import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import type {RepositoryProfile} from '../src/pipeline/collectors.js';

const cacheRoot = path.resolve(process.cwd(), 'data');
const dataDir = path.join(cacheRoot, `daily-history-${randomUUID()}`);
const previousDataDir = process.env.DATA_DIR;
let buildCandidates: typeof import('../src/pipeline/run.js').buildCandidates;
let upsertCandidate: typeof import('../src/db.js').upsertCandidate;
let createEdition: typeof import('../src/db.js').createEdition;
let updateEditionStatus: typeof import('../src/db.js').updateEditionStatus;
let getTodayLockedRepos: typeof import('../src/db.js').getTodayLockedRepos;
let getToolHistory: typeof import('../src/db.js').getToolHistory;
let deleteRepoLock: typeof import('../src/db.js').deleteRepoLock;
let resetTodayRepoLock: typeof import('../src/db.js').resetTodayRepoLock;
let sqlite: typeof import('../src/db.js').sqlite;

const profile = (number: number, rank = number, readme = '# 功能\n本地工具'): RepositoryProfile => ({
  repo: `owner/tool-${number}`, url: `https://github.com/owner/tool-${number}`, rank,
  description: `Tool ${number}`, fetchedAt: new Date().toISOString(), primarySource: true,
  topics: [], archived: false, readme,
});

beforeAll(async () => {
  fs.mkdirSync(cacheRoot, {recursive: true});
  fs.mkdirSync(dataDir);
  process.env.DATA_DIR = dataDir;
  vi.resetModules();
  ({buildCandidates} = await import('../src/pipeline/run.js'));
  ({upsertCandidate, createEdition, updateEditionStatus, getTodayLockedRepos, getToolHistory, deleteRepoLock, resetTodayRepoLock, sqlite} = await import('../src/db.js'));
});

afterEach(() => vi.unstubAllGlobals());

afterAll(() => {
  sqlite?.close();
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  if (path.dirname(dataDir) === cacheRoot && path.basename(dataDir).startsWith('daily-history-')) {
    fs.rmSync(dataDir, {recursive: true, force: true});
  }
});

describe('本地日报复用', () => {
  it('同一天重新采集时跳过已成片锁定的仓库并补足候选', async () => {
    const date = '2026-10-19';
    const first = await buildCandidates(date, [120, 121, 122].map((number) => profile(number)));
    const lockedRepo = 'owner/tool-120';
    for (const candidate of first.edition.candidates) {
      upsertCandidate({...candidate, selected: candidate.repo === lockedRepo, confirmed: true});
    }
    updateEditionStatus(first.edition.id, 'rendered');

    const entries = Array.from({length: 16}, (_, index) => profile(index + 120, index + 1));
    const second = await buildCandidates(date, entries);
    expect(getTodayLockedRepos(date)).toContain(lockedRepo);
    expect(second.skippedHistorical).toBe(1);
    expect(second.edition.candidates).toHaveLength(15);
    expect(second.edition.candidates.map((item) => item.repo)).not.toContain(lockedRepo);
    expect(second.edition.candidates[0].repo).toBe('owner/tool-121');

    expect(deleteRepoLock(date, lockedRepo)).toBe(true);
    const third = await buildCandidates(date, entries);
    expect(third.edition.candidates[0].repo).toBe(lockedRepo);
  });

  it('仅成功渲染且入选的历史仓库被跳过；同日重跑保留已优化文案和证据', async () => {
    const historical = await buildCandidates('2026-10-10', [1, 2, 3, 4, 5].map((number) => profile(number)));
    const locked = historical.edition.candidates.find((item) => item.repo === 'owner/tool-1')!;
    for (const candidate of historical.edition.candidates) upsertCandidate({...candidate, selected: candidate.id === locked.id, confirmed: true});
    updateEditionStatus(historical.edition.id, 'rendered');
    const incoming = [profile(1, 1), ...[6, 7, 8, 9, 10].map((number, index) => profile(number, index + 2))];
    const first = await buildCandidates('2026-10-11', incoming);
    expect(first.edition.candidates.map((item) => item.repo)).not.toContain('owner/tool-1');
    expect(first.edition.candidates).toHaveLength(5);

    const reviewed = first.edition.candidates.find((item) => item.repo === 'owner/tool-6')!;
    upsertCandidate({...reviewed, generationMethod: 'llm', oneLinePitchZh: '人工确认的中文工具概述',
      useCases: ['整理本地资料'], selected: true, confirmed: true});
    const laterRules = createEdition('2026-10-11');
    upsertCandidate({...reviewed, id: `tool_${randomUUID()}`, editionId: laterRules.id,
      generationMethod: 'rule', oneLinePitchZh: '重跑生成的规则文案', confirmed: false});
    const changed = incoming.map((item) => item.repo === 'owner/tool-6'
      ? {...item, rank: 3, readme: '# 变化\n不应覆盖已保存证据'} : item);
    const second = await buildCandidates('2026-10-11', changed);
    const reused = second.edition.candidates.find((item) => item.repo === 'owner/tool-6')!;
    expect(reused.generationMethod).toBe('llm');
    expect(reused.oneLinePitchZh).toBe('人工确认的中文工具概述');
    expect(reused.useCases).toEqual(['整理本地资料']);
    expect(reused.sources).toEqual(reviewed.sources);
    expect(reused.rank).toBe(3);
    expect(reused.confirmed).toBe(false);
  });

  it('同日重跑只抓取尚未缓存的新仓库详情', async () => {
    const historical = await buildCandidates('2026-10-09', [20, 21, 22, 23, 24].map((number) => profile(number)));
    const locked = historical.edition.candidates.find((item) => item.repo === 'owner/tool-20')!;
    for (const candidate of historical.edition.candidates) upsertCandidate({...candidate, selected: candidate.id === locked.id, confirmed: true});
    updateEditionStatus(historical.edition.id, 'rendered');
    const {currentChinaDate} = await import('../src/shared/date.js');
    const today = currentChinaDate();
    let apiCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/trending?')) {
        const html = [20, 25, 26, 27, 28, 29].map((number) =>
          `<article><h2><a href="/owner/tool-${number}">owner/tool-${number}</a></h2><p>Useful tool</p></article>`).join('');
        return new Response(html, {status: 200});
      }
      if (url.includes('/trending/')) return new Response('', {status: 404});
      apiCalls += 1;
      if (url.endsWith('/readme')) return new Response('# 功能\n工具说明', {status: 200});
      if (url.endsWith('/languages')) return new Response(JSON.stringify({TypeScript: 70, Python: 20, Go: 10}), {status: 200});
      return new Response(JSON.stringify({description: 'Useful tool', language: 'TypeScript',
        stargazers_count: 10, forks_count: 1, topics: [], archived: false}), {status: 200});
    }));
    const first = await buildCandidates(today);
    expect(first.skippedHistorical).toBe(1);
    expect(first.edition.candidates).toHaveLength(5);
    expect(apiCalls).toBe(15);
    const second = await buildCandidates(today);
    expect(second.reusedToday).toBe(5);
    expect(apiCalls).toBe(15);
  });

  it('审核 API 保存的 LLM 优化结果会被同日新日报复用', async () => {
    const first = await buildCandidates('2026-10-11', [30, 31, 32, 33, 34].map((number) => profile(number)));
    const {config} = await import('../src/config.js');
    const previous = {...config.llm};
    config.llm.apiKey = 'fixture-key';
    config.llm.model = 'fixture-model';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({
      oneLinePitchZh: '帮助开发者整理本地资料的工具', toolType: '开发工具',
      useCases: ['整理本地资料'], targetUsers: ['开发者'], sourceRefs: ['E1'], confidence: 0.9, riskFlags: [],
    })}}]}), {status: 200}));
    vi.stubGlobal('fetch', fetchMock);
    const {createApp} = await import('../src/server.js');
    const app = await createApp(false);
    try {
      const candidate = first.edition.candidates.find((item) => item.repo === 'owner/tool-30')!;
      const response = await app.inject({method: 'POST',
        url: `/api/editions/${first.edition.id}/candidates/${candidate.id}/regenerate`});
      expect(response.statusCode).toBe(200);
      expect(response.json().candidates.find((item: {repo: string}) => item.repo === candidate.repo).generationMethod).toBe('llm');
      const second = await buildCandidates('2026-10-11', [30, 31, 32, 33, 34].map((number) => profile(number)));
      const reused = second.edition.candidates.find((item) => item.repo === candidate.repo)!;
      expect(reused.oneLinePitchZh).toBe('帮助开发者整理本地资料的工具');
      expect(reused.generationMethod).toBe('llm');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      Object.assign(config.llm, previous);
      await app.close();
    }
  });

  it('全部为已渲染的历史入选仓库时不重新采集详情，并给出候选不足提示', async () => {
    const historical = await buildCandidates('2026-10-12', [1, 2, 3, 4, 5].map((number) => profile(number)));
    for (const candidate of historical.edition.candidates) upsertCandidate({...candidate, selected: true, confirmed: true});
    updateEditionStatus(historical.edition.id, 'rendered');
    const result = await buildCandidates('2026-10-13', [1, 2, 3, 4, 5].map((number) => profile(number)));
    expect(result.edition.candidates).toHaveLength(0);
    expect(result.skippedHistorical).toBe(5);
    expect(result.warnings.join(' ')).toContain('无法渲染成片');
  });

  it('当日可人工重置已渲染仓库锁定，其他仓库不受影响', async () => {
    const {currentChinaDate} = await import('../src/shared/date.js');
    const today = currentChinaDate();
    const result = await buildCandidates(today, [40, 41, 42].map((number) => profile(number)));
    const locked = result.edition.candidates[0];
    upsertCandidate({...locked, selected: true, confirmed: true});
    updateEditionStatus(result.edition.id, 'rendered');
    expect(getTodayLockedRepos(today)).toContain(locked.repo);
    expect(resetTodayRepoLock(today, locked.repo)).toBe(true);
    expect(getTodayLockedRepos(today)).not.toContain(locked.repo);
    expect(resetTodayRepoLock(today, locked.repo)).toBe(false);
  });

  it('热榜前列已有历史锁定仓库时继续向后取足 15 条', async () => {
    const historical = await buildCandidates('2026-10-14', [50, 51, 52, 53, 54].map((number) => profile(number)));
    for (const candidate of historical.edition.candidates) upsertCandidate({...candidate, selected: true, confirmed: true});
    updateEditionStatus(historical.edition.id, 'rendered');
    const entries = Array.from({length: 20}, (_, index) => profile(index + 50, index + 1));
    const result = await buildCandidates('2026-10-15', entries);
    expect(result.skippedHistorical).toBe(5);
    expect(result.edition.candidates).toHaveLength(15);
    expect(result.edition.candidates[0].repo).toBe('owner/tool-55');
    expect(result.edition.candidates.at(-1)?.repo).toBe('owner/tool-69');
  });

  it('审核台接口只允许重置今天已成片入选的仓库', async () => {
    const {currentChinaDate} = await import('../src/shared/date.js');
    const today = currentChinaDate();
    const result = await buildCandidates(today, [80, 81, 82].map((number) => profile(number)));
    const locked = result.edition.candidates[0];
    upsertCandidate({...locked, selected: true, confirmed: true});
    updateEditionStatus(result.edition.id, 'rendered');
    const {createApp} = await import('../src/server.js');
    const app = await createApp(false);
    try {
      const before = await app.inject({method: 'GET', url: '/api/repo-locks/today'});
      expect(before.json().repos).toContain(locked.repo);
      const reset = await app.inject({method: 'POST', url: '/api/repo-locks/today/reset', payload: {repo: locked.repo}});
      expect(reset.statusCode).toBe(200);
      expect(reset.json().repos).not.toContain(locked.repo);
      const repeat = await app.inject({method: 'POST', url: '/api/repo-locks/today/reset', payload: {repo: locked.repo}});
      expect(repeat.statusCode).toBe(404);
    } finally { await app.close(); }
  });

  it('审核台可读取以往已成片入选仓库的锁定记录', async () => {
    const historical = await buildCandidates('2026-10-06', [90, 91, 92].map((number) => profile(number)));
    const locked = historical.edition.candidates[0];
    upsertCandidate({...locked, selected: true, confirmed: true});
    updateEditionStatus(historical.edition.id, 'rendered');
    const {createApp} = await import('../src/server.js');
    const app = await createApp(false);
    try {
      const response = await app.inject({method: 'GET', url: '/api/repo-locks'});
      expect(response.statusCode).toBe(200);
      expect(response.json().repos).toContainEqual({date: '2026-10-06', repo: locked.repo});
    } finally { await app.close(); }
  });

  it('允许删除历史日期的锁定记录，保留原成片与审核数据', async () => {
    const historical = await buildCandidates('2026-10-05', [93].map((number) => profile(number)));
    updateEditionStatus(historical.edition.id, 'rendered');
    const repo = historical.edition.candidates[0].repo;
    const {createApp} = await import('../src/server.js');
    const app = await createApp(false);
    try {
      const response = await app.inject({method: 'POST', url: '/api/repo-locks/delete', payload: {date: '2026-10-05', repo}});
      expect(response.statusCode).toBe(200);
      expect(response.json().repos).not.toContainEqual({date: '2026-10-05', repo});
      expect(getToolHistory('2026-10-06').previousRepos.has(repo.toLowerCase())).toBe(false);
      expect((sqlite.prepare('SELECT status FROM editions WHERE id=?').get(historical.edition.id) as {status: string}).status).toBe('rendered');
      const repeat = await app.inject({method: 'POST', url: '/api/repo-locks/delete', payload: {date: '2026-10-05', repo}});
      expect(repeat.statusCode).toBe(404);
    } finally { await app.close(); }
  });

  it('新日报按榜单顺序默认入选前十个，同日重跑也保持该默认值', async () => {
    const entries = Array.from({length: 15}, (_, index) => profile(index + 100, index + 1));
    const first = await buildCandidates('2026-10-16', entries);
    expect(first.edition.candidates.filter((item) => item.selected).map((item) => item.repo))
      .toEqual(entries.slice(0, 10).map((item) => item.repo));
    const second = await buildCandidates('2026-10-16', entries);
    expect(second.edition.candidates.filter((item) => item.selected)).toHaveLength(10);
  });

  it('渲染 API 必须收到二次确认，拒绝后保持草稿且不创建任务', async () => {
    const result = await buildCandidates('2026-10-17', [110, 111, 112].map((number) => profile(number)));
    const {createApp} = await import('../src/server.js');
    const app = await createApp(false);
    try {
      const response = await app.inject({method: 'POST', url: `/api/editions/${result.edition.id}/render`});
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('二次确认');
      const status = sqlite.prepare('SELECT status FROM editions WHERE id=?').get(result.edition.id) as {status: string};
      expect(status.status).toBe('draft');
      const jobs = sqlite.prepare('SELECT COUNT(*) AS count FROM render_jobs WHERE edition_id=?').get(result.edition.id) as {count: number};
      expect(jobs.count).toBe(0);
    } finally { await app.close(); }
  });

  it('草稿经二次确认后直接启动渲染，不需要单独批准操作', async () => {
    const result = await buildCandidates('2026-10-18', [113, 114, 115].map((number) => profile(number)));
    const {createApp} = await import('../src/server.js');
    let statusAtRender = '';
    const app = await createApp(false, async (id) => {
      statusAtRender = (sqlite.prepare('SELECT status FROM editions WHERE id=?').get(id) as {status: string}).status;
      return '';
    });
    try {
      const response = await app.inject({method: 'POST', url: `/api/editions/${result.edition.id}/render`, payload: {confirm: true}});
      expect(response.statusCode).toBe(202);
      expect(statusAtRender).toBe('approved');
      const jobs = sqlite.prepare('SELECT COUNT(*) AS count FROM render_jobs WHERE edition_id=?').get(result.edition.id) as {count: number};
      expect(jobs.count).toBe(1);
    } finally { await app.close(); }
  });
});
