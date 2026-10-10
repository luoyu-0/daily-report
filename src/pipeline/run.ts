import {createEdition, getEdition, logEvent, newId, upsertCandidate} from '../db.js';
import type {DiscoveryEdition, ToolCandidate} from '../shared/types.js';
import {collectGithubTrending, collectRepositoryProfiles, type RepositoryProfile} from './collectors.js';
import {enrichToolWithRules} from './llm.js';
import {assessTool, stableSourceId} from './rules.js';

export type DailyRunResult = {edition: DiscoveryEdition; warnings: string[]};
export type DailyProgress = {completed: number; total: number; repo?: string; method?: 'llm' | 'rule'};

export async function mapWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({length: Math.min(Math.max(1, concurrency), items.length)}, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

export function chooseSuggestedTools(profiles: RepositoryProfile[], limit = 4): Set<string> {
  return new Set(profiles
    .map((profile) => ({repo: profile.repo, ...assessTool(profile)}))
    .filter((item) => item.toolLikely)
    .sort((a, b) => b.utilityScore - a.utilityScore)
    .slice(0, limit)
    .map((item) => item.repo));
}

export async function buildCandidates(date: string, providedProfiles?: RepositoryProfile[], onProgress?: (progress: DailyProgress) => void): Promise<DailyRunResult> {
  let warnings: string[] = [];
  let profiles = providedProfiles;
  if (!profiles) {
    const trending = await collectGithubTrending(date);
    const detailed = await collectRepositoryProfiles(trending.entries);
    profiles = detailed.profiles;
    warnings = [...trending.warnings, ...detailed.warnings];
  }
  if (profiles.length < 5) throw new Error(`全球 GitHub Today 榜仅获得 ${profiles.length} 条，至少需要 5 条`);

  const edition = createEdition(date);
  const suggested = chooseSuggestedTools(profiles);
  logEvent(edition.id, 'collection', `采集全球 GitHub Today 榜 ${profiles.length} 条，建议精选 ${suggested.size} 个工具`, {warnings});
  onProgress?.({completed: 0, total: profiles.length});

  for (const [index, profile] of profiles.entries()) {
    const assessment = assessTool(profile);
    const enriched = enrichToolWithRules(profile);
    const content = [profile.description, profile.readme.slice(0, 10_000)].filter(Boolean).join('\n\n');
    const source = {
      id: stableSourceId(profile.url), sourceName: 'GitHub', title: profile.repo, url: profile.url,
      content: content || profile.repo, fetchedAt: profile.fetchedAt, primarySource: profile.primarySource,
    };
    const candidate: ToolCandidate = {
      id: newId('tool'), editionId: edition.id, repo: profile.repo, url: profile.url,
      rank: profile.rank, starsToday: profile.starsToday, totalStars: profile.totalStars, forks: profile.forks,
      language: profile.language, topics: profile.topics, license: profile.license, homepage: profile.homepage,
      archived: profile.archived, repoUpdatedAt: profile.repoUpdatedAt,
      toolType: enriched.tool.toolType, oneLinePitchZh: enriched.tool.oneLinePitchZh,
      useCases: enriched.tool.useCases, targetUsers: enriched.tool.targetUsers, quickStart: enriched.tool.quickStart,
      prerequisites: enriched.tool.prerequisites, caveats: enriched.tool.caveats,
      utilityScore: assessment.utilityScore, toolLikely: assessment.toolLikely, excludeReason: assessment.excludeReason,
      selected: suggested.has(profile.repo), confirmed: false, position: index,
      sources: [source], evidence: [`E1: ${profile.repo} — ${(content || profile.repo).slice(0, 800)}`],
      riskFlags: assessment.riskFlags, generationMethod: 'rule',
    };
    upsertCandidate(candidate);
    logEvent(edition.id, 'enrichment', `${profile.repo} 完成规则识别`, {candidateId: candidate.id, toolLikely: candidate.toolLikely, utilityScore: candidate.utilityScore});
    onProgress?.({completed: index + 1, total: profiles.length, repo: profile.repo, method: 'rule'});
  }
  return {edition: getEdition(edition.id)! as DiscoveryEdition, warnings};
}
