import fs from 'node:fs';
import path from 'node:path';
import {XMLParser} from 'fast-xml-parser';
import {config} from '../config.js';
import {currentChinaDate} from '../shared/date.js';
import {stripHtml} from './rules.js';

export type TrendingRepository = {
  repo: string; url: string; rank: number; description: string; language?: string;
  starsToday?: number; fetchedAt: string; primarySource: boolean; rankingSource?: string;
};

export type RepositoryProfile = TrendingRepository & {
  totalStars?: number; forks?: number; topics: string[]; license?: string; homepage?: string;
  archived: boolean; repoUpdatedAt?: string; readme: string; metadataWarning?: string;
  languages?: Array<{name: string; bytes: number}>;
};

export const GITHUB_TRENDING_URL = 'https://github.com/trending?since=daily';
const supplementalLanguages = ['typescript', 'python', 'javascript', 'go', 'java', 'rust', 'ruby', 'php'];
const TRENDING_RSS_URL = 'https://mshibanami.github.io/GitHubTrendingRSS/daily/all.xml';
const parser = new XMLParser({ignoreAttributes: false, attributeNamePrefix: '@_'});

const errorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause as {code?: string; message?: string} | undefined;
  const detail = [cause?.code, cause?.message].filter(Boolean).join('：');
  return detail ? `${error.message}（${detail}）` : error.message;
};

async function fetchWithRetry(url: string, attempts = 2, headers: Record<string, string> = {}): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {'user-agent': 'GitHub-Tool-Radar/1.0 (+local review workflow)', ...headers},
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) { lastError = error; }
  }
  throw new Error(errorMessage(lastError));
}

const number = (value: string | undefined) => {
  if (!value) return undefined;
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
};

export function parseGithubTrendingHtml(html: string, fetchedAt = new Date().toISOString()): TrendingRepository[] {
  const articles = html.match(/<article[\s\S]*?<\/article>/gi) ?? [];
  return articles.flatMap((article, index) => {
    const match = article.match(/href="\/(?!sponsors)([^"?#]+\/[^"?#]+)"/i);
    if (!match) return [];
    const repo = match[1].replace(/\s/g, '');
    const description = stripHtml(article.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '');
    const language = stripHtml(article.match(/itemprop="programmingLanguage"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '') || undefined;
    const starsToday = number(stripHtml(article.match(/([\d,]+)\s+stars?\s+today/i)?.[1] ?? ''));
    return [{repo, url: `https://github.com/${repo}`, rank: index + 1, description, language, starsToday, fetchedAt, primarySource: true, rankingSource: '全球 Today'}];
  });
}

export function parseGithubTrendingRss(xml: string, fetchedAt = new Date().toISOString(), expectedDate = currentChinaDate(new Date(fetchedAt))): TrendingRepository[] {
  const document = parser.parse(xml) as Record<string, any>;
  const publishedRaw = String(document.rss?.channel?.pubDate ?? '');
  if (!publishedRaw || Number.isNaN(Date.parse(publishedRaw))) throw new Error('GitHub Trending 备用源未提供有效榜单日期');
  const publishedDate = currentChinaDate(new Date(publishedRaw));
  if (publishedDate !== expectedDate) throw new Error(`备用源最新榜单为 ${publishedDate}，不是目标日期 ${expectedDate}；不会使用历史榜单`);
  const items = document.rss?.channel?.item;
  const list = Array.isArray(items) ? items : items ? [items] : [];
  return list.flatMap((item: any, index: number) => {
    const repo = stripHtml(String(item.title ?? '')).replace(/\s/g, '');
    const url = String(item.link ?? '');
    if (!repo.includes('/') || !url.startsWith('https://github.com/')) return [];
    return [{repo, url, rank: index + 1, description: stripHtml(String(item.description ?? '')), fetchedAt, primarySource: false, rankingSource: '全球 Today'}];
  });
}

export async function collectGithubTrending(expectedDate = currentChinaDate(), excludedRepos: ReadonlySet<string> = new Set(), targetCount = config.github.candidateLimit): Promise<{entries: TrendingRepository[]; warnings: string[]; skippedLocked: number}> {
  let officialError = '';
  let globalEntries: TrendingRepository[] | undefined;
  const warnings: string[] = [];
  try {
    const response = await fetchWithRetry(GITHUB_TRENDING_URL);
    const fetchedAt = new Date().toISOString();
    const fetchedDate = currentChinaDate(new Date(fetchedAt));
    if (fetchedDate !== expectedDate) throw new Error(`官方页面只能提供 ${fetchedDate} 的实时榜单`);
    globalEntries = parseGithubTrendingHtml(await response.text(), fetchedAt);
    if (globalEntries.length < 5) throw new Error(`官方页面仅解析到 ${globalEntries.length} 条`);
  } catch (error) { officialError = errorMessage(error); }
  if (!globalEntries) {
    try {
      const response = await fetchWithRetry(TRENDING_RSS_URL);
      globalEntries = parseGithubTrendingRss(await response.text(), new Date().toISOString(), expectedDate);
      if (globalEntries.length < 5) throw new Error(`备用源仅返回 ${globalEntries.length} 条`);
      warnings.push(`GitHub 官方 Trending 页面不可达，已使用同日期社区镜像：${officialError}`);
    } catch (error) {
      throw new Error(`GitHub ${expectedDate} 全球 Today 榜不可用。官方页面：${officialError}；备用源：${errorMessage(error)}`);
    }
  }
  const entries: TrendingRepository[] = [];
  const seen = new Set<string>();
  const skipped = new Set<string>();
  const append = (items: TrendingRepository[], source: string) => {
    for (const item of items) {
      const key = item.repo.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (excludedRepos.has(key)) { skipped.add(key); continue; }
      if (entries.length < targetCount) entries.push({...item, rank: entries.length + 1, rankingSource: source});
    }
  };
  append(globalEntries, '全球 Today');
  const globalCount = entries.length;
  const failedLanguages: string[] = [];
  for (const language of supplementalLanguages) {
    if (entries.length >= targetCount) break;
    try {
      const response = await fetchWithRetry(`https://github.com/trending/${language}?since=daily`);
      const fetchedAt = new Date().toISOString();
      if (currentChinaDate(new Date(fetchedAt)) !== expectedDate) throw new Error('已跨越目标日期');
      append(parseGithubTrendingHtml(await response.text(), fetchedAt), `${language} Today 分榜`);
    } catch { failedLanguages.push(language); }
  }
  if (entries.length > globalCount) warnings.push(`全球 Today 榜可用 ${globalCount} 条，已从同日语言分榜补充至 ${entries.length} 条；补充项不是全球榜原始名次`);
  if (entries.length < targetCount) warnings.push(`全球榜与同日语言分榜合计仅有 ${entries.length} 个未锁定仓库，未达到目标 ${targetCount} 个${failedLanguages.length ? `；部分分榜获取失败：${failedLanguages.join('、')}` : ''}`);
  return {entries, warnings, skippedLocked: skipped.size};
}

type ProfileCache = Record<string, {fetchedAt: string; profile: RepositoryProfile}>;
const cachePath = path.join(config.dataDir, 'github-profile-cache.json');

const readCache = (): ProfileCache => {
  try { return JSON.parse(fs.readFileSync(cachePath, 'utf8')) as ProfileCache; } catch { return {}; }
};
const writeCache = (cache: ProfileCache) => {
  fs.mkdirSync(config.dataDir, {recursive: true});
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
};
const githubHeaders = () => ({
  accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28',
  ...(config.github.token ? {authorization: `Bearer ${config.github.token}`} : {}),
});

async function fetchRepositoryProfile(entry: TrendingRepository): Promise<RepositoryProfile> {
  try {
    const [metadataResponse, readmeResponse, languagesResponse] = await Promise.all([
      fetchWithRetry(`https://api.github.com/repos/${entry.repo}`, 2, githubHeaders()),
      fetch(`https://api.github.com/repos/${entry.repo}/readme`, {
        headers: {...githubHeaders(), accept: 'application/vnd.github.raw+json', 'user-agent': 'GitHub-Tool-Radar/1.0'},
        signal: AbortSignal.timeout(20_000),
      }),
      fetch(`https://api.github.com/repos/${entry.repo}/languages`, {
        headers: githubHeaders(), signal: AbortSignal.timeout(20_000),
      }).catch(() => undefined),
    ]);
    const metadata = await metadataResponse.json() as any;
    const readme = readmeResponse.ok ? await readmeResponse.text() : '';
    const languageData: unknown = languagesResponse?.ok ? await languagesResponse.json().catch(() => ({})) : {};
    const languageBytes = languageData && typeof languageData === 'object' && !Array.isArray(languageData)
      ? languageData as Record<string, unknown> : {};
    const languages = Object.entries(languageBytes).filter((item): item is [string, number] =>
      typeof item[1] === 'number' && Number.isFinite(item[1]) && item[1] >= 0)
      .map(([name, bytes]) => ({name, bytes}));
    const homepage = typeof metadata.homepage === 'string' && /^https?:\/\//.test(metadata.homepage) ? metadata.homepage : undefined;
    return {
      ...entry, description: metadata.description || entry.description, language: metadata.language || entry.language,
      totalStars: metadata.stargazers_count, forks: metadata.forks_count, topics: Array.isArray(metadata.topics) ? metadata.topics : [],
      license: metadata.license?.spdx_id && metadata.license.spdx_id !== 'NOASSERTION' ? metadata.license.spdx_id : undefined,
      homepage, archived: Boolean(metadata.archived), repoUpdatedAt: metadata.updated_at || undefined, readme, languages,
    };
  } catch (error) {
    const detail = errorMessage(error);
    const hint = detail.includes('HTTP 403')
      ? config.github.token ? '（账户限额可能耗尽或令牌权限不足，请运行 npm run doctor）' : '（可能达到 GitHub API 匿名限额，可配置 GITHUB_TOKEN）'
      : '';
    return {...entry, topics: [], archived: false, readme: '', metadataWarning: `仓库详情获取失败：${detail}${hint}`};
  }
}

export async function collectRepositoryProfiles(entries: TrendingRepository[], onProgress?: (completed: number, total: number) => void): Promise<{profiles: RepositoryProfile[]; warnings: string[]}> {
  const cache = readCache();
  const ttlMs = config.github.cacheHours * 3_600_000;
  const profiles = new Array<RepositoryProfile>(entries.length);
  let next = 0;
  let completed = 0;
  const workers = Array.from({length: Math.min(3, entries.length)}, async () => {
    while (next < entries.length) {
      const index = next++;
      const entry = entries[index];
      const cached = cache[entry.repo.toLowerCase()];
      if (cached && !cached.profile.metadataWarning && Date.now() - Date.parse(cached.fetchedAt) < ttlMs) {
        profiles[index] = {...cached.profile, ...entry, rank: entry.rank};
        onProgress?.(++completed, entries.length);
        continue;
      }
      const profile = await fetchRepositoryProfile(entry);
      profiles[index] = profile;
      if (!profile.metadataWarning) cache[entry.repo.toLowerCase()] = {fetchedAt: new Date().toISOString(), profile};
      onProgress?.(++completed, entries.length);
    }
  });
  await Promise.all(workers);
  writeCache(cache);
  return {profiles, warnings: profiles.flatMap((item) => item.metadataWarning ? [`${item.repo}：${item.metadataWarning}`] : [])};
}
