/**
 * fix-ci-telemetry — Fastify server + background workers.
 *
 * - Ingest endpoint at POST /events (called by connor-review's
 *   `emitFixCiEvent` helper, fire-and-forget).
 * - Read endpoints for the dashboard at GET /runs, /runs/:id, /suggestions,
 *   /stats/by-version.
 * - Background workers: outcomePoller (5-min), proposePromptDaily.
 *
 * Designed to be self-contained: every helper it needs (gh shell-out,
 * claude shell-out) is copied from connor-review/server/lib so the service
 * can be moved, swapped, or turned off without coordination.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { openDb } from './db.js';
import { registerEventsRoutes } from './routes/events.js';
import { registerRunsRoutes } from './routes/runs.js';
import { registerSuggestionsRoutes } from './routes/suggestions.js';
import { registerDashboardRoute } from './routes/dashboard.js';
import { startOutcomePoller } from './workers/outcomePoller.js';
import { startProposePromptDaily } from './workers/proposePrompt.js';

const PORT = Number(process.env.PORT ?? 5180);
const HOST = process.env.HOST ?? '127.0.0.1';

export async function buildServer() {
  const db = openDb();
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  registerEventsRoutes(app, db);
  registerRunsRoutes(app, db);
  registerSuggestionsRoutes(app, db);
  registerDashboardRoute(app);
  return { app, db };
}

if (process.argv[1] && process.argv[1].endsWith('index.ts')) {
  const { app, db } = await buildServer();
  const log = (msg: string) => app.log.info(msg);
  const poller = startOutcomePoller(db, log);
  const proposer = startProposePromptDaily(db, log);
  const shutdown = async () => {
    poller.stop();
    proposer.stop();
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`fix-ci-telemetry listening on http://${HOST}:${PORT}`);
}
