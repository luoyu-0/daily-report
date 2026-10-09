import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {config} from '../config.js';
import {openLocalUrl} from './open-local-url.js';

export type ReviewLaunchResult = {started: boolean; pid?: number; url: string};

const reviewUrl = (startupError?: string) => {
  const url = new URL(`http://127.0.0.1:${config.reviewPort}`);
  if (startupError) url.searchParams.set('collectionError', startupError);
  return url.toString();
};

async function isReviewReady(): Promise<boolean> {
  try {
    const [api, web] = await Promise.all([
      fetch(`http://127.0.0.1:${config.appPort}/api/health`, {signal: AbortSignal.timeout(800)}),
      fetch(`http://127.0.0.1:${config.reviewPort}`, {signal: AbortSignal.timeout(800)}),
    ]);
    return api.ok && web.ok;
  } catch {
    return false;
  }
}

export async function launchReviewInBackground(startupError?: string): Promise<ReviewLaunchResult> {
  const url = reviewUrl(startupError);
  if (await isReviewReady()) {
    openLocalUrl(url);
    return {started: false, url};
  }

  const logDir = path.join(config.dataDir, 'logs');
  fs.mkdirSync(logDir, {recursive: true});
  const logPath = path.join(logDir, 'review-server.log');
  const log = fs.openSync(logPath, 'a');
  const child = spawn(process.execPath, [
    '--env-file-if-exists=.env',
    '--env-file-if-exists=.env.local',
    '--use-env-proxy',
    '--import', 'tsx',
    path.join(config.rootDir, 'src', 'cli', 'review.ts'),
  ], {
    cwd: config.rootDir,
    detached: true,
    stdio: ['ignore', log, log],
    windowsHide: true,
    env: {...process.env, REVIEW_STARTUP_ERROR: startupError ?? ''},
  });
  child.unref();
  fs.closeSync(log);

  let spawnError: Error | undefined;
  child.once('error', (error) => { spawnError = error; });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (spawnError) break;
    if (await isReviewReady()) return {started: true, pid: child.pid, url};
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`审核台后台启动失败${spawnError ? `：${spawnError.message}` : ''}，请查看 ${logPath}`);
}
