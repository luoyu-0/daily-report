import {createEdition, getEdition, getToolHistory, logEvent, newId, upsertCandidate} from '../db.js';
import {config} from '../config.js';
import type {DiscoveryEdition, ToolCandidate} from '../shared/types.js';
import {collectGithubTrending, collectRepositoryProfiles, type RepositoryProfile, type TrendingRepository} from './collectors.js';
import {enrichToolWithRules} from './llm.js';
import {assessTool, stableSourceId} from './rules.js';

export type DailyRunResult = {edition: DiscoveryEdition; warnings: string[]; skippedHistorical: number; reusedToday: number};
export type DailyProgress = {phase: 'trending' | 'profiles' | 'rules'; completed: number; total: number; repo?: string; method?: 'llm' | 'rule'};

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
  const history = getToolHistory(date);
  const warnings: string[] = [];
  let entries: TrendingRepository[];
  let skippedByCollector = 0;
  if (providedProfiles) {
    entries = providedProfiles;
  } else {
    onProgress?.({phase: 'trending', completed: 0, total: 1});
    const trending = await collectGithubTrending(date, history.previousRepos, config.github.candidateLimit);
    onProgress?.({phase: 'trending', completed: 1, total: 1});
    entries = trending.entries;
    skippedByCollector = trending.skippedLocked;
    warnings.push(...trending.warnings);
  }
  const eligible = entries.filter((entry) => !history.previousRepos.has(entry.repo.toLowerCase()));
  const skippedHistorical = skippedByCollector + entries.length - eligible.length;
  const limited = eligible.slice(0, config.github.candidateLimit);
  const freshEntries = limited.filter((entry) => !history.todayCandidates.has(entry.repo.toLowerCase()));
  onProgress?.({phase: 'profiles', completed: 0, total: freshEntries.length});
  const detailed = providedProfiles
    ? {profiles: freshEntries as RepositoryProfile[], warnings: [] as string[]}
    : await collectRepositoryProfiles(freshEntries, (completed, total) => onProgress?.({phase: 'profiles', completed, total}));
  warnings.push(...detailed.warnings);
  if (limited.length < config.github.candidateLimit) warnings.push(`Today 榜仅找到 ${limited.length} 个未被往期成片锁定的仓库，未达到目标 ${config.github.candidateLimit} 个`);
  if (limited.length < 3) warnings.push(`今日仅有 ${limited.length} 个未收录的新仓库，少于批准成片所需的 3 个`);
  const profiles = new Map(detailed.profiles.map((profile) => [profile.repo.toLowerCase(), profile]));
  const reusedToday = limited.length - freshEntries.length;

  const edition = createEdition(date);
  const selectedCached = limited.filter((entry) => history.todayCandidates.get(entry.repo.toLowerCase())?.selected).length;
  const suggested = chooseSuggestedTools(detailed.profiles, Math.max(0, 4 - selectedCached));
  logEvent(edition.id, 'collection', `今日可选仓库 ${limited.length} 条，往期成片锁定跳过 ${skippedHistorical} 条，同日复用 ${reusedToday} 条`, {warnings});
  onProgress?.({phase: 'rules', completed: 0, total: limited.length});

  for (const [index, entry] of limited.entries()) {
    const cached = history.todayCandidates.get(entry.repo.toLowerCase());
    if (cached) {
      upsertCandidate({...cached, id: newId('tool'), editionId: edition.id, repo: entry.repo,
        rank: entry.rank, rankingSource: entry.rankingSource, starsToday: entry.starsToday ?? cached.starsToday, position: index, confirmed: false});
      logEvent(edition.id, 'cache', `复用同日仓库：${entry.repo}`, {sourceEditionId: cached.editionId, method: cached.generationMethod});
      onProgress?.({phase: 'rules', completed: index + 1, total: limited.length, repo: entry.repo, method: cached.generationMethod});
      continue;
    }
    const profile = profiles.get(entry.repo.toLowerCase());
    if (!profile) throw new Error(`仓库详情缺失：${entry.repo}`);
    const assessment = assessTool(profile);
    const enriched = enrichToolWithRules(profile);
    const content = [`项目描述：${profile.description || '未提供'}`, `README：\n${profile.readme.slice(0, 20_000)}`].join('\n\n');
    const source = {
      id: stableSourceId(profile.url), sourceName: 'GitHub', title: profile.repo, url: profile.url,
      content: content || profile.repo, fetchedAt: profile.fetchedAt, primarySource: profile.primarySource,
    };
    const candidate: ToolCandidate = {
      id: newId('tool'), editionId: edition.id, repo: profile.repo, url: profile.url,
      rank: profile.rank, rankingSource: profile.rankingSource, starsToday: profile.starsToday, totalStars: profile.totalStars, forks: profile.forks,
      language: profile.language, languages: profile.languages, topics: profile.topics, license: profile.license, homepage: profile.homepage,
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
    onProgress?.({phase: 'rules', completed: index + 1, total: limited.length, repo: profile.repo, method: 'rule'});
  }
  return {edition: getEdition(edition.id)! as DiscoveryEdition, warnings, skippedHistorical, reusedToday};
}
