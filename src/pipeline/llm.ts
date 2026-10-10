import crypto from 'node:crypto';
import {config} from '../config.js';
import {getToolEnrichmentCache, saveToolEnrichmentCache} from '../db.js';
import {toolEnrichmentSchema, type ToolCandidate, type ToolEnrichment} from '../shared/types.js';
import type {RepositoryProfile} from './collectors.js';
import {assessTool, numericTokens} from './rules.js';

export type ToolEnrichmentResult = {tool: ToolEnrichment; method: 'llm' | 'rule'; warning?: string; cacheHit?: boolean};
type LlmRequestConfig = Pick<typeof config.llm, 'baseUrl' | 'apiKey' | 'model' | 'timeoutMs'> & {evidenceMaxChars?: number};
export type ToolEnrichmentCache = {get: (key: string) => ToolEnrichment | undefined; set: (key: string, repo: string, value: ToolEnrichment) => void};
const PROMPT_VERSION = 'tool-overview-v2';
const defaultCache: ToolEnrichmentCache = {get: getToolEnrichmentCache, set: saveToolEnrichmentCache};

const usersForType = (type: ToolEnrichment['toolType']) => {
  if (type === 'CLI' || type === '开发工具' || type === '框架与库') return ['开发者'];
  if (type === 'Agent' || type === '自动化') return ['开发者', 'AI 工具用户'];
  return ['技术用户'];
};

const useCasesForType = (type: ToolEnrichment['toolType']) => {
  if (type === 'CLI') return ['在终端中简化重复操作'];
  if (type === '桌面应用') return ['通过桌面界面完成日常任务'];
  if (type === 'Web 工具') return ['通过浏览器或自托管服务完成任务'];
  if (type === '开发工具') return ['改善开发、调试或运维流程'];
  if (type === '自动化') return ['编排并自动执行重复工作流'];
  if (type === 'Agent') return ['构建或运行智能体工作流'];
  if (type === '框架与库') return ['集成到现有软件项目中'];
  return ['探索项目提供的主要能力'];
};

export function enrichToolWithRules(profile: RepositoryProfile, warning?: string): ToolEnrichmentResult {
  const assessment = assessTool(profile);
  const pitch = `${profile.repo} 是一个登上 GitHub Today 热榜的${assessment.toolType}项目，具体能力请结合仓库说明核验。`;
  return {
    tool: {
      oneLinePitchZh: pitch.slice(0, 160), toolType: assessment.toolType,
      useCases: useCasesForType(assessment.toolType), targetUsers: usersForType(assessment.toolType),
      prerequisites: [], caveats: [], sourceRefs: ['E1'], confidence: assessment.toolLikely ? 0.65 : 0.4,
      riskFlags: warning ? [...assessment.riskFlags, warning] : assessment.riskFlags,
    },
    method: 'rule', warning,
  };
}

function validateGrounding(tool: ToolEnrichment, candidate: ToolCandidate): string | undefined {
  if (tool.sourceRefs.some((ref) => ref !== 'E1')) return '模型引用了不存在的证据编号';
  const corpus = candidate.sources.map((source) => `${source.title} ${source.content}`).join(' ');
  const generated = `${tool.oneLinePitchZh} ${tool.useCases.join(' ')} ${tool.targetUsers.join(' ')}`;
  const missingNumbers = numericTokens(generated).filter((token) => !numericTokens(corpus).includes(token));
  if (missingNumbers.length) return `模型生成了证据中不存在的数字：${[...new Set(missingNumbers)].join(', ')}`;
  return undefined;
}

const omittedSection = /^(?:install(?:ation)?|quick\s*start|getting\s*started|setup|requirements?|prerequisites?|usage|troubleshoot|contribut|license|安装|快速开始|使用|环境要求)/i;
const prioritySection = /(?:overview|about|introduction|what\s+is|why|features?|capabilities|use\s*cases?|简介|概述|功能|特性|用途|场景)/i;

const cleanMarkdown = (value: string) => value
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/^\s*(?:[-*_]\s*){3,}\s*$/gm, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export function buildToolEvidence(candidate: ToolCandidate, maxChars: number): string {
  const raw = candidate.sources[0]?.content ?? '';
  const markerIndex = raw.indexOf('README：');
  const description = cleanMarkdown(markerIndex >= 0 ? raw.slice(0, markerIndex).replace(/^项目描述：/, '') : raw.split(/\n\s*\n/, 1)[0]);
  const readme = markerIndex >= 0 ? raw.slice(markerIndex + 'README：'.length) : raw;
  const headings = [...readme.matchAll(/^#{1,4}\s+(.+)$/gm)];
  const sections = headings.map((match, index) => ({
    heading: cleanMarkdown(match[1]),
    body: cleanMarkdown(readme.slice((match.index ?? 0) + match[0].length, headings[index + 1]?.index ?? readme.length)),
  })).filter((section) => section.body && !omittedSection.test(section.heading));
  const prioritized = sections.filter((section) => prioritySection.test(section.heading));
  const fallback = sections.filter((section) => !prioritySection.test(section.heading));
  const intro = cleanMarkdown(readme.slice(0, headings[0]?.index ?? readme.length));
  const parts = [
    `仓库：${candidate.repo}`,
    description ? `项目描述：${description}` : '',
    ...prioritized.map((section) => `${section.heading}：${section.body}`),
    intro ? `README 概述：${intro}` : '',
    ...fallback.map((section) => `${section.heading}：${section.body}`),
  ].filter(Boolean);
  return parts.join('\n').slice(0, maxChars);
}

export function toolEnrichmentCacheKey(candidate: ToolCandidate, model: string, evidence: string): string {
  return crypto.createHash('sha256').update(JSON.stringify({
    promptVersion: PROMPT_VERSION, model, repo: candidate.repo.toLowerCase(), repoUpdatedAt: candidate.repoUpdatedAt, evidence,
  })).digest('hex');
}

const ruleFromCandidate = (candidate: ToolCandidate, warning?: string): ToolEnrichmentResult => ({
  tool: {
    oneLinePitchZh: candidate.oneLinePitchZh, toolType: candidate.toolType, useCases: candidate.useCases,
    targetUsers: candidate.targetUsers, prerequisites: [], caveats: [], sourceRefs: ['E1'], confidence: 0.55,
    riskFlags: warning ? [...candidate.riskFlags, warning] : candidate.riskFlags,
  },
  method: 'rule', warning,
});

export async function enrichToolWithLlm(candidate: ToolCandidate, llmConfig: LlmRequestConfig = config.llm, cache: ToolEnrichmentCache = defaultCache): Promise<ToolEnrichmentResult> {
  if (!llmConfig.apiKey || !llmConfig.model) return ruleFromCandidate(candidate, '未配置 LLM，保留规则提炼');
  const evidenceMaxChars = llmConfig.evidenceMaxChars ?? 1_600;
  const source = candidate.sources[0];
  const focusedContent = buildToolEvidence(candidate, evidenceMaxChars);
  const evidence = [{ref: 'E1', repo: candidate.repo, rank: candidate.rank, title: source.title, url: source.url, content: focusedContent}];
  const cacheKey = toolEnrichmentCacheKey(candidate, llmConfig.model, focusedContent);
  const cached = cache.get(cacheKey);
  if (cached) return {tool: cached, method: 'llm', cacheHit: true};
  const system = `你是 GitHub 工具发现编辑。只能根据提供的仓库描述和 README 核心功能证据，输出自然、简洁的中文 JSON。专有名词和项目名保留原文。字段只需包含 oneLinePitchZh、toolType、useCases、targetUsers、sourceRefs、confidence、riskFlags。重点回答项目是什么、能解决什么问题、适合谁；不要输出安装命令、运行环境或注意事项。toolType 只能是 CLI、桌面应用、Web 工具、开发工具、自动化、Agent、框架与库、其他。不得声称实际运行或验证过项目。sourceRefs 只能使用 E1。`;
  try {
    const response = await fetch(`${llmConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {'content-type': 'application/json', authorization: `Bearer ${llmConfig.apiKey}`},
      body: JSON.stringify({
        model: llmConfig.model, temperature: 0.2, response_format: {type: 'json_object'},
        messages: [{role: 'system', content: system}, {role: 'user', content: JSON.stringify({evidence})}],
      }),
      signal: AbortSignal.timeout(llmConfig.timeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as any;
    const parsedTool = toolEnrichmentSchema.parse(JSON.parse(payload.choices?.[0]?.message?.content));
    const tool: ToolEnrichment = {...parsedTool, quickStart: undefined, prerequisites: [], caveats: []};
    const groundingError = validateGrounding(tool, candidate);
    if (groundingError) return ruleFromCandidate(candidate, groundingError);
    cache.set(cacheKey, candidate.repo, tool);
    return {tool, method: 'llm', cacheHit: false};
  } catch (error) {
    return ruleFromCandidate(candidate, `LLM 失败：${error instanceof Error ? error.message : String(error)}`);
  }
}
