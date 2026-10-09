import {XMLParser} from 'fast-xml-parser';
import {currentChinaDate} from '../shared/date.js';
import {sourceRecordSchema, type SourceRecord} from '../shared/types.js';
import {stableSourceId, stripHtml} from './rules.js';

type FeedConfig = {name: string; url: string; primarySource?: boolean; timeoutMs?: number};

export const DEFAULT_FEEDS: FeedConfig[] = [
  {name: 'OpenAI', url: 'https://openai.com/news/rss.xml', timeoutMs: 25_000},
  {name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml'},
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

const errorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause as {code?: string; message?: string} | undefined;
  const causeDetails = [cause?.code, cause?.message].filter(Boolean).join('：');
  return causeDetails ? `${error.message}（${causeDetails}）` : error.message;
};

const decodeHtmlText = (value: string): string => stripHtml(value
  .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10))));

const pageDate = (value: string): string | undefined => {
  const timestamp = Date.parse(`${value.trim()} 12:00:00 UTC`);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
};

async function fetchWithRetry(url: string, attempts = 2, timeoutMs = 15_000): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {'user-agent': 'AI-Insight-Daily/1.0 (+local review workflow)'},
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(errorMessage(lastError));
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
  return parseFeed(await fetchWithRetry(feed.url, 2, feed.timeoutMs), feed);
}

export function parseAnthropicNewsHtml(html: string, fetchedAt = new Date().toISOString()): SourceRecord[] {
  const pattern = /<a\b[^>]*href="(\/news\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set<string>();
  return Array.from(html.matchAll(pattern)).flatMap((match) => {
    const url = new URL(match[1], 'https://www.anthropic.com').toString();
    if (seen.has(url)) return [];
    const body = match[2];
    const date = body.match(/<time\b[^>]*>([\s\S]*?)<\/time>/i)?.[1];
    const category = decodeHtmlText(body.match(/<span\b[^>]*class="[^"]*__subject[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '');
    const title = decodeHtmlText(body.match(/<span\b[^>]*class="[^"]*__title[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '');
    const publishedAt = date ? pageDate(decodeHtmlText(date)) : undefined;
    if (!title || !publishedAt) return [];
    seen.add(url);
    return [sourceRecordSchema.parse({
      id: stableSourceId(url), sourceName: 'Anthropic', title, url,
      content: category ? `${category}：${title}` : title,
      publishedAt, fetchedAt, primarySource: true,
    })];
  });
}

export async function collectAnthropicNews(): Promise<SourceRecord[]> {
  return parseAnthropicNewsHtml(await fetchWithRetry('https://www.anthropic.com/news'));
}

export function parseMetaBlogHtml(html: string, fetchedAt = new Date().toISOString()): SourceRecord[] {
  const linkPattern = /<a\b[^>]*aria-label="Read ([^"]+)"[^>]*href="(https:\/\/ai\.meta\.com\/blog\/[^"]+)"[^>]*>/gi;
  const matches = Array.from(html.matchAll(linkPattern));
  const seen = new Set<string>();
  return matches.flatMap((match, index) => {
    const url = match[2].replace(/&amp;/g, '&');
    if (seen.has(url)) return [];
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? Math.min(html.length, start + 8_000);
    const cardHtml = html.slice(start, end);
    const date = cardHtml.match(/\b((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+\d{4})\b/i)?.[1];
    const title = decodeHtmlText(match[1]);
    const publishedAt = date ? pageDate(date) : undefined;
    if (!title || !publishedAt) return [];
    seen.add(url);
    return [sourceRecordSchema.parse({
      id: stableSourceId(url), sourceName: 'Meta AI', title, url,
      content: title, publishedAt, fetchedAt, primarySource: true,
    })];
  });
}

export async function collectMetaBlog(): Promise<SourceRecord[]> {
  return parseMetaBlogHtml(await fetchWithRetry('https://ai.meta.com/blog/'));
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
    {name: 'Anthropic', run: collectAnthropicNews},
    {name: 'Meta AI', run: collectMetaBlog},
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

