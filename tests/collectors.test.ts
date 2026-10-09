import {describe, expect, it} from 'vitest';
import {parseFeed, parseGithubTrendingHtml, parseGithubTrendingRss} from '../src/pipeline/collectors.js';

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

describe('GitHub Trending 解析', () => {
  it('解析 GitHub 官方页面中的仓库', () => {
    const html = `<article><h2><a href="/openai/codex">openai / codex</a></h2><p>Local coding agent</p></article>`;
    const items = parseGithubTrendingHtml(html, '2026-10-09T01:00:00.000Z');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({title: 'openai/codex', url: 'https://github.com/openai/codex', primarySource: true});
  });

  it('解析社区 RSS 并保留榜单更新时间和来源标记', () => {
    const xml = `<?xml version="1.0"?><rss><channel><pubDate>Thu, 08 Oct 2026 06:50:58 GMT</pubDate><item><title>openai/codex</title><link>https://github.com/openai/codex</link><description><![CDATA[<p>Local coding agent</p>]]></description></item></channel></rss>`;
    const items = parseGithubTrendingRss(xml, '2026-10-09T01:00:00.000Z');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: 'openai/codex',
      publishedAt: '2026-10-08T06:50:58.000Z',
      primarySource: false,
      author: 'mshibanami/GitHubTrendingRSS（社区镜像）',
    });
  });
});

