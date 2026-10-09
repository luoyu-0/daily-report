import 'dotenv/config';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {brandConfigSchema} from './shared/types.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const resolveFromRoot = (value: string | undefined, fallback: string) =>
  path.resolve(rootDir, value || fallback);

export const config = {
  rootDir,
  appPort: Number(process.env.APP_PORT ?? 4173),
  reviewPort: Number(process.env.REVIEW_PORT ?? 5173),
  dataDir: resolveFromRoot(process.env.DATA_DIR, 'data'),
  outputDir: resolveFromRoot(process.env.OUTPUT_DIR, 'output'),
  publicDir: path.join(rootDir, 'public'),
  databasePath: path.join(resolveFromRoot(process.env.DATA_DIR, 'data'), 'daily-report.db'),
  llm: {
    baseUrl: (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || '',
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 30_000),
  },
  brand: brandConfigSchema.parse({
    name: 'AI 智讯日报',
    tagline: '筛选当日重要 AI 进展',
    background: '#F4F8FF',
    primary: '#2563EB',
    ink: '#0F172A',
    paleBlue: '#DBEAFE',
    accent: '#38BDF8',
  }),
};

