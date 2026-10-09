import {useEffect, useMemo, useState} from 'react';
import type {CandidateStory, Edition, RenderJob} from '../shared/types.js';
import {NewsCard} from '../ui/NewsCard.js';

const api = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {headers: {'content-type': 'application/json'}, ...init});
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
};

const chinaDate = () => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());

function EmptyState({onCreated}: {onCreated: (edition: Edition) => void}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const create = async () => {
    setBusy(true); setError('');
    try {
      const result = await api<{edition: Edition}>('/api/editions', {method: 'POST', body: JSON.stringify({date: chinaDate()})});
      onCreated(result.edition);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <main className="empty"><div className="empty-mark">AI</div><h1>AI 智讯日报</h1><p>还没有可审核的日报。创建今日任务后，系统将采集并整理最近 36 小时的资讯。</p><button className="primary" onClick={create} disabled={busy}>{busy ? '正在采集…' : '创建今日日报'}</button>{error && <div className="error">{error}</div>}</main>;
}

function EditorCard({story, index, total, edition, onUpdate, onRegenerate, onDrag, onDrop}: {
  story: CandidateStory; index: number; total: number; edition: Edition;
  onUpdate: (id: string, patch: Partial<CandidateStory>) => Promise<void>;
  onRegenerate: (id: string) => Promise<void>;
  onDrag: () => void; onDrop: () => void;
}) {
  const [draft, setDraft] = useState(story);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(story), [story]);
  const save = async (confirmed = false) => {
    setBusy(true);
    try { await onUpdate(story.id, {titleZh: draft.titleZh, summaryZh: draft.summaryZh, category: draft.category, selected: draft.selected, confirmed}); }
    finally { setBusy(false); }
  };
  return <article className={`editor-card ${story.selected ? 'selected' : ''}`} draggable onDragStart={onDrag} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
    <div className="card-top"><span className="drag">⋮⋮</span><strong>#{String(index + 1).padStart(2, '0')}</strong><span className="score">评分 {story.score}</span><span className={`method ${story.generationMethod}`}>{story.generationMethod === 'llm' ? 'LLM + 规则' : '规则回退'}</span><label className="pick"><input type="checkbox" checked={draft.selected} onChange={(event) => setDraft({...draft, selected: event.target.checked})}/>入选</label></div>
    <div className="compare">
      <section className="source-pane"><div className="eyebrow">原始证据</div><h3>{story.titleOriginal}</h3><p>{story.sources[0].content}</p><a href={story.sources[0].url} target="_blank" rel="noreferrer">{story.sources[0].sourceName} ↗</a></section>
      <section className="edit-pane"><div className="eyebrow">成片文案</div><select value={draft.category} onChange={(event) => setDraft({...draft, category: event.target.value as CandidateStory['category']})}>{['AI 产品与模型','智能体与安全','芯片与算力','研究与开源','行业动态'].map((item) => <option key={item}>{item}</option>)}</select><input value={draft.titleZh} onChange={(event) => setDraft({...draft, titleZh: event.target.value})}/><textarea value={draft.summaryZh} onChange={(event) => setDraft({...draft, summaryZh: event.target.value})}/></section>
    </div>
    {story.riskFlags.length > 0 && <div className="warning">⚠ {story.riskFlags.join(' · ')}</div>}
    <div className="card-actions"><span className={story.confirmed ? 'confirmed' : 'pending'}>{story.confirmed ? '✓ 已确认' : '待确认'}</span><button onClick={() => onRegenerate(story.id)} disabled={busy}>重新生成</button><button onClick={() => save(false)} disabled={busy}>保存</button><button className="primary small" onClick={() => save(true)} disabled={busy}>保存并确认</button></div>
  </article>;
}

export function App() {
  const [edition, setEdition] = useState<Edition>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [category, setCategory] = useState('全部');
  const [minScore, setMinScore] = useState(0);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [dragId, setDragId] = useState<string>();
  const [job, setJob] = useState<RenderJob>();

  const loadLatest = async () => {
    try { setEdition(await api<Edition>('/api/editions/latest')); }
    catch (reason) { if (!(reason instanceof Error && reason.message === '暂无日报')) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void loadLatest(); }, []);
  useEffect(() => {
    if (!job || ['completed', 'failed'].includes(job.status)) return;
    const timer = window.setInterval(async () => {
      const next = await api<RenderJob>(`/api/render-jobs/${job.id}`);
      setJob(next);
      if (['completed', 'failed'].includes(next.status)) void loadLatest();
    }, 1500);
    return () => clearInterval(timer);
  }, [job?.id, job?.status]);

  const filtered = useMemo(() => (edition?.candidates ?? []).filter((item) => (category === '全部' || item.category === category) && item.score >= minScore), [edition, category, minScore]);
  const selected = (edition?.candidates ?? []).filter((item) => item.selected).sort((a, b) => a.position - b.position);
  const currentPreview = selected[Math.min(previewIndex, Math.max(0, selected.length - 1))];

  if (loading) return <main className="empty"><div className="loader" /><p>正在载入审核台…</p></main>;
  if (!edition) return <EmptyState onCreated={setEdition} />;

  const update = async (candidateId: string, patch: Partial<CandidateStory>) => {
    const next = await api<Edition>(`/api/editions/${edition.id}/candidates/${candidateId}`, {method: 'PATCH', body: JSON.stringify(patch)});
    setEdition(next); setError('');
  };
  const regenerate = async (candidateId: string) => {
    try { setEdition(await api<Edition>(`/api/editions/${edition.id}/candidates/${candidateId}/regenerate`, {method: 'POST'})); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const drop = async (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = edition.candidates.sort((a,b) => a.position-b.position).map((item) => item.id);
    const from = ids.indexOf(dragId); const to = ids.indexOf(targetId);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setEdition(await api<Edition>(`/api/editions/${edition.id}/reorder`, {method: 'POST', body: JSON.stringify({candidateIds: ids})}));
    setDragId(undefined);
  };
  const approve = async () => {
    try { setEdition(await api<Edition>(`/api/editions/${edition.id}/approve`, {method: 'POST'})); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const render = async () => {
    try { setJob(await api<RenderJob>(`/api/editions/${edition.id}/render`, {method: 'POST'})); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  return <div className="app-shell">
    <header className="app-header"><div><div className="brand"><span>AI</span> {edition.brand.name}</div><h1>{edition.date} 审核台</h1></div><div className="status-block"><span className={`status ${edition.status}`}>{edition.status}</span><small>v{edition.version} · {edition.candidates.length} 条候选</small></div></header>
    <div className="toolbar"><label>栏目 <select value={category} onChange={(event) => setCategory(event.target.value)}><option>全部</option>{[...new Set(edition.candidates.map((item) => item.category))].map((item) => <option key={item}>{item}</option>)}</select></label><label>最低评分 <input type="range" min="0" max="100" value={minScore} onChange={(event) => setMinScore(Number(event.target.value))}/><strong>{minScore}</strong></label><div className="toolbar-spacer"/><span>已选 <b>{selected.length}</b> / 5～6</span><button onClick={approve} disabled={edition.status !== 'draft'}>批准并锁定</button><button className="primary" onClick={render} disabled={edition.status !== 'approved'}>渲染 MP4</button></div>
    {error && <div className="global-error">{error}<button onClick={() => setError('')}>x</button></div>}
    {job && <div className={`job ${job.status}`}><div><strong>渲染任务：{job.status}</strong><span>{job.error || job.outputPath || job.logs.at(-1)}</span></div><progress max="100" value={job.progress}/><b>{job.progress}%</b></div>}
    <div className="workspace"><main className="candidate-list">{filtered.map((story) => <EditorCard key={story.id} story={story} index={edition.candidates.indexOf(story)} total={edition.candidates.length} edition={edition} onUpdate={update} onRegenerate={regenerate} onDrag={() => setDragId(story.id)} onDrop={() => void drop(story.id)} />)}</main>
      <aside className="preview-panel"><div className="preview-head"><div><div className="eyebrow">成片预览</div><strong>{currentPreview ? `${previewIndex + 1} / ${selected.length}` : '未选择'}</strong></div><div><button onClick={() => setPreviewIndex(Math.max(0, previewIndex - 1))}>←</button><button onClick={() => setPreviewIndex(Math.min(selected.length - 1, previewIndex + 1))}>→</button></div></div><div className="video-frame">{currentPreview ? <div className="video-canvas"><NewsCard story={currentPreview} brand={edition.brand} index={previewIndex} total={selected.length}/></div> : <p>请选择 5～6 条新闻</p>}</div><div className="preview-note">预览与成片共用同一套 React 组件。正式视频将以 1920×1080、30fps 渲染。</div></aside>
    </div>
  </div>;
}

