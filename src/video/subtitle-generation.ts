import crypto from 'node:crypto';
import {z} from 'zod';
import {config} from '../config.js';
import {getSubtitleGenerationCache, saveSubtitleGenerationCache} from '../db.js';
import {numericTokens} from '../pipeline/rules.js';
import {subtitleCueSchema, type DiscoveryEdition, type SubtitleCue} from '../shared/types.js';
import {buildTimeline, VIDEO_FPS} from './timeline.js';

type LlmSettings = Pick<typeof config.llm, 'baseUrl' | 'apiKey' | 'model' | 'timeoutMs'>;
type SubtitleCache = {get: (key: string) => SubtitleCue[] | undefined; set: (key: string, cues: SubtitleCue[]) => void};
const defaultCache: SubtitleCache = {get: getSubtitleGenerationCache, set: saveSubtitleGenerationCache};
const promptVersion = 'video-subtitle-v1';

export function buildSubtitleEvidence(edition: DiscoveryEdition) {
  const selected = edition.candidates.filter((item) => item.selected).sort((a, b) => a.position - b.position);
  const segments = buildTimeline(edition);
  return segments.map((segment, index) => {
    const tool = segment.type === 'tool' ? selected[segment.toolIndex!] : undefined;
    return {
      index, type: segment.type, durationSeconds: segment.durationInFrames / VIDEO_FPS,
      ...(tool ? {repo: tool.repo, toolType: tool.toolType, pitch: tool.oneLinePitchZh.slice(0, 160), useCases: tool.useCases.slice(0, 2)} : {}),
    };
  });
}

export async function generateSubtitleDraft(edition: DiscoveryEdition, settings: LlmSettings = config.llm, cache: SubtitleCache = defaultCache) {
  if (!settings.apiKey || !settings.model) throw new Error('尚未配置 LLM API key 或模型');
  const evidence = buildSubtitleEvidence(edition);
  const input = JSON.stringify({selectedCount: edition.candidates.filter((item) => item.selected).length, segments: evidence});
  const cacheKey = crypto.createHash('sha256').update(JSON.stringify({promptVersion, model: settings.model, input})).digest('hex');
  const cached = cache.get(cacheKey);
  if (cached) return {subtitles: cached, cacheHit: true, inputChars: 0};
  const response = await fetch(`${settings.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {'content-type': 'application/json', authorization: `Bearer ${settings.apiKey}`},
    body: JSON.stringify({
      model: settings.model, temperature: 0.2, max_tokens: Math.min(700, Math.max(180, evidence.length * 55)), response_format: {type: 'json_object'},
      messages: [
        {role: 'system', content: '你是 GitHub 工具视频的字幕编辑。只根据给定的已审核文案，为每个片段写一条简短中文重点字幕；专有名词保持原文。不得发明功能、数字或实际使用体验，不要输出安装命令。只返回 JSON 对象，字段 captions 是与输入 segments 顺序一致的字符串数组，每条不超过 80 字。'},
        {role: 'user', content: input},
      ],
    }),
    signal: AbortSignal.timeout(settings.timeoutMs),
  });
  if (!response.ok) throw new Error(`字幕 LLM 请求失败：HTTP ${response.status}`);
  const payload = await response.json() as {choices?: Array<{message?: {content?: string}}>};
  const parsed = z.object({captions: z.array(z.string().trim().min(1).max(80))}).parse(JSON.parse(payload.choices?.[0]?.message?.content ?? ''));
  if (parsed.captions.length !== evidence.length) throw new Error('字幕 LLM 返回的片段数量不匹配');
  const factCorpus = `${edition.candidates.filter((item) => item.selected).map((item) => `${item.repo} ${item.oneLinePitchZh} ${item.useCases.join(' ')}`).join(' ')} ${edition.candidates.filter((item) => item.selected).length}`;
  const allowedNumbers = new Set(numericTokens(factCorpus));
  const inventedNumbers = numericTokens(parsed.captions.join(' ')).filter((token) => !allowedNumbers.has(token));
  if (inventedNumbers.length) throw new Error(`字幕包含审核文案中不存在的数字：${[...new Set(inventedNumbers)].join('、')}`);
  const timeline = buildTimeline(edition);
  const subtitles = subtitleCueSchema.array().parse(parsed.captions.map((text, index) => {
    const segment = timeline[index];
    return {
      startMs: Math.round((segment.from + 9) * 1000 / VIDEO_FPS),
      endMs: Math.round((segment.from + segment.durationInFrames - 9) * 1000 / VIDEO_FPS),
      text,
    };
  }));
  cache.set(cacheKey, subtitles);
  return {subtitles, cacheHit: false, inputChars: input.length};
}
