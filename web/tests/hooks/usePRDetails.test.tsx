import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server.js';
import { META_FIXTURE, DIFF_FIXTURE } from '../msw/handlers.js';
import { usePRDetails } from '../../src/hooks/usePRDetails.js';

describe('usePRDetails', () => {
  it('returns loading then data on success', async () => {
    const { result } = renderHook(() => usePRDetails({ owner: 'a', repo: 'b', number: 1 }));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.meta?.id).toBe('PR_abc');
    expect(result.current.diff).toContain('diff --git');
  });

  it('returns null result when id is null', () => {
    const { result } = renderHook(() => usePRDetails(null));
    expect(result.current.meta).toBeNull();
    expect(result.current.diff).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('routes local-source ids to /api/local/* and never hits /api/pulls', async () => {
    // CRITICAL: do NOT pass `localRepo` here. Real call sites (PRList, App.tsx
    // toIdentity, nextUntouchedAfter) construct the Identity with owner='local',
    // repo='<short name>', source/branch/localPath — but NOT localRepo. The hook
    // must use id.repo as the local repo short name.
    let githubHit = false;
    let localMetaHit: URL | null = null;
    let localDiffHit: URL | null = null;
    server.use(
      http.get('/api/pulls/:owner/:repo/:number', () => { githubHit = true; return HttpResponse.json(META_FIXTURE); }),
      http.get('/api/pulls/:owner/:repo/:number/diff', () => { githubHit = true; return HttpResponse.text(DIFF_FIXTURE); }),
      http.get('/api/local/meta', ({ request }) => { localMetaHit = new URL(request.url); return HttpResponse.json({ ...META_FIXTURE, source: 'local', localRepo: 'web' }); }),
      http.get('/api/local/diff', ({ request }) => { localDiffHit = new URL(request.url); return HttpResponse.text(DIFF_FIXTURE); }),
    );
    const { result } = renderHook(() => usePRDetails({
      owner: 'local', repo: 'web', number: 99,
      source: 'local', branch: 'feature/foo', localPath: '/Users/me/web',
    }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.meta?.source).toBe('local');
    expect(result.current.diff).toContain('diff --git');
    expect(localMetaHit).not.toBeNull();
    expect(localDiffHit).not.toBeNull();
    // Confirm id.repo is used as the short repo name on the local request.
    expect(localMetaHit!.searchParams.get('repo')).toBe('web');
    expect(localMetaHit!.searchParams.get('path')).toBe('/Users/me/web');
    expect(localMetaHit!.searchParams.get('branch')).toBe('feature/foo');
    expect(githubHit).toBe(false);
  });

  it('surfaces an error so the drawer can show a failure panel instead of hanging on Loading…', async () => {
    server.use(
      http.get('/api/local/meta', () => HttpResponse.json({ code: 'BRANCH_NOT_FOUND', message: "branch 'gone' not found in web" }, { status: 404 })),
      http.get('/api/local/diff', () => HttpResponse.text(DIFF_FIXTURE)),
    );
    const { result } = renderHook(() => usePRDetails({
      owner: 'local', repo: 'web', number: 99,
      source: 'local', branch: 'gone', localPath: '/Users/me/web',
    }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.message.toLowerCase()).toContain('not found');
    // meta stays null so the drawer falls into the error branch.
    expect(result.current.meta).toBeNull();
  });
});
