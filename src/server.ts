import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import Fastify, {LogController} from 'fastify';
import fastifyStatic from '@fastify/static';
import {z} from 'zod';
import {config} from './config.js';
import {
  createRenderJob, deleteRepoLock, forkEdition, getEdition, getEditionEvents, getLatestEdition, getLatestRenderJob, getLockedRepos, getRenderJob, getTodayLockedRepos, logEvent, resetTodayRepoLock, saveRenderJob,
  updateEditionStatus, upsertCandidate,
} from './db.js';
import {buildCandidates, mapWithConcurrency} from './pipeline/run.js';
import {buildToolEvidence, enrichToolWithLlm} from './pipeline/llm.js';
import {toolCandidateSchema, type DiscoveryEdition} from './shared/types.js';
import {REVIEW_API_VERSION, REVIEW_APP_ID} from './shared/review-contract.js';
import {cancelRenderJob, renderEdition} from './render.js';
import {currentChinaDate} from './shared/date.js';
import {bgmPath, clearBgm, getBgmStatus, MAX_BGM_BYTES, saveBgm} from './audio/bgm.js';
import type {ReviewLifecycle} from './shared/review-lifecycle.js';

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
  if (selected.length < 1 || selected.length > 10) return '每期必须选择 1～10 个工具';
  if (selected.some((item) => !item.sources.length || !item.evidence.length)) return '入选工具缺少来源或证据';
  if (selected.some((item) => !item.oneLinePitchZh.trim() || !item.useCases.length || !item.targetUsers.length)) {
    return '入选工具必须填写推荐语、使用场景和适合人群';
  }
  return undefined;
}

export const getOptimizationTargets = (edition: DiscoveryEdition) =>
  edition.candidates.filter((item) => item.generationMethod !== 'llm');

export async function createApp(serveWeb = false, launchRender = renderEdition, reviewLifecycle?: ReviewLifecycle) {
  const app = Fastify({logger: true, logController: new LogController({disableRequestLogging: true}), bodyLimit: 1_000_000});
  app.addContentTypeParser('application/octet-stream', {parseAs: 'buffer', bodyLimit: MAX_BGM_BYTES}, (_, body, done) => done(null, body));

  await app.register(fastifyStatic, {root: path.dirname(bgmPath()), prefix: '/api/audio/files/', decorateReply: false});

  app.get('/api/health', async () => ({ok: true, app: REVIEW_APP_ID, apiVersion: REVIEW_API_VERSION, time: new Date().toISOString()}));
  if (reviewLifecycle) {
    app.post('/api/review-sessions/:id/ping', async (request) => {
      reviewLifecycle.ping((request.params as {id: string}).id);
      return {ok: true};
    });
    app.post('/api/review-sessions/:id/leave', async (request) => {
      reviewLifecycle.leave((request.params as {id: string}).id);
      return {ok: true};
    });
  }
  app.get('/api/audio/bgm', getBgmStatus);
  app.put('/api/audio/bgm', {bodyLimit: MAX_BGM_BYTES}, async (request, reply) => {
    if (!Buffer.isBuffer(request.body)) return reply.code(400).send({error: '请上传 MP3 文件'});
    try { return await saveBgm(request.body); }
    catch (error) { return reply.code(400).send({error: error instanceof Error ? error.message : String(error)}); }
  });
  app.delete('/api/audio/bgm', clearBgm);
  app.get('/api/editions/latest', async (_, reply) => getLatestEdition() ?? reply.code(404).send({error: '暂无工具雷达日报'}));
  app.get('/api/editions/:id', async (request, reply) => getEdition((request.params as {id: string}).id) ?? reply.code(404).send({error: '日报不存在'}));
  app.get('/api/editions/:id/events', async (request, reply) => {
    const id = (request.params as {id: string}).id;
    return getEdition(id) ? getEditionEvents(id) : reply.code(404).send({error: '日报不存在'});
  });
  app.get('/api/editions/:id/render-job', async (request, reply) => getLatestRenderJob((request.params as {id: string}).id) ?? reply.code(404).send({error: '暂无渲染任务'}));
  app.get('/api/repo-locks', async () => ({repos: getLockedRepos()}));
  app.post('/api/repo-locks/delete', async (request, reply) => {
    const {date, repo} = z.object({date: dateSchema, repo: z.string().min(3)}).parse(request.body);
    if (!deleteRepoLock(date, repo)) return reply.code(404).send({error: '锁定记录不存在'});
    return {repos: getLockedRepos()};
  });
  app.get('/api/repo-locks/today', async () => ({date: currentChinaDate(), repos: getTodayLockedRepos(currentChinaDate())}));
  app.post('/api/repo-locks/today/reset', async (request, reply) => {
    const {repo} = z.object({repo: z.string().min(3)}).parse(request.body);
    const date = currentChinaDate();
    if (!resetTodayRepoLock(date, repo)) return reply.code(404).send({error: '该仓库今天没有已渲染的锁定记录'});
    return {date, repos: getTodayLockedRepos(date)};
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
    upsertCandidate({...candidate, ...patch, confirmed: patch.confirmed ?? candidate.confirmed});
    logEvent(edition.id, 'review', `更新工具：${candidate.repo}`, {candidateId: candidate.id, selected: patch.selected ?? candidate.selected});
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
  app.post('/api/editions/:id/optimize-all', async (request, reply) => {
    const sourceEdition = discoveryEdition((request.params as {id: string}).id);
    if (!sourceEdition) return reply.code(404).send({error: '工具日报不存在'});
    if (!config.llm.apiKey || !config.llm.model) return reply.code(400).send({error: '尚未配置 LLM API key 或模型'});
    const edition = sourceEdition.status === 'draft' ? sourceEdition : forkEdition(sourceEdition.id);
    const targets = getOptimizationTargets(edition);
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
    logEvent(edition.id, 'approval', '人工批准工具日报；成功渲染后锁定入选仓库', {selectedIds: selected.map((item) => item.id)});
    return approved;
  });
  app.post('/api/editions/:id/render', async (request, reply) => {
    const edition = discoveryEdition((request.params as {id: string}).id);
    if (!edition) return reply.code(404).send({error: '工具日报不存在'});
    if (!z.object({confirm: z.literal(true)}).safeParse(request.body).success) return reply.code(400).send({error: '需要在二次确认后才能渲染成片'});
    if (edition.status !== 'draft' && edition.status !== 'approved') return reply.code(409).send({error: '只有待审核或已批准日报才能渲染'});
    const approvalError = validateApproval(edition);
    if (approvalError) return reply.code(400).send({error: approvalError});
    if (edition.status === 'draft') {
      for (const candidate of edition.candidates.filter((item) => item.selected)) upsertCandidate({...candidate, confirmed: true});
      updateEditionStatus(edition.id, 'approved');
      logEvent(edition.id, 'approval', '用户二次确认并开始渲染', {selectedRepos: edition.candidates.filter((item) => item.selected).map((item) => item.repo)});
    }
    const job = createRenderJob(edition.id);
    void launchRender(edition.id, job).catch((error) => app.log.error(error));
    return reply.code(202).send(job);
  });
  app.get('/api/render-jobs/:id', async (request, reply) => getRenderJob((request.params as {id: string}).id) ?? reply.code(404).send({error: '任务不存在'}));
  app.post('/api/render-jobs/:id/cancel', async (request, reply) => {
    const id = (request.params as {id: string}).id;
    const job = getRenderJob(id);
    if (!job) return reply.code(404).send({error: '任务不存在'});
    if (job.status === 'canceling') return job;
    if (!['queued', 'running'].includes(job.status) || !cancelRenderJob(id)) return reply.code(409).send({error: '渲染任务已结束或不在当前服务中运行'});
    const canceling = {...job, status: 'canceling' as const, updatedAt: new Date().toISOString(), logs: [...job.logs, '正在取消渲染并清理临时文件']};
    saveRenderJob(canceling);
    return canceling;
  });

  if (serveWeb && fs.existsSync(path.join(config.rootDir, 'dist', 'web'))) {
    await app.register(fastifyStatic, {root: path.join(config.rootDir, 'dist', 'web')});
    app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({error: 'Not found'}) : reply.sendFile('index.html'));
  }
  return app;
}

export async function startServer(port = config.appPort, serveWeb = process.env.NODE_ENV === 'production', reviewLifecycle?: ReviewLifecycle) {
  const app = await createApp(serveWeb, renderEdition, reviewLifecycle);
  await app.listen({host: '127.0.0.1', port});
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startServer().catch((error) => { console.error(error); process.exitCode = 1; });
}
