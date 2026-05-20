import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server.js';
import { META_FIXTURE_2, DIFF_FIXTURE } from '../msw/handlers.js';
import { useNextPRPrefetch } from '../../src/hooks/useNextPRPrefetch.js';
import type { TrackedPR } from '../../src/types.js';

const PRS: TrackedPR[] = [
  { owner: 'a', repo: 'b', number: 1, title: 'one', authorLogin: 'x', status: 'untouched', addedAt: 1 },
  { owner: 'a', repo: 'b', number: 2, title: 'two', authorLogin: 'x', status: 'untouched', addedAt: 2 },
];

describe('useNextPRPrefetch', () => {
  it('fires meta + diff requests for the next untouched PR', async () => {
    const metaCalls: string[] = [];
    const diffCalls: string[] = [];
    server.use(
      http.get('/api/pulls/:owner/:repo/:number', ({ params }) => { metaCalls.push(String(params.number)); return HttpResponse.json(META_FIXTURE_2); }),
      http.get('/api/pulls/:owner/:repo/:number/diff', ({ params }) => { diffCalls.push(String(params.number)); return HttpResponse.text(DIFF_FIXTURE); }),
    );

    renderHook(() => useNextPRPrefetch({ current: { owner: 'a', repo: 'b', number: 1 }, prs: PRS }));

    await waitFor(() => {
      expect(metaCalls).toContain('2');
      expect(diffCalls).toContain('2');
    });
  });

  it('does nothing when there is no next untouched PR', async () => {
    const calls: string[] = [];
    server.use(http.get('/api/pulls/:owner/:repo/:number', ({ params }) => { calls.push(String(params.number)); return HttpResponse.json(META_FIXTURE_2); }));
    renderHook(() => useNextPRPrefetch({ current: { owner: 'a', repo: 'b', number: 2 }, prs: PRS }));
    await new Promise((r) => setTimeout(r, 25));
    expect(calls).toEqual([]);
  });
});
