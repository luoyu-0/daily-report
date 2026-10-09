import {describe, expect, it} from 'vitest';
import {partitionCandidateSources} from '../src/pipeline/run.js';
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
});

