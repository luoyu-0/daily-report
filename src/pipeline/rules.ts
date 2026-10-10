import crypto from 'node:crypto';
import type {SourceRecord, StoryCategory, ToolType} from '../shared/types.js';
import type {RepositoryProfile} from './collectors.js';

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

const nonToolPattern = /\b(awesome|curated\s+list|roadmap|interview questions|course|tutorial|paper|dataset|newsletter|weekly)\b|教程|课程|论文|数据集|周刊|资源列表/i;
const toolPattern = /\b(cli|command.line|desktop|app|tool|framework|library|sdk|server|client|editor|agent|automation|workflow|browser|plugin|extension|generator|monitor|dashboard|api|platform|runtime|compiler|proxy|gateway|database)\b|工具|客户端|桌面|自动化|工作流|插件|扩展|生成器|编辑器|平台|框架/i;

export function classifyTool(profile: RepositoryProfile): ToolType {
  const text = `${profile.description} ${profile.topics.join(' ')} ${profile.readme.slice(0, 5_000)}`.toLowerCase();
  if (/\b(electron|desktop|tauri|windows|macos|linux app)\b|桌面/.test(text)) return '桌面应用';
  if (/\b(cli|command.line|terminal|tui)\b|命令行/.test(text)) return 'CLI';
  if (/\b(agent|agentic|mcp)\b|智能体/.test(text)) return 'Agent';
  if (/\b(automation|workflow|orchestrat|pipeline)\b|自动化|工作流/.test(text)) return '自动化';
  if (/\b(web app|browser|dashboard|website|self.hosted)\b|网页|浏览器/.test(text)) return 'Web 工具';
  if (/\b(sdk|framework|library|package|runtime)\b|框架|开发库/.test(text)) return '框架与库';
  if (/\b(editor|debug|developer|devtool|compiler|proxy|gateway|monitor)\b|开发工具|编辑器/.test(text)) return '开发工具';
  return '其他';
}

export function extractQuickStart(readme: string): string | undefined {
  if (!readme) return undefined;
  const section = readme.match(/(?:^|\n)#{1,3}\s*(?:quick\s*start|getting\s*started|installation|install|usage|快速开始|安装|使用)[^\n]*\n([\s\S]{0,2500})/i)?.[1] ?? readme.slice(0, 3_000);
  const code = section.match(/```(?:bash|sh|shell|powershell|zsh|cmd)?\s*\n([\s\S]*?)```/i)?.[1]?.trim();
  return code ? code.slice(0, 600) : undefined;
}

export function assessTool(profile: RepositoryProfile) {
  const corpus = `${profile.repo} ${profile.description} ${profile.topics.join(' ')} ${profile.readme.slice(0, 8_000)}`;
  const quickStart = extractQuickStart(profile.readme);
  const excluded = nonToolPattern.test(corpus);
  const positive = toolPattern.test(corpus);
  const toolLikely = !profile.archived && !excluded && positive;
  let score = 20;
  score += Math.max(0, 18 - (profile.rank - 1));
  score += Math.min(15, Math.round(Math.log10((profile.starsToday ?? 0) + 1) * 6));
  score += positive ? 18 : 4;
  score += quickStart ? 14 : 0;
  score += profile.license ? 8 : 0;
  score += profile.readme.length > 1_000 ? 5 : 0;
  if (profile.archived) score -= 35;
  if (excluded) score -= 30;
  const utilityScore = Math.max(0, Math.min(100, Math.round(score)));
  const excludeReason = profile.archived ? '仓库已归档'
    : excluded ? '更像资讯、教程、论文或资源列表，而不是可直接使用的工具'
      : !positive ? '暂未从描述和 README 中识别出明确的工具入口' : undefined;
  const riskFlags = [
    ...(profile.metadataWarning ? [profile.metadataWarning] : []),
    ...(!profile.license ? ['未识别到开源许可证'] : []),
    ...(!quickStart ? ['未提取到明确的快速开始命令'] : []),
    ...(profile.archived ? ['仓库已归档'] : []),
  ];
  return {toolType: classifyTool(profile), toolLikely, utilityScore, excludeReason, quickStart, riskFlags};
}

