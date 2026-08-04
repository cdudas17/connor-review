import type { FastifyInstance } from 'fastify';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Reusable prompt templates ("skills") stored one markdown file per
 * skill under `~/.connor-review/skills/`. Referenced by slug from
 * workflow steps so the same prompt text doesn't have to be pasted
 * into every workflow that needs it.
 *
 * Same on-disk pattern as notes: display name lives inline as an HTML
 * comment on line 1 (`<!--name:<encoded name>-->`), body follows.
 * Files are plain markdown so the user can edit them in an editor
 * outside the app.
 */

const MAX_SLUG_LEN = 48;
const MAX_SKILLS = 200;

interface SkillSummary {
  slug: string;
  name: string;
  path: string;
  updatedAt: number;
}

function skillsPaths() {
  const dir = join(homedir(), '.connor-review');
  const skillsDir = join(dir, 'skills');
  return { dir, skillsDir };
}

function skillFilePath(slug: string): string {
  const { skillsDir } = skillsPaths();
  return join(skillsDir, `${slug}.md`);
}

function slugify(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LEN);
  return s || `skill-${Date.now()}`;
}

const NAME_LINE_RE = /^<!--name:(.*?)-->\r?\n/;
function extractName(text: string, fallback: string): string {
  const m = text.match(NAME_LINE_RE);
  return m ? decodeURIComponent(m[1]) : fallback;
}
function stripNameLine(text: string): string {
  return text.replace(NAME_LINE_RE, '');
}
function withNameLine(text: string, name: string): string {
  return `<!--name:${encodeURIComponent(name)}-->\n${stripNameLine(text)}`;
}

async function ensureLayout(): Promise<void> {
  const { skillsDir } = skillsPaths();
  await fs.mkdir(skillsDir, { recursive: true });
}

async function readSkill(slug: string): Promise<{ name: string; body: string; updatedAt: number; path: string } | null> {
  const path = skillFilePath(slug);
  if (!existsSync(path)) return null;
  const raw = await fs.readFile(path, 'utf8');
  const stat = await fs.stat(path);
  return { name: extractName(raw, slug), body: stripNameLine(raw), updatedAt: stat.mtimeMs, path };
}

async function listSkills(): Promise<SkillSummary[]> {
  const { skillsDir } = skillsPaths();
  const entries = existsSync(skillsDir) ? await fs.readdir(skillsDir) : [];
  const out: SkillSummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const slug = entry.slice(0, -'.md'.length);
    const info = await readSkill(slug);
    if (!info) continue;
    out.push({ slug, name: info.name, path: info.path, updatedAt: info.updatedAt });
  }
  // Most-recently-updated first — matches the notes list ordering.
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

export async function registerSkillsRoutes(app: FastifyInstance) {
  app.get('/api/skills', async () => {
    await ensureLayout();
    return { skills: await listSkills() };
  });

  app.get<{ Params: { slug: string } }>('/api/skills/:slug', async (req, reply) => {
    await ensureLayout();
    const info = await readSkill(req.params.slug);
    if (!info) { reply.code(404).send({ code: 'NOT_FOUND', message: `No skill named ${req.params.slug}` }); return; }
    return { slug: req.params.slug, name: info.name, body: info.body, path: info.path };
  });

  app.put<{ Params: { slug: string }; Body: { body?: string; name?: string } }>('/api/skills/:slug', async (req, reply) => {
    await ensureLayout();
    const slug = req.params.slug;
    if (!/^[a-z0-9-]+$/.test(slug) || slug.length > MAX_SLUG_LEN) {
      reply.code(400).send({ code: 'BAD_SLUG', message: `Invalid slug: ${slug}` });
      return;
    }
    const body = typeof req.body?.body === 'string' ? req.body.body : '';
    const path = skillFilePath(slug);
    let name = req.body?.name;
    if (!name && existsSync(path)) name = (await readSkill(slug))?.name;
    if (!name) name = slug;
    await fs.writeFile(path, withNameLine(body, name), 'utf8');
    reply.code(204).send();
  });

  app.post<{ Body: { name?: string; body?: string } }>('/api/skills', async (req, reply) => {
    await ensureLayout();
    const rawName = (req.body?.name ?? '').trim();
    if (!rawName) { reply.code(400).send({ code: 'BAD_NAME', message: 'name is required' }); return; }
    const existing = new Set((await listSkills()).map((s) => s.slug));
    if (existing.size >= MAX_SKILLS) {
      reply.code(400).send({ code: 'TOO_MANY_SKILLS', message: `Skill limit (${MAX_SKILLS}) reached` });
      return;
    }
    const base = slugify(rawName);
    let slug = base;
    let n = 2;
    while (existing.has(slug)) {
      slug = `${base}-${n++}`;
      if (n > 100) { slug = `${base}-${Date.now()}`; break; }
    }
    const body = typeof req.body?.body === 'string' ? req.body.body : '';
    await fs.writeFile(skillFilePath(slug), withNameLine(body, rawName), 'utf8');
    return { slug, name: rawName };
  });

  app.patch<{ Params: { slug: string }; Body: { name?: string } }>('/api/skills/:slug', async (req, reply) => {
    await ensureLayout();
    const info = await readSkill(req.params.slug);
    if (!info) { reply.code(404).send({ code: 'NOT_FOUND', message: `No skill named ${req.params.slug}` }); return; }
    const newName = (req.body?.name ?? '').trim();
    if (!newName) { reply.code(400).send({ code: 'BAD_NAME', message: 'name is required' }); return; }
    await fs.writeFile(skillFilePath(req.params.slug), withNameLine(info.body, newName), 'utf8');
    return { slug: req.params.slug, name: newName };
  });

  app.delete<{ Params: { slug: string } }>('/api/skills/:slug', async (req, reply) => {
    await ensureLayout();
    const path = skillFilePath(req.params.slug);
    if (!existsSync(path)) { reply.code(404).send({ code: 'NOT_FOUND', message: `No skill named ${req.params.slug}` }); return; }
    await fs.unlink(path);
    reply.code(204).send();
  });
}
