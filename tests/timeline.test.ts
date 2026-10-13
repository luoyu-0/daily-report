import {describe, expect, it} from 'vitest';
import type {DiscoveryEdition, ToolCandidate} from '../src/shared/types.js';
import {buildTimeline, totalDurationFrames, VIDEO_FPS} from '../src/video/timeline.js';

const tool = (index: number): ToolCandidate => ({
  id: `tool-${index}`, editionId: 'e1', repo: `owner/tool-${index}`, url: `https://github.com/owner/tool-${index}`,
  rank: index + 1, starsToday: 100 - index, language: 'TypeScript', topics: ['developer-tools'], archived: false,
  toolType: '开发工具', oneLinePitchZh: `第 ${index + 1} 个实用开发工具`, useCases: ['提升日常开发效率'], targetUsers: ['开发者'],
  prerequisites: ['Node.js'], caveats: ['使用前请阅读项目文档'], utilityScore: 80, toolLikely: true,
  selected: true, confirmed: true, position: index,
  sources: [{id: `source-${index}`, sourceName: 'GitHub', title: `owner/tool-${index}`,
    url: `https://github.com/owner/tool-${index}`, content: 'Repository evidence', fetchedAt: new Date().toISOString(), primarySource: true}],
  evidence: ['E1: Repository evidence'], riskFlags: [], generationMethod: 'rule',
});

const edition: DiscoveryEdition = {
  id: 'e1', kind: 'github-tools', date: '2026-10-10', version: 1, status: 'approved',
  brand: {name: 'GitHub 工具雷达', tagline: '从今日热榜发现真正好用的工具', background: '#F4F8FF', primary: '#2563EB', ink: '#0F172A', paleBlue: '#DBEAFE', accent: '#38BDF8'},
  candidates: Array.from({length: 10}, (_, index) => tool(index)),
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

describe('视频时间轴', () => {
  it('包含片头、15 秒热榜概览、十个 8 秒工具和简短片尾', () => {
    const types = buildTimeline(edition).map((item) => item.type);
    expect(types[0]).toBe('intro');
    expect(types[1]).toBe('radar');
    expect(types.filter((item) => item === 'tool')).toHaveLength(10);
    expect(types.at(-1)).toBe('outro');
    expect(buildTimeline(edition)[1].durationInFrames).toBe(15 * VIDEO_FPS);
    expect(buildTimeline(edition).filter((item) => item.type === 'tool').every((item) => item.durationInFrames === 8 * VIDEO_FPS)).toBe(true);
    expect(buildTimeline(edition).at(-1)?.durationInFrames).toBeLessThanOrEqual(4 * VIDEO_FPS);
  });

  it('默认十个工具的时长不超过三分钟', () => {
    const seconds = totalDurationFrames(edition) / VIDEO_FPS;
    expect(seconds).toBe(102);
  });

  it('选择较少工具时缩短成片，时间轴仍以片尾结束', () => {
    for (const count of [1, 5]) {
      const seconds = totalDurationFrames({...edition, candidates: edition.candidates.slice(0, count)}) / VIDEO_FPS;
      expect(seconds).toBeGreaterThan(22);
      expect(seconds).toBeLessThan(totalDurationFrames(edition) / VIDEO_FPS);
    }
  });
});
