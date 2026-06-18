import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';

/**
 * Single ingest endpoint shared by every Fix CI milestone. The review app
 * fires four event kinds — `started`, `install_done`, `claude_done`,
 * `finished` — and each call UPSERTs into `runs`, merging whatever fields
 * are present in the payload. That makes the call idempotent on
 * (runId, kind): a retried emit overwrites with the same values; subsequent
 * milestones only add new columns.
 */

type StartedPayload = {
  kind: 'started';
  owner: string;
  repo: string;
  number: number;
  head_sha?: string;
  failing_checks?: unknown;
  prompt_version?: string;
  ts: number;
};

type InstallDonePayload = {
  kind: 'install_done';
  install_ms?: number;
  install_failed?: boolean;
  install_error?: string;
  ts: number;
};

type ClaudeDonePayload = {
  kind: 'claude_done';
  claude_ms?: number;
  claude_failed?: boolean;
  claude_error?: string;
  stderr_tail?: string;
  ts: number;
};

type FinishedPayload = {
  kind: 'finished';
  status:
    | 'success_pushed'
    | 'no_changes'
    | 'no_failures'
    | 'safety_aborted'
    | 'push_failed'
    | 'claude_failed'
    | 'install_failed';
  abort_code?: string;
  pushed_sha?: string;
  files_changed?: unknown;
  error?: string;
  stderr_tail?: string;
  total_ms?: number;
  ts: number;
};

type EventBody = { runId: string } & (StartedPayload | InstallDonePayload | ClaudeDonePayload | FinishedPayload);

export function registerEventsRoutes(app: FastifyInstance, db: Database.Database): void {
  const insertStart = db.prepare(`
    INSERT INTO runs (id, triggered_at, owner, repo, number, head_sha, failing_checks, prompt_version, status)
    VALUES (@id, @triggered_at, @owner, @repo, @number, @head_sha, @failing_checks, @prompt_version, 'started')
    ON CONFLICT(id) DO UPDATE SET
      triggered_at = excluded.triggered_at,
      owner = excluded.owner,
      repo = excluded.repo,
      number = excluded.number,
      head_sha = COALESCE(excluded.head_sha, runs.head_sha),
      failing_checks = COALESCE(excluded.failing_checks, runs.failing_checks),
      prompt_version = COALESCE(excluded.prompt_version, runs.prompt_version)
  `);

  const updateInstall = db.prepare(`
    UPDATE runs
    SET install_ms = COALESCE(@install_ms, install_ms),
        error = COALESCE(@install_error, error)
    WHERE id = @id
  `);

  const updateClaude = db.prepare(`
    UPDATE runs
    SET claude_ms = COALESCE(@claude_ms, claude_ms),
        error = COALESCE(@claude_error, error),
        stderr_tail = COALESCE(@stderr_tail, stderr_tail)
    WHERE id = @id
  `);

  const updateFinished = db.prepare(`
    UPDATE runs
    SET status = @status,
        abort_code = COALESCE(@abort_code, abort_code),
        pushed_sha = COALESCE(@pushed_sha, pushed_sha),
        files_changed = COALESCE(@files_changed, files_changed),
        error = COALESCE(@error, error),
        stderr_tail = COALESCE(@stderr_tail, stderr_tail),
        total_ms = COALESCE(@total_ms, total_ms)
    WHERE id = @id
  `);

  // Used when 'finished' arrives before any 'started' (network race / lost
  // packet) — we still want the row to land so the dashboard reflects it.
  const insertFallback = db.prepare(`
    INSERT OR IGNORE INTO runs (id, triggered_at, owner, repo, number, status)
    VALUES (@id, @triggered_at, '', '', 0, 'started')
  `);

  app.post<{ Body: EventBody }>('/events', async (req, reply) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || !body.runId || !body.kind) {
      return reply.code(400).send({ error: 'runId and kind are required' });
    }

    const id = body.runId;
    const ts = typeof body.ts === 'number' ? body.ts : Date.now();

    insertFallback.run({ id, triggered_at: ts });

    if (body.kind === 'started') {
      insertStart.run({
        id,
        triggered_at: ts,
        owner: body.owner ?? '',
        repo: body.repo ?? '',
        number: body.number ?? 0,
        head_sha: body.head_sha ?? null,
        failing_checks: body.failing_checks != null ? JSON.stringify(body.failing_checks) : null,
        prompt_version: body.prompt_version ?? null,
      });
    } else if (body.kind === 'install_done') {
      updateInstall.run({
        id,
        install_ms: body.install_ms ?? null,
        install_error: body.install_error ?? null,
      });
    } else if (body.kind === 'claude_done') {
      updateClaude.run({
        id,
        claude_ms: body.claude_ms ?? null,
        claude_error: body.claude_error ?? null,
        stderr_tail: body.stderr_tail ?? null,
      });
    } else if (body.kind === 'finished') {
      updateFinished.run({
        id,
        status: body.status,
        abort_code: body.abort_code ?? null,
        pushed_sha: body.pushed_sha ?? null,
        files_changed: body.files_changed != null ? JSON.stringify(body.files_changed) : null,
        error: body.error ?? null,
        stderr_tail: body.stderr_tail ?? null,
        total_ms: body.total_ms ?? null,
      });
    } else {
      return reply.code(400).send({ error: `unknown kind: ${(body as { kind?: string }).kind}` });
    }

    return reply.code(204).send();
  });
}
