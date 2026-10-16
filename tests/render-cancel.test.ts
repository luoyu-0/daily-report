import {describe, expect, it} from 'vitest';
import {RenderCancellation} from '../src/shared/render-cancellation.js';

describe('渲染取消', () => {
  it('接收取消请求、传递给编码器，并等待清理完成', async () => {
    const cancellation = new RenderCancellation();
    let canceled = false;
    const task = cancellation.register('render-1', () => { canceled = true; });
    expect(cancellation.cancel('render-1')).toBe(true);
    expect(cancellation.isCanceled('render-1')).toBe(true);
    expect(canceled).toBe(true);
    let finished = false;
    const wait = cancellation.waitForAll().then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    task.complete();
    await wait;
    expect(finished).toBe(true);
    expect(cancellation.cancel('render-1')).toBe(false);
  });
});
