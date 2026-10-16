import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ffprobe from 'ffprobe-static';
import {config} from '../config.js';

const execFileAsync = promisify(execFile);
export const MAX_BGM_BYTES = 20 * 1024 * 1024;
export const bgmPath = () => path.join(config.publicDir, 'assets', 'audio', 'bgm.mp3');

export type BgmStatus = {available: boolean; durationSeconds?: number; version?: number; message: string};

async function probeBgm(file: string): Promise<number> {
  let stdout: string;
  try {
    ({stdout} = await execFileAsync(ffprobe.path, [
      '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name:format=duration', '-of', 'json', file,
    ], {windowsHide: true}));
  } catch { throw new Error('文件不是可播放的 MP3 音频'); }
  const metadata = JSON.parse(stdout) as {streams?: Array<{codec_name?: string}>; format?: {duration?: string}};
  const duration = Number(metadata.format?.duration);
  if (metadata.streams?.[0]?.codec_name !== 'mp3' || !Number.isFinite(duration) || duration <= 0) {
    throw new Error('文件不是可播放的 MP3 音频');
  }
  return duration;
}

export async function getBgmStatus(): Promise<BgmStatus> {
  let stat;
  try { stat = await fs.stat(bgmPath()); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {available: false, message: '未设置 BGM，视频将静音导出'};
    throw error;
  }
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BGM_BYTES) {
    return {available: false, message: 'BGM 文件为空或超过 20 MB，视频将静音导出'};
  }
  try {
    const durationSeconds = await probeBgm(bgmPath());
    return {available: true, durationSeconds, version: stat.mtimeMs, message: '本地 BGM 已就绪'};
  } catch {
    return {available: false, message: 'BGM 文件无法解码，视频将静音导出'};
  }
}

export async function saveBgm(content: Buffer): Promise<BgmStatus> {
  if (content.length === 0 || content.length > MAX_BGM_BYTES) throw new Error('请选择不超过 20 MB 的 MP3 文件');
  const target = bgmPath();
  await fs.mkdir(path.dirname(target), {recursive: true});
  const temporary = path.join(path.dirname(target), `bgm-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, content);
    await probeBgm(temporary);
    await fs.rename(temporary, target);
    return getBgmStatus();
  } finally {
    await fs.rm(temporary, {force: true});
  }
}

export async function clearBgm(): Promise<BgmStatus> {
  await fs.rm(bgmPath(), {force: true});
  return getBgmStatus();
}
