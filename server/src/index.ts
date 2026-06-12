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
}
