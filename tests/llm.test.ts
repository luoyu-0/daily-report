import {describe, expect, it} from 'vitest';
import {enrichWithLlm} from '../src/pipeline/llm.js';

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
});

