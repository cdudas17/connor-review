import type { FastifyInstance } from 'fastify';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Resolved at request time so tests can stub os.homedir(). */
function notesPaths() {
  const dir = join(homedir(), '.connor-review');
  return { dir, file: join(dir, 'notes.html') };
}

/**
 * Persists the user's freeform notes to a single file under `~/.connor-review/`.
 * Independent of any browser / localStorage so notes survive crashes, browser
 * profile resets, etc.
 */
export async function registerNotesRoutes(app: FastifyInstance) {
  app.get('/api/notes', async () => {
    const { file } = notesPaths();
    try {
      const text = await fs.readFile(file, 'utf8');
      return { notes: text, path: file };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        return { notes: '', path: file };
      }
      throw e;
    }
  });

  app.put<{ Body: { notes?: string } }>('/api/notes', async (req, reply) => {
    const { dir, file } = notesPaths();
    const notes = typeof req.body?.notes === 'string' ? req.body.notes : '';
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, notes, 'utf8');
    reply.code(204).send();
  });
}
