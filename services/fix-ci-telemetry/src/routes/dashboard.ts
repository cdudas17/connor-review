import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Re-read the HTML on every request so edits to dashboard.html show up
// without restarting the service. tsx watch only reloads on TS changes,
// and the dashboard is tiny, so the per-request file read is fine.
const DASHBOARD_HTML_PATH = resolve(
  new URL('.', import.meta.url).pathname, '..', 'views', 'dashboard.html',
);

export function registerDashboardRoute(app: FastifyInstance): void {
  app.get('/dashboard', async (_req, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8');
    return readFileSync(DASHBOARD_HTML_PATH, 'utf8');
  });

  app.get('/', async (_req, reply) => {
    reply.redirect('/dashboard');
  });
}
