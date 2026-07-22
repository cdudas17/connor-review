import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Override os.homedir() so the test writes into a temp dir instead of the real ~.
let homeDir = '';

vi.mock('node:os', async (orig) => {
  const actual = await orig() as typeof import('node:os');
  return { ...actual, homedir: () => homeDir };
});

import { buildServer } from '../../src/index.js';

// Notes are now stored per-project under ~/.connor-review/notes/<slug>.html.
// The legacy /api/notes endpoint reads/writes the 'misc' project so
// pre-multi-project callers keep working.
const MISC_FILE_REL = '.connor-review/notes/misc.html';
const NAME_LINE = /^<!--name:.*?-->\n/;

describe('notes routes', () => {
  beforeEach(async () => {
    homeDir = await fs.mkdtemp(join(tmpdir(), 'cr-notes-test-'));
  });
  afterEach(async () => {
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  // ---- legacy single-file endpoints (still work by routing to `misc`) ----

  it('GET /api/notes returns empty on first run (misc created lazily)', async () => {
    const app = await buildServer();
    const res = await app.inject({ url: '/api/notes' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.notes).toBe('');
    expect(body.path).toContain(MISC_FILE_REL);
    await app.close();
  });

  it('PUT /api/notes writes to misc and GET returns the same content', async () => {
    const app = await buildServer();
    const html = '<p>hello <a href="https://x.test" target="_blank" rel="noopener noreferrer">there</a></p>';
    const put = await app.inject({ method: 'PUT', url: '/api/notes', payload: { notes: html } });
    expect(put.statusCode).toBe(204);

    // File on disk includes a name-header line and the body verbatim.
    const onDisk = await fs.readFile(join(homeDir, MISC_FILE_REL), 'utf8');
    expect(onDisk).toMatch(NAME_LINE);
    expect(onDisk.replace(NAME_LINE, '')).toBe(html);

    // GET strips the name header and returns just the notes body.
    const get = await app.inject({ url: '/api/notes' });
    expect(get.json().notes).toBe(html);
    await app.close();
  });

  it('legacy notes.html gets migrated into misc on first request', async () => {
    // Seed the old single-file location with pre-migration content.
    const legacyDir = join(homeDir, '.connor-review');
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(join(legacyDir, 'notes.html'), '<p>legacy body</p>', 'utf8');

    const app = await buildServer();
    const get = await app.inject({ url: '/api/notes' });
    expect(get.json().notes).toBe('<p>legacy body</p>');
    // Misc file now exists and contains the migrated body.
    const migrated = await fs.readFile(join(homeDir, MISC_FILE_REL), 'utf8');
    expect(migrated.replace(NAME_LINE, '')).toBe('<p>legacy body</p>');
    await app.close();
  });

  // ---- new per-project endpoints ----

  it('GET /api/notes/projects lists misc even on a fresh install', async () => {
    const app = await buildServer();
    const res = await app.inject({ url: '/api/notes/projects' });
    expect(res.statusCode).toBe(200);
    const { projects } = res.json();
    expect(projects[0].slug).toBe('misc');
    expect(projects[0].name).toBe('Misc');
    await app.close();
  });

  it('POST /api/notes/projects creates a new slug and PUT persists a body', async () => {
    const app = await buildServer();
    const created = await app.inject({
      method: 'POST',
      url: '/api/notes/projects',
      payload: { name: 'Migration Cleanup' },
    });
    expect(created.statusCode).toBe(200);
    const { slug, name } = created.json();
    expect(slug).toBe('migration-cleanup');
    expect(name).toBe('Migration Cleanup');

    const put = await app.inject({
      method: 'PUT',
      url: `/api/notes/projects/${slug}`,
      payload: { notes: '<p>step one</p>' },
    });
    expect(put.statusCode).toBe(204);

    const get = await app.inject({ url: `/api/notes/projects/${slug}` });
    expect(get.json().notes).toBe('<p>step one</p>');
    expect(get.json().name).toBe('Migration Cleanup');
    await app.close();
  });

  it('DELETE /api/notes/projects/misc is refused', async () => {
    const app = await buildServer();
    const res = await app.inject({ method: 'DELETE', url: '/api/notes/projects/misc' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('PROTECTED');
    await app.close();
  });

  it('PATCH /api/notes/projects/misc (rename) is refused', async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/notes/projects/misc',
      payload: { name: 'Not Misc' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('PROTECTED');
    await app.close();
  });

  it('DELETE removes a non-misc project', async () => {
    const app = await buildServer();
    const created = await app.inject({ method: 'POST', url: '/api/notes/projects', payload: { name: 'Scratch' } });
    const { slug } = created.json();
    const del = await app.inject({ method: 'DELETE', url: `/api/notes/projects/${slug}` });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({ url: `/api/notes/projects/${slug}` });
    expect(get.statusCode).toBe(404);
    await app.close();
  });

  it('POST refuses to reserve the misc slug — falls back to a suffix', async () => {
    const app = await buildServer();
    const created = await app.inject({ method: 'POST', url: '/api/notes/projects', payload: { name: 'misc' } });
    expect(created.statusCode).toBe(200);
    expect(created.json().slug).not.toBe('misc');
    expect(created.json().slug.startsWith('misc-')).toBe(true);
    await app.close();
  });

  it('POST auto-suffixes when the slug is already taken', async () => {
    const app = await buildServer();
    await app.inject({ method: 'POST', url: '/api/notes/projects', payload: { name: 'Onboarding' } });
    const second = await app.inject({ method: 'POST', url: '/api/notes/projects', payload: { name: 'Onboarding' } });
    expect(second.statusCode).toBe(200);
    expect(second.json().slug).toBe('onboarding-2');
    await app.close();
  });
});
