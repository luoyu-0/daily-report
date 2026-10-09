import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import crypto from 'node:crypto';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {chromium} from 'playwright';
import ffprobe from 'ffprobe-static';
import {config} from './config.js';
import {getEdition, logEvent, saveRenderJob, updateEditionStatus} from './db.js';
import type {Edition, RenderJob} from './shared/types.js';
import {totalDurationFrames, VIDEO_FPS} from './video/timeline.js';

const execFileAsync = promisify(execFile);

export async function validateVideo(outputPath: string, edition: Edition) {
  const {stdout} = await execFileAsync(ffprobe.path, ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,r_frame_rate:format=duration', '-of', 'json', outputPath]);
  const metadata = JSON.parse(stdout);
  const video = metadata.streams?.find((stream: any) => stream.codec_name === 'h264');
  const duration = Number(metadata.format?.duration);
  const expected = totalDurationFrames(edition) / VIDEO_FPS;
  if (!video || video.width !== 1920 || video.height !== 1080 || video.r_frame_rate !== '30/1') throw new Error('成片参数不符合 1920×1080 / 30fps / H.264');
  if (!Number.isFinite(duration) || Math.abs(duration - expected) > 1.5) throw new Error(`成片时长异常：${duration}s，预期 ${expected.toFixed(1)}s`);
  return {duration, codec: video.codec_name, width: video.width, height: video.height, fps: video.r_frame_rate};
}

const updateJob = (job: RenderJob, patch: Partial<RenderJob>) => {
  Object.assign(job, patch, {updatedAt: new Date().toISOString()});
  saveRenderJob(job);
};

export async function renderEdition(editionId: string, job?: RenderJob): Promise<string> {
  const edition = getEdition(editionId);
  if (!edition) throw new Error('日报不存在');
  if (edition.status !== 'approved' && edition.status !== 'rendering') throw new Error('只有已批准日报才能渲染');
  const activeJob = job ?? {
    id: `render_${crypto.randomUUID()}`, editionId, status: 'queued' as const, progress: 0,
    logs: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  saveRenderJob(activeJob);
  fs.mkdirSync(config.outputDir, {recursive: true});
  const outputPath = path.join(config.outputDir, `${edition.date}-v${edition.version}-ai-insight-daily.mp4`);
  const bgmPath = path.join(config.publicDir, 'assets', 'audio', 'bgm.mp3');
  const hasBgm = fs.existsSync(bgmPath);
  try {
    updateEditionStatus(editionId, 'rendering');
    logEvent(editionId, 'render', '开始渲染', {jobId: activeJob.id, hasBgm});
    updateJob(activeJob, {status: 'running', progress: 2, logs: [...activeJob.logs, hasBgm ? '已加载本地 BGM' : '未找到 BGM，将静音导出']});
    const serveUrl = await bundle({
      entryPoint: path.join(config.rootDir, 'src', 'video', 'Root.tsx'),
      publicDir: config.publicDir,
      onProgress: (progress) => {
        const normalized = progress > 1 ? progress / 100 : progress;
        updateJob(activeJob, {progress: Math.max(2, Math.min(15, Math.round(normalized * 15)))});
      },
    });
    const inputProps = {edition: getEdition(editionId)!, hasBgm};
    const browserExecutable = chromium.executablePath();
    const composition = await selectComposition({serveUrl, id: 'DailyReport', inputProps, browserExecutable});
    await renderMedia({
      composition, serveUrl, codec: 'h264', outputLocation: outputPath, inputProps, browserExecutable,
      onProgress: ({progress}) => updateJob(activeJob, {progress: 15 + Math.round(progress * 80)}),
    });
    const metadata = await validateVideo(outputPath, edition);
    fs.writeFileSync(outputPath.replace(/\.mp4$/, '.json'), JSON.stringify({editionId, renderedAt: new Date().toISOString(), metadata, hasBgm}, null, 2));
    updateEditionStatus(editionId, 'rendered');
    logEvent(editionId, 'render', '渲染完成', {jobId: activeJob.id, outputPath, metadata});
    updateJob(activeJob, {status: 'completed', progress: 100, outputPath, logs: [...activeJob.logs, '渲染与编码检查完成']});
    return outputPath;
  } catch (error) {
    updateEditionStatus(editionId, 'failed');
    logEvent(editionId, 'render', '渲染失败', {jobId: activeJob.id, error: error instanceof Error ? error.message : String(error)});
    updateJob(activeJob, {status: 'failed', error: error instanceof Error ? error.message : String(error), logs: [...activeJob.logs, '渲染失败']});
    throw error;
  }
}

