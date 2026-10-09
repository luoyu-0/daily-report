import {describe, expect, it} from 'vitest';
import {parseFeed} from '../src/pipeline/collectors.js';

describe('RSS / Atom 解析', () => {
  it('解析 RSS 并清理 HTML', () => {
    const xml = `<?xml version="1.0"?><rss><channel><item><title>New AI Model</title><link>https://example.com/a</link><description><![CDATA[<p>Useful <b>details</b>.</p>]]></description><pubDate>Thu, 09 Oct 2026 01:00:00 GMT</pubDate></item></channel></rss>`;
    const items = parseFeed(xml, {name: 'Example', url: 'https://example.com/feed'});
    expect(items).toHaveLength(1);
    expect(items[0].content).toBe('Useful details.');
    expect(items[0].publishedAt).toBeTruthy();
  });

  it('忽略缺少合法链接的条目', () => {
    const xml = `<feed><entry><title>Missing link</title><summary>Body</summary></entry></feed>`;
    expect(parseFeed(xml, {name: 'Example', url: 'https://example.com/feed'})).toHaveLength(0);
  });
});

