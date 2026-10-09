import type {CSSProperties} from 'react';
import type {BrandConfig, CandidateStory} from '../shared/types';

export type NewsCardProps = {
  story: CandidateStory;
  brand: BrandConfig;
  index?: number;
  total?: number;
  style?: CSSProperties;
};

export function NewsCard({story, brand, index = 0, total = 1, style}: NewsCardProps) {
  const source = story.sources[0];
  return (
    <article style={{
      width: '100%', height: '100%', boxSizing: 'border-box', padding: '5.4% 5.8%',
      color: brand.ink, fontFamily: '"Microsoft YaHei", "Segoe UI", sans-serif',
      background: `linear-gradient(135deg, #fff 0%, ${brand.background} 58%, ${brand.paleBlue} 160%)`,
      display: 'grid', gridTemplateRows: 'auto 1fr auto', gap: 28, position: 'relative', overflow: 'hidden', ...style,
    }}>
      <div style={{position: 'absolute', right: '-6%', top: '-25%', width: '35%', aspectRatio: '1', borderRadius: '50%', border: `2px solid ${brand.paleBlue}`}} />
      <header style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 18}}>
          <span style={{fontWeight: 800, color: brand.primary, letterSpacing: 1.5}}>{brand.name}</span>
          <span style={{height: 18, width: 1, background: brand.paleBlue}} />
          <span style={{fontWeight: 700, color: '#475569'}}>{story.category}</span>
        </div>
        <div style={{fontVariantNumeric: 'tabular-nums', fontWeight: 800, color: brand.primary}}>
          {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </div>
      </header>

      <div style={{display: 'grid', gridTemplateColumns: '1.45fr .75fr', gap: '4%', minHeight: 0, position: 'relative'}}>
        <section style={{display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0}}>
          <div style={{display: 'inline-flex', alignSelf: 'flex-start', padding: '8px 14px', borderRadius: 999, color: brand.primary, background: brand.paleBlue, fontWeight: 800, marginBottom: 24}}>
            今日重点 · {Math.round(story.score)}
          </div>
          <h1 style={{fontSize: 58, lineHeight: 1.18, letterSpacing: -1.5, margin: 0, maxWidth: '96%', overflowWrap: 'anywhere'}}>{story.titleZh}</h1>
          <div style={{width: 96, height: 6, background: brand.accent, borderRadius: 9, margin: '28px 0'}} />
          <p style={{fontSize: 29, lineHeight: 1.72, margin: 0, color: '#334155', fontWeight: 520, display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden'}}>{story.summaryZh}</p>
        </section>

        <aside style={{alignSelf: 'center', background: 'rgba(255,255,255,.88)', border: `1px solid ${brand.paleBlue}`, boxShadow: '0 20px 55px rgba(37,99,235,.10)', borderRadius: 28, padding: 30, minWidth: 0}}>
          <div style={{display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 22}}>
            <span style={{fontWeight: 900, color: brand.primary}}>来源证据</span>
            <span style={{fontSize: 16, color: '#64748b'}}>{story.generationMethod === 'llm' ? 'LLM + 规则' : '规则摘要'}</span>
          </div>
          <h2 style={{fontSize: 26, lineHeight: 1.38, margin: '0 0 18px', overflowWrap: 'anywhere'}}>{source.title}</h2>
          <p style={{fontSize: 20, lineHeight: 1.55, margin: 0, color: '#475569', display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden'}}>{source.content}</p>
          <div style={{borderTop: `1px solid ${brand.paleBlue}`, marginTop: 22, paddingTop: 18, fontSize: 17, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{source.sourceName} · {new URL(source.url).hostname}</div>
        </aside>
      </div>

      <footer style={{display: 'grid', gridTemplateColumns: '1fr auto', gap: 30, alignItems: 'center'}}>
        <div style={{height: 5, borderRadius: 9, background: brand.paleBlue, overflow: 'hidden'}}>
          <div style={{height: '100%', width: `${((index + 1) / total) * 100}%`, background: `linear-gradient(90deg, ${brand.primary}, ${brand.accent})`}} />
        </div>
        <strong style={{fontSize: 18, color: '#475569'}}>{source.sourceName}</strong>
      </footer>
    </article>
  );
}

