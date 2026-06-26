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

const NOTES_FILE_REL = '.connor-review/notes.html';

describe('notes routes', () => {
  beforeEach(async () => {
    homeDir = await fs.mkdtemp(join(tmpdir(), 'cr-notes-test-'));
  });
  afterEach(async () => {
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it('GET /api/notes returns empty when the file does not exist', async () => {
    const app = await buildServer();
    const res = await app.inject({ url: '/api/notes' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.notes).toBe('');
    // Normalize separators so the assertion holds on Windows (backslash) too.
    expect(body.path.replace(/\\/g, '/')).toContain(NOTES_FILE_REL);
    await app.close();
  });

  it('PUT /api/notes writes to the file and GET returns the same content', async () => {
    const app = await buildServer();
    const html = '<p>hello <a href="https://x.test" target="_blank" rel="noopener noreferrer">there</a></p>';
    const put = await app.inject({
      method: 'PUT',
      url: '/api/notes',
      payload: { notes: html },
    });
    expect(put.statusCode).toBe(204);

    // File on disk matches.
    const onDisk = await fs.readFile(join(homeDir, NOTES_FILE_REL), 'utf8');
    expect(onDisk).toBe(html);

    // GET returns the same content.
    const get = await app.inject({ url: '/api/notes' });
    expect(get.json().notes).toBe(html);
    await app.close();
  });

  it('PUT with empty body writes an empty file', async () => {
    const app = await buildServer();
    await app.inject({ method: 'PUT', url: '/api/notes', payload: { notes: '' } });
    const onDisk = await fs.readFile(join(homeDir, NOTES_FILE_REL), 'utf8');
    expect(onDisk).toBe('');
    await app.close();
  });

  it('creates the ~/.connor-review directory if it does not exist', async () => {
    const app = await buildServer();
    // Directory not present yet.
    await expect(fs.access(join(homeDir, '.connor-review'))).rejects.toBeDefined();
    await app.inject({ method: 'PUT', url: '/api/notes', payload: { notes: 'x' } });
    await fs.access(join(homeDir, '.connor-review')); // exists now
    await app.close();
  });
});
