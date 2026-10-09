import {describe, expect, it} from 'vitest';
import {buildRequestInit} from '../src/web/api.js';

describe('前端 API 请求封装', () => {
  it('无请求体的 POST 不声明 JSON 内容类型', () => {
    const init = buildRequestInit({method: 'POST'});
    expect(new Headers(init.headers).has('content-type')).toBe(false);
  });

  it('有请求体时自动声明 JSON 内容类型', () => {
    const init = buildRequestInit({method: 'PATCH', body: JSON.stringify({confirmed: true})});
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });

  it('保留显式指定的内容类型', () => {
    const init = buildRequestInit({method: 'POST', body: 'text', headers: {'content-type': 'text/plain'}});
    expect(new Headers(init.headers).get('content-type')).toBe('text/plain');
  });
});

