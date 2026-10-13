import {useEffect, useMemo, useRef, useState} from 'react';
import {Player} from '@remotion/player';
import type {DiscoveryEdition, RenderJob, ToolCandidate, ToolType} from '../shared/types.js';
import {currentChinaDate} from '../shared/date.js';
import {REVIEW_API_VERSION, REVIEW_APP_ID} from '../shared/review-contract.js';
import {DailyReportVideo} from '../video/Composition.js';
import {totalDurationFrames, VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH} from '../video/timeline.js';
import {api} from './api.js';
import './tool-radar.css';

type OptimizationResult = {edition: DiscoveryEdition; requested: number; optimized: number; fallback: number; cacheHits: number; inputChars: number; warnings: string[]};
type LockedRepo = {date: string; repo: string};
type ReviewPage = 'overview' | 'candidates' | 'locks' | 'render';
type ToolDraft = Pick<ToolCandidate, 'oneLinePitchZh' | 'toolType' | 'useCases' | 'targetUsers'>;
const toolTypes: ToolType[] = ['CLI', '桌面应用', 'Web 工具', '开发工具', '自动化', 'Agent', '框架与库', '其他'];
const lines = (value: string) => value.split('\n').map((item) => item.trim()).filter(Boolean);
const editableFields = (tool: ToolCandidate): ToolDraft => ({oneLinePitchZh: tool.oneLinePitchZh, toolType: tool.toolType, useCases: tool.useCases, targetUsers: tool.targetUsers});
const sourceOverview = (tool: ToolCandidate) => {
  const content = tool.sources[0]?.content ?? '';
  const marked = content.match(/^项目描述：([^\n]+)/)?.[1]?.trim();
  return (marked || content.split(/\n\s*\n/)[0] || '仓库未提供项目描述').slice(0, 600);
};
const parseEdition = (value: unknown): DiscoveryEdition => {
  const candidate = value as Partial<DiscoveryEdition> | null;
  const valid = candidate?.kind === 'github-tools' && typeof candidate.id === 'string' && Array.isArray(candidate.candidates)
    && candidate.candidates.every((item) => typeof item?.repo === 'string' && typeof item?.rank === 'number' && Array.isArray(item?.sources));
  if (!valid) throw new Error('审核服务版本不兼容。请关闭旧审核台后重新运行 npm run daily。');
  return candidate as DiscoveryEdition;
};

function EmptyState({onCreated}: {onCreated: (edition: DiscoveryEdition) => void}) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const create = async () => {
    setBusy(true); setError('');
    try { onCreated(parseEdition((await api<{edition: unknown}>('/api/editions', {method: 'POST', body: JSON.stringify({date: currentChinaDate()})})).edition)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <main className="empty"><div className="empty-mark">GH</div><h1>GitHub 工具雷达</h1><p>读取全球 GitHub Trending Today，跳过往期已成片入选仓库，发现值得尝试的新工具。</p><button className="primary" onClick={create} disabled={busy}>{busy ? '正在发现工具…' : '创建今日工具雷达'}</button>{error && <div className="error">{error}</div>}</main>;
}

function TrendingRadar({tools}: {tools: ToolCandidate[]}) {
  return <section className="github-panel"><div className="section-title"><div><div className="eyebrow">GITHUB · TRENDING · TODAY</div><h2>今日可选仓库</h2></div><span className="auto-badge">已跳过成片锁定仓库</span></div><div className="github-grid">{tools.length === 0 && <p>今日榜单暂无可选仓库。</p>}{[...tools].sort((a, b) => a.rank - b.rank).map((tool) => <article key={tool.id}><strong>#{tool.rank}</strong><div><h3>{tool.repo} {tool.rankingSource && <small className="ranking-source">{tool.rankingSource}</small>}</h3><p>{tool.oneLinePitchZh}</p><a href={tool.url} target="_blank" rel="noreferrer">查看仓库 ↗</a></div><span className="topic-tag">+{tool.starsToday ?? '—'} ★</span></article>)}</div></section>;
}

function ToolEditor({tool, onUpdate, onRegenerate, optimizing, optimizationLocked}: {
  tool: ToolCandidate; onUpdate: (repo: string, patch: Partial<ToolCandidate>) => Promise<void>; onRegenerate: (repo: string) => Promise<void>;
  optimizing: boolean; optimizationLocked: boolean;
}) {
  const serverDraft = editableFields(tool);
  const serverKey = JSON.stringify(serverDraft);
  const [draft, setDraft] = useState<ToolDraft>(serverDraft);
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const lastSubmitted = useRef(serverKey);
  useEffect(() => {
    if (JSON.stringify(draft) === lastSubmitted.current) setDraft(serverDraft);
    lastSubmitted.current = serverKey;
  }, [tool.id, serverKey]);
  const persist = async (value: ToolDraft, selected?: boolean) => {
    const key = JSON.stringify(value);
    if (selected === undefined && key === lastSubmitted.current) return;
    lastSubmitted.current = key;
    setSaveState('saving');
    try { await onUpdate(tool.repo, selected === undefined ? value : {...value, selected, confirmed: selected}); setSaveState('saved'); }
    catch (reason) { lastSubmitted.current = serverKey; setSaveState('error'); throw reason; }
  };
  useEffect(() => {
    if (JSON.stringify(draft) === lastSubmitted.current) return;
    const timer = window.setTimeout(() => { void persist(draft).catch(() => {}); }, 650);
    return () => window.clearTimeout(timer);
  }, [draft, serverKey]);
  const select = async (selected: boolean) => {
    setBusy(true);
    try { await persist(draft, selected); } finally { setBusy(false); }
  };
  return <article className={`editor-card ${tool.selected ? 'selected' : ''}`}>
    <div className="card-top"><strong>候选 #{String(tool.rank).padStart(2, '0')}</strong>{tool.rankingSource && <span className="ranking-source">{tool.rankingSource}</span>}<span className="score">实用性 {tool.utilityScore}</span><span className={`method ${tool.generationMethod}`}>{tool.generationMethod === 'llm' ? 'LLM + 证据' : '规则提炼'}</span></div>
    <div className="compare"><section className="source-pane"><div className="eyebrow">仓库证据</div><h3>{tool.repo}</h3><p>{sourceOverview(tool)}</p><div className="repo-metrics"><span>{tool.language ?? '未知语言'}</span><span>{tool.license ?? '无许可证信息'}</span><span>{tool.totalStars?.toLocaleString() ?? '—'} Stars</span></div><a href={tool.url} target="_blank" rel="noreferrer">GitHub ↗</a>{tool.excludeReason && <div className="warning">非工具提示：{tool.excludeReason}</div>}</section>
      <section className="edit-pane" onBlur={() => { void persist(draft).catch(() => {}); }}><div className="edit-heading"><div className="eyebrow">推荐文案</div><select disabled={optimizationLocked} value={draft.toolType} onChange={(event) => setDraft({...draft, toolType: event.target.value as ToolType})}>{toolTypes.map((type) => <option key={type}>{type}</option>)}</select></div><input disabled={optimizationLocked} value={draft.oneLinePitchZh} onChange={(event) => setDraft({...draft, oneLinePitchZh: event.target.value})}/><label>使用场景（每行一项）</label><textarea disabled={optimizationLocked} value={draft.useCases.join('\n')} onChange={(event) => setDraft({...draft, useCases: lines(event.target.value)})}/><label>适合人群（每行一项）</label><textarea disabled={optimizationLocked} className="compact-textarea" value={draft.targetUsers.join('\n')} onChange={(event) => setDraft({...draft, targetUsers: lines(event.target.value)})}/></section></div>
    {optimizing && <div className="optimization-progress"><span>正在优化，结果将自动保存；入选前请核对</span><progress aria-label={`${tool.repo} 优化进度`}/></div>}
    <div className="card-actions"><span className={tool.selected ? 'confirmed' : 'pending'}>{tool.selected ? '✓ 已入选' : '待入选'}{saveState === 'saving' ? ' · 自动保存中' : saveState === 'saved' ? ' · 已自动保存' : saveState === 'error' ? ' · 保存失败，请重试' : ''}</span><button onClick={() => { void persist(draft).then(() => onRegenerate(tool.repo)).catch(() => {}); }} disabled={busy || optimizationLocked}>{optimizing ? 'LLM 优化中…' : 'LLM优化'}</button>{tool.selected ? <button className="danger" onClick={() => { void select(false).catch(() => {}); }} disabled={busy || optimizationLocked}>取消入选</button> : <button className="primary small" onClick={() => { void select(true).catch(() => {}); }} disabled={busy || optimizationLocked}>入选</button>}</div>
  </article>;
}

function RenderConfirmation({count, busy, onCancel, onConfirm}: {count: number; busy: boolean; onCancel: () => void; onConfirm: () => void}) {
  const [seconds, setSeconds] = useState(3);
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <div className="confirm-backdrop"><section className="confirm-dialog" role="dialog" aria-modal="true" aria-label="确认渲染成片"><h2>确认渲染成片？</h2><p>将使用当前入选的 {count} 个仓库生成最终 MP4。请先核对来源和推荐文案；成功成片后，这些仓库将被锁定。</p><div><button onClick={onCancel} disabled={busy}>返回审核</button><button className="primary" onClick={onConfirm} disabled={seconds > 0 || busy}>{busy ? '正在提交…' : seconds > 0 ? `${seconds} 秒后可确认` : '确认并渲染'}</button></div></section></div>;
}

export function App() {
  const startupError = new URLSearchParams(window.location.search).get('collectionError');
  const [edition, setEdition] = useState<DiscoveryEdition>(); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(''); const [serviceError, setServiceError] = useState(''); const [minScore, setMinScore] = useState(0);
  const [job, setJob] = useState<RenderJob>(); const [optimizing, setOptimizing] = useState(false); const [optimizingToolId, setOptimizingToolId] = useState<string>(); const optimizationLock = useRef(false); const [optimizationMessage, setOptimizationMessage] = useState('');
  const [showRenderConfirm, setShowRenderConfirm] = useState(false); const [renderBusy, setRenderBusy] = useState(false);
  const editionRef = useRef<DiscoveryEdition | undefined>(undefined);
  const updateQueue = useRef<Promise<void>>(Promise.resolve());
  const editError = useRef<unknown>(undefined);
  const applyEdition = (next: DiscoveryEdition) => { editionRef.current = next; setEdition(next); };
  const [lockedRepos, setLockedRepos] = useState<LockedRepo[]>([]); const [activePage, setActivePage] = useState<ReviewPage>('overview');
  const loadLocks = async () => { try { const result = await api<{repos: LockedRepo[]}>('/api/repo-locks'); setLockedRepos(result.repos); } catch { setLockedRepos([]); } };
  const loadLatest = async () => {
    try {
      const health = await api<{app: string; apiVersion: number}>('/api/health');
      if (health.app !== REVIEW_APP_ID || health.apiVersion !== REVIEW_API_VERSION) throw new Error('审核服务版本过旧。请关闭旧审核台进程，再运行 npm run review。');
      applyEdition(parseEdition(await api<unknown>('/api/editions/latest')));
    } catch (reason) { if (!(reason instanceof Error && reason.message === '暂无工具雷达日报')) setServiceError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); void loadLocks(); }
  };
  useEffect(() => { void loadLatest(); }, []);
  useEffect(() => {
    if (!job || ['completed', 'failed'].includes(job.status)) return;
    const timer = window.setInterval(async () => { const next = await api<RenderJob>(`/api/render-jobs/${job.id}`); setJob(next); if (['completed', 'failed'].includes(next.status)) void loadLatest(); }, 1500);
    return () => clearInterval(timer);
  }, [job?.id, job?.status]);
  const selected = (edition?.candidates ?? []).filter((item) => item.selected).sort((a, b) => a.position - b.position);
  const filtered = useMemo(() => (edition?.candidates ?? []).filter((item) => item.utilityScore >= minScore), [edition, minScore]);
  const llmTargets = (edition?.candidates ?? []).filter((item) => item.generationMethod !== 'llm');
  const estimatedChars = llmTargets.reduce((total, item) => total + Math.min(item.sources[0].content.length, 1600), 0);
  if (loading) return <main className="empty"><div className="loader"/><p>正在载入审核台…</p></main>;
  if (startupError) return <main className="empty"><div className="empty-mark">!</div><h1>今日工具采集失败</h1><p className="startup-error">{startupError}</p><p>未使用过去日期榜单，请稍后重新运行 <code>npm run daily</code>。</p></main>;
  if (serviceError) return <main className="empty"><div className="empty-mark">!</div><h1>审核服务暂不可用</h1><p className="startup-error">{serviceError}</p></main>;
  if (!edition) return <EmptyState onCreated={applyEdition}/>;
  const update = (repo: string, patch: Partial<ToolCandidate>): Promise<void> => {
    const task = updateQueue.current.then(async () => {
      const current = editionRef.current;
      const candidate = current?.candidates.find((item) => item.repo === repo);
      if (!current || !candidate) throw new Error('待保存的仓库已不在当前日报中');
      try {
        applyEdition(parseEdition(await api<unknown>(`/api/editions/${current.id}/candidates/${candidate.id}`, {method: 'PATCH', body: JSON.stringify(patch)})));
        editError.current = undefined; setError('');
      } catch (reason) { editError.current = reason; setError(reason instanceof Error ? reason.message : String(reason)); throw reason; }
    });
    updateQueue.current = task.catch(() => {});
    return task;
  };
  const regenerate = async (repo: string) => {
    if (optimizationLock.current) return;
    if (!window.confirm('将调用一次 LLM 优化此工具。是否继续？')) return;
    optimizationLock.current = true; setOptimizingToolId(repo); setError('');
    try {
      await updateQueue.current;
      const current = editionRef.current;
      const candidate = current?.candidates.find((item) => item.repo === repo);
      if (!current || !candidate) throw new Error('待优化的仓库已不在当前日报中');
      applyEdition(parseEdition(await api<unknown>(`/api/editions/${current.id}/candidates/${candidate.id}/regenerate`, {method: 'POST'})));
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { optimizationLock.current = false; setOptimizingToolId(undefined); }
  };
  const optimize = async () => {
    if (optimizationLock.current) return;
    if (!llmTargets.length || !window.confirm(`将调用 LLM 优化全部 ${llmTargets.length} 个尚未优化的候选（包含未入选项），最多发送约 ${(estimatedChars / 1000).toFixed(1)}k 字符。已优化项会跳过。是否继续？`)) return;
    optimizationLock.current = true; setOptimizing(true); setError('');
    try { await updateQueue.current; const current = editionRef.current; if (!current) throw new Error('日报不存在'); const result = await api<OptimizationResult>(`/api/editions/${current.id}/optimize-all`, {method: 'POST'}); applyEdition(parseEdition(result.edition)); setOptimizationMessage(`优化完成：成功 ${result.optimized}，缓存命中 ${result.cacheHits}，规则回退 ${result.fallback}，本次发送 ${result.inputChars} 个证据字符。`); if (result.warnings.length) setError(result.warnings.join('；')); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { optimizationLock.current = false; setOptimizing(false); }
  };
  const render = async () => {
    setRenderBusy(true);
    try {
      await updateQueue.current;
      if (editError.current) throw new Error('仍有编辑内容保存失败，请先重试保存');
      const current = editionRef.current;
      if (!current) throw new Error('日报不存在');
      setJob(await api<RenderJob>(`/api/editions/${current.id}/render`, {method: 'POST', body: JSON.stringify({confirm: true})}));
      setShowRenderConfirm(false); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setRenderBusy(false); }
  };
  const deleteLock = async (date: string, repo: string) => {
    if (!window.confirm(`删除 ${date} 的 ${repo} 锁定记录？仓库将可再次进入候选；原视频和审核数据不会删除。`)) return;
    try { await api('/api/repo-locks/delete', {method: 'POST', body: JSON.stringify({date, repo})}); await loadLocks(); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const pageTitles: Record<ReviewPage, string> = {overview: '概览', candidates: '仓库候选', locks: '锁定记录', render: '成片渲染'};
  const renderDisabled = !['draft', 'approved'].includes(edition.status) || optimizing || Boolean(optimizingToolId)
    || Boolean(job && !['completed', 'failed'].includes(job.status)) || selected.length < 1 || selected.length > 10;
  return <div className="review-shell">
    <header className="review-heading"><div className="brand"><span>GH</span> {edition.brand.name}</div><h1>审核台</h1></header>
    <div className="review-layout"><nav className="review-nav" aria-label="审核台导航">{(['overview', 'candidates', 'locks', 'render'] as ReviewPage[]).map((page) => <button key={page} type="button" className={activePage === page ? 'active' : ''} aria-current={activePage === page ? 'page' : undefined} onClick={() => setActivePage(page)}>{pageTitles[page]}{page === 'locks' && lockedRepos.length > 0 ? <small>{lockedRepos.length}</small> : null}</button>)}</nav>
      <div className="review-content"><div className="review-page-head"><div><div className="eyebrow">{edition.date} · v{edition.version}</div><h2>{pageTitles[activePage]}</h2></div><div className="status-block"><span className={`status ${edition.status}`}>{edition.status}</span><small>候选 {edition.candidates.length} 项 · 已入选 {selected.length} 项</small></div></div>
        {error && <div className="global-error">{error}<button onClick={() => setError('')}>×</button></div>}{optimizationMessage && <div className="global-error success">{optimizationMessage}<button onClick={() => setOptimizationMessage('')}>×</button></div>}{job && <div className={`job ${job.status}`}><div><strong>渲染任务：{job.status}</strong><span>{job.error || job.outputPath || job.logs.at(-1)}</span></div><progress max="100" value={job.progress}/><b>{job.progress}%</b></div>}
        {activePage === 'overview' && <main className="overview-page"><p>从今日 GitHub 热榜发现新工具，核对仓库证据与推荐文案，确认后生成视频。</p><div className="overview-stats"><div><strong>{edition.candidates.length}</strong><span>今日候选</span></div><div><strong>{selected.length}</strong><span>已入选</span></div><div><strong>{lockedRepos.length}</strong><span>成片锁定记录</span></div></div><div className="overview-actions"><button className="primary" onClick={() => setActivePage('candidates')}>审核仓库候选</button><button onClick={() => setActivePage('render')}>预览成片</button></div><TrendingRadar tools={edition.candidates}/></main>}
        {activePage === 'candidates' && <main className="candidate-page"><div className="page-actions"><label>最低实用性 <input type="range" min="0" max="100" value={minScore} onChange={(event) => setMinScore(Number(event.target.value))}/><strong>{minScore}</strong></label><button onClick={optimize} disabled={edition.status !== 'draft' || optimizing || Boolean(optimizingToolId) || !llmTargets.length}>{optimizing ? 'LLM 优化中…' : 'LLM一键优化'}</button></div><div className="section-title industry-title"><div><div className="eyebrow">TOOLS · REVIEW</div><h2>工具候选</h2></div><span>新日报默认入选前 10 项，可逐项调整</span></div><div className="candidate-list">{filtered.map((tool) => <ToolEditor key={tool.id} tool={tool} onUpdate={update} onRegenerate={regenerate} optimizing={optimizingToolId === tool.repo} optimizationLocked={optimizing || Boolean(optimizingToolId)}/>)}</div></main>}
        {activePage === 'locks' && <main className="locked-repos" aria-label="以往锁定仓库"><h2>已成片锁定仓库</h2>{lockedRepos.length === 0 ? <p>暂无锁定记录。只有入选并成功渲染成片的仓库才会出现在这里。</p> : <div className="locked-repo-list">{lockedRepos.map((item) => <div key={`${item.date}:${item.repo}`}><time>{item.date}</time><a href={`https://github.com/${item.repo}`} target="_blank" rel="noreferrer">{item.repo}</a><button className="danger" onClick={() => deleteLock(item.date, item.repo)}>删除锁定记录</button></div>)}</div>}</main>}
        {activePage === 'render' && <main className="render-page"><div className="render-actions"><p>将使用当前入选的 {selected.length} 个仓库。请先在“仓库候选”核对文案和来源。</p><button className="primary" onClick={() => { (document.activeElement as HTMLElement | null)?.blur(); setShowRenderConfirm(true); }} disabled={renderDisabled}>渲染成片</button></div><section className="preview-panel"><div className="preview-head"><div><div className="eyebrow">REMOTION · PLAYER</div><strong>完整成片预览</strong></div><span>{Math.round(totalDurationFrames(edition) / VIDEO_FPS)} 秒</span></div><div className="video-frame"><Player component={DailyReportVideo} inputProps={{edition, hasBgm: false}} durationInFrames={totalDurationFrames(edition)} fps={VIDEO_FPS} compositionWidth={VIDEO_WIDTH} compositionHeight={VIDEO_HEIGHT} controls loop clickToPlay style={{width: '100%', aspectRatio: '16 / 9'}}/></div><div className="preview-note">预览与正式 MP4 使用相同时间轴。项目没有被自动安装或运行，推荐依据仅来自公开仓库资料。</div></section></main>}
      </div></div>
    {showRenderConfirm && <RenderConfirmation count={selected.length} busy={renderBusy} onCancel={() => setShowRenderConfirm(false)} onConfirm={() => { void render(); }} />}
  </div>;
}
