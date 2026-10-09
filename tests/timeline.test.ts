import {describe, expect, it} from 'vitest';
import type {CandidateStory, Edition} from '../src/shared/types.js';
import {buildTimeline, totalDurationFrames, VIDEO_FPS} from '../src/video/timeline.js';

const story = (index: number, category = 'AI 产品与模型'): CandidateStory => ({
  id: `s${index}`, editionId: 'e1', titleOriginal: `Story ${index}`, titleZh: `第 ${index} 条 AI 重要新闻`,
  summaryZh: '这是一段用于测试阅读时长和视频时间轴的中文摘要。'.repeat(4), category: category as CandidateStory['category'],
  score: 80, selected: true, confirmed: true, position: index,
  sources: [{id: `src${index}`, sourceName: 'Official', title: `Source ${index}`, url: `https://example.com/${index}`, content: 'Evidence', fetchedAt: new Date().toISOString(), primarySource: true}],
  evidence: ['E1: Evidence'], keyFacts: ['Evidence'], riskFlags: [], generationMethod: 'rule',
});

const edition: Edition = {
  id: 'e1', date: '2026-10-09', version: 1, status: 'approved',
  brand: {name: 'AI 智讯日报', tagline: '每日重点', background: '#F4F8FF', primary: '#2563EB', ink: '#0F172A', paleBlue: '#DBEAFE', accent: '#38BDF8'},
  candidates: [story(0), story(1), story(2, '智能体与安全'), story(3), story(4, '研究与开源')],
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

describe('视频时间轴', () => {
  it('包含片头、目录、栏目、新闻和结尾', () => {
    const types = buildTimeline(edition).map((item) => item.type);
    expect(types[0]).toBe('intro');
    expect(types).toContain('agenda');
    expect(types.filter((item) => item === 'story')).toHaveLength(5);
    expect(types.at(-1)).toBe('summary');
  });

  it('5 条新闻的默认时长在 2～3 分钟内', () => {
    const seconds = totalDurationFrames(edition) / VIDEO_FPS;
    expect(seconds).toBeGreaterThanOrEqual(120);
    expect(seconds).toBeLessThanOrEqual(180);
  });
});

