import {afterEach, describe, expect, it, vi} from 'vitest';
import {ReviewLifecycle} from '../src/shared/review-lifecycle.js';

afterEach(() => vi.useRealTimers());

describe('审核台生命周期', () => {
  it('最后一个页面关闭后延迟停止，刷新或其他页面仍在时不停止', async () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    const lifecycle = new ReviewLifecycle(stop, {closeGraceMs: 3000, heartbeatTtlMs: 30000, startupGraceMs: 60000});
    lifecycle.ping('tab-a');
    lifecycle.ping('tab-b');
    lifecycle.leave('tab-a');
    await vi.advanceTimersByTimeAsync(4000);
    expect(stop).not.toHaveBeenCalled();
    lifecycle.leave('tab-b');
    await vi.advanceTimersByTimeAsync(2000);
    lifecycle.ping('tab-b');
    await vi.advanceTimersByTimeAsync(4000);
    expect(stop).not.toHaveBeenCalled();
    lifecycle.leave('tab-b');
    await vi.advanceTimersByTimeAsync(3000);
    expect(stop).toHaveBeenCalledOnce();
    lifecycle.dispose();
  });

  it('浏览器异常退出未发送离开事件时仍能超时停止', async () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    const lifecycle = new ReviewLifecycle(stop, {closeGraceMs: 1000, heartbeatTtlMs: 5000, startupGraceMs: 60000});
    lifecycle.ping('tab-a');
    await vi.advanceTimersByTimeAsync(7000);
    expect(stop).toHaveBeenCalledOnce();
    lifecycle.dispose();
  });
});
