import {newId, createEdition, logEvent, upsertCandidate} from '../db.js';
import type {CandidateStory, Edition, SourceRecord} from '../shared/types.js';
import {collectAll} from './collectors.js';
import {deduplicate, scoreGroup} from './rules.js';
import {enrichWithLlm} from './llm.js';
import {config} from '../config.js';

export type DailyRunResult = {edition: Edition; warnings: string[]};
export type DailyProgress = {completed: number; total: number; title?: string; method?: 'llm' | 'rule'};

export async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({length: Math.min(Math.max(1, concurrency), items.length)}, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

export function partitionCandidateSources(records: SourceRecord[]) {
  const githubRecords = records.filter((item) => item.sourceName === 'GitHub Trending').slice(0, 5);
  const industryGroups = deduplicate(records.filter((item) => item.sourceName !== 'GitHub Trending'))
    .map((sources) => ({sources, score: scoreGroup(sources)}))
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);
  return {githubRecords, industryGroups};
}

export async function buildCandidates(
  date: string,
  records?: SourceRecord[],
  onProgress?: (progress: DailyProgress) => void,
): Promise<DailyRunResult> {
  const collected = records ? {records, warnings: []} : await collectAll(36, date);
  const {githubRecords, industryGroups} = partitionCandidateSources(collected.records);
  if (!githubRecords.length && !industryGroups.length) throw new Error('未采集到可用资讯，请检查网络和来源配置。');
  const edition = createEdition(date);
  const warnings = [...collected.warnings];
  logEvent(edition.id, 'collection', `采集 ${collected.records.length} 条原始记录：GitHub ${githubRecords.length} 条，行业候选 ${industryGroups.length} 组`, {warnings: collected.warnings});
  const groups = [
    ...githubRecords.map((source, index) => ({sources: [source], score: Math.max(70, 95 - index * 3), section: 'github' as const, position: index})),
    ...industryGroups.map((group, index) => ({...group, section: 'industry' as const, position: index})),
  ];
  let completed = 0;
  onProgress?.({completed, total: groups.length});
  await mapWithConcurrency(groups, config.llm.concurrency, async (group) => {
    const enriched = await enrichWithLlm(group.sources);
    if (enriched.warning) warnings.push(`${group.sources[0].title}：${enriched.warning}`);
    const isGithub = group.section === 'github';
    const story: CandidateStory = {
      id: newId('story'), editionId: edition.id,
      titleOriginal: group.sources[0].title,
      titleZh: isGithub ? group.sources[0].title : enriched.story.titleZh,
      summaryZh: enriched.story.summaryZh,
      category: enriched.story.category,
      section: group.section,
      score: group.score,
      selected: isGithub || group.position < 4,
      confirmed: isGithub,
      position: group.position,
      sources: group.sources,
      evidence: group.sources.map((source, sourceIndex) => `E${sourceIndex + 1}: ${source.title} — ${source.content.slice(0, 500)}`),
      publishedAt: group.sources[0].publishedAt,
      keyFacts: enriched.story.keyFacts,
      riskFlags: enriched.story.riskFlags,
      generationMethod: enriched.method,
    };
    upsertCandidate(story);
    logEvent(edition.id, 'enrichment', `${story.titleOriginal} 使用 ${enriched.method === 'llm' ? 'LLM + 规则' : '规则'} 生成`, {storyId: story.id, warning: enriched.warning});
    completed += 1;
    onProgress?.({completed, total: groups.length, title: story.titleOriginal, method: enriched.method});
  });
  return {edition: (await import('../db.js')).getEdition(edition.id)!, warnings};
}

