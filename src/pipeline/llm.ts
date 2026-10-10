import {config} from '../config.js';
import {toolEnrichmentSchema, type ToolCandidate, type ToolEnrichment} from '../shared/types.js';
import type {RepositoryProfile} from './collectors.js';
import {assessTool, numericTokens} from './rules.js';

export type ToolEnrichmentResult = {tool: ToolEnrichment; method: 'llm' | 'rule'; warning?: string};
type LlmRequestConfig = Pick<typeof config.llm, 'baseUrl' | 'apiKey' | 'model' | 'timeoutMs'> & {evidenceMaxChars?: number};

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
      quickStart: assessment.quickStart, prerequisites: profile.language ? [`需要 ${profile.language} 相关运行环境`] : [],
      caveats: assessment.riskFlags, sourceRefs: ['E1'], confidence: assessment.toolLikely ? 0.65 : 0.4,
      riskFlags: warning ? [...assessment.riskFlags, warning] : assessment.riskFlags,
    },
    method: 'rule', warning,
  };
}

function validateGrounding(tool: ToolEnrichment, candidate: ToolCandidate): string | undefined {
  if (tool.sourceRefs.some((ref) => ref !== 'E1')) return '模型引用了不存在的证据编号';
  const corpus = candidate.sources.map((source) => `${source.title} ${source.content}`).join(' ');
  const generated = `${tool.oneLinePitchZh} ${tool.useCases.join(' ')} ${tool.prerequisites.join(' ')} ${tool.caveats.join(' ')}`;
  const missingNumbers = numericTokens(generated).filter((token) => !numericTokens(corpus).includes(token));
  if (missingNumbers.length) return `模型生成了证据中不存在的数字：${[...new Set(missingNumbers)].join(', ')}`;
  if (tool.quickStart && !corpus.includes(tool.quickStart.trim())) return '模型生成了 README 中不存在的快速开始命令';
  return undefined;
}

const ruleFromCandidate = (candidate: ToolCandidate, warning?: string): ToolEnrichmentResult => ({
  tool: {
    oneLinePitchZh: candidate.oneLinePitchZh, toolType: candidate.toolType, useCases: candidate.useCases,
    targetUsers: candidate.targetUsers, quickStart: candidate.quickStart, prerequisites: candidate.prerequisites,
    caveats: candidate.caveats, sourceRefs: ['E1'], confidence: 0.55,
    riskFlags: warning ? [...candidate.riskFlags, warning] : candidate.riskFlags,
  },
  method: 'rule', warning,
});

export async function enrichToolWithLlm(candidate: ToolCandidate, llmConfig: LlmRequestConfig = config.llm): Promise<ToolEnrichmentResult> {
  if (!llmConfig.apiKey || !llmConfig.model) return ruleFromCandidate(candidate, '未配置 LLM，保留规则提炼');
  const evidenceMaxChars = llmConfig.evidenceMaxChars ?? 1_600;
  const source = candidate.sources[0];
  const evidence = [{ref: 'E1', repo: candidate.repo, rank: candidate.rank, title: source.title, url: source.url, content: source.content.slice(0, evidenceMaxChars)}];
  const system = `你是 GitHub 工具发现编辑。只能根据提供的仓库描述和 README 证据，输出自然、简洁的中文 JSON。专有名词和项目名保留原文。字段必须为 oneLinePitchZh、toolType、useCases、targetUsers、quickStart、prerequisites、caveats、sourceRefs、confidence、riskFlags。toolType 只能是 CLI、桌面应用、Web 工具、开发工具、自动化、Agent、框架与库、其他。quickStart 只能逐字引用证据中的完整命令；没有明确命令时省略。不得声称实际运行或验证过项目。sourceRefs 只能使用 E1。`;
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
    const tool = toolEnrichmentSchema.parse(JSON.parse(payload.choices?.[0]?.message?.content));
    const groundingError = validateGrounding(tool, candidate);
    return groundingError ? ruleFromCandidate(candidate, groundingError) : {tool, method: 'llm'};
  } catch (error) {
    return ruleFromCandidate(candidate, `LLM 失败：${error instanceof Error ? error.message : String(error)}`);
  }
}
