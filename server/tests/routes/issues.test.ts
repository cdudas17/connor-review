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

  it('parses the gh search output and returns the viewer\'s open issues most-recent first', async () => {
    mocked.mockResolvedValueOnce(JSON.stringify([
      {
        number: 1, title: 'Old', url: 'u1', state: 'open', author: { login: 'me' },
        repository: { nameWithOwner: 'Gusto/zenpayroll' },
        createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z',
        labels: [{ name: 'bug' }],
      },
      {
        number: 2, title: 'Newer', url: 'u2', state: 'open', author: { login: 'me' },
        repository: { nameWithOwner: 'Gusto/zenpayroll' },
        createdAt: '2026-06-10T00:00:00Z', updatedAt: '2026-06-10T00:00:00Z',
        labels: [],
      },
    ]));
    const app = await buildServer();
    const res = await app.inject({ url: '/api/issues/mine' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.issues.map((i: { number: number }) => i.number)).toEqual([2, 1]);
    expect(body.issues[0].repository).toBe('Gusto/zenpayroll');
    expect(body.issues[1].labels).toEqual(['bug']);
    // gh search command is constructed correctly.
    const callArgs = mocked.mock.calls[0][0] as string[];
    expect(callArgs[0]).toBe('search');
    expect(callArgs[1]).toBe('issues');
    // Default scope is 'either' (assigned OR authored).
    expect(callArgs[2]).toContain('assignee:@me');
    expect(callArgs[2]).toContain('author:@me');
    expect(callArgs).toContain('--json');
    expect(callArgs).toContain('--limit');
    await app.close();
  });

  it('honors scope=assigned (no author qualifier)', async () => {
    mocked.mockResolvedValueOnce('[]');
    const app = await buildServer();
    await app.inject({ url: '/api/issues/mine?scope=assigned' });
    const callArgs = mocked.mock.calls[0][0] as string[];
    expect(callArgs[2]).toContain('assignee:@me');
    expect(callArgs[2]).not.toContain('author:@me');
    await app.close();
  });

  it('caps limit to 200 and falls back to 50 on invalid input', async () => {
    mocked.mockResolvedValueOnce('[]');
    const app = await buildServer();
    await app.inject({ url: '/api/issues/mine?limit=9999' });
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
