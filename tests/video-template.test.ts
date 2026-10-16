import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {activeSubtitleAtFrame, parseLrc} from '../src/video/subtitles.js';
import {getVideoTemplate, videoTemplates} from '../src/video/templates/registry.js';
import type {ToolCandidate} from '../src/shared/types.js';

const dataDir = path.join(process.cwd(), 'data', `video-template-test-${randomUUID()}`);
const previousDataDir = process.env.DATA_DIR;
let db: typeof import('../src/db.js');
let app: Awaited<ReturnType<typeof import('../src/server.js').createApp>>;
let generateSubtitleDraft: typeof import('../src/video/subtitle-generation.js').generateSubtitleDraft;

beforeAll(async () => {
  fs.mkdirSync(dataDir, {recursive: true});
  process.env.DATA_DIR = dataDir;
  vi.resetModules();
  db = await import('../src/db.js');
  ({generateSubtitleDraft} = await import('../src/video/subtitle-generation.js'));
  const {createApp} = await import('../src/server.js');
  app = await createApp(false);
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  await app?.close();
  db?.sqlite.close();
  if (previousDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previousDataDir;
  if (path.dirname(dataDir) === path.join(process.cwd(), 'data') && path.basename(dataDir).startsWith('video-template-test-')) fs.rmSync(dataDir, {recursive: true, force: true});
});

describe('视频模板与字幕轨', () => {
  it('提供两套可替换模板，未注册模板明确失败', () => {
    expect(videoTemplates.map((template) => template.id)).toEqual(['blue-grid', 'dark-signal']);
    expect(getVideoTemplate('blue-grid').render).not.toBe(getVideoTemplate('dark-signal').render);
    expect(() => getVideoTemplate('missing')).toThrow('视频模板不存在');
  });

  it('字幕按毫秒时间段生效，结束边界不重复显示', () => {
    const cues = [{startMs: 1000, endMs: 2000, text: '第一句'}];
    expect(activeSubtitleAtFrame(cues, 29)).toBeUndefined();
    expect(activeSubtitleAtFrame(cues, 30)?.text).toBe('第一句');
    expect(activeSubtitleAtFrame(cues, 60)).toBeUndefined();
  });

  it('导入 LRC 时解析多时间戳、偏移与空白结束标记', () => {
    const cues = parseLrc('[ti:测试]\n[offset:100]\n[00:03.50][00:05.00]第一句\n[00:07.00]\n[00:08.000]第二句', 10_000);
    expect(cues).toEqual([
      {startMs: 3600, endMs: 5100, text: '第一句'},
      {startMs: 5100, endMs: 7100, text: '第一句'},
      {startMs: 8100, endMs: 10_000, text: '第二句'},
    ]);
    expect(() => parseLrc('[00:03.00]甲\n[00:03.00]乙', 10_000)).toThrow('重复时间戳');
    expect(() => parseLrc('[00:12.00]越界', 10_000)).toThrow('超出成片');
    expect(parseLrc('[00:02.00]独立一句', 100_000)[0].endMs).toBe(8000);
  });

  it('LLM 从精简 README 提炼仓库短字幕，非仓库画面留白并复用缓存', async () => {
    const edition = db.createEdition('2026-10-22');
    const tool: ToolCandidate = {
      id: 'subtitle-tool', editionId: edition.id, repo: 'owner/demo-tool', url: 'https://github.com/owner/demo-tool',
      rank: 1, topics: [], archived: false, toolType: '开发工具', oneLinePitchZh: '帮助开发者整理代码结构',
      useCases: ['梳理代码依赖'], targetUsers: ['开发者'], prerequisites: [], caveats: [], utilityScore: 80, toolLikely: true,
      selected: true, confirmed: true, position: 0, generationMethod: 'rule', riskFlags: [],
      sources: [{id: 'subtitle-source', sourceName: 'GitHub', title: 'owner/demo-tool', url: 'https://github.com/owner/demo-tool', content: '项目描述：代码结构工具\nREADME：\n## Features\n支持离线梳理模块关系。\n## Installation\n运行安装命令。', fetchedAt: new Date().toISOString(), primarySource: true}],
      evidence: ['E1: 已审核文案'],
    };
    db.upsertCandidate(tool);
    const latest = db.getEdition(edition.id);
    if (latest?.kind !== 'github-tools') throw new Error('测试日报不存在');
    const fetchMock = vi.fn().mockResolvedValue({ok: true, json: async () => ({choices: [{message: {content: JSON.stringify({toolCaptions: [['离线梳理模块', '看清依赖脉络']]})}}]})});
    vi.stubGlobal('fetch', fetchMock);
    const memory = new Map<string, ReturnType<typeof parseLrc>>();
    const cache = {get: (key: string) => memory.get(key), set: (key: string, cues: ReturnType<typeof parseLrc>) => { memory.set(key, cues); }};
    const settings = {baseUrl: 'https://llm.example/v1', apiKey: 'test-key', model: 'test-model', timeoutMs: 1000};
    const first = await generateSubtitleDraft(latest, settings, cache);
    expect(first.subtitles.map((cue) => cue.text)).toEqual(['离线梳理模块', '看清依赖脉络']);
    expect(first.subtitles[0].startMs).toBeGreaterThan(18_000);
    expect(first.subtitles[1].endMs).toBeLessThan(26_000);
    expect(first.subtitles[1].startMs).toBeGreaterThan(first.subtitles[0].endMs);
    expect(first.cacheHit).toBe(false);
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.messages[1].content).toContain('离线梳理模块关系');
    expect(requestBody.messages[1].content).not.toContain('运行安装命令');
    expect((await generateSubtitleDraft(latest, settings, cache)).cacheHit).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: true, json: async () => ({choices: [{message: {content: JSON.stringify({toolCaptions: [['新增999项功能']]})}}]})}));
    await expect(generateSubtitleDraft(latest, {...settings, model: 'test-model-v2'}, cache)).rejects.toThrow('不存在的数字');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: true, json: async () => ({choices: [{message: {content: JSON.stringify({toolCaptions: [['这一句字幕明显超过十个汉字']]})}}]})}));
    await expect(generateSubtitleDraft(latest, {...settings, model: 'too-long-model'}, cache)).rejects.toThrow('过长');

    const four = ['离线整理模块', '识别依赖关系', '观察结构变化', '聚焦关键节点'];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: true, json: async () => ({choices: [{message: {content: JSON.stringify({toolCaptions: [four]})}}]})}));
    const fourCues = await generateSubtitleDraft(latest, {...settings, model: 'four-cues-model'}, cache);
    expect(fourCues.subtitles).toHaveLength(4);
    expect(fourCues.subtitles[0].startMs).toBeGreaterThan(18_000);
    expect(fourCues.subtitles[3].endMs).toBeLessThan(26_000);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: true, json: async () => ({choices: [{message: {content: JSON.stringify({toolCaptions: [['先看是否适配']]})}}]})}));
    const oneCue = await generateSubtitleDraft(latest, {...settings, model: 'one-cue-model'}, cache);
    expect(oneCue.subtitles).toHaveLength(1);
    expect(oneCue.subtitles[0].startMs).toBeGreaterThan(20_000);
    expect(oneCue.subtitles[0].endMs).toBeLessThan(24_000);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: true, json: async () => ({choices: [{message: {content: JSON.stringify({toolCaptions: [[...four, '最后一条']]})}}]})}));
    await expect(generateSubtitleDraft(latest, {...settings, model: 'five-cues-model'}, cache)).rejects.toThrow('返回结构不符合要求');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: true, json: async () => ({choices: [{message: {content: JSON.stringify({toolCaptions: [['梳理代码依赖']]})}}]})}));
    await expect(generateSubtitleDraft(latest, {...settings, model: 'repeated-cue-model'}, cache)).rejects.toThrow('重复画面');
  });

  it('字幕模型输出被截断时重试并要求符合结构化字幕格式', async () => {
    const edition = db.createEdition('2026-10-23');
    db.upsertCandidate({
      id: 'truncated-subtitle-tool', editionId: edition.id, repo: 'owner/demo', url: 'https://github.com/owner/demo',
      rank: 1, topics: [], archived: false, toolType: '开发工具', oneLinePitchZh: '帮助开发者整理代码结构',
      useCases: ['梳理代码依赖'], targetUsers: ['开发者'], prerequisites: [], caveats: [], utilityScore: 80, toolLikely: true,
      selected: true, confirmed: true, position: 0, generationMethod: 'rule', riskFlags: [],
      sources: [{id: 'truncated-source', sourceName: 'GitHub', title: 'owner/demo', url: 'https://github.com/owner/demo', content: '工具说明', fetchedAt: new Date().toISOString(), primarySource: true}],
      evidence: ['E1: 工具说明'],
    });
    const latest = db.getEdition(edition.id);
    if (latest?.kind !== 'github-tools') throw new Error('测试日报不存在');
    const toolCaptions = [['先看依赖全貌', '再找结构瓶颈']];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ok: true, json: async () => ({choices: [{finish_reason: 'length', message: {content: '{"toolCaptions":[["先看依赖全貌"'}}]})})
      .mockResolvedValueOnce({ok: true, json: async () => ({choices: [{finish_reason: 'stop', message: {content: JSON.stringify({toolCaptions})}}]})});
    vi.stubGlobal('fetch', fetchMock);
    const cache = {get: () => undefined, set: vi.fn()};
    const result = await generateSubtitleDraft(latest, {baseUrl: 'https://llm.example/v1', apiKey: 'test-key', model: 'test-model', timeoutMs: 1000}, cache);
    expect(result.subtitles.map((cue) => cue.text)).toEqual(toolCaptions[0]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.response_format).toMatchObject({type: 'json_schema', json_schema: {strict: true}});
    expect(request.max_tokens).toBeGreaterThan(500);
    expect(request.response_format.json_schema.schema).toMatchObject({
      required: ['toolCaptions'], additionalProperties: false,
      properties: {toolCaptions: {type: 'array', items: {type: 'array', items: {type: 'string'}}}},
    });
    const retry = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(retry.max_tokens).toBeGreaterThan(request.max_tokens);

    const fallbackMock = vi.fn()
      .mockResolvedValueOnce({ok: false, status: 400, text: async () => 'response_format json_schema is not supported'})
      .mockResolvedValueOnce({ok: true, json: async () => ({choices: [{finish_reason: 'stop', message: {content: JSON.stringify({toolCaptions})}}]})});
    vi.stubGlobal('fetch', fallbackMock);
    expect((await generateSubtitleDraft(latest, {baseUrl: 'https://llm.example/v1', apiKey: 'test-key', model: 'fallback-model', timeoutMs: 1000}, cache)).subtitles).toHaveLength(2);
    expect(JSON.parse(fallbackMock.mock.calls[1][1].body).response_format).toEqual({type: 'json_object'});

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: true, json: async () => ({choices: [{finish_reason: 'length', message: {content: ''}}]})}));
    await expect(generateSubtitleDraft(latest, {baseUrl: 'https://llm.example/v1', apiKey: 'test-key', model: 'empty-model', timeoutMs: 1000}, cache)).rejects.toThrow('输出被截断或为空');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: true, json: async () => ({choices: [{finish_reason: 'stop', message: {content: '{"toolCaptions":[["正常",42]]}'}}]})}));
    await expect(generateSubtitleDraft(latest, {baseUrl: 'https://llm.example/v1', apiKey: 'test-key', model: 'invalid-shape-model', timeoutMs: 1000}, cache)).rejects.toThrow('返回结构不符合要求');
  });

  it('切换模板和字幕后持久化；已批准日报修改时创建新版本', async () => {
    const edition = db.createEdition('2026-10-20');
    const templates = await app.inject({method: 'GET', url: '/api/video-templates'});
    expect(templates.json().map((item: {id: string}) => item.id)).toContain('dark-signal');
    const videoConfig = {templateId: 'dark-signal', subtitles: [{startMs: 3000, endMs: 5500, text: '今日工具推荐'}]};
    const saved = await app.inject({method: 'PUT', url: `/api/editions/${edition.id}/video-config`, payload: videoConfig});
    expect(saved.statusCode).toBe(200);
    expect(db.getEdition(edition.id)).toMatchObject({videoConfig});
    db.updateEditionStatus(edition.id, 'approved');
    const changed = await app.inject({method: 'PUT', url: `/api/editions/${edition.id}/video-config`, payload: {...videoConfig, subtitles: []}});
    expect(changed.statusCode).toBe(200);
    expect(changed.json().id).not.toBe(edition.id);
    expect(changed.json().videoConfig).toEqual({...videoConfig, subtitles: []});
    expect(db.getEdition(edition.id)).toMatchObject({videoConfig});
  });

  it('拒绝未知模板、重叠字幕和超出片长的字幕', async () => {
    const edition = db.createEdition('2026-10-21');
    const put = (payload: {templateId: string; subtitles: Array<{startMs: number; endMs: number; text: string}>}) => app.inject({method: 'PUT', url: `/api/editions/${edition.id}/video-config`, payload});
    expect((await put({templateId: 'missing', subtitles: []})).statusCode).toBe(400);
    expect((await put({templateId: 'blue-grid', subtitles: [{startMs: 1000, endMs: 3000, text: '甲'}, {startMs: 2000, endMs: 4000, text: '乙'}]})).statusCode).toBe(400);
    expect((await put({templateId: 'blue-grid', subtitles: [{startMs: 0, endMs: 999999, text: '超时'}]})).statusCode).toBe(400);
    const current = db.getEdition(edition.id);
    expect(current?.kind).toBe('github-tools');
    if (current?.kind === 'github-tools') expect(current.videoConfig.templateId).toBe('blue-grid');
  });
});
