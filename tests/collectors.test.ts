import {describe, expect, it} from 'vitest';
import {parseGithubTrendingHtml, parseGithubTrendingRss} from '../src/pipeline/collectors.js';

describe('GitHub Trending 解析', () => {
  it('按页面顺序解析全球 Today 仓库及榜单指标', () => {
    const html = `
      <article><h2><a href="/openai/codex">openai / codex</a></h2><p>Local coding agent</p><span itemprop="programmingLanguage">Rust</span><span>1,234 stars today</span></article>
      <article><h2><a href="/owner/toolbox">owner / toolbox</a></h2><p>Useful toolbox</p><span>87 stars today</span></article>`;
    const items = parseGithubTrendingHtml(html, '2026-10-10T01:00:00.000Z');
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({repo: 'openai/codex', rank: 1, language: 'Rust', starsToday: 1234, primarySource: true});
    expect(items[1]).toMatchObject({repo: 'owner/toolbox', rank: 2, starsToday: 87});
  });

  it('解析同日期社区镜像，并保持榜单顺序', () => {
    const xml = `<?xml version="1.0"?><rss><channel><pubDate>Fri, 09 Oct 2026 18:00:00 GMT</pubDate><item><title>openai/codex</title><link>https://github.com/openai/codex</link><description><![CDATA[<p>Local coding agent</p>]]></description></item></channel></rss>`;
    const items = parseGithubTrendingRss(xml, '2026-10-10T01:00:00.000Z', '2026-10-10');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({repo: 'openai/codex', rank: 1, primarySource: false});
  });

  it('拒绝使用过去日期的社区榜单', () => {
    const xml = `<?xml version="1.0"?><rss><channel><pubDate>Thu, 08 Oct 2026 06:50:58 GMT</pubDate><item><title>openai/codex</title><link>https://github.com/openai/codex</link></item></channel></rss>`;
    expect(() => parseGithubTrendingRss(xml, '2026-10-10T01:00:00.000Z', '2026-10-10'))
      .toThrow('不会使用历史榜单');
  });
});
