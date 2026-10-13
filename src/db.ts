import fs from 'node:fs';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import {config} from './config.js';
import {
  legacyCandidateStorySchema,
  toolCandidateSchema,
  toolEnrichmentSchema,
  editionSchema,
  type CandidateStory, type DiscoveryEdition,
  type Edition,
  type ToolCandidate,
  type ToolEnrichment,
  type RenderJob,
  renderJobSchema,
} from './shared/types.js';

fs.mkdirSync(config.dataDir, {recursive: true});
const sqlite = new Database(config.databasePath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS editions (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    version INTEGER NOT NULL,
    parent_id TEXT,
    status TEXT NOT NULL,
    brand_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    approved_at TEXT,
    kind TEXT NOT NULL DEFAULT 'ai-news',
    UNIQUE(date, version)
  );
  CREATE TABLE IF NOT EXISTS candidates (
    id TEXT PRIMARY KEY,
    edition_id TEXT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
    payload_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_candidates_edition ON candidates(edition_id);
  CREATE TABLE IF NOT EXISTS render_jobs (
    id TEXT PRIMARY KEY,
    edition_id TEXT NOT NULL REFERENCES editions(id),
    payload_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    edition_id TEXT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    payload_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_edition ON audit_events(edition_id, created_at);
  CREATE TABLE IF NOT EXISTS tool_enrichment_cache (
    cache_key TEXT PRIMARY KEY,
    repo TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS repo_lock_resets (
    date TEXT NOT NULL,
    repo TEXT NOT NULL,
    reset_at TEXT NOT NULL,
    PRIMARY KEY (date, repo)
  );
`);
const editionColumns = sqlite.prepare('PRAGMA table_info(editions)').all() as Array<{name: string}>;
if (!editionColumns.some((column) => column.name === 'kind')) {
  sqlite.exec("ALTER TABLE editions ADD COLUMN kind TEXT NOT NULL DEFAULT 'ai-news'");
}

const now = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

function hydrateEdition(row: Record<string, unknown>): Edition {
  const kind = row.kind === 'github-tools' ? 'github-tools' : 'ai-news';
  const candidates = sqlite
    .prepare('SELECT payload_json FROM candidates WHERE edition_id = ?')
    .all(row.id)
    .map((item) => {
      const raw = JSON.parse((item as {payload_json: string}).payload_json);
      if (!raw.section && raw.sources?.[0]?.sourceName === 'GitHub Trending') {
        raw.section = 'github';
        raw.selected = true;
        raw.confirmed = true;
      }
      return kind === 'github-tools' ? toolCandidateSchema.parse(raw) : legacyCandidateStorySchema.parse(raw);
    })
    .sort((a, b) => a.position - b.position);
  return editionSchema.parse({
    id: row.id,
    kind,
    date: row.date,
    version: row.version,
    parentId: row.parent_id || undefined,
    status: row.status,
    brand: JSON.parse(row.brand_json as string),
    candidates,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at || undefined,
  });
}

export function createEdition(date: string, candidates: ToolCandidate[] = []): DiscoveryEdition {
  // 旧版与新版共享 (date, version) 唯一约束，因此版本号必须跨类型递增。
  const latest = sqlite.prepare('SELECT MAX(version) AS version FROM editions WHERE date = ?').get(date) as {version?: number};
  const edition: DiscoveryEdition = {
    id: newId('edition'),
    kind: 'github-tools',
    date,
    version: (latest.version ?? 0) + 1,
    status: 'draft',
    brand: config.brand,
    candidates: [],
    createdAt: now(),
    updatedAt: now(),
  };
  const insert = sqlite.transaction(() => {
    sqlite.prepare(`INSERT INTO editions
      (id,date,version,parent_id,status,brand_json,created_at,updated_at,approved_at,kind)
      VALUES (@id,@date,@version,NULL,@status,@brand,@createdAt,@updatedAt,NULL,@kind)`)
      .run({...edition, brand: JSON.stringify(edition.brand)});
    for (const candidate of candidates) upsertCandidate({...candidate, editionId: edition.id});
  });
  insert();
  return getEdition(edition.id)! as DiscoveryEdition;
}

export function getEdition(id: string): Edition | undefined {
  const row = sqlite.prepare('SELECT * FROM editions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? hydrateEdition(row) : undefined;
}

export function getLatestEdition(): DiscoveryEdition | undefined {
  const row = sqlite.prepare("SELECT * FROM editions WHERE kind = 'github-tools' ORDER BY date DESC, version DESC LIMIT 1").get() as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const edition = hydrateEdition(row);
  return edition.kind === 'github-tools' ? edition : undefined;
}

export function getToolHistory(date: string): {previousRepos: Set<string>; todayCandidates: Map<string, ToolCandidate>} {
  const previousRows = sqlite.prepare(`SELECT DISTINCT LOWER(json_extract(c.payload_json, '$.repo')) AS repo
    FROM candidates c JOIN editions e ON e.id = c.edition_id
    WHERE e.kind = 'github-tools' AND e.date <= ? AND e.status = 'rendered'
      AND json_extract(c.payload_json, '$.selected') = 1
      AND NOT EXISTS (SELECT 1 FROM repo_lock_resets r WHERE r.date = e.date AND r.repo = LOWER(json_extract(c.payload_json, '$.repo')))`)
    .all(date) as Array<{repo: string}>;
  const todayRows = sqlite.prepare(`SELECT c.payload_json FROM candidates c JOIN editions e ON e.id = c.edition_id
    WHERE e.kind = 'github-tools' AND e.date = ? ORDER BY e.version DESC`).all(date) as Array<{payload_json: string}>;
  const todayCandidates = new Map<string, ToolCandidate>();
  for (const row of todayRows) {
    const candidate = toolCandidateSchema.parse(JSON.parse(row.payload_json));
    const key = candidate.repo.toLowerCase();
    const latest = todayCandidates.get(key);
    if (!latest || (latest.generationMethod !== 'llm' && candidate.generationMethod === 'llm' && !latest.confirmed)) {
      todayCandidates.set(key, candidate);
    }
  }
  return {previousRepos: new Set(previousRows.map((row) => row.repo)), todayCandidates};
}

export function getLockedRepos(): Array<{date: string; repo: string}> {
  return sqlite.prepare(`SELECT e.date AS date, MIN(json_extract(c.payload_json, '$.repo')) AS repo
    FROM candidates c JOIN editions e ON e.id = c.edition_id
    WHERE e.kind = 'github-tools' AND e.status = 'rendered'
      AND json_extract(c.payload_json, '$.selected') = 1
      AND NOT EXISTS (SELECT 1 FROM repo_lock_resets r WHERE r.date = e.date AND r.repo = LOWER(json_extract(c.payload_json, '$.repo')))
    GROUP BY e.date, LOWER(json_extract(c.payload_json, '$.repo'))
    ORDER BY e.date DESC, repo`).all() as Array<{date: string; repo: string}>;
}

export function getTodayLockedRepos(date: string): string[] {
  return getLockedRepos().filter((item) => item.date === date).map((item) => item.repo);
}

export function resetTodayRepoLock(date: string, repo: string): boolean {
  return deleteRepoLock(date, repo);
}

export function deleteRepoLock(date: string, repo: string): boolean {
  if (!getLockedRepos().some((item) => item.date === date && item.repo.toLowerCase() === repo.toLowerCase())) return false;
  sqlite.prepare('INSERT OR REPLACE INTO repo_lock_resets (date,repo,reset_at) VALUES (?,?,?)')
    .run(date, repo.toLowerCase(), now());
  return true;
}

export function relockRenderedRepos(edition: DiscoveryEdition): void {
  const clear = sqlite.prepare('DELETE FROM repo_lock_resets WHERE date=? AND repo=?');
  sqlite.transaction(() => {
    for (const candidate of edition.candidates.filter((item) => item.selected)) clear.run(edition.date, candidate.repo.toLowerCase());
  })();
}

export function upsertCandidate(candidate: CandidateStory | ToolCandidate): void {
  const parsed = 'repo' in candidate ? toolCandidateSchema.parse(candidate) : legacyCandidateStorySchema.parse(candidate);
  sqlite.prepare(`INSERT INTO candidates (id,edition_id,payload_json) VALUES (?,?,?)
    ON CONFLICT(id) DO UPDATE SET edition_id=excluded.edition_id,payload_json=excluded.payload_json`)
    .run(parsed.id, parsed.editionId, JSON.stringify(parsed));
  sqlite.prepare('UPDATE editions SET updated_at = ? WHERE id = ?').run(now(), parsed.editionId);
}

export function updateEditionStatus(id: string, status: Edition['status']): Edition {
  const approvedAt = status === 'approved' ? now() : undefined;
  sqlite.prepare('UPDATE editions SET status=?,updated_at=?,approved_at=COALESCE(?,approved_at) WHERE id=?')
    .run(status, now(), approvedAt ?? null, id);
  return getEdition(id)!;
}

export function forkEdition(sourceId: string): DiscoveryEdition {
  const source = getEdition(sourceId);
  if (!source) throw new Error('日报不存在');
  if (source.kind !== 'github-tools') throw new Error('旧版资讯日报不支持继续编辑');
  const fork = createEdition(source.date);
  sqlite.prepare('UPDATE editions SET parent_id=? WHERE id=?').run(source.id, fork.id);
  for (const item of source.candidates) {
    upsertCandidate({...item, id: newId('tool'), editionId: fork.id, confirmed: false});
  }
  return getEdition(fork.id)! as DiscoveryEdition;
}

export function saveRenderJob(job: RenderJob): void {
  const parsed = renderJobSchema.parse(job);
  sqlite.prepare(`INSERT INTO render_jobs (id,edition_id,payload_json) VALUES (?,?,?)
    ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json`)
    .run(parsed.id, parsed.editionId, JSON.stringify(parsed));
}

export function getRenderJob(id: string): RenderJob | undefined {
  const row = sqlite.prepare('SELECT payload_json FROM render_jobs WHERE id=?').get(id) as {payload_json: string} | undefined;
  return row ? renderJobSchema.parse(JSON.parse(row.payload_json)) : undefined;
}

export function getToolEnrichmentCache(cacheKey: string): ToolEnrichment | undefined {
  const row = sqlite.prepare('SELECT payload_json FROM tool_enrichment_cache WHERE cache_key=?').get(cacheKey) as {payload_json: string} | undefined;
  if (!row) return undefined;
  try { return toolEnrichmentSchema.parse(JSON.parse(row.payload_json)); } catch { return undefined; }
}

export function saveToolEnrichmentCache(cacheKey: string, repo: string, payload: ToolEnrichment): void {
  sqlite.prepare(`INSERT INTO tool_enrichment_cache (cache_key,repo,payload_json,created_at) VALUES (?,?,?,?)
    ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json,created_at=excluded.created_at`)
    .run(cacheKey, repo, JSON.stringify(toolEnrichmentSchema.parse(payload)), now());
}

export function createRenderJob(editionId: string): RenderJob {
  const timestamp = now();
  const job: RenderJob = {
    id: newId('render'), editionId, status: 'queued', progress: 0, logs: [], createdAt: timestamp, updatedAt: timestamp,
  };
  saveRenderJob(job);
  return job;
}

export function logEvent(editionId: string, type: string, message: string, payload?: unknown): void {
  sqlite.prepare('INSERT INTO audit_events (id,edition_id,type,message,payload_json,created_at) VALUES (?,?,?,?,?,?)')
    .run(newId('event'), editionId, type, message, payload === undefined ? null : JSON.stringify(payload), now());
}

export function getEditionEvents(editionId: string) {
  return sqlite.prepare('SELECT id,type,message,payload_json,created_at FROM audit_events WHERE edition_id=? ORDER BY created_at ASC').all(editionId)
    .map((row: any) => ({id: row.id, type: row.type, message: row.message, payload: row.payload_json ? JSON.parse(row.payload_json) : undefined, createdAt: row.created_at}));
}

export {newId, sqlite};

