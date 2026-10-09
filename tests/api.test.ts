import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {FastifyInstance} from 'fastify';
import {createApp} from '../src/server.js';

describe('本地审核 API', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createApp(false); });
  afterAll(async () => { await app.close(); });

  it('返回健康状态', async () => {
    const response = await app.inject({method: 'GET', url: '/api/health'});
    expect(response.statusCode).toBe(200);
    expect(response.json().ok).toBe(true);
  });

  it('拒绝渲染不存在的日报', async () => {
    const response = await app.inject({method: 'POST', url: '/api/editions/missing/render'});
    expect(response.statusCode).toBe(404);
  });
});

