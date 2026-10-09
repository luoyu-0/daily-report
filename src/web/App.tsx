import {useEffect, useMemo, useState} from 'react';
import {Player} from '@remotion/player';
import type {CandidateStory, Edition, RenderJob} from '../shared/types.js';
import {currentChinaDate} from '../shared/date.js';
import {DailyReportVideo} from '../video/Composition.js';
import {totalDurationFrames, VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH} from '../video/timeline.js';
import {api} from './api.js';

function EmptyState({onCreated}: {onCreated: (edition: Edition) => void}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const create = async () => {
    setBusy(true); setError('');
    try {
      const result = await api<{edition: Edition}>('/api/editions', {method: 'POST', body: JSON.stringify({date: currentChinaDate()})});
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
      <section className="edit-pane"><div className="edit-heading"><div className="eyebrow">成片文案</div><span className="topic-tag">{draft.category}</span></div><input value={draft.titleZh} onChange={(event) => setDraft({...draft, titleZh: event.target.value})}/><textarea value={draft.summaryZh} onChange={(event) => setDraft({...draft, summaryZh: event.target.value})}/></section>
    </div>
    {story.riskFlags.length > 0 && <div className="warning">⚠ {story.riskFlags.join(' · ')}</div>}
    <div className="card-actions"><span className={story.confirmed ? 'confirmed' : 'pending'}>{story.confirmed ? '✓ 已确认' : '待确认'}</span><button onClick={() => onRegenerate(story.id)} disabled={busy}>重新生成</button><button onClick={() => save(false)} disabled={busy}>保存</button><button className="primary small" onClick={() => save(true)} disabled={busy}>保存并确认</button></div>
  </article>;
}

function GithubPanel({stories}: {stories: CandidateStory[]}) {
  return <section className="github-panel"><div className="section-title"><div><div className="eyebrow">GITHUB · DAILY</div><h2>GitHub 当天热榜前五</h2></div><span className="auto-badge">自动入选 · 无需审核</span></div><div className="github-grid">{stories.map((story, index) => <article key={story.id}><strong>{String(index + 1).padStart(2, '0')}</strong><div><h3>{story.titleZh}</h3><p>{story.summaryZh}</p><a href={story.sources[0].url} target="_blank" rel="noreferrer">{story.sources[0].sourceName} ↗</a></div><span className="topic-tag">{story.category}</span></article>)}</div>{stories.length !== 5 && <div className="warning">⚠ 当前日报没有完整的 GitHub Top 5，请重新运行 npm run daily 生成新版本。</div>}</section>;
}

export function App() {
  const [edition, setEdition] = useState<Edition>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [minScore, setMinScore] = useState(0);
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

  const github = (edition?.candidates ?? []).filter((item) => item.section === 'github' && item.selected).sort((a, b) => a.position - b.position).slice(0, 5);
  const industry = (edition?.candidates ?? []).filter((item) => item.section === 'industry');
  const filtered = useMemo(() => industry.filter((item) => item.score >= minScore), [industry, minScore]);
  const selected = industry.filter((item) => item.selected).sort((a, b) => a.position - b.position);

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
    const ids = industry.sort((a,b) => a.position-b.position).map((item) => item.id);
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
    <div className="toolbar"><label>行业候选最低评分 <input type="range" min="0" max="100" value={minScore} onChange={(event) => setMinScore(Number(event.target.value))}/><strong>{minScore}</strong></label><div className="toolbar-spacer"/><span>GitHub <b>{github.length}</b> / 5</span><span>行业概览 <b>{selected.length}</b> / 4</span><button onClick={approve} disabled={edition.status !== 'draft'}>批准并锁定</button><button className="primary" onClick={render} disabled={edition.status !== 'approved'}>渲染 MP4</button></div>
    {error && <div className="global-error">{error}<button onClick={() => setError('')}>x</button></div>}
    {job && <div className={`job ${job.status}`}><div><strong>渲染任务：{job.status}</strong><span>{job.error || job.outputPath || job.logs.at(-1)}</span></div><progress max="100" value={job.progress}/><b>{job.progress}%</b></div>}
    <div className="workspace"><main className="candidate-list"><GithubPanel stories={github}/><div className="section-title industry-title"><div><div className="eyebrow">INDUSTRY · REVIEW</div><h2>行业概览候选</h2></div><span>请选择并确认 4 条</span></div>{filtered.map((story) => <EditorCard key={story.id} story={story} index={industry.indexOf(story)} total={industry.length} edition={edition} onUpdate={update} onRegenerate={regenerate} onDrag={() => setDragId(story.id)} onDrop={() => void drop(story.id)} />)}</main>
      <aside className="preview-panel"><div className="preview-head"><div><div className="eyebrow">REMOTION · PLAYER</div><strong>完整成片预览</strong></div><span>{Math.round(totalDurationFrames(edition) / VIDEO_FPS)} 秒</span></div><div className="video-frame"><Player component={DailyReportVideo} inputProps={{edition, hasBgm: false}} durationInFrames={totalDurationFrames(edition)} fps={VIDEO_FPS} compositionWidth={VIDEO_WIDTH} compositionHeight={VIDEO_HEIGHT} controls loop clickToPlay style={{width: '100%', aspectRatio: '16 / 9'}} /></div><div className="preview-note">此处直接播放与 MP4 渲染相同的 Remotion 时间轴。审核阶段不加载 BGM，正式成片会按本地素材自动处理。</div></aside>
    </div>
  </div>;
}

