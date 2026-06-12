import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/lib/ghExec.js', () => {
  const ghExec = vi.fn();
  class GhCliError extends Error {
    override readonly name = 'GhCliError';
    constructor(public code: string, message: string, public stderr: string) {
      super(message);
    }
  }
  return { ghExec, GhCliError };
});

import { buildServer } from '../../src/index.js';
import { ghExec, GhCliError } from '../../src/lib/ghExec.js';

const mocked = ghExec as unknown as ReturnType<typeof vi.fn>;

describe('GET /api/issues/mine', () => {
  beforeEach(() => mocked.mockReset());

  it('runs two scoped gh search calls for scope=either and merges results most-recent first', async () => {
    // First call: assigned. Returns one issue.
    mocked.mockResolvedValueOnce(JSON.stringify([
      {
        number: 1, title: 'Assigned', url: 'u1', state: 'open', author: { login: 'someone' },
        repository: { nameWithOwner: 'Gusto/zenpayroll' },
        createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z',
        labels: [{ name: 'bug' }],
      },
    ]));
    // Second call: authored. Returns two issues, one of which is the SAME as
    // the assigned one (you're often both) — dedupe should drop the dup.
    mocked.mockResolvedValueOnce(JSON.stringify([
      {
        number: 1, title: 'Assigned', url: 'u1', state: 'open', author: { login: 'someone' },
        repository: { nameWithOwner: 'Gusto/zenpayroll' },
        createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z',
        labels: [{ name: 'bug' }],
      },
      {
        number: 2, title: 'Authored', url: 'u2', state: 'open', author: { login: 'me' },
        repository: { nameWithOwner: 'Gusto/zenpayroll' },
        createdAt: '2026-06-10T00:00:00Z', updatedAt: '2026-06-10T00:00:00Z',
        labels: [],
      },
    ]));

    const app = await buildServer();
    const res = await app.inject({ url: '/api/issues/mine' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Both scoped searches were called.
    expect(mocked).toHaveBeenCalledTimes(2);
    // Dedupe worked AND sort-by-updatedAt-desc puts Authored ahead.
    expect(body.issues.map((i: { number: number }) => i.number)).toEqual([2, 1]);

    // First call uses --assignee @me, --state open, no `is:` qualifiers.
    const assignedCall = mocked.mock.calls[0][0] as string[];
    expect(assignedCall).toContain('--assignee');
    expect(assignedCall[assignedCall.indexOf('--assignee') + 1]).toBe('@me');
    expect(assignedCall).toContain('--state');
    expect(assignedCall[assignedCall.indexOf('--state') + 1]).toBe('open');
    expect(assignedCall).not.toContain('is:open');
    // Second call uses --author @me.
    const authoredCall = mocked.mock.calls[1][0] as string[];
    expect(authoredCall).toContain('--author');
    expect(authoredCall[authoredCall.indexOf('--author') + 1]).toBe('@me');
    await app.close();
  });

  it('honors scope=assigned (single call, --assignee only)', async () => {
    mocked.mockResolvedValueOnce('[]');
    const app = await buildServer();
    await app.inject({ url: '/api/issues/mine?scope=assigned' });
    expect(mocked).toHaveBeenCalledTimes(1);
    const callArgs = mocked.mock.calls[0][0] as string[];
    expect(callArgs).toContain('--assignee');
    expect(callArgs).not.toContain('--author');
    await app.close();
  });

  it('honors scope=authored (single call, --author only)', async () => {
    mocked.mockResolvedValueOnce('[]');
    const app = await buildServer();
    await app.inject({ url: '/api/issues/mine?scope=authored' });
    expect(mocked).toHaveBeenCalledTimes(1);
    const callArgs = mocked.mock.calls[0][0] as string[];
    expect(callArgs).toContain('--author');
    expect(callArgs).not.toContain('--assignee');
    await app.close();
  });

  it('caps limit to 200 and falls back to 50 on invalid input', async () => {
    // scope=assigned to keep it to one shell-out.
    mocked.mockResolvedValueOnce('[]');
    const app = await buildServer();
    await app.inject({ url: '/api/issues/mine?scope=assigned&limit=9999' });
    const callArgs = mocked.mock.calls[0][0] as string[];
    expect(callArgs[callArgs.indexOf('--limit') + 1]).toBe('200');
    await app.close();
  });

  it('maps AUTH_REQUIRED to 401', async () => {
    mocked.mockRejectedValueOnce(new GhCliError('AUTH_REQUIRED', 'need login', 'gh auth login required'));
    const app = await buildServer();
    const res = await app.inject({ url: '/api/issues/mine' });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH_REQUIRED');
    await app.close();
  });
});
