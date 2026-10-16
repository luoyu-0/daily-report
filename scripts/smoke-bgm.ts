import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import type {ToolCandidate} from '../src/shared/types.js';

const root = process.cwd();
const dataRoot = path.join(root, 'data');
const temporary = path.join(dataRoot, `bgm-render-${randomUUID()}`);
fs.mkdirSync(temporary, {recursive: true});
process.env.DATA_DIR = path.join(temporary, 'database');
process.env.OUTPUT_DIR = path.join(temporary, 'output');

const {config} = await import('../src/config.js');
config.publicDir = path.join(temporary, 'public');
const audioDir = path.join(config.publicDir, 'assets', 'audio');
fs.mkdirSync(audioDir, {recursive: true});
execFileSync(ffmpegPath!, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libmp3lame', path.join(audioDir, 'bgm.mp3')]);

const {createEdition, newId, sqlite, updateEditionStatus, upsertCandidate} = await import('../src/db.js');
try {
  const {renderEdition, validateVideo} = await import('../src/render.js');
  const edition = createEdition('2026-10-14');
  const tool: ToolCandidate = {
    id: newId('tool'), editionId: edition.id, repo: 'example/bgm-check', url: 'https://github.com/example/bgm-check',
    rank: 1, topics: [], archived: false, toolType: '开发工具', oneLinePitchZh: '用于验证背景音乐是否进入成片的本地测试仓库。',
    useCases: ['检查音轨'], targetUsers: ['开发者'], prerequisites: [], caveats: [], utilityScore: 80, toolLikely: true,
    selected: true, confirmed: true, position: 0,
    sources: [{id: 'smoke-source', sourceName: 'GitHub', title: 'example/bgm-check', url: 'https://github.com/example/bgm-check',
      content: '本地测试证据', fetchedAt: new Date().toISOString(), primarySource: true}],
    evidence: ['E1: 本地测试证据'], riskFlags: [], generationMethod: 'rule',
  };
  upsertCandidate(tool);
  updateEditionStatus(edition.id, 'approved');
  const output = await renderEdition(edition.id);
  const metadata = await validateVideo(output, {...edition, candidates: [tool]}, true);
  if (metadata.audioCodec !== 'aac') throw new Error('成片未包含 AAC 音轨');
  console.log(`背景音乐成片检查通过：${metadata.duration.toFixed(1)} 秒，音轨 ${metadata.audioCodec}`);
} finally {
  sqlite.close();
  if (path.dirname(temporary) === dataRoot && path.basename(temporary).startsWith('bgm-render-')) {
    fs.rmSync(temporary, {recursive: true, force: true});
  }
}
