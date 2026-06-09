import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server.js';
import { META_FIXTURE_2, DIFF_FIXTURE } from '../msw/handlers.js';
import { useNextPRPrefetch } from '../../src/hooks/useNextPRPrefetch.js';
import type { TrackedPR } from '../../src/types.js';

const PRS: TrackedPR[] = [
  { owner: 'a', repo: 'b', number: 1, title: 'one', authorLogin: 'x', status: 'untouched', ghStatus: 'open', ciStatus: null, ciUrl: null, labels: [], createdAt: null, addedAt: 1 },
  { owner: 'a', repo: 'b', number: 2, title: 'two', authorLogin: 'x', status: 'untouched', ghStatus: 'open', ciStatus: null, ciUrl: null, labels: [], createdAt: null, addedAt: 2 },
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

  it('routes local-source entries to /api/local/* and never asks GitHub for "local/<repo>"', async () => {
    // Regression: a local entry has `source: 'local'`, owner: 'local', repo: 'web'.
    // Hitting /api/pulls/local/web/... would 502 with "Could not resolve to a Repository
    // with the name 'local/web'". The prefetch must use /api/local/meta + /api/local/diff.
    const githubMetaHits: string[] = [];
    const githubDiffHits: string[] = [];
    const localMetaHits: URL[] = [];
    const localDiffHits: URL[] = [];
    server.use(
      http.get('/api/pulls/:owner/:repo/:number', ({ params }) => {
        githubMetaHits.push(String(params.owner));
        return HttpResponse.json(META_FIXTURE_2);
      }),
      http.get('/api/pulls/:owner/:repo/:number/diff', ({ params }) => {
        githubDiffHits.push(String(params.owner));
        return HttpResponse.text(DIFF_FIXTURE);
      }),
      http.get('/api/local/meta', ({ request }) => { localMetaHits.push(new URL(request.url)); return HttpResponse.json({ ...META_FIXTURE_2, source: 'local', localRepo: 'web' }); }),
      http.get('/api/local/diff', ({ request }) => { localDiffHits.push(new URL(request.url)); return HttpResponse.text(DIFF_FIXTURE); }),
    );

    const localPRs: TrackedPR[] = [
      { owner: 'local', repo: 'web', number: 100, title: 'first local', authorLogin: 'me', status: 'untouched', ghStatus: null, ciStatus: null, ciUrl: null, labels: [], createdAt: null, addedAt: 1, source: 'local', branch: 'feature/foo', localPath: '/Users/me/web' },
      { owner: 'local', repo: 'web', number: 101, title: 'second local', authorLogin: 'me', status: 'untouched', ghStatus: null, ciStatus: null, ciUrl: null, labels: [], createdAt: null, addedAt: 2, source: 'local', branch: 'feature/bar', localPath: '/Users/me/web' },
    ];

    renderHook(() => useNextPRPrefetch({
      current: { owner: 'local', repo: 'web', number: 100, source: 'local', branch: 'feature/foo', localPath: '/Users/me/web' },
      prs: localPRs,
    }));

    await waitFor(() => {
      expect(localMetaHits.length).toBe(1);
      expect(localDiffHits.length).toBe(1);
    });
    // Confirm we never asked GitHub for a repo called "local/<anything>".
    expect(githubMetaHits).toEqual([]);
    expect(githubDiffHits).toEqual([]);
    // Confirm the local request carries the branch + path of the *next* entry, not the current.
    expect(localMetaHits[0].searchParams.get('branch')).toBe('feature/bar');
    expect(localMetaHits[0].searchParams.get('path')).toBe('/Users/me/web');
    expect(localDiffHits[0].searchParams.get('branch')).toBe('feature/bar');
  });
});
