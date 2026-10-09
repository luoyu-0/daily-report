import {spawn} from 'node:child_process';

export function openLocalUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
    throw new Error('只允许自动打开本机 HTTP 地址');
  }

  const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, {detached: true, stdio: 'ignore', windowsHide: true});
  child.on('error', (error) => console.warn(`无法自动打开审核台：${error.message}`));
  child.unref();
}
