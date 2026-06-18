import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { RunRow, OutcomeRow } from '../db.js';

export function registerRunsRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get<{
    Querystring: { repo?: string; owner?: string; status?: string; prompt_version?: string; since?: string; limit?: string };
  }>('/runs', async (req) => {
    const q = req.query;
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (q.owner) { where.push('owner = @owner'); params.owner = q.owner; }
    if (q.repo) { where.push('repo = @repo'); params.repo = q.repo; }
    if (q.status) { where.push('status = @status'); params.status = q.status; }
    if (q.prompt_version) { where.push('prompt_version = @prompt_version'); params.prompt_version = q.prompt_version; }
    if (q.since) { where.push('triggered_at >= @since'); params.since = Number(q.since); }
    const limit = Math.max(1, Math.min(500, Number(q.limit ?? 100)));
    const sql = `
      SELECT r.*, o.ci_state, o.merged_at, o.reverted, o.observed_at
      FROM runs r
      LEFT JOIN outcomes o ON o.run_id = r.id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY triggered_at DESC
      LIMIT ${limit}
    `;
    return db.prepare(sql).all(params);
  });

  app.get<{ Params: { id: string } }>('/runs/:id', async (req, reply) => {
    const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(req.params.id) as RunRow | undefined;
    if (!run) return reply.code(404).send({ error: 'not found' });
    const outcome = db.prepare('SELECT * FROM outcomes WHERE run_id = ?').get(req.params.id) as OutcomeRow | undefined;
    return { run, outcome: outcome ?? null };
  });

  // Roll-up panel feeding the dashboard's version-comparison view. Counts
  // and rates by prompt_version, plus a breakdown of safety_aborted abort
  // codes (since that's the failure mode we care most about steering
  // prompts away from).
  app.get('/stats/by-version', async () => {
    const rows = db.prepare(`
      SELECT
        COALESCE(prompt_version, 'unknown') AS prompt_version,
        COUNT(*) AS total,
        SUM(CASE WHEN status IN ('success_pushed', 'success_rebased') THEN 1 ELSE 0 END) AS successes,
        SUM(CASE WHEN status = 'success_rebased' THEN 1 ELSE 0 END) AS rebases,
        SUM(CASE WHEN status = 'safety_aborted' THEN 1 ELSE 0 END) AS safety_aborts,
        SUM(CASE WHEN status = 'claude_failed' THEN 1 ELSE 0 END) AS claude_failed,
        SUM(CASE WHEN status = 'rebase_conflicts' THEN 1 ELSE 0 END) AS rebase_conflicts,
        SUM(CASE WHEN status = 'no_changes' THEN 1 ELSE 0 END) AS no_changes,
        AVG(total_ms) AS avg_total_ms
      FROM runs
      GROUP BY prompt_version
      ORDER BY MIN(triggered_at) DESC
    `).all();
    return rows;
  });
}
