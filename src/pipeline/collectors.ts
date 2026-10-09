import {XMLParser} from 'fast-xml-parser';
import {currentChinaDate} from '../shared/date.js';
import {sourceRecordSchema, type SourceRecord} from '../shared/types.js';
import {stableSourceId, stripHtml} from './rules.js';

type FeedConfig = {name: string; url: string; primarySource?: boolean};

export const DEFAULT_FEEDS: FeedConfig[] = [
  {name: 'OpenAI', url: 'https://openai.com/news/rss.xml'},
  {name: 'Anthropic', url: 'https://www.anthropic.com/rss.xml'},
  {name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml'},
  {name: 'Meta AI', url: 'https://ai.meta.com/blog/rss/'},
  {name: 'Microsoft Research', url: 'https://www.microsoft.com/en-us/research/feed/'},
  {name: 'NVIDIA', url: 'https://blogs.nvidia.com/feed/'},
];

const parser = new XMLParser({ignoreAttributes: false, attributeNamePrefix: '@_'});
const array = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const textValue = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    return String(item['#text'] ?? item['@_href'] ?? '');
  }
  return '';
};

async function fetchWithRetry(url: string, attempts = 2): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {'user-agent': 'AI-Insight-Daily/1.0 (+local review workflow)'},
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export function parseFeed(xml: string, feed: FeedConfig, fetchedAt = new Date().toISOString()): SourceRecord[] {
  const document = parser.parse(xml) as Record<string, any>;
  const rssItems = array(document.rss?.channel?.item);
  const atomItems = array(document.feed?.entry);
  return [...rssItems, ...atomItems].flatMap((item: any) => {
    const title = stripHtml(textValue(item.title));
    const url = textValue(item.link) || textValue(item.guid) || textValue(item.id);
    const content = stripHtml(textValue(item['content:encoded']) || textValue(item.content) || textValue(item.summary) || textValue(item.description));
    const publishedRaw = textValue(item.pubDate) || textValue(item.published) || textValue(item.updated);
    if (!title || !/^https?:\/\//i.test(url)) return [];
    const parsedDate = publishedRaw && !Number.isNaN(Date.parse(publishedRaw)) ? new Date(publishedRaw).toISOString() : undefined;
    return [sourceRecordSchema.parse({
      id: stableSourceId(url), sourceName: feed.name, title, url, content: content || title,
      author: textValue(item.author?.name || item.author) || undefined,
      publishedAt: parsedDate, fetchedAt, primarySource: feed.primarySource ?? true,
    })];
  });
}

export async function collectFeed(feed: FeedConfig): Promise<SourceRecord[]> {
  return parseFeed(await fetchWithRetry(feed.url), feed);
}

export async function collectArxiv(): Promise<SourceRecord[]> {
  const query = encodeURIComponent('cat:cs.AI OR cat:cs.LG OR cat:cs.CL OR cat:cs.CV');
  const feed: FeedConfig = {name: 'arXiv', url: `https://export.arxiv.org/api/query?search_query=${query}&sortBy=submittedDate&sortOrder=descending&max_results=25`};
  return parseFeed(await fetchWithRetry(feed.url), {...feed, primarySource: true});
}

export function parseGithubTrendingHtml(html: string, fetchedAt = new Date().toISOString()): SourceRecord[] {
  const articles = html.match(/<article[\s\S]*?<\/article>/gi) ?? [];
  return articles.slice(0, 15).flatMap((article) => {
    const match = article.match(/href="\/(?!sponsors)([^"?#]+\/[^"?#]+)"/i);
    if (!match) return [];
    const repo = match[1].replace(/\s/g, '');
    const url = `https://github.com/${repo}`;
    const description = stripHtml(article.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '');
    return [sourceRecordSchema.parse({
      id: stableSourceId(url), sourceName: 'GitHub Trending', title: repo,
      url, content: description || `${repo} 进入 GitHub 当日趋势榜。`,
      fetchedAt, publishedAt: fetchedAt, primarySource: true,
    })];
  });
}

export function parseGithubTrendingRss(
  xml: string,
  fetchedAt = new Date().toISOString(),
  expectedDate = currentChinaDate(new Date(fetchedAt)),
): SourceRecord[] {
  const document = parser.parse(xml) as Record<string, any>;
  const publishedRaw = textValue(document.rss?.channel?.pubDate);
  if (!publishedRaw || Number.isNaN(Date.parse(publishedRaw))) {
    throw new Error('GitHub Trending 备用源未提供有效榜单日期，已拒绝使用');
  }
  const publishedAt = new Date(publishedRaw).toISOString();
  const publishedDate = currentChinaDate(new Date(publishedAt));
  if (publishedDate !== expectedDate) {
    throw new Error(`GitHub Trending 备用源最新榜单为 ${publishedDate}，不是目标日期 ${expectedDate}；不会使用历史榜单`);
  }
  const feed: FeedConfig = {
    name: 'GitHub Trending',
    url: 'https://mshibanami.github.io/GitHubTrendingRSS/daily/all.xml',
    primarySource: false,
  };
  return parseFeed(xml, feed, fetchedAt).slice(0, 15).map((item) => sourceRecordSchema.parse({
    ...item,
    publishedAt,
    author: 'mshibanami/GitHubTrendingRSS（社区镜像）',
  }));
}

export async function collectGithubTrending(expectedDate = currentChinaDate()): Promise<SourceRecord[]> {
  let officialError = '';
  try {
    const html = await fetchWithRetry('https://github.com/trending?since=daily', 1);
    const fetchedAt = new Date().toISOString();
    const fetchedDate = currentChinaDate(new Date(fetchedAt));
    if (fetchedDate !== expectedDate) {
      throw new Error(`官方页面只能提供 ${fetchedDate} 的实时榜单，目标日期为 ${expectedDate}`);
    }
    const records = parseGithubTrendingHtml(html, fetchedAt);
    if (records.length >= 5) return records;
    officialError = `官方页面仅解析到 ${records.length} 条`;
  } catch (error) {
    officialError = error instanceof Error ? error.message : String(error);
  }

  try {
    const xml = await fetchWithRetry('https://mshibanami.github.io/GitHubTrendingRSS/daily/all.xml');
    const records = parseGithubTrendingRss(xml, new Date().toISOString(), expectedDate);
    if (records.length < 5) throw new Error(`备用源仅返回 ${records.length} 条，至少需要 5 条`);
    return records;
  } catch (error) {
    const mirrorError = error instanceof Error ? error.message : String(error);
    throw new Error(`GitHub ${expectedDate} 当天热榜不可用。官方页面：${officialError}；备用源：${mirrorError}`);
  }
}

export type CollectionResult = {records: SourceRecord[]; warnings: string[]};

export async function collectAll(cutoffHours = 36, editionDate = currentChinaDate()): Promise<CollectionResult> {
  const tasks = [
    ...DEFAULT_FEEDS.map((feed) => ({name: feed.name, run: () => collectFeed(feed)})),
    {name: 'arXiv', run: collectArxiv},
    {name: 'GitHub Trending', run: () => collectGithubTrending(editionDate)},
  ];
  const settled = await Promise.allSettled(tasks.map((task) => task.run()));
  const warnings: string[] = [];
  const records = settled.flatMap((result, index) => {
    if (result.status === 'fulfilled') {
      if (tasks[index].name === 'GitHub Trending' && result.value.some((item) => !item.primarySource)) {
        warnings.push('GitHub 官方 Trending 页面不可达，已使用 mshibanami/GitHubTrendingRSS 社区镜像');
      }
      return result.value;
    }
    warnings.push(`${tasks[index].name} 采集失败：${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    return [];
  });
  const githubCount = records.filter((item) => item.sourceName === 'GitHub Trending').length;
  if (githubCount < 5) {
    const githubWarning = warnings.find((warning) => warning.startsWith('GitHub Trending 采集失败：'));
    throw new Error(githubWarning?.replace('GitHub Trending 采集失败：', '')
      ?? `GitHub ${editionDate} 当天热榜采集不足：仅获得 ${githubCount} 条；不会使用历史榜单`);
  }
  const cutoff = Date.now() - cutoffHours * 3_600_000;
  return {
    records: records.filter((item) => !item.publishedAt || Date.parse(item.publishedAt) >= cutoff),
    warnings,
  };
}

