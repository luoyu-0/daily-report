import 'dotenv/config';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {brandConfigSchema} from './shared/types.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const resolveFromRoot = (value: string | undefined, fallback: string) =>
  path.resolve(rootDir, value || fallback);
const dataRoot = path.join(rootDir, 'data');
const dataDir = resolveFromRoot(process.env.DATA_DIR, 'data');
const dataRelative = path.relative(dataRoot, dataDir);
if (dataRelative === '..' || dataRelative.startsWith(`..${path.sep}`) || path.isAbsolute(dataRelative)) {
  throw new Error('DATA_DIR 必须位于项目的 data/ 目录内');
}

export const config = {
  rootDir,
  appPort: Number(process.env.APP_PORT ?? 4173),
  reviewPort: Number(process.env.REVIEW_PORT ?? 5173),
  dataDir,
  outputDir: resolveFromRoot(process.env.OUTPUT_DIR, 'output'),
  publicDir: path.join(rootDir, 'public'),
  databasePath: path.join(dataDir, 'daily-report.db'),
  llm: {
    baseUrl: (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || '',
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 30_000),
    concurrency: Math.max(1, Math.min(3, Number(process.env.LLM_CONCURRENCY ?? 2))),
    evidenceMaxChars: Math.max(500, Math.min(3_500, Number(process.env.LLM_EVIDENCE_MAX_CHARS ?? 1_600))),
  },
  github: {
    token: process.env.GITHUB_TOKEN || '',
    candidateLimit: Math.max(5, Math.min(25, Number(process.env.GITHUB_CANDIDATE_LIMIT ?? 15))),
    cacheHours: Math.max(1, Math.min(72, Number(process.env.GITHUB_CACHE_HOURS ?? 12))),
  },
  brand: brandConfigSchema.parse({
    name: 'GitHub 工具雷达',
    tagline: '每天从全球热榜发现值得一试的工具',
    background: '#F4F8FF',
    primary: '#2563EB',
    ink: '#0F172A',
    paleBlue: '#DBEAFE',
    accent: '#38BDF8',
  }),
};

