import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerPullsRoutes } from './routes/pulls.js';
import { registerTeamRoutes } from './routes/team.js';
import { registerNotesRoutes } from './routes/notes.js';
import { registerLocalRoutes } from './routes/local.js';
import { registerIssuesRoutes } from './routes/issues.js';

export async function buildServer() {
  const app = Fastify({ logger: { level: 'warn' } });
  await app.register(cors, { origin: 'http://localhost:5173' });
  app.get('/api/health', async () => ({ ok: true }));
  await registerPullsRoutes(app);
  await registerTeamRoutes(app);
  await registerNotesRoutes(app);
  await registerLocalRoutes(app);
  await registerIssuesRoutes(app);
  return app;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const app = await buildServer();
  await app.listen({ port: 5174, host: '127.0.0.1' });

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
