import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  collectGithubTrending,
  parseAnthropicNewsHtml,
  parseFeed,
  parseGithubTrendingHtml,
  parseMetaBlogHtml,
} from '../src/pipeline/collectors.js';
import {currentChinaDate} from '../src/shared/date.js';

afterEach(() => vi.unstubAllGlobals());

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
  it('请求中文口语筛选下的 Today 榜', async () => {
    const html = Array.from({length: 5}, (_, index) =>
      `<article><h2><a href="/owner/repo-${index}">owner / repo-${index}</a></h2></article>`,
    ).join('');
    const fetchMock = vi.fn(async () => new Response(html, {status: 200}));
    vi.stubGlobal('fetch', fetchMock);

    await collectGithubTrending(currentChinaDate());

    expect(fetchMock).toHaveBeenCalledWith(
      'https://github.com/trending?since=daily&spoken_language_code=zh',
      expect.any(Object),
    );
  });

  it('解析 GitHub 官方页面中的仓库', () => {
    const html = `<article><h2><a href="/openai/codex">openai / codex</a></h2><p>Local coding agent</p></article>`;
    const items = parseGithubTrendingHtml(html, '2026-10-09T01:00:00.000Z');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({title: 'openai/codex', url: 'https://github.com/openai/codex', primarySource: true});
  });

  it('官方中文榜不可用时明确失败，不回退到不同榜单', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) => { throw new Error('network unavailable'); });
    vi.stubGlobal('fetch', fetchMock);

    await expect(collectGithubTrending(currentChinaDate())).rejects.toThrow('中文口语 Today 榜不可用');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([url]) => url === 'https://github.com/trending?since=daily&spoken_language_code=zh')).toBe(true);
  });
});

