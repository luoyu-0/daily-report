import type {CSSProperties} from 'react';
import type {BrandConfig, ToolCandidate} from '../shared/types';

export function ToolCard({tool, brand, index, total, style}: {
  tool: ToolCandidate; brand: BrandConfig; index: number; total: number; style?: CSSProperties;
}) {
  return <article style={{
    width: '100%', height: '100%', boxSizing: 'border-box', padding: '5.2% 5.8%', color: brand.ink,
    fontFamily: '"Microsoft YaHei", "Segoe UI", sans-serif', background: `linear-gradient(135deg,#fff 0%,${brand.background} 60%,${brand.paleBlue} 170%)`,
    display: 'grid', gridTemplateRows: 'auto 1fr auto', gap: 26, position: 'relative', overflow: 'hidden', ...style,
  }}>
    <header style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
      <div style={{display: 'flex', gap: 16, alignItems: 'center'}}><b style={{color: brand.primary}}>{brand.name}</b><span>·</span><strong>{tool.toolType}</strong></div>
      <b style={{color: brand.primary}}>{String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</b>
    </header>
    <div style={{display: 'grid', gridTemplateColumns: '1.35fr .75fr', gap: 54, minHeight: 0}}>
      <section style={{display: 'flex', flexDirection: 'column', justifyContent: 'center'}}>
        <div style={{display: 'flex', gap: 12, marginBottom: 20}}>
          <span style={{padding: '8px 14px', borderRadius: 999, color: brand.primary, background: brand.paleBlue, fontWeight: 900}}>Trending #{tool.rank}</span>
          <span style={{padding: '8px 14px', borderRadius: 999, color: '#0369a1', background: '#e0f2fe', fontWeight: 900}}>实用性 {tool.utilityScore}</span>
        </div>
        <h1 style={{fontSize: 62, lineHeight: 1.15, margin: 0, overflowWrap: 'anywhere'}}>{tool.repo}</h1>
        <p style={{fontSize: 31, lineHeight: 1.55, color: '#334155', margin: '28px 0'}}>{tool.oneLinePitchZh}</p>
        <div style={{display: 'grid', gap: 12}}>{tool.useCases.slice(0, 3).map((item, i) => <div key={item} style={{fontSize: 23, display: 'flex', gap: 12}}><b style={{color: brand.primary}}>0{i + 1}</b><span>{item}</span></div>)}</div>
      </section>
      <aside style={{alignSelf: 'center', padding: 30, borderRadius: 26, background: '#fff', border: `1px solid ${brand.paleBlue}`, boxShadow: '0 20px 55px rgba(37,99,235,.10)'}}>
        <h2 style={{fontSize: 25, margin: '0 0 22px'}}>仓库速览</h2>
        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, fontSize: 20}}>
          <div><small>Today</small><strong style={{display: 'block', fontSize: 27}}>+{tool.starsToday ?? '—'} ★</strong></div>
          <div><small>Language</small><strong style={{display: 'block', fontSize: 24}}>{tool.language ?? '—'}</strong></div>
          <div><small>License</small><strong style={{display: 'block', fontSize: 24}}>{tool.license ?? '未识别'}</strong></div>
          <div><small>适合</small><strong style={{display: 'block', fontSize: 21}}>{tool.targetUsers.slice(0, 2).join('、')}</strong></div>
        </div>
        {tool.quickStart && <div style={{marginTop: 24, padding: 18, borderRadius: 14, background: '#0f172a', color: '#e2e8f0', fontFamily: 'Consolas, monospace', fontSize: 17, whiteSpace: 'pre-wrap', overflow: 'hidden', maxHeight: 150}}>{tool.quickStart}</div>}
        {tool.caveats[0] && <p style={{margin: '22px 0 0', color: '#9a3412', fontSize: 18}}>注意：{tool.caveats[0]}</p>}
      </aside>
    </div>
    <footer style={{display: 'flex', justifyContent: 'space-between', gap: 28, color: '#64748b'}}><span>所有结论来自仓库公开资料</span><strong style={{overflowWrap: 'anywhere', textAlign: 'right'}}>{tool.url}</strong></footer>
  </article>;
}
