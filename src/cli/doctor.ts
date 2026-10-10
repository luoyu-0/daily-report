import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {config} from '../config.js';

const checks: Array<{name: string; ok: boolean; detail: string}> = [];
fs.mkdirSync(config.dataDir, {recursive: true});
fs.mkdirSync(config.outputDir, {recursive: true});
const nodeMajor = Number(process.versions.node.split('.')[0]);
checks.push({name: 'Node.js', ok: nodeMajor >= 20, detail: process.version});
checks.push({name: 'FFmpeg', ok: Boolean(ffmpegPath && fs.existsSync(ffmpegPath)), detail: ffmpegPath || '未找到'});
checks.push({name: 'FFprobe', ok: fs.existsSync(ffprobe.path), detail: ffprobe.path});
checks.push({name: 'Chromium', ok: fs.existsSync(chromium.executablePath()), detail: chromium.executablePath()});
const fontCandidates = process.platform === 'win32' ? ['C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/msyhbd.ttc'] : [];
checks.push({name: '中文字体', ok: process.platform !== 'win32' || fontCandidates.some(fs.existsSync), detail: fontCandidates.find(fs.existsSync) || '使用系统回退字体'});
const proxyValue = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const proxyEnabled = process.execArgv.includes('--use-env-proxy') || process.env.NODE_USE_ENV_PROXY === '1';
let proxyDetail = '未配置，使用直连';
let proxyOk = true;
if (proxyValue) {
  try {
    const proxyUrl = new URL(proxyValue);
    proxyDetail = `${proxyEnabled ? '已启用' : '已配置但未启用'} ${proxyUrl.hostname}:${proxyUrl.port}`;
    proxyOk = proxyEnabled;
  } catch {
    proxyDetail = '代理地址格式无效';
    proxyOk = false;
  }
}
checks.push({name: '项目代理', ok: proxyOk, detail: proxyDetail});
try {
  const response = await fetch('https://github.com/trending?since=daily', {signal: AbortSignal.timeout(10_000)});
  const html = await response.text();
  const count = html.match(/<article[\s\S]*?<\/article>/gi)?.length ?? 0;
  checks.push({name: 'GitHub Trending', ok: response.ok && count >= 5, detail: `HTTP ${response.status}，解析到 ${count} 条`});
} catch (error) {
  checks.push({name: 'GitHub Trending', ok: false, detail: error instanceof Error ? error.message : String(error)});
}
try {
  const disk = fs.statfsSync(config.outputDir);
  const freeBytes = disk.bavail * disk.bsize;
  checks.push({name: '可用磁盘', ok: freeBytes > 512 * 1024 * 1024, detail: `${(freeBytes / 1024 ** 3).toFixed(1)} GB；输出目录 ${path.relative(config.rootDir, config.outputDir)}`});
} catch {
  checks.push({name: '可用磁盘', ok: false, detail: `无法读取 ${path.relative(config.rootDir, config.outputDir)}`});
}
checks.push({name: 'GitHub API', ok: true, detail: config.github.token ? '已配置 Token，可提高限额' : '未配置 Token，使用匿名限额与本地缓存'});
checks.push({name: 'LLM', ok: Boolean(config.llm.apiKey && config.llm.model), detail: config.llm.apiKey && config.llm.model ? `已配置 ${config.llm.model}` : '未配置，仅使用规则提炼'});
for (const item of checks) console.log(`${item.ok ? '✓' : item.name === 'LLM' ? '!' : '✗'} ${item.name}: ${item.detail}`);
if (checks.some((item) => !item.ok && item.name !== 'LLM')) process.exitCode = 1;

