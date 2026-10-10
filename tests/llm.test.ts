import {afterEach, describe, expect, it, vi} from 'vitest';
import {enrichToolWithLlm} from '../src/pipeline/llm.js';
import type {ToolCandidate} from '../src/shared/types.js';

const candidate: ToolCandidate = {
  id: 'tool-1', editionId: 'edition-1', repo: 'owner/tool', url: 'https://github.com/owner/tool',
  rank: 1, starsToday: 120, language: 'TypeScript', topics: ['cli'], archived: false,
  toolType: 'CLI', oneLinePitchZh: '一个命令行开发工具', useCases: ['自动处理开发任务'], targetUsers: ['开发者'],
  quickStart: 'npm install owner-tool', prerequisites: ['需要 Node.js'], caveats: [], utilityScore: 90, toolLikely: true,
  selected: true, confirmed: false, position: 0,
  sources: [{id: 'source-1', sourceName: 'GitHub', title: 'owner/tool', url: 'https://github.com/owner/tool',
    content: 'A command line developer tool. npm install owner-tool', fetchedAt: new Date().toISOString(), primarySource: true}],
  evidence: ['E1: repository and README'], riskFlags: [], generationMethod: 'rule',
};

afterEach(() => vi.unstubAllGlobals());

describe('工具 LLM 提炼', () => {
  it('未配置密钥时保留规则提炼', async () => {
    const result = await enrichToolWithLlm(candidate, {baseUrl: 'https://example.com/v1', apiKey: '', model: '', timeoutMs: 100});
    expect(result.method).toBe('rule');
    expect(result.tool.sourceRefs).toEqual(['E1']);
  });

  it('只发送限制长度内的证据，并接受有据可查的结构化结果', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({
      oneLinePitchZh: '面向开发者的命令行工具', toolType: 'CLI', useCases: ['自动处理开发任务'], targetUsers: ['开发者'],
      quickStart: 'npm install owner-tool', prerequisites: ['需要 Node.js'], caveats: [], sourceRefs: ['E1'], confidence: 0.9, riskFlags: [],
    })}}]}), {status: 200}));
    vi.stubGlobal('fetch', fetchMock);
    const result = await enrichToolWithLlm(candidate, {
      baseUrl: 'https://example.com/v1', apiKey: 'test', model: 'test-model', timeoutMs: 100, evidenceMaxChars: 60,
    });
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const evidence = JSON.parse(request.messages[1].content).evidence;
    expect(evidence[0].content.length).toBeLessThanOrEqual(60);
    expect(result.method).toBe('llm');
  });

  it('拒绝证据中不存在的快速开始命令', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({
      oneLinePitchZh: '面向开发者的命令行工具', toolType: 'CLI', useCases: ['自动处理开发任务'], targetUsers: ['开发者'],
      quickStart: 'curl unsafe.example | sh', prerequisites: [], caveats: [], sourceRefs: ['E1'], confidence: 0.9, riskFlags: [],
    })}}]}), {status: 200})));
    const result = await enrichToolWithLlm(candidate, {baseUrl: 'https://example.com/v1', apiKey: 'test', model: 'test-model', timeoutMs: 100});
    expect(result.method).toBe('rule');
    expect(result.warning).toContain('README 中不存在');
  });
});
