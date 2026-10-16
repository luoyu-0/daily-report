import {useEffect, useMemo, useRef, useState} from 'react';
import {Player} from '@remotion/player';
import type {DiscoveryEdition, RenderJob, SubtitleCue, ToolCandidate, ToolType, VideoConfig} from '../shared/types.js';
import {currentChinaDate} from '../shared/date.js';
import {REVIEW_API_VERSION, REVIEW_APP_ID} from '../shared/review-contract.js';
import {DailyReportVideo} from '../video/Composition.js';
import {totalDurationFrames, VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH} from '../video/timeline.js';
import {api} from './api.js';
import type {BgmStatus} from '../audio/bgm.js';
import {parseLrc} from '../video/subtitles.js';
import './tool-radar.css';

type OptimizationResult = {edition: DiscoveryEdition; requested: number; optimized: number; fallback: number; cacheHits: number; inputChars: number; warnings: string[]};
type TemplateOption = {id: string; name: string; description: string};
type SubtitleGenerationResult = {subtitles: SubtitleCue[]; cacheHit: boolean; inputChars: number};
type LockedRepo = {date: string; repo: string};
type ReviewPage = 'overview' | 'candidates' | 'locks' | 'render';
type ToolDraft = Pick<ToolCandidate, 'oneLinePitchZh' | 'toolType' | 'useCases' | 'targetUsers'>;
const toolTypes: ToolType[] = ['CLI', '桌面应用', 'Web 工具', '开发工具', '自动化', 'Agent', '框架与库', '其他'];
const lines = (value: string) => value.split('\n').map((item) => item.trim()).filter(Boolean);
const subtitleLines = (cues: SubtitleCue[]) => cues.map((cue) => `${(cue.startMs / 1000).toFixed(3)} | ${(cue.endMs / 1000).toFixed(3)} | ${cue.text}`).join('\n');
const parseSubtitleLines = (value: string): SubtitleCue[] => lines(value).map((line, index) => {
  const match = line.match(/^(\d+(?:\.\d{1,3})?)\s*\|\s*(\d+(?:\.\d{1,3})?)\s*\|\s*(.+)$/);
  if (!match) throw new Error(`第 ${index + 1} 行字幕格式无效，请使用「开始秒 | 结束秒 | 内容」`);
  return {startMs: Math.round(Number(match[1]) * 1000), endMs: Math.round(Number(match[2]) * 1000), text: match[3].trim()};
});
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
  if (!valid) throw new Error('审核服务版本不兼容。请关闭旧审核台后重新运行 npm run dev。');
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

function CandidateNavigator({tools}: {tools: ToolCandidate[]}) {
  const [open, setOpen] = useState(false);
  const drawer = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!drawer.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);
  const navigate = (id: string) => {
    const card = document.getElementById(`candidate-${id}`);
    card?.scrollIntoView({behavior: 'smooth', block: 'start'});
    card?.focus({preventScroll: true});
    setOpen(false);
  };
  return <aside ref={drawer} className={`candidate-navigator${open ? ' open' : ''}`} aria-label="候选仓库快捷导航"
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button className="candidate-nav-handle" type="button" aria-label={open ? '收起仓库导航' : '展开仓库导航'} aria-expanded={open}
      aria-controls="candidate-nav-panel" onClick={() => setOpen((value) => !value)}>
      <svg className="candidate-nav-shape" viewBox="0 0 42 128" aria-hidden="true">
        <path d="M40.5 0 Q40.5 12 28.5 12 H12.5 Q.5 12 .5 24 V104 Q.5 116 12.5 116 H28.5 Q40.5 116 40.5 128 H42 V0 Z" fill="white"/>
        <path d="M40.5 0 Q40.5 12 28.5 12 H12.5 Q.5 12 .5 24 V104 Q.5 116 12.5 116 H28.5 Q40.5 116 40.5 128" fill="none" stroke="#bfdbfe"/>
      </svg>
      <svg className="candidate-nav-chevron" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={open ? 'm9 5.5 6 6.5-6 6.5' : 'm15 5.5-6 6.5 6 6.5'}/>
      </svg>
    </button>
    <div id="candidate-nav-panel" className="candidate-nav-panel" aria-hidden={!open}>
      <strong>快速查找仓库</strong><small>当前筛选 {tools.length} 项</small>
      <div className="candidate-nav-list">{[...tools].sort((a, b) => a.rank - b.rank).map((tool) =>
        <button key={tool.id} type="button" tabIndex={open ? 0 : -1} onClick={() => navigate(tool.id)} title={tool.repo}>
          <span>#{String(tool.rank).padStart(2, '0')}</span><span>{tool.repo}</span>{tool.selected && <span aria-label="已入选">✓</span>}
        </button>)}{tools.length === 0 && <p>当前筛选下没有仓库</p>}</div>
    </div>
  </aside>;
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
  return <article id={`candidate-${tool.id}`} tabIndex={-1} className={`editor-card ${tool.selected ? 'selected' : ''}`}>
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
  useEffect(() => {
    const id = crypto.randomUUID();
    const endpoint = `/api/review-sessions/${id}`;
    const ping = () => { void fetch(`${endpoint}/ping`, {method: 'POST'}).catch(() => {}); };
    ping();
    const timer = window.setInterval(ping, 10000);
    const leave = () => { navigator.sendBeacon?.(`${endpoint}/leave`); };
    window.addEventListener('pagehide', leave);
    return () => { window.clearInterval(timer); window.removeEventListener('pagehide', leave); leave(); };
  }, []);
  const startupError = new URLSearchParams(window.location.search).get('collectionError');
  const [edition, setEdition] = useState<DiscoveryEdition>(); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(''); const [serviceError, setServiceError] = useState(''); const [minScore, setMinScore] = useState(0);
  const [job, setJob] = useState<RenderJob>(); const [cancelBusy, setCancelBusy] = useState(false); const [optimizing, setOptimizing] = useState(false); const [optimizingToolId, setOptimizingToolId] = useState<string>(); const optimizationLock = useRef(false); const [optimizationMessage, setOptimizationMessage] = useState('');
  const [showRenderConfirm, setShowRenderConfirm] = useState(false); const [renderBusy, setRenderBusy] = useState(false);
  const [bgm, setBgm] = useState<BgmStatus>({available: false, message: '正在检查 BGM…'}); const [bgmBusy, setBgmBusy] = useState(false);
  const [templates, setTemplates] = useState<TemplateOption[]>([]); const [videoConfigBusy, setVideoConfigBusy] = useState(false); const [subtitleDraft, setSubtitleDraft] = useState('');
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false); const templatePickerRef = useRef<HTMLDivElement>(null);
  const [subtitleGenerating, setSubtitleGenerating] = useState(false); const subtitleGenerationLock = useRef(false); const [subtitleMessage, setSubtitleMessage] = useState('');
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
      const latest = parseEdition(await api<unknown>('/api/editions/latest'));
      applyEdition(latest);
      void api<RenderJob>(`/api/editions/${latest.id}/render-job`).then(setJob).catch(() => {});
    } catch (reason) { if (!(reason instanceof Error && reason.message === '暂无工具雷达日报')) setServiceError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); void loadLocks(); }
  };
  useEffect(() => { void loadLatest(); }, []);
  useEffect(() => { void api<BgmStatus>('/api/audio/bgm').then(setBgm).catch(() => setBgm({available: false, message: '暂时无法读取 BGM 状态'})); }, []);
  useEffect(() => { void api<TemplateOption[]>('/api/video-templates').then(setTemplates).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))); }, []);
  useEffect(() => { setSubtitleDraft(subtitleLines(edition?.videoConfig.subtitles ?? [])); }, [edition?.id]);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => { if (!templatePickerRef.current?.contains(event.target as Node)) setTemplateMenuOpen(false); };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setTemplateMenuOpen(false); };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeEscape); };
  }, []);
  useEffect(() => {
    if (!job || ['completed', 'failed', 'canceled'].includes(job.status)) return;
    const timer = window.setInterval(async () => { try { const next = await api<RenderJob>(`/api/render-jobs/${job.id}`); setJob(next); if (['completed', 'failed', 'canceled'].includes(next.status)) void loadLatest(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } }, 1500);
    return () => clearInterval(timer);
  }, [job?.id, job?.status]);
  const selected = (edition?.candidates ?? []).filter((item) => item.selected).sort((a, b) => a.position - b.position);
  const filtered = useMemo(() => (edition?.candidates ?? []).filter((item) => item.utilityScore >= minScore), [edition, minScore]);
  const llmTargets = (edition?.candidates ?? []).filter((item) => item.generationMethod !== 'llm');
  const estimatedChars = llmTargets.reduce((total, item) => total + Math.min(item.sources[0].content.length, 1600), 0);
  if (loading) return <main className="empty"><div className="loader"/><p>正在载入审核台…</p></main>;
  if (startupError) return <main className="empty"><div className="empty-mark">!</div><h1>今日工具采集失败</h1><p className="startup-error">{startupError}</p><p>未使用过去日期榜单，请稍后重新运行 <code>npm run dev</code>。</p></main>;
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
  const cancelRender = async () => {
    if (!job || cancelBusy || !['queued', 'running'].includes(job.status)) return;
    setCancelBusy(true); setError('');
    try { setJob(await api<RenderJob>(`/api/render-jobs/${job.id}/cancel`, {method: 'POST'})); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setCancelBusy(false); }
  };
  const uploadBgm = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) { setError('BGM 文件不能超过 20 MB'); return; }
    setBgmBusy(true); setError('');
    try {
      const response = await fetch('/api/audio/bgm', {method: 'PUT', headers: {'content-type': 'application/octet-stream'}, body: file});
      const result = await response.json() as BgmStatus & {error?: string};
      if (!response.ok) throw new Error(result.error || `上传失败：HTTP ${response.status}`);
      setBgm(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBgmBusy(false); }
  };
  const clearBgm = async () => {
    setBgmBusy(true); setError('');
    try { setBgm(await api<BgmStatus>('/api/audio/bgm', {method: 'DELETE'})); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBgmBusy(false); }
  };
  const saveVideoConfig = async (videoConfig: VideoConfig) => {
    setVideoConfigBusy(true); setError('');
    try {
      await updateQueue.current;
      const current = editionRef.current;
      if (!current) throw new Error('日报不存在');
      const updated = parseEdition(await api<unknown>(`/api/editions/${current.id}/video-config`, {method: 'PUT', body: JSON.stringify(videoConfig)}));
      applyEdition(updated); setSubtitleDraft(subtitleLines(updated.videoConfig.subtitles));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setVideoConfigBusy(false); }
  };
  const importLrc = async (file: File) => {
    setError(''); setSubtitleMessage('');
    try {
      if (!file.name.toLowerCase().endsWith('.lrc')) throw new Error('请选择 .lrc 字幕文件');
      if (file.size > 1024 * 1024) throw new Error('LRC 文件不能超过 1 MB');
      if (subtitleDraft.trim() && !window.confirm('导入将替换当前字幕草稿，尚未保存的修改会丢失。是否继续？')) return;
      const cues = parseLrc(await file.text(), totalDurationFrames(edition) * 1000 / VIDEO_FPS);
      setSubtitleDraft(subtitleLines(cues));
      setSubtitleMessage(`已导入 ${cues.length} 条字幕草稿；确认内容后点击“保存字幕”。`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const generateSubtitles = async () => {
    if (subtitleGenerationLock.current) return;
    const current = editionRef.current;
    if (!current) return;
    const chosen = current.candidates.filter((item) => item.selected);
    if (!chosen.length) { setError('请先入选仓库'); return; }
    const estimate = chosen.reduce((sum, item) => sum + item.repo.length + item.oneLinePitchZh.length + item.useCases.slice(0, 2).join(' ').length + Math.min(700, item.sources[0]?.content.length ?? 0), 0);
    if (!window.confirm(`将调用 LLM，为 ${chosen.length} 个入选仓库生成简短字幕草稿，预计发送约 ${estimate} 个字符（包含每仓最多约 700 字符的本地 README 摘录，不发送完整 README）。格式不兼容或输出截断时可能重试，最多 3 次请求；结果会替换当前编辑框内容，但不会自动保存。是否继续？`)) return;
    subtitleGenerationLock.current = true; setSubtitleGenerating(true); setError(''); setSubtitleMessage('');
    try {
      await updateQueue.current;
      const latest = editionRef.current;
      if (!latest) throw new Error('日报不存在');
      const result = await api<SubtitleGenerationResult>(`/api/editions/${latest.id}/subtitles/generate`, {method: 'POST'});
      setSubtitleDraft(subtitleLines(result.subtitles));
      setSubtitleMessage(`已生成 ${result.subtitles.length} 条字幕草稿${result.cacheHit ? '（使用本地缓存）' : `（本次发送 ${result.inputChars} 个字符）`}；请核对并保存。`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { subtitleGenerationLock.current = false; setSubtitleGenerating(false); }
  };
  const deleteLock = async (date: string, repo: string) => {
    if (!window.confirm(`删除 ${date} 的 ${repo} 锁定记录？仓库将可再次进入候选；原视频和审核数据不会删除。`)) return;
    try { await api('/api/repo-locks/delete', {method: 'POST', body: JSON.stringify({date, repo})}); await loadLocks(); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const pageTitles: Record<ReviewPage, string> = {overview: '概览', candidates: '仓库候选', locks: '锁定记录', render: '成片渲染'};
  const subtitleDirty = subtitleDraft !== subtitleLines(edition.videoConfig.subtitles);
  const renderDisabled = !['draft', 'approved'].includes(edition.status) || optimizing || Boolean(optimizingToolId) || videoConfigBusy || subtitleGenerating || subtitleDirty
    || Boolean(job && !['completed', 'failed', 'canceled'].includes(job.status)) || selected.length < 1 || selected.length > 10;
  return <div className="review-shell">
    <header className="review-heading"><div className="brand"><span>GH</span> {edition.brand.name}</div><h1>审核台</h1></header>
    <div className="review-layout"><nav className="review-nav" aria-label="审核台导航">{(['overview', 'candidates', 'locks', 'render'] as ReviewPage[]).map((page) => <button key={page} type="button" className={activePage === page ? 'active' : ''} aria-current={activePage === page ? 'page' : undefined} onClick={() => setActivePage(page)}>{pageTitles[page]}{page === 'locks' && lockedRepos.length > 0 ? <small>{lockedRepos.length}</small> : null}</button>)}</nav>
      <div className="review-content"><div className="review-page-head"><div><div className="eyebrow">{edition.date} · v{edition.version}</div><h2>{pageTitles[activePage]}</h2></div><div className="status-block"><span className={`status ${edition.status}`}>{edition.status}</span><small>候选 {edition.candidates.length} 项 · 已入选 {selected.length} 项</small></div></div>
        {error && <div className="global-error">{error}<button onClick={() => setError('')}>×</button></div>}{optimizationMessage && <div className="global-error success">{optimizationMessage}<button onClick={() => setOptimizationMessage('')}>×</button></div>}{job && <div className={`job ${job.status}`}><div><strong>渲染任务：{job.status === 'canceling' ? '正在取消' : job.status === 'canceled' ? '已取消' : job.status}</strong><span>{job.error || job.outputPath || job.logs.at(-1)}</span></div><progress max="100" value={job.progress}/><b>{job.progress}%</b>{['queued', 'running'].includes(job.status) && <button className="danger" onClick={() => { void cancelRender(); }} disabled={cancelBusy}>{cancelBusy ? '正在取消…' : '取消渲染'}</button>}</div>}
        {activePage === 'overview' && <main className="overview-page"><p>从今日 GitHub 热榜发现新工具，核对仓库证据与推荐文案，确认后生成视频。</p><div className="overview-stats"><div><strong>{edition.candidates.length}</strong><span>今日候选</span></div><div><strong>{selected.length}</strong><span>已入选</span></div><div><strong>{lockedRepos.length}</strong><span>成片锁定记录</span></div></div><div className="overview-actions"><button className="primary" onClick={() => setActivePage('candidates')}>审核仓库候选</button><button onClick={() => setActivePage('render')}>预览成片</button></div><TrendingRadar tools={edition.candidates}/></main>}
        {activePage === 'candidates' && <main className="candidate-page"><div className="page-actions"><label>最低实用性 <input type="range" min="0" max="100" value={minScore} onChange={(event) => setMinScore(Number(event.target.value))}/><strong>{minScore}</strong></label><button onClick={optimize} disabled={edition.status !== 'draft' || optimizing || Boolean(optimizingToolId) || !llmTargets.length}>{optimizing ? 'LLM 优化中…' : 'LLM一键优化'}</button></div><div className="section-title industry-title"><div><div className="eyebrow">TOOLS · REVIEW</div><h2>工具候选</h2></div><span>新日报默认入选前 10 项，可逐项调整</span></div><div className="candidate-list">{filtered.map((tool) => <ToolEditor key={tool.id} tool={tool} onUpdate={update} onRegenerate={regenerate} optimizing={optimizingToolId === tool.repo} optimizationLocked={optimizing || Boolean(optimizingToolId)}/>)}</div><CandidateNavigator tools={filtered}/></main>}
        {activePage === 'locks' && <main className="locked-repos" aria-label="以往锁定仓库"><h2>已成片锁定仓库</h2>{lockedRepos.length === 0 ? <p>暂无锁定记录。只有入选并成功渲染成片的仓库才会出现在这里。</p> : <div className="locked-repo-list">{lockedRepos.map((item) => <div key={`${item.date}:${item.repo}`}><time>{item.date}</time><a href={`https://github.com/${item.repo}`} target="_blank" rel="noreferrer">{item.repo}</a><button className="danger" onClick={() => deleteLock(item.date, item.repo)}>删除锁定记录</button></div>)}</div>}</main>}
        {activePage === 'render' && <main className="render-page">
          <div className="render-actions"><p>将使用当前入选的 {selected.length} 个仓库。请先在“仓库候选”核对文案和来源。</p><button className="primary" onClick={() => { (document.activeElement as HTMLElement | null)?.blur(); setShowRenderConfirm(true); }} disabled={renderDisabled || bgmBusy}>渲染成片</button></div>
          <div className="video-config-control"><div><strong>视频风格模板</strong><p>模板只负责画面编排；时间轴、字幕和 BGM 在各风格间共用。若字幕有未保存修改，请先保存。</p></div><div className="template-picker" ref={templatePickerRef}><button type="button" className="template-picker-trigger" aria-label="视频风格模板" aria-haspopup="listbox" aria-expanded={templateMenuOpen} disabled={videoConfigBusy || subtitleDirty || Boolean(job && !['completed', 'failed', 'canceled'].includes(job.status))} onClick={() => setTemplateMenuOpen((open) => !open)}><span className="template-picker-mark">▦</span><span><b>{templates.find((template) => template.id === edition.videoConfig.templateId)?.name ?? '加载模板中…'}</b><small>{templates.find((template) => template.id === edition.videoConfig.templateId)?.description}</small></span><span className={`template-picker-chevron${templateMenuOpen ? ' open' : ''}`} aria-hidden="true"/></button>{templateMenuOpen && <div className="template-picker-menu" role="listbox" aria-label="可用视频风格">{templates.map((template) => <button key={template.id} type="button" role="option" aria-selected={template.id === edition.videoConfig.templateId} className={template.id === edition.videoConfig.templateId ? 'selected' : ''} onClick={() => { setTemplateMenuOpen(false); if (template.id !== edition.videoConfig.templateId) void saveVideoConfig({...edition.videoConfig, templateId: template.id}); }}><span className="template-picker-option-mark">{template.id === edition.videoConfig.templateId ? '✓' : '○'}</span><span><b>{template.name}</b><small>{template.description}</small></span></button>)}</div>}</div></div>
          <div className="subtitle-control"><div><strong>字幕轨（可选）</strong><p>每行填写「开始秒 | 结束秒 | 内容」，例如「3 | 5.5 | 今天的工具推荐」。也可导入 .lrc 文件或用 LLM 生成草稿；修改后请先保存再渲染。</p></div><textarea aria-label="字幕轨" rows={3} placeholder="3 | 5.5 | 今天的工具推荐" value={subtitleDraft} onChange={(event) => { setSubtitleDraft(event.target.value); setSubtitleMessage(''); }} disabled={videoConfigBusy || subtitleGenerating || Boolean(job && !['completed', 'failed', 'canceled'].includes(job.status))}/>{subtitleMessage && <p className="subtitle-message" role="status">{subtitleMessage}</p>}<div className="subtitle-actions"><label className="subtitle-import">导入 .lrc<input type="file" accept=".lrc,text/plain" disabled={videoConfigBusy || subtitleGenerating || Boolean(job && !['completed', 'failed', 'canceled'].includes(job.status))} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importLrc(file); event.target.value = ''; }}/></label><button type="button" onClick={() => { void generateSubtitles(); }} disabled={videoConfigBusy || subtitleGenerating || !selected.length || Boolean(job && !['completed', 'failed', 'canceled'].includes(job.status))}>{subtitleGenerating ? 'LLM 生成中…' : 'LLM 生成'}</button><button className="primary" onClick={() => { try { void saveVideoConfig({...edition.videoConfig, subtitles: parseSubtitleLines(subtitleDraft)}); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } }} disabled={!subtitleDirty || videoConfigBusy || subtitleGenerating || Boolean(job && !['completed', 'failed', 'canceled'].includes(job.status))}>{videoConfigBusy ? '保存中…' : '保存字幕'}</button></div></div>
          <div className="bgm-control"><div><strong>背景音乐</strong><p>{bgm.message}{bgm.available && bgm.durationSeconds ? ` · ${Math.round(bgm.durationSeconds)} 秒，成片中自动循环并淡入淡出` : ''}</p></div><div className="bgm-actions">{bgm.available && <button className="danger" onClick={() => { void clearBgm(); }} disabled={bgmBusy || Boolean(job && !['completed', 'failed', 'canceled'].includes(job.status))}>取消选中</button>}<label className="bgm-upload">{bgmBusy ? '正在检查音频…' : bgm.available ? '更换 MP3' : '添加 MP3'}<input type="file" accept=".mp3,audio/mpeg" disabled={bgmBusy || Boolean(job && !['completed', 'failed', 'canceled'].includes(job.status))} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadBgm(file); event.target.value = ''; }}/></label></div></div>
          <section className="preview-panel"><div className="preview-head"><div><div className="eyebrow">REMOTION · PLAYER</div><strong>完整成片预览</strong></div><span>{Math.round(totalDurationFrames(edition) / VIDEO_FPS)} 秒</span></div><div className="video-frame"><Player component={DailyReportVideo} inputProps={{edition, hasBgm: bgm.available, bgmSrc: bgm.available ? `/api/audio/files/bgm.mp3?v=${bgm.version}` : undefined}} durationInFrames={totalDurationFrames(edition)} fps={VIDEO_FPS} compositionWidth={VIDEO_WIDTH} compositionHeight={VIDEO_HEIGHT} controls loop clickToPlay style={{width: '100%', aspectRatio: '16 / 9'}}/></div><div className="preview-note">预览与正式 MP4 使用相同时间轴。项目没有被自动安装或运行，推荐依据仅来自公开仓库资料。</div></section>
        </main>}
      </div></div>
    {showRenderConfirm && <RenderConfirmation count={selected.length} busy={renderBusy} onCancel={() => setShowRenderConfirm(false)} onConfirm={() => { void render(); }} />}
  </div>;
}
