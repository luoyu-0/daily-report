import React from 'react';
import {AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import type {BrandConfig, Edition, VideoProps} from '../shared/types';
import {NewsCard} from '../ui/NewsCard';
import {buildTimeline} from './timeline';

const base: React.CSSProperties = {
  fontFamily: '"Microsoft YaHei", "Segoe UI", sans-serif',
};

function Fade({children}: {children: React.ReactNode}) {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const opacity = interpolate(frame, [0, 12, durationInFrames - 12, durationInFrames], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <AbsoluteFill style={{opacity}}>{children}</AbsoluteFill>;
}

function Intro({edition}: {edition: Edition}) {
  const frame = useCurrentFrame();
  const progress = spring({frame, fps: 30, config: {damping: 18}});
  const {brand} = edition;
  return <AbsoluteFill style={{...base, background: brand.background, color: brand.ink, justifyContent: 'center', alignItems: 'center'}}>
    <div style={{position: 'absolute', width: 760, height: 760, borderRadius: '50%', border: `2px solid ${brand.paleBlue}`, transform: `scale(${.7 + progress * .3})`}} />
    <div style={{position: 'relative', textAlign: 'center', transform: `translateY(${(1 - progress) * 35}px)`, opacity: progress}}>
      <div style={{display: 'inline-flex', padding: '11px 22px', borderRadius: 999, background: brand.paleBlue, color: brand.primary, fontSize: 24, fontWeight: 900, letterSpacing: 5}}>AI · NEWSROOM</div>
      <h1 style={{fontSize: 104, letterSpacing: -5, margin: '34px 0 16px'}}>{brand.name}</h1>
      <p style={{fontSize: 34, color: '#475569', margin: 0}}>{brand.tagline}</p>
      <div style={{width: 180, height: 8, borderRadius: 99, background: `linear-gradient(90deg,${brand.primary},${brand.accent})`, margin: '42px auto 0'}} />
    </div>
  </AbsoluteFill>;
}

function Agenda({edition}: {edition: Edition}) {
  const stories = edition.candidates.filter((item) => item.selected).sort((a, b) => a.position - b.position);
  const categories = [...new Set(stories.map((item) => item.category))];
  return <Fade><AbsoluteFill style={{...base, background: edition.brand.background, color: edition.brand.ink, padding: 86}}>
    <header style={{display: 'flex', justifyContent: 'space-between', alignItems: 'end', borderBottom: `3px solid ${edition.brand.primary}`, paddingBottom: 26}}>
      <div><div style={{fontWeight: 900, color: edition.brand.primary, fontSize: 24}}>今日导读</div><h1 style={{fontSize: 68, margin: '12px 0 0'}}>{edition.date} · AI 重点</h1></div>
      <div style={{fontSize: 28, fontWeight: 800}}>{stories.length} 条精选</div>
    </header>
    <div style={{display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 24, marginTop: 34}}>
      {stories.map((story, index) => <div key={story.id} style={{display: 'grid', gridTemplateColumns: '58px 1fr', gap: 20, padding: '22px 26px', borderRadius: 22, background: '#fff', border: `1px solid ${edition.brand.paleBlue}`}}>
        <strong style={{fontSize: 26, color: edition.brand.primary}}>{String(index + 1).padStart(2, '0')}</strong>
        <div><div style={{fontSize: 18, color: '#64748b', fontWeight: 800, marginBottom: 7}}>{story.category}</div><div style={{fontSize: 25, fontWeight: 800, lineHeight: 1.35}}>{story.titleZh}</div></div>
      </div>)}
    </div>
    <footer style={{marginTop: 'auto', color: '#64748b', fontSize: 22}}>{categories.join(' / ')}</footer>
  </AbsoluteFill></Fade>;
}

function SectionPage({category, brand, number}: {category: string; brand: BrandConfig; number: number}) {
  const frame = useCurrentFrame();
  const x = interpolate(frame, [0, 15], [-110, 0], {extrapolateRight: 'clamp'});
  return <Fade><AbsoluteFill style={{...base, background: brand.primary, color: '#fff', justifyContent: 'center', padding: 120}}>
    <div style={{opacity: .16, position: 'absolute', right: 80, top: -160, fontSize: 520, fontWeight: 950}}>{String(number).padStart(2, '0')}</div>
    <div style={{transform: `translateX(${x}px)`}}><div style={{fontSize: 25, letterSpacing: 8, opacity: .75, fontWeight: 900}}>SECTION {String(number).padStart(2, '0')}</div><h1 style={{fontSize: 112, margin: '25px 0'}}>{category}</h1><div style={{height: 9, width: 260, background: brand.accent, borderRadius: 99}} /></div>
  </AbsoluteFill></Fade>;
}

function StoryPage({edition, storyIndex}: {edition: Edition; storyIndex: number}) {
  const stories = edition.candidates.filter((item) => item.selected).sort((a, b) => a.position - b.position);
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const reveal = spring({frame, fps, config: {damping: 20, stiffness: 130}});
  return <Fade><NewsCard story={stories[storyIndex]} brand={edition.brand} index={storyIndex} total={stories.length} style={{transform: `translateY(${(1 - reveal) * 24}px)`}} /></Fade>;
}

function Summary({edition}: {edition: Edition}) {
  const stories = edition.candidates.filter((item) => item.selected).sort((a, b) => a.position - b.position);
  return <Fade><AbsoluteFill style={{...base, background: edition.brand.background, color: edition.brand.ink, padding: 90}}>
    <div style={{fontSize: 24, color: edition.brand.primary, fontWeight: 900}}>{edition.brand.name}</div>
    <h1 style={{fontSize: 70, margin: '15px 0 32px'}}>今日要点回顾</h1>
    <div style={{display: 'grid', gap: 15}}>{stories.map((story, index) => <div key={story.id} style={{display: 'grid', gridTemplateColumns: '62px 1fr auto', gap: 20, alignItems: 'center', padding: '17px 24px', background: '#fff', borderRadius: 18, border: `1px solid ${edition.brand.paleBlue}`}}><strong style={{fontSize: 22, color: edition.brand.primary}}>{String(index + 1).padStart(2, '0')}</strong><span style={{fontSize: 24, fontWeight: 800}}>{story.titleZh}</span><small style={{fontSize: 17, color: '#64748b'}}>{story.sources[0].sourceName}</small></div>)}</div>
    <p style={{fontSize: 21, color: '#64748b', marginTop: 'auto'}}>所有内容均保留原始来源与证据映射 · {edition.date}</p>
  </AbsoluteFill></Fade>;
}

export function DailyReportVideo({edition, hasBgm}: VideoProps) {
  const timeline = buildTimeline(edition);
  let sectionNumber = 0;
  return <AbsoluteFill style={{background: edition.brand.background}}>
    {timeline.map((segment, index) => {
      if (segment.type === 'section') sectionNumber += 1;
      const content = segment.type === 'intro' ? <Intro edition={edition} />
        : segment.type === 'agenda' ? <Agenda edition={edition} />
        : segment.type === 'section' ? <SectionPage category={segment.category!} brand={edition.brand} number={sectionNumber} />
        : segment.type === 'story' ? <StoryPage edition={edition} storyIndex={segment.storyIndex!} />
        : <Summary edition={edition} />;
      return <Sequence key={`${segment.type}-${index}`} from={segment.from} durationInFrames={segment.durationInFrames}>{content}</Sequence>;
    })}
    {hasBgm ? <Audio src={staticFile('assets/audio/bgm.mp3')} loop volume={0.12} /> : null}
  </AbsoluteFill>;
}

