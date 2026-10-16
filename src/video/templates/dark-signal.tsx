import {AbsoluteFill, Sequence, interpolate, useCurrentFrame} from 'remotion';
import type {DiscoveryEdition, ToolCandidate} from '../../shared/types';
import {languageSummary} from '../../shared/languages';
import type {TemplateViewProps} from './registry';

const background = '#081225';
const accent = '#5EEAD4';
const muted = '#94A3B8';
const font = '"Microsoft YaHei", "Segoe UI", sans-serif';

function Shell({children, edition, label}: {children: React.ReactNode; edition: DiscoveryEdition; label: string}) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 12], [0, 1], {extrapolateRight: 'clamp'});
  return <AbsoluteFill style={{background, color: '#F8FAFC', fontFamily: font, padding: 82, boxSizing: 'border-box', opacity}}>
    <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 24, color: accent, fontWeight: 800, letterSpacing: 3}}><span>{edition.brand.name}</span><span>{label}</span></div>
    <div style={{height: 2, background: '#24415A', marginTop: 24}} />
    {children}
    <div style={{position: 'absolute', bottom: 70, left: 82, right: 82, display: 'flex', justifyContent: 'space-between', color: muted, fontSize: 21}}><span>GITHUB · TRENDING · TODAY</span><span>{edition.date}</span></div>
  </AbsoluteFill>;
}

function Intro({edition}: {edition: DiscoveryEdition}) {
  return <Shell edition={edition} label="DISCOVER"><div style={{marginTop: 240, borderLeft: `8px solid ${accent}`, paddingLeft: 44}}><h1 style={{fontSize: 108, margin: '0 0 26px'}}>{edition.brand.name}</h1><p style={{fontSize: 38, color: muted}}>{edition.brand.tagline}</p></div></Shell>;
}

function Radar({edition}: {edition: DiscoveryEdition}) {
  const top = [...edition.candidates].sort((a, b) => a.rank - b.rank).slice(0, 10);
  return <Shell edition={edition} label="TOP 10"><h1 style={{fontSize: 62, margin: '42px 0'}}>今日 GitHub 热榜</h1><div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12}}>{top.map((tool, index) => <div key={tool.id} style={{height: 123, boxSizing: 'border-box', padding: '17px 22px', background: '#12233B', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 20}}><strong style={{fontSize: 27, color: accent}}>{String(index + 1).padStart(2, '0')}</strong><div style={{minWidth: 0}}><div style={{fontSize: 23, fontWeight: 800, overflowWrap: 'anywhere'}}>{tool.repo}</div><div style={{fontSize: 18, color: muted, marginTop: 5}}>{languageSummary(tool)}</div></div></div>)}</div></Shell>;
}

function Tool({edition, tool, index, total}: {edition: DiscoveryEdition; tool: ToolCandidate; index: number; total: number}) {
  return <Shell edition={edition} label={`${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`}>
    <div style={{marginTop: 110, color: accent, fontSize: 26, fontWeight: 800}}>{tool.toolType} · {languageSummary(tool)}</div>
    <h1 style={{fontSize: 76, lineHeight: 1.15, margin: '25px 0', overflowWrap: 'anywhere'}}>{tool.repo}</h1>
    <p style={{fontSize: 36, lineHeight: 1.4, color: '#CBD5E1', maxWidth: 1530}}>{tool.oneLinePitchZh}</p>
    <div style={{display: 'flex', gap: 18, marginTop: 24}}>{tool.useCases.slice(0, 2).map((useCase) => <div key={useCase} style={{background: '#122F42', borderLeft: `5px solid ${accent}`, borderRadius: 8, padding: '20px 25px', fontSize: 25, maxWidth: 700}}>{useCase}</div>)}</div>
    <div style={{position: 'absolute', right: 82, bottom: 142, color: muted, fontSize: 19}}>{tool.url}</div>
  </Shell>;
}

function Outro({edition}: {edition: DiscoveryEdition}) {
  return <Shell edition={edition} label="SEE YOU"><div style={{marginTop: 280, textAlign: 'center'}}><h1 style={{fontSize: 84}}>明天继续发现好工具</h1><div style={{height: 6, width: 400, margin: '40px auto', background: accent, borderRadius: 99}} /></div></Shell>;
}

export function DarkSignalTemplate({edition, timeline}: TemplateViewProps) {
  const selected = edition.candidates.filter((item) => item.selected).sort((a, b) => a.position - b.position);
  return <AbsoluteFill style={{background}}>{timeline.map((segment, index) => {
    const content = segment.type === 'intro' ? <Intro edition={edition} /> : segment.type === 'radar' ? <Radar edition={edition} /> : segment.type === 'outro' ? <Outro edition={edition} /> : <Tool edition={edition} tool={selected[segment.toolIndex!]} index={segment.toolIndex!} total={selected.length} />;
    return <Sequence key={`${segment.type}-${index}`} from={segment.from} durationInFrames={segment.durationInFrames}>{content}</Sequence>;
  })}</AbsoluteFill>;
}
