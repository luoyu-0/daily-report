import {AbsoluteFill, Audio, interpolate, staticFile, useCurrentFrame} from 'remotion';
import type {VideoProps} from '../shared/types';
import {buildTimeline, totalDurationFrames} from './timeline';
import {getVideoTemplate} from './templates/registry';
import {activeSubtitleAtFrame} from './subtitles';

function SubtitleTrack({edition}: Pick<VideoProps, 'edition'>) {
  const cue = activeSubtitleAtFrame(edition.videoConfig.subtitles, useCurrentFrame());
  if (!cue) return null;
  return <div style={{position: 'absolute', bottom: 58, left: 160, right: 160, textAlign: 'center', pointerEvents: 'none'}}>
    <span style={{display: 'inline-block', maxWidth: '100%', boxSizing: 'border-box', padding: '14px 28px', borderRadius: 12, background: 'rgba(15,23,42,.88)', color: '#fff', fontFamily: '"Microsoft YaHei", "Segoe UI", sans-serif', fontSize: 34, fontWeight: 700, lineHeight: 1.4, overflowWrap: 'anywhere'}}>{cue.text}</span>
  </div>;
}

export function DailyReportVideo({edition, hasBgm, bgmSrc}: VideoProps) {
  const Template = getVideoTemplate(edition.videoConfig.templateId).render;
  const duration = totalDurationFrames(edition);
  return <AbsoluteFill>
    <Template edition={edition} timeline={buildTimeline(edition)} />
    <SubtitleTrack edition={edition} />
    {hasBgm ? <Audio src={bgmSrc ?? staticFile('assets/audio/bgm.mp3')} loop volume={(frame) => interpolate(frame, [0, 15, Math.max(16, duration - 60), duration], [0, 0.12, 0.12, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})} /> : null}
  </AbsoluteFill>;
}
