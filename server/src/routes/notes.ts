import type { FastifyInstance } from 'fastify';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Notes are stored one file per project under `~/.connor-review/notes/`.
 * The 'misc' project always exists (created on first request) and can't
 * be renamed or deleted — it's where legacy notes get parked during the
 * one-file-to-projects migration and where the user drops anything that
 * doesn't have a home yet.
 *
 * Slug rules: [a-z0-9-]+, ≤ 48 chars, generated from the caller-supplied
 * `name`. If two projects would slug the same we append a numeric
 * suffix so the filesystem stays authoritative.
 */

const MISC_SLUG = 'misc';
const MAX_SLUG_LEN = 48;
/** Cap on how many projects we'll create — a runaway loop shouldn't be
 *  able to blow the notes dir. */
const MAX_PROJECTS = 200;

interface ProjectSummary {
  slug: string;
  name: string;
  path: string;
  updatedAt: number;
}

function notesPaths() {
  const dir = join(homedir(), '.connor-review');
  const projectDir = join(dir, 'notes');
  return { dir, projectDir, legacyFile: join(dir, 'notes.html') };
}

function projectFilePath(slug: string): string {
  const { projectDir } = notesPaths();
  return join(projectDir, `${slug}.html`);
}

function slugify(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LEN);
  return s || `project-${Date.now()}`;
}

/** Escape a name for the display metadata file. Names are stored inside
 *  the .html file as an HTML comment on line 1: <!--name:<escaped>-->\n
 *  so we don't need a sidecar file to remember the pretty name. */
const NAME_LINE_RE = /^<!--name:(.*?)-->\r?\n/;
function extractName(html: string, fallback: string): string {
  const m = html.match(NAME_LINE_RE);
  if (!m) return fallback;
  return decodeURIComponent(m[1]);
}
function stripNameLine(html: string): string {
  return html.replace(NAME_LINE_RE, '');
}
function withNameLine(html: string, name: string): string {
  const stripped = stripNameLine(html);
  return `<!--name:${encodeURIComponent(name)}-->\n${stripped}`;
}

async function ensureNotesLayout(): Promise<void> {
  const { dir, projectDir, legacyFile } = notesPaths();
  await fs.mkdir(projectDir, { recursive: true });
  const miscPath = projectFilePath(MISC_SLUG);
  // Migration: if the old single-file notes exist AND misc doesn't yet,
  // move the legacy content into misc so the user's history isn't lost.
  if (!existsSync(miscPath) && existsSync(legacyFile)) {
    try {
      const legacyContent = await fs.readFile(legacyFile, 'utf8');
      await fs.writeFile(miscPath, withNameLine(legacyContent, 'Misc'), 'utf8');
      // Keep the legacy file on disk for a manual paranoia recovery; a
      // future cleanup pass can remove it once we're confident.
    } catch { /* fall through to create empty misc below */ }
  }
  if (!existsSync(miscPath)) {
    await fs.writeFile(miscPath, withNameLine('', 'Misc'), 'utf8');
  }
  // Belt-and-suspenders: ensure ~/.connor-review exists (mkdir on
  // projectDir would create it, but a corrupted state where the parent
  // exists as a file would be caught by this write attempt).
  void dir;
}

async function readProject(slug: string): Promise<{ name: string; body: string; updatedAt: number; path: string } | null> {
  const path = projectFilePath(slug);
  if (!existsSync(path)) return null;
  const raw = await fs.readFile(path, 'utf8');
  const stat = await fs.stat(path);
  const name = extractName(raw, slug);
  const body = stripNameLine(raw);
  return { name, body, updatedAt: stat.mtimeMs, path };
}

async function listProjects(): Promise<ProjectSummary[]> {
  const { projectDir } = notesPaths();
  const entries = await fs.readdir(projectDir);
  const out: ProjectSummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.html')) continue;
    const slug = entry.slice(0, -'.html'.length);
    const info = await readProject(slug);
    if (!info) continue;
    out.push({ slug, name: info.name, path: info.path, updatedAt: info.updatedAt });
  }
  // Always sort with 'misc' first, then most-recently-modified.
  out.sort((a, b) => {
    if (a.slug === MISC_SLUG) return -1;
    if (b.slug === MISC_SLUG) return 1;
    return b.updatedAt - a.updatedAt;
  });
  return out;
}

export async function registerNotesRoutes(app: FastifyInstance) {
  /** List every project (misc pinned first). */
  app.get('/api/notes/projects', async () => {
    await ensureNotesLayout();
    return { projects: await listProjects() };
  });

  /** Fetch one project by slug. */
  app.get<{ Params: { slug: string } }>('/api/notes/projects/:slug', async (req, reply) => {
    await ensureNotesLayout();
    const slug = req.params.slug;
    const info = await readProject(slug);
    if (!info) { reply.code(404).send({ code: 'NOT_FOUND', message: `No project named ${slug}` }); return; }
    return { slug, name: info.name, notes: info.body, path: info.path };
  });

  /** Save one project's body. Creates the file if missing (which is how
   *  the client persists edits to a freshly-created project). */
  app.put<{ Params: { slug: string }; Body: { notes?: string; name?: string } }>(
    '/api/notes/projects/:slug',
    async (req, reply) => {
      await ensureNotesLayout();
      const slug = req.params.slug;
      if (!/^[a-z0-9-]+$/.test(slug) || slug.length > MAX_SLUG_LEN) {
        reply.code(400).send({ code: 'BAD_SLUG', message: `Invalid slug: ${slug}` });
        return;
      }
      const notes = typeof req.body?.notes === 'string' ? req.body.notes : '';
      const path = projectFilePath(slug);
      // Preserve the name that was originally chosen when the project
      // was created; only overwrite if the client explicitly sends one.
      let name = req.body?.name;
      if (!name && existsSync(path)) {
        const existing = await readProject(slug);
        name = existing?.name;
      }
      if (!name) name = slug === MISC_SLUG ? 'Misc' : slug;
      await fs.writeFile(path, withNameLine(notes, name), 'utf8');
      reply.code(204).send();
    },
  );

  /** Create a new project. Body: { name }. Server slugifies + de-dupes. */
  app.post<{ Body: { name?: string } }>(
    '/api/notes/projects',
    async (req, reply) => {
      await ensureNotesLayout();
      const rawName = (req.body?.name ?? '').trim();
      if (!rawName) { reply.code(400).send({ code: 'BAD_NAME', message: 'name is required' }); return; }
      const projects = await listProjects();
      if (projects.length >= MAX_PROJECTS) {
        reply.code(400).send({ code: 'TOO_MANY_PROJECTS', message: `Project limit (${MAX_PROJECTS}) reached` });
        return;
      }
      const existing = new Set(projects.map((p) => p.slug));
      let base = slugify(rawName);
      // 'misc' is a protected slug — force a suffix if the user tries to
      // reserve it. Same for anything that already exists.
      let slug = base;
      let n = 2;
      while (existing.has(slug) || slug === MISC_SLUG) {
        slug = `${base}-${n++}`;
        if (n > 100) { slug = `${base}-${Date.now()}`; break; }
      }
      await fs.writeFile(projectFilePath(slug), withNameLine('', rawName), 'utf8');
      return { slug, name: rawName };
    },
  );

  /** Rename a project. Body: { name }. Misc is non-renamable. */
  app.patch<{ Params: { slug: string }; Body: { name?: string } }>(
    '/api/notes/projects/:slug',
    async (req, reply) => {
      await ensureNotesLayout();
      const slug = req.params.slug;
      if (slug === MISC_SLUG) { reply.code(400).send({ code: 'PROTECTED', message: 'The misc project cannot be renamed.' }); return; }
      const info = await readProject(slug);
      if (!info) { reply.code(404).send({ code: 'NOT_FOUND', message: `No project named ${slug}` }); return; }
      const newName = (req.body?.name ?? '').trim();
      if (!newName) { reply.code(400).send({ code: 'BAD_NAME', message: 'name is required' }); return; }
      await fs.writeFile(projectFilePath(slug), withNameLine(info.body, newName), 'utf8');
      return { slug, name: newName };
    },
  );

  /** Delete a project. Misc is non-deletable. */
  app.delete<{ Params: { slug: string } }>(
    '/api/notes/projects/:slug',
    async (req, reply) => {
      await ensureNotesLayout();
      const slug = req.params.slug;
      if (slug === MISC_SLUG) { reply.code(400).send({ code: 'PROTECTED', message: 'The misc project cannot be deleted.' }); return; }
      const path = projectFilePath(slug);
      if (!existsSync(path)) { reply.code(404).send({ code: 'NOT_FOUND', message: `No project named ${slug}` }); return; }
      await fs.unlink(path);
      reply.code(204).send();
    },
  );

  // Legacy single-file endpoints — read/write the misc project so tools
  // that still call /api/notes keep working during the transition.
  app.get('/api/notes', async () => {
    await ensureNotesLayout();
    const info = await readProject(MISC_SLUG);
    return { notes: info?.body ?? '', path: info?.path ?? '' };
  });
  app.put<{ Body: { notes?: string } }>('/api/notes', async (req, reply) => {
    await ensureNotesLayout();
    const notes = typeof req.body?.notes === 'string' ? req.body.notes : '';
    await fs.writeFile(projectFilePath(MISC_SLUG), withNameLine(notes, 'Misc'), 'utf8');
    reply.code(204).send();
  });
}
