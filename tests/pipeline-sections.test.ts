import {describe, expect, it} from 'vitest';
import {mapWithConcurrency} from '../src/pipeline/run.js';

describe('工具候选流水线', () => {
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
