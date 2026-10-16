import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import crypto from 'node:crypto';
import {bundle} from '@remotion/bundler';
import {makeCancelSignal, renderMedia, selectComposition} from '@remotion/renderer';
import {chromium} from 'playwright';
import ffprobe from 'ffprobe-static';
import {config} from './config.js';
import {getEdition, logEvent, relockRenderedRepos, saveRenderJob, updateEditionStatus} from './db.js';
import type {DiscoveryEdition, RenderJob} from './shared/types.js';
import {totalDurationFrames, VIDEO_FPS} from './video/timeline.js';
import {getBgmStatus} from './audio/bgm.js';
import {RenderCancellation} from './shared/render-cancellation.js';

const execFileAsync = promisify(execFile);
const activeRenders = new RenderCancellation();
export const cancelRenderJob = (id: string) => activeRenders.cancel(id);
export const stopActiveRenders = async () => { activeRenders.cancelAll(); await activeRenders.waitForAll(); };

export async function validateVideo(outputPath: string, edition: DiscoveryEdition, expectBgm = false) {
  const {stdout} = await execFileAsync(ffprobe.path, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate:format=duration', '-of', 'json', outputPath], {windowsHide: true});
  const metadata = JSON.parse(stdout);
  const video = metadata.streams?.find((stream: any) => stream.codec_type === 'video');
  const audio = metadata.streams?.find((stream: any) => stream.codec_type === 'audio');
  const duration = Number(metadata.format?.duration);
  const expected = totalDurationFrames(edition) / VIDEO_FPS;
  if (!video || video.width !== 1920 || video.height !== 1080 || video.r_frame_rate !== '30/1') throw new Error('成片参数不符合 1920×1080 / 30fps / H.264');
  if (video.codec_name !== 'h264') throw new Error('成片视频编码不是 H.264');
  if (expectBgm && audio?.codec_name !== 'aac') throw new Error('已设置 BGM，但成片缺少 AAC 音轨');
  if (!Number.isFinite(duration) || Math.abs(duration - expected) > 1.5) throw new Error(`成片时长异常：${duration}s，预期 ${expected.toFixed(1)}s`);
  return {duration, codec: video.codec_name, audioCodec: audio?.codec_name ?? null, width: video.width, height: video.height, fps: video.r_frame_rate};
}

const updateJob = (job: RenderJob, patch: Partial<RenderJob>) => {
  Object.assign(job, patch, {updatedAt: new Date().toISOString()});
  saveRenderJob(job);
};

const removeIncompleteFile = async (filePath: string) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { await fs.promises.rm(filePath, {force: true}); return; }
    catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
};

export async function renderEdition(editionId: string, job?: RenderJob): Promise<string> {
  const edition = getEdition(editionId);
  if (!edition) throw new Error('日报不存在');
  if (edition.kind !== 'github-tools') throw new Error('旧版资讯日报不支持使用新版工具视频模板渲染');
  if (edition.status !== 'approved' && edition.status !== 'rendering') throw new Error('只有已批准日报才能渲染');
  const activeJob = job ?? {
    id: `render_${crypto.randomUUID()}`, editionId, status: 'queued' as const, progress: 0,
    logs: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  saveRenderJob(activeJob);
  fs.mkdirSync(config.outputDir, {recursive: true});
  const outputPath = path.join(config.outputDir, `${edition.date}-v${edition.version}-github-tool-radar.mp4`);
  const temporaryPath = path.join(config.outputDir, `.${edition.date}-v${edition.version}-${activeJob.id}.partial.mp4`);
  const sidecarPath = outputPath.replace(/\.mp4$/, '.json');
  const {cancelSignal, cancel} = makeCancelSignal();
  const task = activeRenders.register(activeJob.id, cancel);
  let published = false;
  const checkCanceled = () => { if (activeRenders.isCanceled(activeJob.id)) throw new Error('用户取消渲染'); };
  try {
    const bgm = await getBgmStatus();
    checkCanceled();
    const hasBgm = bgm.available;
    updateEditionStatus(editionId, 'rendering');
    logEvent(editionId, 'render', '开始渲染', {jobId: activeJob.id, hasBgm});
    updateJob(activeJob, {status: 'running', progress: 2, logs: [...activeJob.logs, hasBgm ? '已加载本地 BGM' : bgm.message]});
    const serveUrl = await bundle({
      entryPoint: path.join(config.rootDir, 'src', 'video', 'Root.tsx'),
      publicDir: config.publicDir,
      onProgress: (progress) => {
        const normalized = progress > 1 ? progress / 100 : progress;
        if (!activeRenders.isCanceled(activeJob.id)) updateJob(activeJob, {progress: Math.max(2, Math.min(15, Math.round(normalized * 15)))});
      },
    });
    checkCanceled();
    const currentEdition = getEdition(editionId);
    if (!currentEdition || currentEdition.kind !== 'github-tools') throw new Error('工具日报不存在');
    const inputProps = {edition: currentEdition, hasBgm};
    const browserExecutable = chromium.executablePath();
    const composition = await selectComposition({serveUrl, id: 'DailyReport', inputProps, browserExecutable});
    checkCanceled();
    await renderMedia({
      composition, serveUrl, codec: 'h264', outputLocation: temporaryPath, inputProps, browserExecutable, cancelSignal,
      onProgress: ({progress}) => { if (!activeRenders.isCanceled(activeJob.id)) updateJob(activeJob, {progress: 15 + Math.round(progress * 80)}); },
    });
    checkCanceled();
    const metadata = await validateVideo(temporaryPath, edition, hasBgm);
    checkCanceled();
    fs.renameSync(temporaryPath, outputPath);
    published = true;
    fs.writeFileSync(sidecarPath, JSON.stringify({editionId, renderedAt: new Date().toISOString(), metadata, hasBgm}, null, 2));
    updateEditionStatus(editionId, 'rendered');
    relockRenderedRepos(currentEdition);
    logEvent(editionId, 'render', '渲染完成', {jobId: activeJob.id, outputPath, metadata});
    updateJob(activeJob, {status: 'completed', progress: 100, outputPath, logs: [...activeJob.logs, '渲染与编码检查完成']});
    return outputPath;
  } catch (error) {
    const canceled = activeRenders.isCanceled(activeJob.id);
    let cleanupError: string | undefined;
    try {
      await removeIncompleteFile(temporaryPath);
      if (published) { await removeIncompleteFile(outputPath); await removeIncompleteFile(sidecarPath); }
    } catch (reason) { cleanupError = reason instanceof Error ? reason.message : String(reason); }
    updateEditionStatus(editionId, canceled ? 'approved' : 'failed');
    logEvent(editionId, 'render', canceled ? '渲染已取消' : '渲染失败', {jobId: activeJob.id, error: error instanceof Error ? error.message : String(error), cleanupError});
    updateJob(activeJob, {status: canceled ? 'canceled' : 'failed', error: cleanupError ? `临时文件清理失败：${cleanupError}` : canceled ? undefined : error instanceof Error ? error.message : String(error), logs: [...activeJob.logs, cleanupError ? '清理临时文件失败，请检查输出目录' : canceled ? '已取消渲染并清理临时文件' : '渲染失败并清理临时文件']});
    throw error;
  } finally {
    task.complete();
  }
}

