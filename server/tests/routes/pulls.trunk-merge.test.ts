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
import { ghExec } from '../../src/lib/ghExec.js';

const mockedGh = ghExec as unknown as ReturnType<typeof vi.fn>;

describe('POST /api/pulls/:o/:r/:n/trunk-merge', () => {
  beforeEach(() => {
    mockedGh.mockReset();
  });

  it('posts `/trunk merge` for action="enable"', async () => {
    mockedGh.mockResolvedValueOnce('https://github.com/Gusto/web/pull/1#issuecomment-1\n');
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/web/1/trunk-merge',
      payload: { action: 'enable' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, action: 'enable', body: '/trunk merge' });
    expect(mockedGh.mock.calls[0][0]).toEqual([
      'pr', 'comment', '1',
      '--repo', 'Gusto/web',
      '--body', '/trunk merge',
    ]);
    await app.close();
  });

  it('posts `/trunk cancel` for action="cancel"', async () => {
    mockedGh.mockResolvedValueOnce('https://github.com/Gusto/web/pull/1#issuecomment-2\n');
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/web/1/trunk-merge',
      payload: { action: 'cancel' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, action: 'cancel', body: '/trunk cancel' });
    expect(mockedGh.mock.calls[0][0]).toContain('/trunk cancel');
    await app.close();
  });

  it('returns 400 on an unknown action', async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/web/1/trunk-merge',
      payload: { action: 'wat' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('BAD_PARAMS');
    expect(mockedGh).not.toHaveBeenCalled();
    await app.close();
  });
});
