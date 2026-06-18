import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type RunStatus =
  | 'started'
  | 'install_failed'
  | 'claude_failed'
  | 'push_failed'
  | 'safety_aborted'
  | 'success_pushed'
  | 'no_failures'
  | 'no_changes';

export interface RunRow {
  id: string;
  triggered_at: number;
  owner: string;
  repo: string;
  number: number;
  head_sha: string | null;
  pushed_sha: string | null;
  failing_checks: string | null;
  prompt_version: string | null;
  status: RunStatus;
  abort_code: string | null;
  install_ms: number | null;
  claude_ms: number | null;
  total_ms: number | null;
  files_changed: string | null;
  error: string | null;
  stderr_tail: string | null;
}

export interface OutcomeRow {
  run_id: string;
  observed_at: number;
  ci_state: 'success' | 'failure' | 'pending' | 'unknown' | null;
  merged_at: number | null;
  reverted: number;
  notes: string | null;
}

export interface SuggestionRow {
  id: number;
  created_at: number;
  cluster_summary: string;
  failing_runs: string;
  current_prompt: string;
  proposed_prompt: string;
  shipped: number;
}

export const DEFAULT_DB_PATH = resolve(
  new URL('.', import.meta.url).pathname,
  '..',
  'data',
  'telemetry.db',
);

export function openDb(path = DEFAULT_DB_PATH): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applySchema(db);
  return db;
}

function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id              TEXT PRIMARY KEY,
      triggered_at    INTEGER NOT NULL,
      owner           TEXT NOT NULL,
      repo            TEXT NOT NULL,
      number          INTEGER NOT NULL,
      head_sha        TEXT,
      pushed_sha      TEXT,
      failing_checks  TEXT,
      prompt_version  TEXT,
      status          TEXT NOT NULL,
      abort_code      TEXT,
      install_ms      INTEGER,
      claude_ms       INTEGER,
      total_ms        INTEGER,
      files_changed   TEXT,
      error           TEXT,
      stderr_tail     TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_runs_repo_triggered_at
      ON runs(owner, repo, triggered_at DESC);

    CREATE INDEX IF NOT EXISTS idx_runs_status_version
      ON runs(status, prompt_version);

    CREATE TABLE IF NOT EXISTS outcomes (
      run_id          TEXT PRIMARY KEY REFERENCES runs(id),
      observed_at     INTEGER NOT NULL,
      ci_state        TEXT,
      merged_at       INTEGER,
      reverted        INTEGER NOT NULL DEFAULT 0,
      notes           TEXT
    );

    CREATE TABLE IF NOT EXISTS prompt_suggestions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at      INTEGER NOT NULL,
      cluster_summary TEXT NOT NULL,
      failing_runs    TEXT NOT NULL,
      current_prompt  TEXT NOT NULL,
      proposed_prompt TEXT NOT NULL,
      shipped         INTEGER NOT NULL DEFAULT 0
    );
  `);
}
