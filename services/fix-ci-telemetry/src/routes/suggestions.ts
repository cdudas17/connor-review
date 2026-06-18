import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';

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
}
