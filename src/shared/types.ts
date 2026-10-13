import {z} from 'zod';

export const categorySchema = z.enum(['AI 产品与模型', '智能体与安全', '芯片与算力', '研究与开源', '行业动态']);
export type StoryCategory = z.infer<typeof categorySchema>;

export const sourceRecordSchema = z.object({
  id: z.string(), sourceName: z.string(), title: z.string(), url: z.string().url(), content: z.string(),
  author: z.string().optional(), publishedAt: z.string().datetime().optional(), fetchedAt: z.string().datetime(),
  primarySource: z.boolean().default(true),
});
export type SourceRecord = z.infer<typeof sourceRecordSchema>;

export const legacyCandidateStorySchema = z.object({
  id: z.string(), editionId: z.string(), titleOriginal: z.string(), titleZh: z.string(), summaryZh: z.string(),
  category: categorySchema, section: z.enum(['github', 'industry']).default('industry'), score: z.number().min(0).max(100),
  selected: z.boolean(), confirmed: z.boolean(), position: z.number().int().nonnegative(),
  sources: z.array(sourceRecordSchema).min(1), evidence: z.array(z.string()).min(1), publishedAt: z.string().datetime().optional(),
  keyFacts: z.array(z.string()), riskFlags: z.array(z.string()), generationMethod: z.enum(['llm', 'rule']),
  narrationAudio: z.string().optional(), audioDurationMs: z.number().positive().optional(),
});
export type CandidateStory = z.infer<typeof legacyCandidateStorySchema>;

export const toolTypeSchema = z.enum(['CLI', '桌面应用', 'Web 工具', '开发工具', '自动化', 'Agent', '框架与库', '其他']);
export type ToolType = z.infer<typeof toolTypeSchema>;

export const toolCandidateSchema = z.object({
  id: z.string(), editionId: z.string(), repo: z.string(), url: z.string().url(),
  rank: z.number().int().positive(), rankingSource: z.string().optional(), starsToday: z.number().int().nonnegative().optional(),
  totalStars: z.number().int().nonnegative().optional(), forks: z.number().int().nonnegative().optional(),
  language: z.string().optional(), languages: z.array(z.object({name: z.string(), bytes: z.number().nonnegative()})).optional(),
  topics: z.array(z.string()), license: z.string().optional(), homepage: z.string().url().optional(),
  latestRelease: z.string().optional(), archived: z.boolean().default(false), repoUpdatedAt: z.string().datetime().optional(),
  toolType: toolTypeSchema, oneLinePitchZh: z.string().min(1).max(160), useCases: z.array(z.string()).max(5),
  targetUsers: z.array(z.string()).max(5), quickStart: z.string().max(600).optional(), prerequisites: z.array(z.string()).max(5),
  caveats: z.array(z.string()).max(5), utilityScore: z.number().min(0).max(100), toolLikely: z.boolean(),
  excludeReason: z.string().optional(), selected: z.boolean(), confirmed: z.boolean(), position: z.number().int().nonnegative(),
  sources: z.array(sourceRecordSchema).min(1), evidence: z.array(z.string()).min(1), riskFlags: z.array(z.string()),
  generationMethod: z.enum(['llm', 'rule']), narrationAudio: z.string().optional(), audioDurationMs: z.number().positive().optional(),
});
export type ToolCandidate = z.infer<typeof toolCandidateSchema>;

export const toolEnrichmentSchema = z.object({
  oneLinePitchZh: z.string().min(4).max(160), toolType: toolTypeSchema,
  useCases: z.array(z.string().min(2)).min(1).max(5), targetUsers: z.array(z.string().min(2)).min(1).max(5),
  quickStart: z.string().max(600).optional(), prerequisites: z.array(z.string()).max(5).default([]), caveats: z.array(z.string()).max(5).default([]),
  sourceRefs: z.array(z.string().regex(/^E\d+$/)).min(1), confidence: z.number().min(0).max(1), riskFlags: z.array(z.string()).max(5),
});
export type ToolEnrichment = z.infer<typeof toolEnrichmentSchema>;

export const brandConfigSchema = z.object({
  name: z.string(), tagline: z.string(), background: z.string(), primary: z.string(), ink: z.string(), paleBlue: z.string(), accent: z.string(),
});
export type BrandConfig = z.infer<typeof brandConfigSchema>;

const editionBaseSchema = z.object({
  id: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), version: z.number().int().positive(),
  parentId: z.string().optional(), status: z.enum(['draft', 'approved', 'rendering', 'rendered', 'failed']),
  brand: brandConfigSchema, createdAt: z.string().datetime(), updatedAt: z.string().datetime(), approvedAt: z.string().datetime().optional(),
});

export const legacyEditionSchema = editionBaseSchema.extend({kind: z.literal('ai-news'), candidates: z.array(legacyCandidateStorySchema)});
export const discoveryEditionSchema = editionBaseSchema.extend({kind: z.literal('github-tools'), candidates: z.array(toolCandidateSchema)});
export const editionSchema = z.discriminatedUnion('kind', [legacyEditionSchema, discoveryEditionSchema]);
export type LegacyEdition = z.infer<typeof legacyEditionSchema>;
export type DiscoveryEdition = z.infer<typeof discoveryEditionSchema>;
export type Edition = z.infer<typeof editionSchema>;

export const renderJobSchema = z.object({
  id: z.string(), editionId: z.string(), status: z.enum(['queued', 'running', 'completed', 'failed']),
  progress: z.number().min(0).max(100), outputPath: z.string().optional(), error: z.string().optional(), logs: z.array(z.string()),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type RenderJob = z.infer<typeof renderJobSchema>;

export const videoPropsSchema = z.object({edition: discoveryEditionSchema, hasBgm: z.boolean()});
export type VideoProps = z.infer<typeof videoPropsSchema>;
