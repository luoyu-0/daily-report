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
  ({upsertCandidate, createEdition, sqlite} = await import('../src/db.js'));
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
  it('历史仓库不进入新日报；同日重跑保留已优化文案和证据', async () => {
    await buildCandidates('2026-10-10', [1, 2, 3, 4, 5].map((number) => profile(number)));
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
    await buildCandidates('2026-10-09', [20, 21, 22, 23, 24].map((number) => profile(number)));
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
      apiCalls += 1;
      if (url.endsWith('/readme')) return new Response('# 功能\n工具说明', {status: 200});
      return new Response(JSON.stringify({description: 'Useful tool', language: 'TypeScript',
        stargazers_count: 10, forks_count: 1, topics: [], archived: false}), {status: 200});
    }));
    const first = await buildCandidates(today);
    expect(first.skippedHistorical).toBe(1);
    expect(first.edition.candidates).toHaveLength(5);
    expect(apiCalls).toBe(10);
    const second = await buildCandidates(today);
    expect(second.reusedToday).toBe(5);
    expect(apiCalls).toBe(10);
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

  it('全部为历史仓库时不重新采集详情，并给出候选不足提示', async () => {
    const result = await buildCandidates('2026-10-13', [1, 2, 3, 4, 5].map((number) => profile(number)));
    expect(result.edition.candidates).toHaveLength(0);
    expect(result.skippedHistorical).toBe(5);
    expect(result.warnings.join(' ')).toContain('少于批准成片所需');
  });
});
