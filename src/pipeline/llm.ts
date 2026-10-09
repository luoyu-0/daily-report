import {config} from '../config.js';
import {llmStorySchema, type LlmStory, type SourceRecord} from '../shared/types.js';
import {classify, extractiveSummary, latinEntities, numericTokens} from './rules.js';

export type EnrichmentResult = {story: LlmStory; method: 'llm' | 'rule'; warning?: string};

const fallback = (sources: SourceRecord[], warning?: string): EnrichmentResult => ({
  story: {
    titleZh: sources[0].title.slice(0, 80),
    summaryZh: extractiveSummary(sources[0]),
    category: classify(sources.map((item) => `${item.title} ${item.content}`).join(' ')),
    keyFacts: [extractiveSummary(sources[0], 100)],
    sourceRefs: ['E1'],
    confidence: 0.55,
    riskFlags: warning ? [warning] : [],
  },
  method: 'rule', warning,
});

function validateGrounding(story: LlmStory, sources: SourceRecord[]): string | undefined {
  const validRefs = new Set(sources.map((_, index) => `E${index + 1}`));
  if (story.sourceRefs.some((ref) => !validRefs.has(ref))) return '模型引用了不存在的证据编号';
  const corpus = sources.map((item) => `${item.title} ${item.content}`).join(' ');
  const generated = `${story.titleZh} ${story.summaryZh} ${story.keyFacts.join(' ')}`;
  const missingNumbers = numericTokens(generated).filter((token) => !numericTokens(corpus).includes(token));
  if (missingNumbers.length) return `模型生成了来源中不存在的数字：${[...new Set(missingNumbers)].join(', ')}`;
  const corpusEntities = new Set(latinEntities(corpus).map((item) => item.toLowerCase()));
  const allowedEntities = new Set<string>(['AI']);
  const unknownEntities = latinEntities(generated).filter((item) => !corpusEntities.has(item.toLowerCase()) && !allowedEntities.has(item));
  if (unknownEntities.length) return `模型生成了来源中不存在的英文实体：${[...new Set(unknownEntities)].join(', ')}`;
  return undefined;
}

export async function enrichWithLlm(sources: SourceRecord[], llmConfig = config.llm): Promise<EnrichmentResult> {
  if (!llmConfig.apiKey || !llmConfig.model) return fallback(sources, '未配置 LLM，已使用规则摘要');
  const evidence = sources.map((item, index) => ({
    ref: `E${index + 1}`, source: item.sourceName, title: item.title,
    content: item.content.slice(0, 3500), url: item.url, publishedAt: item.publishedAt,
  }));
  const system = `你是中文 AI 新闻编辑。只能使用提供的证据，不得增加任何新事实。若原文为英文，必须翻译并提炼为自然、简洁的中文；公司、人名、产品、模型、项目和 API 等专有名词保留原文。titleZh 使用中文新闻标题，建议 16～35 个汉字；summaryZh 使用 80～150 字中文提炼重点，不是逐字直译。输出 JSON，字段必须为 titleZh、summaryZh、category、keyFacts、sourceRefs、confidence、riskFlags。category 只能是 AI 产品与模型、智能体与安全、芯片与算力、研究与开源、行业动态之一。数字、日期、专有名词必须与证据一致。`;
  try {
    const response = await fetch(`${llmConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {'content-type': 'application/json', authorization: `Bearer ${llmConfig.apiKey}`},
      body: JSON.stringify({
        model: llmConfig.model, temperature: 0.2,
        response_format: {type: 'json_object'},
        messages: [{role: 'system', content: system}, {role: 'user', content: JSON.stringify({evidence})}],
      }),
      signal: AbortSignal.timeout(llmConfig.timeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as any;
    const content = payload.choices?.[0]?.message?.content;
    const story = llmStorySchema.parse(JSON.parse(content));
    const groundingError = validateGrounding(story, sources);
    return groundingError ? fallback(sources, groundingError) : {story, method: 'llm'};
  } catch (error) {
    return fallback(sources, `LLM 失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

