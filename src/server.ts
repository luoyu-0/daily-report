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
import {buildCandidates} from './pipeline/run.js';
import {enrichWithLlm} from './pipeline/llm.js';
import {candidateStorySchema} from './shared/types.js';
import {renderEdition} from './render.js';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const editSchema = candidateStorySchema.pick({
  titleZh: true, summaryZh: true, category: true, selected: true, confirmed: true,
}).partial();

export async function createApp(serveWeb = false) {
  const app = Fastify({logger: true, bodyLimit: 1_000_000});

  app.get('/api/health', async () => ({ok: true, time: new Date().toISOString()}));
  app.get('/api/editions/latest', async (_, reply) => getLatestEdition() ?? reply.code(404).send({error: '暂无日报'}));
  app.get('/api/editions/:id', async (request, reply) => {
    const edition = getEdition((request.params as {id: string}).id);
    return edition ?? reply.code(404).send({error: '日报不存在'});
  });
  app.get('/api/editions/:id/events', async (request, reply) => {
    const id = (request.params as {id: string}).id;
    return getEdition(id) ? getEditionEvents(id) : reply.code(404).send({error: '日报不存在'});
  });
  app.post('/api/editions', async (request, reply) => {
    const body = z.object({date: dateSchema}).parse(request.body);
    try {
      const result = await buildCandidates(body.date);
      return reply.code(201).send(result);
    } catch (error) {
      return reply.code(502).send({error: error instanceof Error ? error.message : String(error)});
    }
  });
  app.patch('/api/editions/:id/candidates/:candidateId', async (request, reply) => {
    const {id, candidateId} = request.params as {id: string; candidateId: string};
    let edition = getEdition(id);
    if (!edition) return reply.code(404).send({error: '日报不存在'});
    if (edition.status !== 'draft') edition = forkEdition(edition.id);
    const candidate = edition.candidates.find((item) => item.id === candidateId)
      ?? (edition.parentId ? edition.candidates.find((item) => item.titleOriginal === getEdition(id)?.candidates.find((old) => old.id === candidateId)?.titleOriginal) : undefined);
    if (!candidate) return reply.code(404).send({error: '候选新闻不存在'});
    const patch = editSchema.parse(request.body);
    upsertCandidate({...candidate, ...patch, confirmed: patch.confirmed ?? false});
    logEvent(edition.id, 'review', `更新候选：${candidate.titleOriginal}`, {candidateId: candidate.id, confirmed: patch.confirmed ?? false});
    return getEdition(edition.id);
  });
  app.post('/api/editions/:id/reorder', async (request, reply) => {
    const sourceEdition = getEdition((request.params as {id: string}).id);
    let edition = sourceEdition;
    if (!edition) return reply.code(404).send({error: '日报不存在'});
    if (edition.status !== 'draft') edition = forkEdition(edition.id);
    const {candidateIds} = z.object({candidateIds: z.array(z.string())}).parse(request.body);
    if (new Set(candidateIds).size !== candidateIds.length) return reply.code(400).send({error: '排序中存在重复 ID'});
    const translatedIds = candidateIds.map((candidateId) => {
      if (edition!.candidates.some((item) => item.id === candidateId)) return candidateId;
      const originalTitle = sourceEdition?.candidates.find((item) => item.id === candidateId)?.titleOriginal;
      return edition!.candidates.find((item) => item.titleOriginal === originalTitle)?.id;
    }).filter((id): id is string => Boolean(id));
    const order = new Map(translatedIds.map((candidateId, index) => [candidateId, index]));
    edition.candidates.forEach((candidate) => upsertCandidate({...candidate, position: order.get(candidate.id) ?? candidate.position + candidateIds.length}));
    logEvent(edition.id, 'review', '调整候选排序', {candidateIds: translatedIds});
    return getEdition(edition.id);
  });
  app.post('/api/editions/:id/candidates/:candidateId/regenerate', async (request, reply) => {
    let edition = getEdition((request.params as {id: string; candidateId: string}).id);
    if (!edition) return reply.code(404).send({error: '日报不存在'});
    if (edition.status !== 'draft') edition = forkEdition(edition.id);
    const requestedId = (request.params as {candidateId: string}).candidateId;
    const sourceTitle = getEdition((request.params as {id: string}).id)?.candidates.find((item) => item.id === requestedId)?.titleOriginal;
    const candidate = edition.candidates.find((item) => item.id === requestedId || item.titleOriginal === sourceTitle);
    if (!candidate) return reply.code(404).send({error: '候选新闻不存在'});
    const enriched = await enrichWithLlm(candidate.sources);
    upsertCandidate({...candidate, ...enriched.story, generationMethod: enriched.method, confirmed: false});
    logEvent(edition.id, 'enrichment', `重新生成：${candidate.titleOriginal}`, {candidateId: candidate.id, method: enriched.method, warning: enriched.warning});
    return getEdition(edition.id);
  });
  app.post('/api/editions/:id/approve', async (request, reply) => {
    const edition = getEdition((request.params as {id: string}).id);
    if (!edition) return reply.code(404).send({error: '日报不存在'});
    if (edition.status !== 'draft') return reply.code(409).send({error: '只能批准草稿'});
    const github = edition.candidates.filter((item) => item.section === 'github' && item.selected);
    const selected = edition.candidates.filter((item) => item.section === 'industry' && item.selected);
    if (github.length !== 5) return reply.code(400).send({error: 'GitHub 当天热榜必须包含前 5 条'});
    if (selected.length !== 4) return reply.code(400).send({error: '行业概览必须选择 4 条新闻'});
    if (selected.some((item) => !item.confirmed)) return reply.code(400).send({error: '行业概览的入选新闻必须逐条确认'});
    if ([...github, ...selected].some((item) => !item.sources.length || !item.evidence.length)) return reply.code(400).send({error: '入选内容缺少来源或证据'});
    const approved = updateEditionStatus(edition.id, 'approved');
    logEvent(edition.id, 'approval', '人工批准并锁定日报', {githubIds: github.map((item) => item.id), selectedIds: selected.map((item) => item.id)});
    return approved;
  });
  app.post('/api/editions/:id/render', async (request, reply) => {
    const edition = getEdition((request.params as {id: string}).id);
    if (!edition) return reply.code(404).send({error: '日报不存在'});
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

