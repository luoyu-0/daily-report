import {z} from 'zod';

export const categorySchema = z.enum([
  'AI 产品与模型',
  '智能体与安全',
  '芯片与算力',
  '研究与开源',
  '行业动态',
]);
export type StoryCategory = z.infer<typeof categorySchema>;

export const sourceRecordSchema = z.object({
  id: z.string(),
  sourceName: z.string(),
  title: z.string(),
  url: z.string().url(),
  content: z.string(),
  author: z.string().optional(),
  publishedAt: z.string().datetime().optional(),
  fetchedAt: z.string().datetime(),
  primarySource: z.boolean().default(true),
});
export type SourceRecord = z.infer<typeof sourceRecordSchema>;

export const llmStorySchema = z.object({
  titleZh: z.string().min(4).max(80),
  summaryZh: z.string().min(20).max(500),
  category: categorySchema,
  keyFacts: z.array(z.string().min(2)).min(1).max(6),
  sourceRefs: z.array(z.string().regex(/^E\d+$/)).min(1),
  confidence: z.number().min(0).max(1),
  riskFlags: z.array(z.string()).default([]),
});
export type LlmStory = z.infer<typeof llmStorySchema>;

export const candidateStorySchema = z.object({
  id: z.string(),
  editionId: z.string(),
  titleOriginal: z.string(),
  titleZh: z.string(),
  summaryZh: z.string(),
  category: categorySchema,
  section: z.enum(['github', 'industry']).default('industry'),
  score: z.number().min(0).max(100),
  selected: z.boolean(),
  confirmed: z.boolean(),
  position: z.number().int().nonnegative(),
  sources: z.array(sourceRecordSchema).min(1),
  evidence: z.array(z.string()).min(1),
  publishedAt: z.string().datetime().optional(),
  keyFacts: z.array(z.string()),
  riskFlags: z.array(z.string()),
  generationMethod: z.enum(['llm', 'rule']),
  narrationAudio: z.string().optional(),
  audioDurationMs: z.number().positive().optional(),
});
export type CandidateStory = z.infer<typeof candidateStorySchema>;
export type ReviewedStory = CandidateStory;

export const brandConfigSchema = z.object({
  name: z.string(),
  tagline: z.string(),
  background: z.string(),
  primary: z.string(),
  ink: z.string(),
  paleBlue: z.string(),
  accent: z.string(),
});
export type BrandConfig = z.infer<typeof brandConfigSchema>;

export const editionSchema = z.object({
  id: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  version: z.number().int().positive(),
  parentId: z.string().optional(),
  status: z.enum(['draft', 'approved', 'rendering', 'rendered', 'failed']),
  brand: brandConfigSchema,
  candidates: z.array(candidateStorySchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  approvedAt: z.string().datetime().optional(),
});
export type Edition = z.infer<typeof editionSchema>;

export const renderJobSchema = z.object({
  id: z.string(),
  editionId: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  progress: z.number().min(0).max(100),
  outputPath: z.string().optional(),
  error: z.string().optional(),
  logs: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type RenderJob = z.infer<typeof renderJobSchema>;

export const videoPropsSchema = z.object({
  edition: editionSchema,
  hasBgm: z.boolean(),
});
export type VideoProps = z.infer<typeof videoPropsSchema>;

