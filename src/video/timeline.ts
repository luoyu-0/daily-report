import type {DiscoveryEdition} from '../shared/types';

export type TimelineSegment = {
  type: 'intro' | 'radar' | 'tool';
  from: number; durationInFrames: number; toolIndex?: number;
};

export const VIDEO_FPS = 30;
export const VIDEO_WIDTH = 1920;
export const VIDEO_HEIGHT = 1080;

export function toolDurationFrames(text: string): number {
  return Math.max(12, Math.min(16, Math.ceil(text.length / 10))) * VIDEO_FPS;
}

export function buildTimeline(edition: DiscoveryEdition): TimelineSegment[] {
  const selected = edition.candidates.filter((item) => item.selected).sort((a, b) => a.position - b.position);
  const segments: TimelineSegment[] = [];
  let cursor = 0;
  const add = (segment: Omit<TimelineSegment, 'from'>) => {
    segments.push({...segment, from: cursor}); cursor += segment.durationInFrames;
  };
  add({type: 'intro', durationInFrames: 3 * VIDEO_FPS});
  add({type: 'radar', durationInFrames: 15 * VIDEO_FPS});
  selected.forEach((tool, toolIndex) => add({
    type: 'tool', toolIndex,
    durationInFrames: toolDurationFrames(`${tool.oneLinePitchZh}${tool.useCases.slice(0, 2).join('')}`),
  }));
  return segments;
}

export const totalDurationFrames = (edition: DiscoveryEdition) => {
  const last = buildTimeline(edition).at(-1);
  return last ? last.from + last.durationInFrames : VIDEO_FPS;
};
