import { loadEnvFile } from './lib/loadEnvFile.js';
// Load .env BEFORE any other import so route modules that read env at top
// level (e.g. fixCiTelemetry's FIX_CI_TELEMETRY_URL) see the right values.
const envLoad = loadEnvFile();

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerPullsRoutes } from './routes/pulls.js';
import { registerTeamRoutes } from './routes/team.js';
import { registerNotesRoutes } from './routes/notes.js';
import { registerLocalRoutes } from './routes/local.js';
import { registerIssuesRoutes } from './routes/issues.js';
import { registerBuildkiteRoutes } from './routes/buildkite.js';

export async function buildServer() {
  const app = Fastify({ logger: { level: 'warn' } });
  await app.register(cors, { origin: 'http://localhost:5173' });
  app.get('/api/health', async () => ({ ok: true }));
  await registerPullsRoutes(app);
  await registerTeamRoutes(app);
  await registerNotesRoutes(app);
  await registerLocalRoutes(app);
  await registerIssuesRoutes(app);
  await registerBuildkiteRoutes(app);
  return app;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const app = await buildServer();
  await app.listen({ port: 5174, host: '127.0.0.1' });

  // Startup announcement — surfaces which secrets are wired up so you can
  // tell at a glance whether `.zshrc` / `.env` is propagating, instead of
  // clicking through the UI to find out a token is missing.
  if (envLoad) {
    app.log.warn(`[server] loaded ${envLoad.loaded.length} var(s) from ${envLoad.source}: ${envLoad.loaded.join(', ') || '(none new)'}`);
  }
  app.log.warn(`[server] BUILDKITE_API_TOKEN: ${process.env.BUILDKITE_API_TOKEN ? 'set ✓' : 'NOT set — Buildkite drill-in disabled'}`);

  // Without explicit signal handlers, Fastify's default graceful-shutdown can
  // hang on in-flight worktree / Claude work, and tsx-watch's child never
  // exits — so a Ctrl-C in the parent shell leaves the listener alive and
  // the port held. Belt-and-suspenders: try to close cleanly, but force-exit
  // after 2s no matter what.
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) { process.exit(0); return; }
    shuttingDown = true;
    app.log.warn(`[server] received ${signal}, shutting down`);
    app.close().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
