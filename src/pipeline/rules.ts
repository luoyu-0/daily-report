import crypto from 'node:crypto';
import type {SourceRecord, StoryCategory} from '../shared/types.js';

export const stripHtml = (value: string) => value
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&#39;/gi, "'")
  .replace(/&quot;/gi, '"')
  .replace(/\s+/g, ' ')
  .replace(/\s+([,.;:!?，。；：！？])/g, '$1')
  .trim();

export function normalizedUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|source$|campaign$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

const tokens = (value: string) => {
  const lowered = value.toLowerCase();
  const latin = lowered.match(/[a-z0-9][a-z0-9.+-]{1,}/g) ?? [];
  const chinese = [...lowered.replace(/[^\u4e00-\u9fff]/g, '')].map((char, index, all) => `${char}${all[index + 1] ?? ''}`);
  return new Set([...latin, ...chinese.filter((item) => item.length === 2)]);
};

export function titleSimilarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  return intersection / (left.size + right.size - intersection);
}

export function deduplicate(records: SourceRecord[]): SourceRecord[][] {
  const groups: SourceRecord[][] = [];
  for (const record of records) {
    const duplicate = groups.find((group) =>
      normalizedUrl(group[0].url) === normalizedUrl(record.url) ||
      titleSimilarity(group[0].title, record.title) >= 0.72,
    );
    if (duplicate) duplicate.push(record);
    else groups.push([record]);
  }
  return groups;
}

export function classify(text: string): StoryCategory {
  const value = text.toLowerCase();
  if (/(agent|security|safety|jailbreak|prompt injection|智能体|安全|漏洞)/i.test(value)) return '智能体与安全';
  if (/(chip|gpu|tpu|cuda|semiconductor|datacenter|芯片|算力|数据中心)/i.test(value)) return '芯片与算力';
  if (/(arxiv|paper|research|github|open.source|benchmark|论文|研究|开源)/i.test(value)) return '研究与开源';
  if (/(model|api|chatbot|multimodal|release|模型|产品|发布|多模态)/i.test(value)) return 'AI 产品与模型';
  return '行业动态';
}

export function extractiveSummary(record: SourceRecord, maxLength = 220): string {
  const clean = stripHtml(record.content || record.title);
  const sentences = clean.split(/(?<=[。！？.!?])\s*/).filter(Boolean);
  const selected = sentences.slice(0, 3).join(' ') || record.title;
  return selected.length <= maxLength ? selected : `${selected.slice(0, maxLength - 1).trim()}…`;
}

export function scoreGroup(group: SourceRecord[], nowMs = Date.now()): number {
  const primary = group.some((item) => item.primarySource) ? 20 : 10;
  const corroboration = Math.min(15, Math.max(0, group.length - 1) * 5);
  const published = group[0].publishedAt ? Date.parse(group[0].publishedAt) : nowMs;
  const ageHours = Math.max(0, (nowMs - published) / 3_600_000);
  const freshness = Math.max(5, 30 - ageHours * 0.8);
  const text = group.map((item) => `${item.title} ${item.content}`).join(' ');
  const impactTerms = (text.match(/(release|launch|new model|open.source|security|funding|acquisition|发布|开源|安全|融资|收购|新模型)/gi) ?? []).length;
  const impact = Math.min(25, 10 + impactTerms * 3);
  const relevance = /(ai|llm|model|agent|machine learning|人工智能|模型|智能体)/i.test(text) ? 10 : 3;
  return Math.round(Math.min(100, primary + corroboration + freshness + impact + relevance));
}

export function stableSourceId(url: string): string {
  return `source_${crypto.createHash('sha1').update(normalizedUrl(url)).digest('hex').slice(0, 16)}`;
}

export const numericTokens = (value: string): string[] => Array.from(value.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? []);
export const latinEntities = (value: string): string[] => Array.from(value.match(/\b[A-Z][A-Za-z0-9.+-]{2,}\b/g) ?? []);

