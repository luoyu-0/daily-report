import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {FastifyInstance} from 'fastify';
import {createApp, getOptimizationTargets, validateApproval} from '../src/server.js';
import {REVIEW_API_VERSION} from '../src/shared/review-contract.js';
import type {DiscoveryEdition, ToolCandidate} from '../src/shared/types.js';

const tool = (index: number, confirmed = true): ToolCandidate => ({
  id: `tool-${index}`, editionId: 'edition-approval', repo: `owner/tool-${index}`, url: `https://github.com/owner/tool-${index}`,
  rank: index + 1, topics: [], archived: false, toolType: '开发工具', oneLinePitchZh: '一个实用的开发工具',
  useCases: ['改善开发流程'], targetUsers: ['开发者'], prerequisites: [], caveats: [], utilityScore: 80, toolLikely: true,
  selected: true, confirmed, position: index,
  sources: [{id: `source-${index}`, sourceName: 'GitHub', title: `owner/tool-${index}`, url: `https://github.com/owner/tool-${index}`,
    content: 'Repository evidence', fetchedAt: new Date().toISOString(), primarySource: true}],
  evidence: ['E1: Repository evidence'], riskFlags: [], generationMethod: 'rule',
});

const edition = (candidates: ToolCandidate[]): DiscoveryEdition => ({
  id: 'edition-approval', kind: 'github-tools', date: '2026-10-10', version: 1, status: 'draft', candidates,
  brand: {name: 'GitHub 工具雷达', tagline: '每日工具', background: '#F4F8FF', primary: '#2563EB', ink: '#0F172A', paleBlue: '#DBEAFE', accent: '#38BDF8'},
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});

describe('本地审核 API', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createApp(false); });
  afterAll(async () => { await app.close(); });

  it('返回健康状态', async () => {
    const response = await app.inject({method: 'GET', url: '/api/health'});
    expect(response.statusCode).toBe(200);
    expect(response.json().ok).toBe(true);
    expect(response.json()).toMatchObject({app: 'github-tool-radar', apiVersion: REVIEW_API_VERSION});
  });

  it('拒绝渲染不存在的日报', async () => {
    const response = await app.inject({method: 'POST', url: '/api/editions/missing/render'});
    expect(response.statusCode).toBe(404);
  });

  it('允许一至十个资料完整的入选工具，确认由渲染动作完成', () => {
    expect(validateApproval(edition([]))).toContain('1～10');
    expect(validateApproval(edition(Array.from({length: 11}, (_, index) => tool(index))))).toContain('1～10');
    expect(validateApproval(edition([tool(0, false)]))).toBeUndefined();
    expect(validateApproval(edition(Array.from({length: 10}, (_, index) => tool(index, false))))).toBeUndefined();
  });

  it('一键优化涵盖未入选候选，但跳过已经 LLM 优化的候选', () => {
    const candidates = [tool(0), {...tool(1), selected: false}, {...tool(2), generationMethod: 'llm' as const}];
    expect(getOptimizationTargets(edition(candidates)).map((item) => item.repo))
      .toEqual(['owner/tool-0', 'owner/tool-1']);
  });
});

