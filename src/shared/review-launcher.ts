import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {config} from '../config.js';
import {openLocalUrl} from './open-local-url.js';
import {REVIEW_API_VERSION, REVIEW_APP_ID} from './review-contract.js';

export type ReviewLaunchResult = {started: boolean; pid?: number; url: string};

const reviewUrl = (startupError?: string) => {
  const url = new URL(`http://127.0.0.1:${config.reviewPort}`);
  if (startupError) url.searchParams.set('collectionError', startupError);
  return url.toString();
};

async function reviewState(): Promise<'ready' | 'stale' | 'down'> {
  const request = async (url: string) => {
    try { return await fetch(url, {signal: AbortSignal.timeout(800)}); } catch { return undefined; }
  };
  const [api, web] = await Promise.all([
    request(`http://127.0.0.1:${config.appPort}/api/health`),
    request(`http://127.0.0.1:${config.reviewPort}`),
  ]);
  if (!api?.ok && !web?.ok) return 'down';
  if (!api?.ok || !web?.ok) return 'stale';
  try {
    const health = await api.json() as {app?: string; apiVersion?: number};
    return health.app === REVIEW_APP_ID && health.apiVersion === REVIEW_API_VERSION ? 'ready' : 'stale';
  } catch {
    return 'stale';
  }
}

export async function launchReviewInBackground(startupError?: string): Promise<ReviewLaunchResult> {
  const url = reviewUrl(startupError);
  let initialState = await reviewState();
  // Vite 或旧 Node 进程退出时两个端口可能短暂不同步，先等待其稳定。
  for (let attempt = 0; initialState === 'stale' && attempt < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    initialState = await reviewState();
  }
  if (initialState === 'ready') {
    openLocalUrl(url);
    return {started: false, url};
  }
  if (initialState === 'stale') {
    throw new Error('检测到旧版或不完整的审核服务仍占用端口。请先关闭旧审核台进程，再重新运行 npm run daily。');
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
    if (await reviewState() === 'ready') return {started: true, pid: child.pid, url};
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`审核台后台启动失败${spawnError ? `：${spawnError.message}` : ''}，请查看 ${logPath}`);
}
