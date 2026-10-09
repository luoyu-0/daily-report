import {newId, createEdition, logEvent, upsertCandidate} from '../db.js';
import type {CandidateStory, Edition, SourceRecord} from '../shared/types.js';
import {collectAll} from './collectors.js';
import {deduplicate, scoreGroup} from './rules.js';
import {enrichWithLlm} from './llm.js';

export type DailyRunResult = {edition: Edition; warnings: string[]};

export async function buildCandidates(date: string, records?: SourceRecord[]): Promise<DailyRunResult> {
  const collected = records ? {records, warnings: []} : await collectAll(36);
  const groups = deduplicate(collected.records)
    .map((sources) => ({sources, score: scoreGroup(sources)}))
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);
  if (!groups.length) throw new Error('未采集到可用资讯，请检查网络和来源配置。');
  const edition = createEdition(date);
  const warnings = [...collected.warnings];
  logEvent(edition.id, 'collection', `采集 ${collected.records.length} 条原始记录，归并为 ${groups.length} 组候选`, {warnings: collected.warnings});
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    const enriched = await enrichWithLlm(group.sources);
    if (enriched.warning) warnings.push(`${group.sources[0].title}：${enriched.warning}`);
    const story: CandidateStory = {
      id: newId('story'), editionId: edition.id,
      titleOriginal: group.sources[0].title,
      titleZh: enriched.story.titleZh,
      summaryZh: enriched.story.summaryZh,
      category: enriched.story.category,
      score: group.score,
      selected: index < 6,
      confirmed: false,
      position: index,
      sources: group.sources,
      evidence: group.sources.map((source, sourceIndex) => `E${sourceIndex + 1}: ${source.title} — ${source.content.slice(0, 500)}`),
      publishedAt: group.sources[0].publishedAt,
      keyFacts: enriched.story.keyFacts,
      riskFlags: enriched.story.riskFlags,
      generationMethod: enriched.method,
    };
    upsertCandidate(story);
    logEvent(edition.id, 'enrichment', `${story.titleOriginal} 使用 ${enriched.method === 'llm' ? 'LLM + 规则' : '规则'} 生成`, {storyId: story.id, warning: enriched.warning});
  }
  return {edition: (await import('../db.js')).getEdition(edition.id)!, warnings};
}

