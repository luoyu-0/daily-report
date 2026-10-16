import type {SubtitleCue} from '../shared/types';
import {VIDEO_FPS} from './timeline';

const timestamp = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

export function parseLrc(value: string, durationMs: number): SubtitleCue[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('成片时长无效');
  let offsetMs = 0;
  const entries: Array<{startMs: number; text: string}> = [];
  for (const line of value.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const trimmed = line.trim();
    const offset = trimmed.match(/^\[offset:([+-]?\d+)\]$/i);
    if (offset) { offsetMs = Number(offset[1]); continue; }
    const matches = [...trimmed.matchAll(timestamp)];
    if (!matches.length) continue;
    const text = trimmed.replace(timestamp, '').trim();
    for (const match of matches) {
      const seconds = Number(match[2]);
      if (seconds >= 60) throw new Error(`LRC 时间戳无效：${match[0]}`);
      const fraction = match[3] ? Number(match[3].padEnd(3, '0')) : 0;
      entries.push({startMs: Number(match[1]) * 60_000 + seconds * 1000 + fraction + offsetMs, text});
    }
  }
  if (!entries.length) throw new Error('未找到有效的 LRC 时间戳');
  entries.sort((a, b) => a.startMs - b.startMs);
  if (entries.some((entry) => entry.startMs < 0 || entry.startMs > durationMs || (entry.startMs === durationMs && entry.text))) throw new Error('LRC 时间超出成片范围');
  if (entries.some((entry, index) => index > 0 && entry.startMs === entries[index - 1].startMs)) throw new Error('LRC 包含重复时间戳');
  const cues = entries.flatMap((entry, index) => entry.text ? [{
    startMs: entry.startMs,
    endMs: Math.min(entries[index + 1]?.startMs ?? durationMs, entry.startMs + 6000, durationMs),
    text: entry.text,
  }] : []);
  if (!cues.length) throw new Error('LRC 中没有字幕文本');
  if (cues.length > 100) throw new Error('字幕不能超过 100 条');
  if (cues.some((cue) => cue.text.length > 160)) throw new Error('单条字幕不能超过 160 字');
  return cues;
}

export const activeSubtitleAtFrame = (cues: SubtitleCue[], frame: number) => {
  const currentMs = frame * 1000 / VIDEO_FPS;
  return cues.find((cue) => cue.startMs <= currentMs && currentMs < cue.endMs);
};
