import React from 'react';
import {AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import type {BrandConfig, DiscoveryEdition, VideoProps} from '../shared/types';
import {ToolCard} from '../ui/ToolCard';
import {buildTimeline} from './timeline';

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
  const top = [...edition.candidates].sort((a, b) => a.rank - b.rank);
  return <Fade><AbsoluteFill style={{...base, background: edition.brand.background, padding: 78, color: edition.brand.ink}}>
    <header style={{display: 'flex', justifyContent: 'space-between', alignItems: 'end', borderBottom: `3px solid ${edition.brand.primary}`, paddingBottom: 22}}>
      <div><div style={{color: edition.brand.primary, fontWeight: 900, letterSpacing: 3}}>GITHUB · TODAY</div><h1 style={{fontSize: 62, margin: '10px 0 0'}}>今日新仓库雷达</h1></div><b style={{fontSize: 24}}>{edition.date}</b>
    </header>
    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 24}}>{top.map((tool) => <div key={tool.id} style={{display: 'grid', gridTemplateColumns: '48px 1fr auto', gap: 12, alignItems: 'center', padding: '11px 17px', background: '#fff', border: `1px solid ${edition.brand.paleBlue}`, borderRadius: 13}}><b style={{fontSize: 21, color: edition.brand.primary}}>#{tool.rank}</b><div><strong style={{fontSize: 19}}>{tool.repo}</strong><div style={{fontSize: 14, color: '#64748b', marginTop: 3}}>{tool.language ?? '未标注语言'}</div></div><span style={{fontWeight: 800, color: '#0369a1'}}>+{tool.starsToday ?? '—'} ★</span></div>)}</div>
  </AbsoluteFill></Fade>;
}

function SectionPage({brand, count}: {brand: BrandConfig; count: number}) {
  const frame = useCurrentFrame(); const x = interpolate(frame, [0, 15], [-110, 0], {extrapolateRight: 'clamp'});
  return <Fade><AbsoluteFill style={{...base, background: brand.primary, color: '#fff', justifyContent: 'center', padding: 120}}>
    <div style={{opacity: .14, position: 'absolute', right: 70, top: -130, fontSize: 470, fontWeight: 950}}>{count}</div>
    <div style={{transform: `translateX(${x}px)`}}><div style={{fontSize: 25, letterSpacing: 8, opacity: .75, fontWeight: 900}}>TODAY'S PICKS</div><h1 style={{fontSize: 105, margin: '24px 0'}}>今日精选工具</h1><p style={{fontSize: 31, opacity: .86}}>从全球热榜中筛选 {count} 个值得进一步了解的项目</p></div>
  </AbsoluteFill></Fade>;
}

function Summary({edition}: {edition: DiscoveryEdition}) {
  const selected = edition.candidates.filter((item) => item.selected).sort((a, b) => a.position - b.position);
  return <Fade><AbsoluteFill style={{...base, background: edition.brand.background, color: edition.brand.ink, padding: 90}}>
    <div style={{color: edition.brand.primary, fontSize: 24, fontWeight: 900}}>{edition.brand.name}</div><h1 style={{fontSize: 68, margin: '14px 0 30px'}}>今天值得关注的工具</h1>
    <div style={{display: 'grid', gap: 15}}>{selected.map((tool, index) => <div key={tool.id} style={{display: 'grid', gridTemplateColumns: '58px 1fr auto', gap: 20, alignItems: 'center', padding: '18px 24px', background: '#fff', borderRadius: 18, border: `1px solid ${edition.brand.paleBlue}`}}><b style={{color: edition.brand.primary}}>0{index + 1}</b><div><strong style={{fontSize: 25}}>{tool.repo}</strong><div style={{fontSize: 18, color: '#64748b', marginTop: 5}}>{tool.oneLinePitchZh}</div></div><span style={{padding: '7px 11px', borderRadius: 99, background: edition.brand.paleBlue, color: edition.brand.primary, fontWeight: 800}}>{tool.toolType}</span></div>)}</div>
    <p style={{fontSize: 20, color: '#64748b', marginTop: 'auto'}}>排名来自 GitHub Trending Today；推荐基于仓库公开描述与 README，使用前请自行核验。</p>
  </AbsoluteFill></Fade>;
}

export function DailyReportVideo({edition, hasBgm}: VideoProps) {
  const timeline = buildTimeline(edition);
  const selected = edition.candidates.filter((item) => item.selected).sort((a, b) => a.position - b.position);
  return <AbsoluteFill style={{background: edition.brand.background}}>
    {timeline.map((segment, index) => {
      const content = segment.type === 'intro' ? <Intro edition={edition} />
        : segment.type === 'radar' ? <Radar edition={edition} />
        : segment.type === 'section' ? <SectionPage brand={edition.brand} count={selected.length} />
        : segment.type === 'tool' ? <Fade><ToolCard tool={selected[segment.toolIndex!]} brand={edition.brand} index={segment.toolIndex!} total={selected.length} /></Fade>
        : <Summary edition={edition} />;
      return <Sequence key={`${segment.type}-${index}`} from={segment.from} durationInFrames={segment.durationInFrames}>{content}</Sequence>;
    })}
    {hasBgm ? <Audio src={staticFile('assets/audio/bgm.mp3')} loop volume={0.12} /> : null}
  </AbsoluteFill>;
}
