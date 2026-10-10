import {useEffect, useMemo, useState} from 'react';
import {Player} from '@remotion/player';
import type {DiscoveryEdition, RenderJob, ToolCandidate, ToolType} from '../shared/types.js';
import {currentChinaDate} from '../shared/date.js';
import {DailyReportVideo} from '../video/Composition.js';
import {totalDurationFrames, VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH} from '../video/timeline.js';
import {api} from './api.js';
import './tool-radar.css';

type OptimizationResult = {edition: DiscoveryEdition; requested: number; optimized: number; fallback: number; cacheHits: number; inputChars: number; warnings: string[]};
const toolTypes: ToolType[] = ['CLI', '桌面应用', 'Web 工具', '开发工具', '自动化', 'Agent', '框架与库', '其他'];
const lines = (value: string) => value.split('\n').map((item) => item.trim()).filter(Boolean);
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
  return <main className="empty"><div className="empty-mark">GH</div><h1>GitHub 工具雷达</h1><p>读取全球 GitHub Trending Today 前 15 名，结合仓库资料发现值得尝试的工具。</p><button className="primary" onClick={create} disabled={busy}>{busy ? '正在发现工具…' : '创建今日工具雷达'}</button>{error && <div className="error">{error}</div>}</main>;
}

function TrendingRadar({tools}: {tools: ToolCandidate[]}) {
  return <section className="github-panel"><div className="section-title"><div><div className="eyebrow">GLOBAL · TRENDING · TODAY</div><h2>今日全球热榜</h2></div><span className="auto-badge">采集时快照</span></div><div className="github-grid">{[...tools].sort((a, b) => a.rank - b.rank).map((tool) => <article key={tool.id}><strong>#{tool.rank}</strong><div><h3>{tool.repo}</h3><p>{tool.oneLinePitchZh}</p><a href={tool.url} target="_blank" rel="noreferrer">查看仓库 ↗</a></div><span className="topic-tag">+{tool.starsToday ?? '—'} ★</span></article>)}</div></section>;
}

function ToolEditor({tool, onUpdate, onRegenerate}: {
  tool: ToolCandidate; onUpdate: (id: string, patch: Partial<ToolCandidate>) => Promise<void>; onRegenerate: (id: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(tool); const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(tool), [tool]);
  const save = async (confirmed: boolean) => {
    setBusy(true);
    try { await onUpdate(tool.id, {
      oneLinePitchZh: draft.oneLinePitchZh, toolType: draft.toolType, useCases: draft.useCases,
      targetUsers: draft.targetUsers, selected: draft.selected, confirmed,
    }); } finally { setBusy(false); }
  };
  return <article className={`editor-card ${tool.selected ? 'selected' : ''}`}>
    <div className="card-top"><strong>#{String(tool.rank).padStart(2, '0')}</strong><span className="score">实用性 {tool.utilityScore}</span><span className={`method ${tool.generationMethod}`}>{tool.generationMethod === 'llm' ? 'LLM + 证据' : '规则提炼'}</span><label className="pick"><input type="checkbox" checked={draft.selected} onChange={(event) => setDraft({...draft, selected: event.target.checked})}/>入选</label></div>
    <div className="compare"><section className="source-pane"><div className="eyebrow">仓库证据</div><h3>{tool.repo}</h3><p>{sourceOverview(tool)}</p><div className="repo-metrics"><span>{tool.language ?? '未知语言'}</span><span>{tool.license ?? '无许可证信息'}</span><span>{tool.totalStars?.toLocaleString() ?? '—'} Stars</span></div><a href={tool.url} target="_blank" rel="noreferrer">GitHub ↗</a>{tool.excludeReason && <div className="warning">非工具提示：{tool.excludeReason}</div>}</section>
      <section className="edit-pane"><div className="edit-heading"><div className="eyebrow">推荐文案</div><select value={draft.toolType} onChange={(event) => setDraft({...draft, toolType: event.target.value as ToolType})}>{toolTypes.map((type) => <option key={type}>{type}</option>)}</select></div><input value={draft.oneLinePitchZh} onChange={(event) => setDraft({...draft, oneLinePitchZh: event.target.value})}/><label>使用场景（每行一项）</label><textarea value={draft.useCases.join('\n')} onChange={(event) => setDraft({...draft, useCases: lines(event.target.value)})}/><label>适合人群（每行一项）</label><textarea className="compact-textarea" value={draft.targetUsers.join('\n')} onChange={(event) => setDraft({...draft, targetUsers: lines(event.target.value)})}/></section></div>
    <div className="card-actions"><span className={tool.confirmed ? 'confirmed' : 'pending'}>{tool.confirmed ? '✓ 已确认' : '待确认'}</span><button onClick={() => onRegenerate(tool.id)} disabled={busy}>LLM 优化此项</button><button onClick={() => save(false)} disabled={busy}>保存</button><button className="primary small" onClick={() => save(true)} disabled={busy}>保存并确认</button></div>
  </article>;
}

export function App() {
  const startupError = new URLSearchParams(window.location.search).get('collectionError');
  const [edition, setEdition] = useState<DiscoveryEdition>(); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(''); const [minScore, setMinScore] = useState(0); const [toolsOnly, setToolsOnly] = useState(false);
  const [job, setJob] = useState<RenderJob>(); const [optimizing, setOptimizing] = useState(false); const [optimizationMessage, setOptimizationMessage] = useState('');
  const loadLatest = async () => {
    try { setEdition(parseEdition(await api<unknown>('/api/editions/latest'))); }
    catch (reason) { if (!(reason instanceof Error && reason.message === '暂无工具雷达日报')) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void loadLatest(); }, []);
  useEffect(() => {
    if (!job || ['completed', 'failed'].includes(job.status)) return;
    const timer = window.setInterval(async () => { const next = await api<RenderJob>(`/api/render-jobs/${job.id}`); setJob(next); if (['completed', 'failed'].includes(next.status)) void loadLatest(); }, 1500);
    return () => clearInterval(timer);
  }, [job?.id, job?.status]);
  const selected = (edition?.candidates ?? []).filter((item) => item.selected).sort((a, b) => a.position - b.position);
  const filtered = useMemo(() => (edition?.candidates ?? []).filter((item) => item.utilityScore >= minScore && (!toolsOnly || item.toolLikely)), [edition, minScore, toolsOnly]);
  const llmTargets = selected.filter((item) => item.generationMethod !== 'llm');
  const estimatedChars = llmTargets.reduce((total, item) => total + Math.min(item.sources[0].content.length, 1600), 0);
  if (loading) return <main className="empty"><div className="loader"/><p>正在载入审核台…</p></main>;
  if (startupError) return <main className="empty"><div className="empty-mark">!</div><h1>今日工具采集失败</h1><p className="startup-error">{startupError}</p><p>未使用过去日期榜单，请稍后重新运行 <code>npm run daily</code>。</p></main>;
  if (!edition) return <EmptyState onCreated={setEdition}/>;
  const update = async (id: string, patch: Partial<ToolCandidate>) => { setEdition(parseEdition(await api<unknown>(`/api/editions/${edition.id}/candidates/${id}`, {method: 'PATCH', body: JSON.stringify(patch)}))); setError(''); };
  const regenerate = async (id: string) => {
    if (!window.confirm('将调用一次 LLM 优化此工具。是否继续？')) return;
    try { setEdition(parseEdition(await api<unknown>(`/api/editions/${edition.id}/candidates/${id}/regenerate`, {method: 'POST'}))); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const approve = async () => { try { setEdition(parseEdition(await api<unknown>(`/api/editions/${edition.id}/approve`, {method: 'POST'}))); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } };
  const optimize = async () => {
    if (!llmTargets.length || !window.confirm(`将调用 LLM 优化 ${llmTargets.length} 个入选工具，最多发送约 ${(estimatedChars / 1000).toFixed(1)}k 字符。是否继续？`)) return;
    setOptimizing(true); setError('');
    try { const result = await api<OptimizationResult>(`/api/editions/${edition.id}/optimize-selected`, {method: 'POST'}); setEdition(parseEdition(result.edition)); setOptimizationMessage(`优化完成：成功 ${result.optimized}，缓存命中 ${result.cacheHits}，规则回退 ${result.fallback}，本次发送 ${result.inputChars} 个证据字符。`); if (result.warnings.length) setError(result.warnings.join('；')); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setOptimizing(false); }
  };
  const render = async () => { try { setJob(await api<RenderJob>(`/api/editions/${edition.id}/render`, {method: 'POST'})); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } };
  return <div className="app-shell"><header className="app-header"><div><div className="brand"><span>GH</span> {edition.brand.name}</div><h1>{edition.date} 审核台</h1></div><div className="status-block"><span className={`status ${edition.status}`}>{edition.status}</span><small>v{edition.version} · 全球榜 {edition.candidates.length} 项</small></div></header>
    <div className="toolbar"><label>最低实用性 <input type="range" min="0" max="100" value={minScore} onChange={(event) => setMinScore(Number(event.target.value))}/><strong>{minScore}</strong></label><label><input type="checkbox" checked={toolsOnly} onChange={(event) => setToolsOnly(event.target.checked)}/>仅看工具候选</label><div className="toolbar-spacer"/><span>精选 <b>{selected.length}</b> / 3～5</span><button onClick={optimize} disabled={edition.status !== 'draft' || optimizing || !llmTargets.length}>{optimizing ? 'LLM 优化中…' : `LLM 优化已入选（${llmTargets.length}）`}</button><button onClick={approve} disabled={edition.status !== 'draft'}>批准并锁定</button><button className="primary" onClick={render} disabled={edition.status !== 'approved'}>渲染 MP4</button></div>
    {error && <div className="global-error">{error}<button onClick={() => setError('')}>×</button></div>}{optimizationMessage && <div className="global-error success">{optimizationMessage}<button onClick={() => setOptimizationMessage('')}>×</button></div>}{job && <div className={`job ${job.status}`}><div><strong>渲染任务：{job.status}</strong><span>{job.error || job.outputPath || job.logs.at(-1)}</span></div><progress max="100" value={job.progress}/><b>{job.progress}%</b></div>}
    <div className="workspace"><main className="candidate-list"><TrendingRadar tools={edition.candidates}/><div className="section-title industry-title"><div><div className="eyebrow">TOOLS · REVIEW</div><h2>工具候选</h2></div><span>精选并确认 3～5 个</span></div>{filtered.map((tool) => <ToolEditor key={tool.id} tool={tool} onUpdate={update} onRegenerate={regenerate}/>)}</main>
      <aside className="preview-panel"><div className="preview-head"><div><div className="eyebrow">REMOTION · PLAYER</div><strong>完整成片预览</strong></div><span>{Math.round(totalDurationFrames(edition) / VIDEO_FPS)} 秒</span></div><div className="video-frame"><Player component={DailyReportVideo} inputProps={{edition, hasBgm: false}} durationInFrames={totalDurationFrames(edition)} fps={VIDEO_FPS} compositionWidth={VIDEO_WIDTH} compositionHeight={VIDEO_HEIGHT} controls loop clickToPlay style={{width: '100%', aspectRatio: '16 / 9'}}/></div><div className="preview-note">预览与正式 MP4 使用相同时间轴。项目没有被自动安装或运行，推荐依据仅来自公开仓库资料。</div></aside></div>
  </div>;
}
