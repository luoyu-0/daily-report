import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import {z} from 'zod';
import {config} from './config.js';
import {
  createRenderJob, forkEdition, getEdition, getEditionEvents, getLatestEdition, getRenderJob, logEvent,
  updateEditionStatus, upsertCandidate,
} from './db.js';
import {buildCandidates, mapWithConcurrency} from './pipeline/run.js';
import {buildToolEvidence, enrichToolWithLlm} from './pipeline/llm.js';
import {toolCandidateSchema, type DiscoveryEdition} from './shared/types.js';
import {REVIEW_API_VERSION, REVIEW_APP_ID} from './shared/review-contract.js';
import {renderEdition} from './render.js';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const editSchema = toolCandidateSchema.pick({
  oneLinePitchZh: true, toolType: true, useCases: true, targetUsers: true, selected: true, confirmed: true,
}).partial();

const discoveryEdition = (id: string): DiscoveryEdition | undefined => {
  const edition = getEdition(id);
  return edition?.kind === 'github-tools' ? edition : undefined;
};

export function validateApproval(edition: DiscoveryEdition): string | undefined {
  const selected = edition.candidates.filter((item) => item.selected);
  if (selected.length < 3 || selected.length > 5) return '每日精选必须选择 3～5 个工具';
  if (selected.some((item) => !item.confirmed)) return '入选工具必须逐条确认';
  if (selected.some((item) => !item.sources.length || !item.evidence.length)) return '入选工具缺少来源或证据';
  if (selected.some((item) => !item.oneLinePitchZh.trim() || !item.useCases.length || !item.targetUsers.length)) {
    return '入选工具必须填写推荐语、使用场景和适合人群';
  }
  return undefined;
}

export async function createApp(serveWeb = false) {
  const app = Fastify({logger: true, bodyLimit: 1_000_000});

  app.get('/api/health', async () => ({ok: true, app: REVIEW_APP_ID, apiVersion: REVIEW_API_VERSION, time: new Date().toISOString()}));
  app.get('/api/editions/latest', async (_, reply) => getLatestEdition() ?? reply.code(404).send({error: '暂无工具雷达日报'}));
  app.get('/api/editions/:id', async (request, reply) => getEdition((request.params as {id: string}).id) ?? reply.code(404).send({error: '日报不存在'}));
  app.get('/api/editions/:id/events', async (request, reply) => {
    const id = (request.params as {id: string}).id;
    return getEdition(id) ? getEditionEvents(id) : reply.code(404).send({error: '日报不存在'});
  });
  app.post('/api/editions', async (request, reply) => {
    const body = z.object({date: dateSchema}).parse(request.body);
    try { return reply.code(201).send(await buildCandidates(body.date)); }
    catch (error) { return reply.code(502).send({error: error instanceof Error ? error.message : String(error)}); }
  });
  app.patch('/api/editions/:id/candidates/:candidateId', async (request, reply) => {
    const {id, candidateId} = request.params as {id: string; candidateId: string};
    const sourceEdition = discoveryEdition(id);
    if (!sourceEdition) return reply.code(404).send({error: '工具日报不存在'});
    const originalRepo = sourceEdition.candidates.find((item) => item.id === candidateId)?.repo;
    const edition = sourceEdition.status === 'draft' ? sourceEdition : forkEdition(sourceEdition.id);
    const candidate = edition.candidates.find((item) => item.id === candidateId || item.repo === originalRepo);
    if (!candidate) return reply.code(404).send({error: '候选工具不存在'});
    const patch = editSchema.parse(request.body);
    upsertCandidate({...candidate, ...patch, confirmed: patch.confirmed ?? false});
    logEvent(edition.id, 'review', `更新工具：${candidate.repo}`, {candidateId: candidate.id, confirmed: patch.confirmed ?? false});
    return discoveryEdition(edition.id);
  });
  app.post('/api/editions/:id/reorder', async (request, reply) => {
    const sourceEdition = discoveryEdition((request.params as {id: string}).id);
    if (!sourceEdition) return reply.code(404).send({error: '工具日报不存在'});
    const edition = sourceEdition.status === 'draft' ? sourceEdition : forkEdition(sourceEdition.id);
    const {candidateIds} = z.object({candidateIds: z.array(z.string())}).parse(request.body);
    if (new Set(candidateIds).size !== candidateIds.length) return reply.code(400).send({error: '排序中存在重复 ID'});
    const repos = candidateIds.map((candidateId) => sourceEdition.candidates.find((item) => item.id === candidateId)?.repo);
    const ids = repos.map((repo) => edition.candidates.find((item) => item.repo === repo)?.id).filter((id): id is string => Boolean(id));
    const order = new Map(ids.map((candidateId, index) => [candidateId, index]));
    edition.candidates.forEach((candidate) => upsertCandidate({...candidate, position: order.get(candidate.id) ?? candidate.position + ids.length}));
    logEvent(edition.id, 'review', '调整工具排序', {candidateIds: ids});
    return discoveryEdition(edition.id);
  });
  app.post('/api/editions/:id/candidates/:candidateId/regenerate', async (request, reply) => {
    const {id, candidateId} = request.params as {id: string; candidateId: string};
    const sourceEdition = discoveryEdition(id);
    if (!sourceEdition) return reply.code(404).send({error: '工具日报不存在'});
    const originalRepo = sourceEdition.candidates.find((item) => item.id === candidateId)?.repo;
    const edition = sourceEdition.status === 'draft' ? sourceEdition : forkEdition(sourceEdition.id);
    const candidate = edition.candidates.find((item) => item.id === candidateId || item.repo === originalRepo);
    if (!candidate) return reply.code(404).send({error: '候选工具不存在'});
    const enriched = await enrichToolWithLlm(candidate);
    upsertCandidate({...candidate, ...enriched.tool, generationMethod: enriched.method, confirmed: false});
    logEvent(edition.id, 'enrichment', `重新提炼：${candidate.repo}`, {candidateId: candidate.id, method: enriched.method, cacheHit: enriched.cacheHit, warning: enriched.warning});
    return discoveryEdition(edition.id);
  });
  app.post('/api/editions/:id/optimize-selected', async (request, reply) => {
    const sourceEdition = discoveryEdition((request.params as {id: string}).id);
    if (!sourceEdition) return reply.code(404).send({error: '工具日报不存在'});
    if (!config.llm.apiKey || !config.llm.model) return reply.code(400).send({error: '尚未配置 LLM API key 或模型'});
    const edition = sourceEdition.status === 'draft' ? sourceEdition : forkEdition(sourceEdition.id);
    const targets = edition.candidates.filter((item) => item.selected && item.generationMethod !== 'llm');
    if (targets.length > 5) return reply.code(400).send({error: '单次最多优化 5 个工具'});
    if (!targets.length) return {edition, requested: 0, optimized: 0, fallback: 0, cacheHits: 0, inputChars: 0, warnings: []};
    const warnings: string[] = [];
    let optimized = 0; let fallback = 0; let cacheHits = 0; let inputChars = 0;
    await mapWithConcurrency(targets, Math.min(2, config.llm.concurrency), async (candidate) => {
      const enriched = await enrichToolWithLlm(candidate);
      if (enriched.cacheHit) cacheHits += 1;
      else inputChars += buildToolEvidence(candidate, config.llm.evidenceMaxChars).length;
      if (enriched.method === 'llm') optimized += 1;
      else { fallback += 1; if (enriched.warning) warnings.push(`${candidate.repo}：${enriched.warning}`); }
      upsertCandidate({...candidate, ...enriched.tool, generationMethod: enriched.method, confirmed: false});
      logEvent(edition.id, 'enrichment', `按需优化：${candidate.repo}`, {candidateId: candidate.id, method: enriched.method, cacheHit: enriched.cacheHit, warning: enriched.warning});
    });
    return {edition: discoveryEdition(edition.id)!, requested: targets.length, optimized, fallback, cacheHits, inputChars, warnings};
  });
  app.post('/api/editions/:id/approve', async (request, reply) => {
    const edition = discoveryEdition((request.params as {id: string}).id);
    if (!edition) return reply.code(404).send({error: '工具日报不存在'});
    if (edition.status !== 'draft') return reply.code(409).send({error: '只能批准草稿'});
    const approvalError = validateApproval(edition);
    if (approvalError) return reply.code(400).send({error: approvalError});
    const selected = edition.candidates.filter((item) => item.selected);
    const approved = updateEditionStatus(edition.id, 'approved');
    logEvent(edition.id, 'approval', '人工批准并锁定工具日报', {selectedIds: selected.map((item) => item.id)});
    return approved;
  });
  app.post('/api/editions/:id/render', async (request, reply) => {
    const edition = discoveryEdition((request.params as {id: string}).id);
    if (!edition) return reply.code(404).send({error: '工具日报不存在'});
    if (edition.status !== 'approved') return reply.code(409).send({error: '只有已批准日报才能渲染'});
    const job = createRenderJob(edition.id);
    void renderEdition(edition.id, job).catch((error) => app.log.error(error));
    return reply.code(202).send(job);
  });
  app.get('/api/render-jobs/:id', async (request, reply) => getRenderJob((request.params as {id: string}).id) ?? reply.code(404).send({error: '任务不存在'}));

  if (serveWeb && fs.existsSync(path.join(config.rootDir, 'dist', 'web'))) {
    await app.register(fastifyStatic, {root: path.join(config.rootDir, 'dist', 'web')});
    app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({error: 'Not found'}) : reply.sendFile('index.html'));
  }
  return app;
}

export async function startServer(port = config.appPort, serveWeb = process.env.NODE_ENV === 'production') {
  const app = await createApp(serveWeb);
  await app.listen({host: '127.0.0.1', port});
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startServer().catch((error) => { console.error(error); process.exitCode = 1; });
}
