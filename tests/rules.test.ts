import {describe, expect, it} from 'vitest';
import type {SourceRecord} from '../src/shared/types.js';
import {classify, deduplicate, extractiveSummary, normalizedUrl, scoreGroup, titleSimilarity} from '../src/pipeline/rules.js';

const source = (patch: Partial<SourceRecord> = {}): SourceRecord => ({
  id: 's1', sourceName: 'Test', title: 'OpenAI releases a new model',
  url: 'https://example.com/news?utm_source=test', content: 'The model is available today. It improves reasoning.',
  fetchedAt: new Date().toISOString(), publishedAt: new Date().toISOString(), primarySource: true, ...patch,
});

describe('规则流水线', () => {
  it('清理跟踪参数并识别相似标题', () => {
    expect(normalizedUrl('https://EXAMPLE.com/news/?utm_source=x')).toBe('https://example.com/news');
    expect(titleSimilarity('OpenAI releases new reasoning model', 'OpenAI launches a new reasoning model')).toBeGreaterThan(.55);
  });

  it('按 URL 和标题去重', () => {
    const groups = deduplicate([source(), source({id: 's2', url: 'https://example.com/news?ref=abc'})]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it('提供稳定分类、摘要和评分', () => {
    expect(classify('New GPU and TPU chip for AI datacenter')).toBe('芯片与算力');
    expect(extractiveSummary(source(), 40).length).toBeLessThanOrEqual(40);
    expect(scoreGroup([source()])).toBeGreaterThanOrEqual(60);
  });
});

