import React from 'react';
import {AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import type {DiscoveryEdition, VideoProps} from '../shared/types';
import {ToolCard} from '../ui/ToolCard';
import {languageSummary} from '../shared/languages';
import {buildTimeline, totalDurationFrames} from './timeline';

const base: React.CSSProperties = {fontFamily: '"Microsoft YaHei", "Segoe UI", sans-serif'};

function Fade({children}: {children: React.ReactNode}) {
  const frame = useCurrentFrame(); const {durationInFrames} = useVideoConfig();
  const opacity = interpolate(frame, [0, 12, durationInFrames - 12, durationInFrames], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <AbsoluteFill style={{opacity}}>{children}</AbsoluteFill>;
}

function Intro({edition}: {edition: DiscoveryEdition}) {
  const frame = useCurrentFrame(); const progress = spring({frame, fps: 30, config: {damping: 18}});
  return <AbsoluteFill style={{...base, background: edition.brand.background, color: edition.brand.ink, justifyContent: 'center', alignItems: 'center'}}>
    <div style={{position: 'absolute', width: 760, height: 760, borderRadius: '50%', border: `2px solid ${edition.brand.paleBlue}`, transform: `scale(${.7 + progress * .3})`}} />
    <div style={{textAlign: 'center', transform: `translateY(${(1 - progress) * 35}px)`, opacity: progress}}>
      <div style={{display: 'inline-flex', padding: '11px 22px', borderRadius: 999, background: edition.brand.paleBlue, color: edition.brand.primary, fontSize: 24, fontWeight: 900, letterSpacing: 5}}>GLOBAL · TRENDING</div>
      <h1 style={{fontSize: 104, letterSpacing: -5, margin: '34px 0 16px'}}>{edition.brand.name}</h1>
      <p style={{fontSize: 34, color: '#475569', margin: 0}}>{edition.brand.tagline}</p>
    </div>
  </AbsoluteFill>;
}

function Radar({edition}: {edition: DiscoveryEdition}) {
  const top = [...edition.candidates].sort((a, b) => a.rank - b.rank).slice(0, 10);
  return <Fade><AbsoluteFill style={{...base, background: edition.brand.background, padding: 78, color: edition.brand.ink}}>
    <header style={{display: 'flex', justifyContent: 'space-between', alignItems: 'end', borderBottom: `3px solid ${edition.brand.primary}`, paddingBottom: 22}}>
      <div><div style={{color: edition.brand.primary, fontWeight: 900, letterSpacing: 3}}>GITHUB · TODAY</div><h1 style={{fontSize: 62, margin: '10px 0 0'}}>今日GitHub热榜</h1></div><b style={{fontSize: 28}}>{edition.date}</b>
    </header>
    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: `repeat(${Math.max(1, Math.ceil(top.length / 2))}, 1fr)`, gap: 15, marginTop: 24, height: Math.min(730, Math.ceil(top.length / 2) * 145)}}>{top.map((tool) => <div key={tool.id} style={{display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center', padding: '18px 24px', background: '#fff', border: `1px solid ${edition.brand.paleBlue}`, borderRadius: 15, minWidth: 0}}><div style={{minWidth: 0}}><strong style={{fontSize: 23, overflowWrap: 'anywhere'}}>{tool.repo}</strong><div style={{fontSize: 17, color: '#64748b', marginTop: 8}}>{languageSummary(tool)}</div></div><span style={{fontSize: 19, fontWeight: 800, color: '#0369a1'}}>+{tool.starsToday ?? '—'} ★</span></div>)}</div>
  </AbsoluteFill></Fade>;
}

export function DailyReportVideo({edition, hasBgm}: VideoProps) {
  const timeline = buildTimeline(edition);
  const selected = edition.candidates.filter((item) => item.selected).sort((a, b) => a.position - b.position);
  return <AbsoluteFill style={{background: edition.brand.background}}>
    {timeline.map((segment, index) => {
      const content = segment.type === 'intro' ? <Intro edition={edition} />
        : segment.type === 'radar' ? <Radar edition={edition} />
        : <Fade><ToolCard tool={selected[segment.toolIndex!]} brand={edition.brand} index={segment.toolIndex!} total={selected.length} /></Fade>;
      return <Sequence key={`${segment.type}-${index}`} from={segment.from} durationInFrames={segment.durationInFrames}>{content}</Sequence>;
    })}
    {hasBgm ? <Audio src={staticFile('assets/audio/bgm.mp3')} loop volume={(frame) => interpolate(frame, [0, 15, Math.max(16, totalDurationFrames(edition) - 60), totalDurationFrames(edition)], [0, 0.12, 0.12, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})} /> : null}
  </AbsoluteFill>;
}
