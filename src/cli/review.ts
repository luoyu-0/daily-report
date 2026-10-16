import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer as createViteServer} from 'vite';
import {config} from '../config.js';
import {startServer} from '../server.js';
import {openLocalUrl} from '../shared/open-local-url.js';
import {ReviewLifecycle} from '../shared/review-lifecycle.js';
import {stopActiveRenders} from '../render.js';

export async function startReview(startupError?: string): Promise<void> {
  let shutdownStarted = false;
  const lifecycle = new ReviewLifecycle(() => { void shutdown(); });
  let api!: Awaited<ReturnType<typeof startServer>>;
  let vite!: Awaited<ReturnType<typeof createViteServer>>;
  try {
    api = await startServer(config.appPort, false, lifecycle);
    vite = await createViteServer({server: {host: '127.0.0.1', port: config.reviewPort}});
    await vite.listen();
  } catch (error) {
    lifecycle.dispose();
    await vite?.close();
    await api?.close();
    throw error;
  }

  const shutdown = async () => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    lifecycle.dispose();
    const stopped = await Promise.race([
      stopActiveRenders().then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 30000)),
    ]);
    if (!stopped) console.warn('渲染取消超过 30 秒，审核服务将强制退出；请检查 output/ 中是否有未完成文件。');
    await vite.close();
    await api.close();
    process.exit(stopped ? process.exitCode ?? 0 : 1);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const reviewUrl = new URL(`http://127.0.0.1:${config.reviewPort}`);
  if (startupError) reviewUrl.searchParams.set('collectionError', startupError);
  console.log(`审核台：${reviewUrl}`);
  openLocalUrl(reviewUrl.toString());
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startReview(process.env.REVIEW_STARTUP_ERROR).catch((error) => { console.error(error); process.exitCode = 1; });
}

