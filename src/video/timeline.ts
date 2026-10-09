import type {Edition} from '../shared/types';

export type TimelineSegment = {
  type: 'intro' | 'agenda' | 'github' | 'section' | 'story' | 'summary';
  from: number;
  durationInFrames: number;
  category?: string;
  storyIndex?: number;
};

const FPS = 30;
export const VIDEO_FPS = FPS;
export const VIDEO_WIDTH = 1920;
export const VIDEO_HEIGHT = 1080;

export function storyDurationFrames(text: string): number {
  const readingSeconds = text.replace(/\s/g, '').length / 8;
  return Math.round(Math.min(25, Math.max(22, readingSeconds + 6)) * FPS);
}

export function buildTimeline(edition: Edition): TimelineSegment[] {
  const github = edition.candidates.filter((item) => item.section === 'github' && item.selected).sort((a, b) => a.position - b.position).slice(0, 5);
  const stories = edition.candidates.filter((item) => item.section === 'industry' && item.selected).sort((a, b) => a.position - b.position);
  const segments: TimelineSegment[] = [];
  let cursor = 0;
  const add = (segment: Omit<TimelineSegment, 'from'>) => {
    segments.push({...segment, from: cursor});
    cursor += segment.durationInFrames;
  };
  add({type: 'intro', durationInFrames: 3 * FPS});
  add({type: 'agenda', durationInFrames: 5 * FPS});
  if (github.length) add({type: 'github', durationInFrames: 16 * FPS});
  if (stories.length) add({type: 'section', durationInFrames: 3 * FPS, category: '行业概览'});
  stories.forEach((story, storyIndex) => {
    add({type: 'story', durationInFrames: storyDurationFrames(`${story.titleZh}${story.summaryZh}`), storyIndex});
  });
  add({type: 'summary', durationInFrames: 5 * FPS});
  return segments;
}

export const totalDurationFrames = (edition: Edition) => {
  const timeline = buildTimeline(edition);
  const last = timeline.at(-1);
  return last ? last.from + last.durationInFrames : 30;
};

