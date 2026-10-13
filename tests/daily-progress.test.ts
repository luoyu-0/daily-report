import {afterEach, expect, it, vi} from 'vitest';

vi.mock('../src/pipeline/run.js', () => ({
  buildCandidates: async (_date: string, _profiles: unknown, onProgress: (value: unknown) => void) => {
    onProgress({phase: 'profiles', completed: 0, total: 0});
    onProgress({phase: 'rules', completed: 15, total: 15});
    return {edition: {id: 'edition-test', candidates: Array(15).fill(null)}, skippedHistorical: 0, reusedToday: 0, warnings: []};
  },
}));

vi.mock('../src/shared/review-launcher.js', () => ({launchReviewInBackground: vi.fn()}));

const originalArgv = process.argv;
afterEach(() => { process.argv = originalArgv; vi.restoreAllMocks(); vi.resetModules(); });

it('终端进度条从左侧开始，零项不显示为已完成', async () => {
  process.argv = ['node', 'daily', '--date', '2026-10-13', '--no-review'];
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((message: string) => { lines.push(message); });
  await import('../src/cli/daily.js');
  expect(lines).toContain('获取仓库详情 [--------------------] 0/0');
  expect(lines).toContain('整理候选 [====================] 15/15');
});
