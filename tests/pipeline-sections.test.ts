import {describe, expect, it} from 'vitest';
import {mapWithConcurrency, partitionCandidateSources} from '../src/pipeline/run.js';
import type {SourceRecord} from '../src/shared/types.js';

const source = (index: number, sourceName: string): SourceRecord => ({
  id: `source-${sourceName}-${index}`,
  sourceName,
  title: sourceName === 'GitHub Trending' ? `repo-${index}-unique` : `industry-topic-${index}-unique`,
  url: `https://example.com/${sourceName}/${index}`,
  content: `Independent evidence topic_${index} with distinct details`,
  fetchedAt: new Date().toISOString(),
  publishedAt: new Date().toISOString(),
  primarySource: true,
});

describe('日报两大板块', () => {
  it('GitHub 只取当天热榜前五，其余来源进入行业候选', () => {
    const records = [
      ...Array.from({length: 7}, (_, index) => source(index, 'GitHub Trending')),
      ...Array.from({length: 8}, (_, index) => source(index, 'Official')),
    ];
    const result = partitionCandidateSources(records);
    expect(result.githubRecords).toHaveLength(5);
    expect(result.githubRecords.map((item) => item.title)).toEqual(records.slice(0, 5).map((item) => item.title));
    expect(result.industryGroups).toHaveLength(8);
    expect(result.industryGroups.every((group) => group.sources.every((item) => item.sourceName !== 'GitHub Trending'))).toBe(true);
  });

  it('候选提炼遵守并发上限并处理全部条目', async () => {
    let active = 0;
    let maxActive = 0;
    const completed: number[] = [];
    await mapWithConcurrency([0, 1, 2, 3, 4, 5], 3, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      completed.push(item);
      active -= 1;
    });
    expect(maxActive).toBe(3);
    expect(completed.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

