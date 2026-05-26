import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server.js';
import { useLabeledPRs } from '../../src/hooks/useLabeledPRs.js';
import type { TeamPR } from '../../src/types.js';

const STATUS_KEY = 'connor-review.labeledPRStatus.v1';

function makeTeamPR(over: Partial<TeamPR> = {}): TeamPR {
  return {
    id: 'PR_1',
    number: 100,
    title: 'A talent-alerts PR',
    url: 'https://github.com/Gusto/zenpayroll/pull/100',
    authorLogin: 'octocat',
    owner: 'Gusto',
    repo: 'zenpayroll',
    isDraft: true,
    state: 'OPEN',
    merged: false,
    reviewDecision: 'REVIEW_REQUIRED',
    ciStatus: 'PENDING',
    ciUrl: null,
    labels: [{ name: 'talent-alerts', color: 'b60205' }],
    baseRefName: 'main',
    headRefName: 'f/r',
    headSha: 'sha-100',
    createdAt: '2026-05-26T00:00:00Z',
    updatedAt: '2026-05-26T01:00:00Z',
    ...over,
  };
}

describe('useLabeledPRs', () => {
  beforeEach(() => localStorage.clear());

  it('does not fetch on mount — caller must call fetch()', async () => {
    let called = 0;
    server.use(http.get('/api/labeled-prs', () => { called++; return HttpResponse.json({ label: 'talent-alerts', prs: [] }); }));
    const { result } = renderHook(() => useLabeledPRs());
    // Yield a few microtasks; nothing should fire.
    await new Promise((r) => setTimeout(r, 30));
    expect(called).toBe(0);
    expect(result.current.hasLoaded).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('fetches when fetch() is called, hydrates prs/members, marks hasLoaded', async () => {
    server.use(http.get('/api/labeled-prs', () => HttpResponse.json({
      label: 'talent-alerts',
      prs: [makeTeamPR({ number: 1, title: 'one' }), makeTeamPR({ number: 2, title: 'two' })],
    })));
    const { result } = renderHook(() => useLabeledPRs());
    await act(async () => { await result.current.fetch(); });
    expect(result.current.hasLoaded).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.prs).toHaveLength(2);
    expect(result.current.prs[0].title).toBeTypeOf('string');
    expect(result.current.lastFetchedAt).not.toBeNull();
  });

  it('overlays persisted per-PR local status onto fresh API responses', async () => {
    localStorage.setItem(STATUS_KEY, JSON.stringify({ 'Gusto/zenpayroll#1': 'reviewed' }));
    server.use(http.get('/api/labeled-prs', () => HttpResponse.json({
      label: 'talent-alerts',
      prs: [makeTeamPR({ number: 1 }), makeTeamPR({ number: 2 })],
    })));
    const { result } = renderHook(() => useLabeledPRs());
    await act(async () => { await result.current.fetch(); });
    expect(result.current.prs.find((p) => p.number === 1)!.status).toBe('reviewed');
    expect(result.current.prs.find((p) => p.number === 2)!.status).toBe('untouched');
  });

  it('setStatus updates an entry and persists to localStorage', async () => {
    server.use(http.get('/api/labeled-prs', () => HttpResponse.json({
      label: 'talent-alerts',
      prs: [makeTeamPR({ number: 1 })],
    })));
    const { result } = renderHook(() => useLabeledPRs());
    await act(async () => { await result.current.fetch(); });
    act(() => result.current.setStatus({ owner: 'Gusto', repo: 'zenpayroll', number: 1 }, 'approved'));
    expect(result.current.prs[0].status).toBe('approved');
    expect(JSON.parse(localStorage.getItem(STATUS_KEY)!)['Gusto/zenpayroll#1']).toBe('approved');
  });

  it('captures errors and surfaces them via .error', async () => {
    server.use(http.get('/api/labeled-prs', () => HttpResponse.json({ code: 'INTERNAL', message: 'kaboom' }, { status: 500 })));
    const { result } = renderHook(() => useLabeledPRs());
    await act(async () => { await result.current.fetch(); });
    expect(result.current.error?.message).toContain('kaboom');
    expect(result.current.errorDismissed).toBe(false);
    expect(result.current.hasLoaded).toBe(true);
  });

  it('dismissError flips the dismissed flag without touching the error itself', async () => {
    server.use(http.get('/api/labeled-prs', () => HttpResponse.json({ code: 'INTERNAL', message: 'boom' }, { status: 500 })));
    const { result } = renderHook(() => useLabeledPRs());
    await act(async () => { await result.current.fetch(); });
    expect(result.current.error).not.toBeNull();
    act(() => result.current.dismissError());
    expect(result.current.errorDismissed).toBe(true);
    expect(result.current.error).not.toBeNull();
  });

  it('a successful re-fetch after a failed fetch clears the error', async () => {
    let firstCall = true;
    server.use(http.get('/api/labeled-prs', () => {
      if (firstCall) { firstCall = false; return HttpResponse.json({ code: 'INTERNAL', message: 'flake' }, { status: 500 }); }
      return HttpResponse.json({ label: 'talent-alerts', prs: [makeTeamPR()] });
    }));
    const { result } = renderHook(() => useLabeledPRs());
    await act(async () => { await result.current.fetch(); });
    expect(result.current.error).not.toBeNull();
    await act(async () => { await result.current.fetch(); });
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.prs).toHaveLength(1);
  });

  it('concurrent fetch() calls do not duplicate API requests', async () => {
    let calls = 0;
    server.use(http.get('/api/labeled-prs', async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return HttpResponse.json({ label: 'talent-alerts', prs: [] });
    }));
    const { result } = renderHook(() => useLabeledPRs());
    await act(async () => {
      const a = result.current.fetch();
      const b = result.current.fetch();
      await Promise.all([a, b]);
    });
    expect(calls).toBe(1);
  });
});
