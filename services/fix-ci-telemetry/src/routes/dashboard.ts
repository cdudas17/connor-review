import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HTML = readFileSync(
  resolve(new URL('.', import.meta.url).pathname, '..', 'views', 'dashboard.html'),
  'utf8',
);

export function registerDashboardRoute(app: FastifyInstance): void {
  app.get('/dashboard', async (_req, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8');
    return HTML;
  });

  app.get('/', async (_req, reply) => {
    reply.redirect('/dashboard');
  });
}
