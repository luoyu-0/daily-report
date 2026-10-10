import {describe, expect, it} from 'vitest';
import type {RepositoryProfile} from '../src/pipeline/collectors.js';
import {chooseSuggestedTools, mapWithConcurrency} from '../src/pipeline/run.js';

const profile = (rank: number, overrides: Partial<RepositoryProfile> = {}): RepositoryProfile => ({
  repo: `owner/tool-${rank}`, url: `https://github.com/owner/tool-${rank}`, rank,
  description: 'A useful command line developer tool', language: 'TypeScript', starsToday: 100 - rank,
  fetchedAt: new Date().toISOString(), primarySource: true, totalStars: 1000, forks: 50,
  topics: ['cli', 'developer-tools'], license: 'MIT', archived: false,
  readme: '# Tool\n\n## Installation\n```bash\nnpm install tool\n```',
  ...overrides,
});

describe('工具候选流水线', () => {
  it('默认建议至多四个高实用性工具，并排除教程类仓库', () => {
    const profiles = [
      profile(1), profile(2), profile(3), profile(4), profile(5),
      profile(6, {description: 'An awesome curated list and tutorial', readme: '# Awesome list'}),
    ];
    const suggested = chooseSuggestedTools(profiles);
    expect(suggested.size).toBe(4);
    expect(suggested.has('owner/tool-1')).toBe(true);
    expect(suggested.has('owner/tool-6')).toBe(false);
  });

  it('并发工具处理遵守上限并处理全部条目', async () => {
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
