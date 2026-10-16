import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import ffmpegPath from 'ffmpeg-static';
import type {FastifyInstance} from 'fastify';
import {config} from '../src/config.js';
import {createApp} from '../src/server.js';
import {getBgmStatus} from '../src/audio/bgm.js';

const originalPublicDir = config.publicDir;
const testDir = path.join(config.rootDir, 'data', `bgm-test-${randomUUID()}`);
let app: FastifyInstance;

beforeAll(async () => {
  fs.mkdirSync(testDir, {recursive: true});
  config.publicDir = path.join(testDir, 'public');
  fs.mkdirSync(path.join(config.publicDir, 'assets', 'audio'), {recursive: true});
  app = await createApp(false);
});

afterAll(async () => {
  await app?.close();
  config.publicDir = originalPublicDir;
  if (path.dirname(testDir) === path.join(config.rootDir, 'data') && path.basename(testDir).startsWith('bgm-test-')) {
    fs.rmSync(testDir, {recursive: true, force: true});
  }
});

describe('本地背景音乐', () => {
  it('有效 MP3 可预览和更换；损坏文件不覆盖；取消选中只移除项目副本', async () => {
    expect((await getBgmStatus()).available).toBe(false);
    const audioFile = path.join(testDir, 'sample.mp3');
    execFileSync(ffmpegPath!, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libmp3lame', audioFile]);
    const audio = fs.readFileSync(audioFile);
    const uploaded = await app.inject({method: 'PUT', url: '/api/audio/bgm', headers: {'content-type': 'application/octet-stream'}, payload: audio});
    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.json()).toMatchObject({available: true});
    expect(uploaded.json().durationSeconds).toBeGreaterThan(0);

    const playback = await app.inject({method: 'GET', url: '/api/audio/files/bgm.mp3', headers: {range: 'bytes=0-15'}});
    expect(playback.statusCode).toBe(206);
    expect(playback.headers['content-type']).toContain('audio/mpeg');

    const invalid = await app.inject({method: 'PUT', url: '/api/audio/bgm', headers: {'content-type': 'application/octet-stream'}, payload: Buffer.from('bad audio')});
    expect(invalid.statusCode).toBe(400);
    expect((await getBgmStatus()).available).toBe(true);
    expect(fs.readFileSync(path.join(config.publicDir, 'assets', 'audio', 'bgm.mp3'))).toEqual(audio);

    const replacementFile = path.join(testDir, 'replacement.mp3');
    execFileSync(ffmpegPath!, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=1', '-c:a', 'libmp3lame', replacementFile]);
    const replacement = fs.readFileSync(replacementFile);
    const replaced = await app.inject({method: 'PUT', url: '/api/audio/bgm', headers: {'content-type': 'application/octet-stream'}, payload: replacement});
    expect(replaced.statusCode).toBe(200);
    expect(fs.readFileSync(path.join(config.publicDir, 'assets', 'audio', 'bgm.mp3'))).toEqual(replacement);

    const cleared = await app.inject({method: 'DELETE', url: '/api/audio/bgm'});
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toMatchObject({available: false});
    expect(fs.existsSync(path.join(config.publicDir, 'assets', 'audio', 'bgm.mp3'))).toBe(false);
    expect(fs.existsSync(replacementFile)).toBe(true);
  });
});
