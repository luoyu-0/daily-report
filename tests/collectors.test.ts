import {describe, expect, it} from 'vitest';
import {
  parseAnthropicNewsHtml,
  parseFeed,
  parseGithubTrendingHtml,
  parseGithubTrendingRss,
  parseMetaBlogHtml,
} from '../src/pipeline/collectors.js';

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

describe('官方资讯页解析', () => {
  it('解析 Anthropic 新闻列表', () => {
    const html = `<li><a href="/news/2026-usage-policy-update" class="listItem"><time>Oct 8, 2026</time><span class="PublicationList__subject">Announcements</span><span class="PublicationList__title body-3">2026 Usage Policy update</span></a></li>`;
    const items = parseAnthropicNewsHtml(html, '2026-10-09T01:00:00.000Z');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sourceName: 'Anthropic',
      title: '2026 Usage Policy update',
      url: 'https://www.anthropic.com/news/2026-usage-policy-update',
      publishedAt: '2026-10-08T12:00:00.000Z',
    });
  });

  it('解析 Meta AI 博客卡片并解码标题', () => {
    const html = `<a aria-label="Read Reimagining Independence: How AI&#x2019;s helping people" href="https://ai.meta.com/blog/reimagining-independence/"><div>Read more</div><div>July 9, 2026</div></a>`;
    const items = parseMetaBlogHtml(html, '2026-10-09T01:00:00.000Z');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sourceName: 'Meta AI',
      title: 'Reimagining Independence: How AI’s helping people',
      publishedAt: '2026-07-09T12:00:00.000Z',
    });
  });

  it('忽略官方页面中没有发布日期的链接', () => {
    const html = `<a aria-label="Read Undated article" href="https://ai.meta.com/blog/undated/">Read</a>`;
    expect(parseMetaBlogHtml(html)).toHaveLength(0);
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
    const items = parseGithubTrendingRss(xml, '2026-10-09T01:00:00.000Z', '2026-10-08');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: 'openai/codex',
      publishedAt: '2026-10-08T06:50:58.000Z',
      primarySource: false,
      author: 'mshibanami/GitHubTrendingRSS（社区镜像）',
    });
  });

  it('拒绝使用过去日期的社区榜单', () => {
    const xml = `<?xml version="1.0"?><rss><channel><pubDate>Thu, 08 Oct 2026 06:50:58 GMT</pubDate><item><title>openai/codex</title><link>https://github.com/openai/codex</link><description>Local coding agent</description></item></channel></rss>`;
    expect(() => parseGithubTrendingRss(xml, '2026-10-09T01:00:00.000Z', '2026-10-09'))
      .toThrow('最新榜单为 2026-10-08，不是目标日期 2026-10-09；不会使用历史榜单');
  });

  it('拒绝没有榜单日期的社区数据', () => {
    const xml = `<?xml version="1.0"?><rss><channel><item><title>openai/codex</title><link>https://github.com/openai/codex</link></item></channel></rss>`;
    expect(() => parseGithubTrendingRss(xml, '2026-10-09T01:00:00.000Z', '2026-10-09'))
      .toThrow('未提供有效榜单日期');
  });
});

