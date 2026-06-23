import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { runProposePromptOnce } from '../workers/proposePrompt.js';

// Single-slot guard so the dashboard's "Run now" button can't queue parallel
// Claude jobs against the same clusters. A run can take minutes; the next
// click is rejected with 409 until the current one finishes.
let proposeRunning = false;
let proposeLastResult: { ranAt: number; created: number; error?: string } | null = null;

export function registerSuggestionsRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/suggestions', async () => {
    return db.prepare(`
      SELECT id, created_at, cluster_summary, failing_runs, current_prompt, proposed_prompt, shipped
      FROM prompt_suggestions
      ORDER BY created_at DESC
    `).all();
  });

  app.post<{ Params: { id: string } }>('/suggestions/:id/shipped', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid id' });
    const info = db.prepare('UPDATE prompt_suggestions SET shipped = 1 WHERE id = ?').run(id);
    if (info.changes === 0) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });

  // Manual trigger for the propose-prompt worker — drives the "Run now" button
  // on the dashboard. Fires the job in the background so the HTTP request
  // returns immediately; the dashboard polls /suggestions/run-status to know
  // when it's done.
  app.post('/suggestions/run-now', async (_req, reply) => {
    if (proposeRunning) {
      return reply.code(409).send({ ok: false, running: true, message: 'a propose-prompt run is already in progress' });
    }
    proposeRunning = true;
    void (async () => {
      try {
        const created = await runProposePromptOnce(db, (m) => app.log.info(`[propose-prompt] ${m}`));
        proposeLastResult = { ranAt: Date.now(), created };
      } catch (e) {
        proposeLastResult = { ranAt: Date.now(), created: 0, error: (e as Error).message };
        app.log.error(`[propose-prompt] manual run failed: ${(e as Error).message}`);
      } finally {
        proposeRunning = false;
      }
    })();
    return reply.code(202).send({ ok: true, queued: true });
  });

  app.get('/suggestions/run-status', async () => {
    return { running: proposeRunning, last: proposeLastResult };
  });
}
