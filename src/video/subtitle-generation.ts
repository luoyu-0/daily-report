import crypto from 'node:crypto';
import {z} from 'zod';
import {config} from '../config.js';
import {getSubtitleGenerationCache, saveSubtitleGenerationCache} from '../db.js';
import {buildToolEvidence} from '../pipeline/llm.js';
import {numericTokens} from '../pipeline/rules.js';
import {subtitleCueSchema, type DiscoveryEdition, type SubtitleCue} from '../shared/types.js';
import {buildTimeline, VIDEO_FPS} from './timeline.js';

type LlmSettings = Pick<typeof config.llm, 'baseUrl' | 'apiKey' | 'model' | 'timeoutMs'>;
type SubtitleCache = {get: (key: string) => SubtitleCue[] | undefined; set: (key: string, cues: SubtitleCue[]) => void};
const defaultCache: SubtitleCache = {get: getSubtitleGenerationCache, set: saveSubtitleGenerationCache};
const promptVersion = 'video-subtitle-v3';
const captionResponseSchema = z.object({toolCaptions: z.array(z.array(z.string().trim().min(1).max(40)).min(1).max(4))}).strict();
const structuredFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'video_subtitles', strict: true,
    schema: {
      type: 'object',
      properties: {toolCaptions: {type: 'array', items: {type: 'array', items: {type: 'string'}}}},
      required: ['toolCaptions'], additionalProperties: false,
    },
  },
} as const;

const normalized = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const displayWidth = (value: string) => [...value].reduce((width, char) => width + (/^[\x00-\x7f]$/.test(char) ? 1 : 2), 0);

export function buildSubtitleEvidence(edition: DiscoveryEdition) {
  const selected = edition.candidates.filter((item) => item.selected).sort((a, b) => a.position - b.position);
  return selected.map((tool) => ({
    repo: tool.repo,
    visible: {
      toolType: tool.toolType, pitch: tool.oneLinePitchZh.slice(0, 160),
      useCases: tool.useCases.slice(0, 2), targetUsers: tool.targetUsers.slice(0, 2),
    },
    readme: buildToolEvidence(tool, 700),
  }));
}

export async function generateSubtitleDraft(edition: DiscoveryEdition, settings: LlmSettings = config.llm, cache: SubtitleCache = defaultCache) {
  if (!settings.apiKey || !settings.model) throw new Error('尚未配置 LLM API key 或模型');
  const evidence = buildSubtitleEvidence(edition);
  const input = JSON.stringify({tools: evidence});
  const cacheKey = crypto.createHash('sha256').update(JSON.stringify({promptVersion, model: settings.model, input})).digest('hex');
  const cached = cache.get(cacheKey);
  if (cached) return {subtitles: cached, cacheHit: true, inputChars: 0};
  let format: typeof structuredFormat | {type: 'json_object'} = structuredFormat;
  let maxTokens = Math.min(3200, Math.max(600, evidence.length * 160));
  let retriedIncomplete = false;
  let parsed: z.infer<typeof captionResponseSchema> | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {'content-type': 'application/json', authorization: `Bearer ${settings.apiKey}`},
      body: JSON.stringify({
        model: settings.model, temperature: 0.2, max_tokens: maxTokens, response_format: format,
        messages: [
          {role: 'system', content: '你是无配音 GitHub 工具视频的补充字幕编辑。视频画面已显示每个仓库的 visible 信息，不要照抄或复述画面。逐仓库从 readme 中优先提炼画面未呈现、具体且有依据的功能或用途；README 信息不足时，才从 visible 写一句不照抄的观看提示。不得发明功能、数字、专有名词或使用体验，不要安装命令和空泛赞美。每仓通常 1～2 条，确有必要可 3～4 条；每条最多 10 个汉字的显示宽度（英文按半宽计），语义完整，不要生硬断词，避免仓库名。片头、榜单和片尾不生成字幕。只返回 JSON 对象，字段 toolCaptions 是与 tools 顺序一致的二维字符串数组，每仓至少 1 条、最多 4 条。'},
          {role: 'user', content: input},
        ],
      }),
      signal: AbortSignal.timeout(settings.timeoutMs),
    });
    if (!response.ok) {
      if ((response.status === 400 || response.status === 422) && format === structuredFormat) {
        const detail = (await response.text()).slice(0, 500);
        if (/json_schema|response_format|unsupported|not supported|不支持/i.test(detail)) {
          format = {type: 'json_object'};
          continue;
        }
      }
      throw new Error(`字幕 LLM 请求失败：HTTP ${response.status}`);
    }
    let payload: {choices?: Array<{finish_reason?: string; message?: {content?: string; refusal?: string}}>} | undefined;
    try { payload = await response.json(); } catch { /* 空响应或不完整响应统一按截断处理 */ }
    const choice = payload?.choices?.[0];
    if (choice?.message?.refusal) throw new Error('字幕 LLM 拒绝生成，请检查已审核文案');
    const content = choice?.message?.content;
    if (choice?.finish_reason === 'length' || !content) {
      if (retriedIncomplete) throw new Error('字幕 LLM 输出被截断或为空，请缩短文案后重试');
      retriedIncomplete = true;
      maxTokens = Math.min(4000, maxTokens * 2);
      continue;
    }
    let raw: unknown;
    try { raw = JSON.parse(content); } catch {
      if (retriedIncomplete) throw new Error('字幕 LLM 未返回完整 JSON，请重试');
      retriedIncomplete = true;
      maxTokens = Math.min(4000, maxTokens * 2);
      continue;
    }
    const result = captionResponseSchema.safeParse(raw);
    if (!result.success) throw new Error('字幕 LLM 返回结构不符合要求：需要每个仓库 1～4 条短字幕');
    parsed = result.data;
    break;
  }
  if (!parsed) throw new Error('字幕 LLM 未返回有效的字幕数据，请检查模型是否支持结构化输出');
  if (parsed.toolCaptions.length !== evidence.length) throw new Error('字幕 LLM 返回的仓库数量不匹配');
  const captions = parsed.toolCaptions.flat();
  const tooLong = captions.find((caption) => displayWidth(caption) > 20);
  if (tooLong) throw new Error(`字幕过长，请将每条限制在约 10 个汉字：${tooLong}`);
  const repeated = parsed.toolCaptions.flatMap((toolCaptions, index) => toolCaptions.filter((caption) => {
    const plain = normalized(caption);
    return plain.length >= 4 && Object.values(evidence[index].visible).flat().some((visible) => normalized(visible).includes(plain));
  }));
  if (repeated.length) throw new Error(`字幕重复画面已有文字：${repeated[0]}`);
  const factCorpus = evidence.map((tool) => `${tool.repo} ${Object.values(tool.visible).flat().join(' ')} ${tool.readme}`).join(' ');
  const allowedNumbers = new Set(numericTokens(factCorpus));
  const inventedNumbers = numericTokens(captions.join(' ')).filter((token) => !allowedNumbers.has(token));
  if (inventedNumbers.length) throw new Error(`字幕包含审核文案中不存在的数字：${[...new Set(inventedNumbers)].join('、')}`);
  const toolSegments = buildTimeline(edition).filter((segment) => segment.type === 'tool');
  const durations = [0, 2600, 2300, 1900, 1550];
  const gapMs = 350;
  const subtitles = subtitleCueSchema.array().parse(parsed.toolCaptions.flatMap((toolCaptions, index) => {
    const segment = toolSegments[index];
    const count = toolCaptions.length;
    const cueMs = durations[count];
    const segmentStartMs = Math.round(segment.from * 1000 / VIDEO_FPS);
    const segmentMs = Math.round(segment.durationInFrames * 1000 / VIDEO_FPS);
    const firstOffsetMs = Math.floor((segmentMs - cueMs * count - gapMs * (count - 1)) / 2);
    return toolCaptions.map((text, cueIndex) => {
      const startMs = segmentStartMs + firstOffsetMs + cueIndex * (cueMs + gapMs);
      return {startMs, endMs: startMs + cueMs, text};
    });
  }));
  cache.set(cacheKey, subtitles);
  return {subtitles, cacheHit: false, inputChars: input.length};
}
