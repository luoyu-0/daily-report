import fs from 'node:fs';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import {config} from './config.js';
import {
  candidateStorySchema,
  editionSchema,
  type CandidateStory,
  type Edition,
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
`);

const now = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

function hydrateEdition(row: Record<string, unknown>): Edition {
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
      return candidateStorySchema.parse(raw);
    })
    .sort((a, b) => a.position - b.position);
  return editionSchema.parse({
    id: row.id,
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

export function createEdition(date: string, candidates: CandidateStory[] = []): Edition {
  const latest = sqlite.prepare('SELECT MAX(version) AS version FROM editions WHERE date = ?').get(date) as {version?: number};
  const edition: Edition = {
    id: newId('edition'),
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
      (id,date,version,parent_id,status,brand_json,created_at,updated_at,approved_at)
      VALUES (@id,@date,@version,NULL,@status,@brand,@createdAt,@updatedAt,NULL)`)
      .run({...edition, brand: JSON.stringify(edition.brand)});
    for (const candidate of candidates) upsertCandidate({...candidate, editionId: edition.id});
  });
  insert();
  return getEdition(edition.id)!;
}

export function getEdition(id: string): Edition | undefined {
  const row = sqlite.prepare('SELECT * FROM editions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? hydrateEdition(row) : undefined;
}

export function getLatestEdition(): Edition | undefined {
  const row = sqlite.prepare('SELECT * FROM editions ORDER BY date DESC, version DESC LIMIT 1').get() as Record<string, unknown> | undefined;
  return row ? hydrateEdition(row) : undefined;
}

export function upsertCandidate(candidate: CandidateStory): void {
  const parsed = candidateStorySchema.parse(candidate);
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

export function forkEdition(sourceId: string): Edition {
  const source = getEdition(sourceId);
  if (!source) throw new Error('日报不存在');
  const fork = createEdition(source.date);
  sqlite.prepare('UPDATE editions SET parent_id=? WHERE id=?').run(source.id, fork.id);
  for (const item of source.candidates) {
    upsertCandidate({...item, id: newId('story'), editionId: fork.id, confirmed: false});
  }
  return getEdition(fork.id)!;
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

