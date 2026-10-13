import type {ToolCandidate} from './types.js';

export function languageSummary(tool: Pick<ToolCandidate, 'language' | 'languages'>): string {
  const ranked = [...(tool.languages ?? [])].filter((item) => item.bytes > 0).sort((a, b) => b.bytes - a.bytes);
  if (!ranked.length) return tool.language ?? '未标注语言';
  const total = ranked.reduce((sum, item) => sum + item.bytes, 0);
  const dominant = ranked[0].bytes / total >= 0.6 && ranked[0].bytes >= (ranked[1]?.bytes ?? 0) * 2;
  return ranked.slice(0, dominant ? 1 : 3).map((item) => item.name).join(' · ');
}
