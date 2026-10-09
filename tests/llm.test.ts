import {afterEach, describe, expect, it, vi} from 'vitest';
import {enrichWithLlm} from '../src/pipeline/llm.js';

afterEach(() => vi.unstubAllGlobals());

describe('LLM 回退', () => {
  it('未配置密钥时使用规则摘要', async () => {
    const result = await enrichWithLlm([{
      id: 's1', sourceName: 'Official', title: 'New open source AI model',
      url: 'https://example.com/model', content: 'A new open source AI model was released today. It supports research use.',
      fetchedAt: new Date().toISOString(), primarySource: true,
    }], {baseUrl: 'https://example.com/v1', apiKey: '', model: '', timeoutMs: 100});
    expect(result.method).toBe('rule');
    expect(result.story.sourceRefs).toEqual(['E1']);
    expect(result.story.summaryZh).not.toBe('');
  });

  it('只向模型发送配置长度内的证据正文', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{message: {content: JSON.stringify({
        titleZh: '开源人工智能模型今日发布',
        summaryZh: '一款新的开源人工智能模型正式发布，相关证据表明它可用于研究用途，具体能力仍需后续验证。',
        category: '研究与开源',
        keyFacts: ['模型已经正式发布'],
        sourceRefs: ['E1'],
        confidence: 0.9,
        riskFlags: [],
      })}}],
    }), {status: 200}));
    vi.stubGlobal('fetch', fetchMock);
    const result = await enrichWithLlm([{
      id: 's1', sourceName: 'Official', title: 'New open source AI model',
      url: 'https://example.com/model', content: 'A'.repeat(500),
      fetchedAt: new Date().toISOString(), primarySource: true,
    }], {baseUrl: 'https://example.com/v1', apiKey: 'test', model: 'test-model', timeoutMs: 100, evidenceMaxChars: 80});
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const evidence = JSON.parse(request.messages[1].content).evidence;
    expect(evidence[0].content).toHaveLength(80);
    expect(result.method).toBe('llm');
  });
});

