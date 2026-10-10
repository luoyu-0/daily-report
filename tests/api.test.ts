import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {FastifyInstance} from 'fastify';
import {createApp, validateApproval} from '../src/server.js';
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
  });

  it('拒绝渲染不存在的日报', async () => {
    const response = await app.inject({method: 'POST', url: '/api/editions/missing/render'});
    expect(response.statusCode).toBe(404);
  });

  it('只有 3～5 个逐条确认且资料完整的工具可以批准', () => {
    expect(validateApproval(edition([tool(0), tool(1)]))).toContain('3～5');
    expect(validateApproval(edition([tool(0), tool(1, false), tool(2)]))).toContain('逐条确认');
    expect(validateApproval(edition([tool(0), tool(1), tool(2)]))).toBeUndefined();
  });
});

