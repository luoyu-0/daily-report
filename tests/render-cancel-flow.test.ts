import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';

const temporary = path.join(process.cwd(), 'data', `cancel-test-${randomUUID()}`);
const oldDataDir = process.env.DATA_DIR;
const oldOutputDir = process.env.OUTPUT_DIR;
let db: typeof import('../src/db.js');
let renderer: typeof import('../src/render.js');
let config: typeof import('../src/config.js').config;

beforeAll(async () => {
  fs.mkdirSync(temporary, {recursive: true});
  process.env.DATA_DIR = path.join(temporary, 'database');
  process.env.OUTPUT_DIR = path.join(temporary, 'output');
  vi.resetModules();
  ({config} = await import('../src/config.js'));
  config.publicDir = path.join(temporary, 'public');
  fs.mkdirSync(config.publicDir, {recursive: true});
  db = await import('../src/db.js');
  renderer = await import('../src/render.js');
});

afterAll(() => {
  db?.sqlite.close();
  if (oldDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = oldDataDir;
  if (oldOutputDir === undefined) delete process.env.OUTPUT_DIR; else process.env.OUTPUT_DIR = oldOutputDir;
  if (path.dirname(temporary) === path.join(process.cwd(), 'data') && path.basename(temporary).startsWith('cancel-test-')) fs.rmSync(temporary, {recursive: true, force: true});
});

describe('渲染取消流水线', () => {
  it('开始后立即取消，恢复可渲染状态且不留下文件', async () => {
    const edition = db.createEdition('2026-10-15');
    db.updateEditionStatus(edition.id, 'approved');
    const job = db.createRenderJob(edition.id);
    const task = renderer.renderEdition(edition.id, job);
    fs.writeFileSync(path.join(config.outputDir, `.${edition.date}-v${edition.version}-${job.id}.partial.mp4`), 'unfinished');
    expect(renderer.cancelRenderJob(job.id)).toBe(true);
    await expect(task).rejects.toThrow('用户取消渲染');
    expect(db.getRenderJob(job.id)?.status).toBe('canceled');
    expect(db.getEdition(edition.id)?.status).toBe('approved');
    expect(fs.readdirSync(config.outputDir)).toEqual([]);
    const {createApp} = await import('../src/server.js');
    const app = await createApp(false);
    try {
      const latest = await app.inject({method: 'GET', url: `/api/editions/${edition.id}/render-job`});
      expect(latest.json().status).toBe('canceled');
      const rejected = await app.inject({method: 'POST', url: `/api/render-jobs/${job.id}/cancel`});
      expect(rejected.statusCode).toBe(409);
    } finally { await app.close(); }
  });
});
