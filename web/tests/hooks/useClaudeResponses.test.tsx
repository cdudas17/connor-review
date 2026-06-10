import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server.js';
import { useClaudeResponses, __resetClaudeResponseStorage } from '../../src/hooks/useClaudeResponses.js';

const TARGET = { owner: 'Gusto', repo: 'zenpayroll', number: 1 };
const TARGET_KEY = 'Gusto/zenpayroll#1';

beforeEach(() => {
  __resetClaudeResponseStorage();
});

describe('useClaudeResponses — summary card', () => {
  it('routes a successful ask through to summaryFor + persists to localStorage', async () => {
    server.use(
      http.post('/api/pulls/:o/:r/:n/claude/ask', () => HttpResponse.json({ response: 'looks fine', truncatedDiff: false })),
    );
    const onToast = vi.fn();
    const { result } = renderHook(() => useClaudeResponses({ onToast, currentPRKey: TARGET_KEY }));
    act(() => { result.current.askSummary(TARGET, 'thoughts?'); });
    expect(result.current.summaryFor(TARGET)?.loading).toBe(true);
    await waitFor(() => expect(result.current.summaryFor(TARGET)?.loading).toBe(false));
    expect(result.current.summaryFor(TARGET)?.body).toBe('looks fine');
    // Drawer was on the asking PR → no toast.
    expect(onToast).not.toHaveBeenCalled();
    // Persisted to localStorage (body only, no loading flag).
    const stored = JSON.parse(localStorage.getItem('connor-review.claudeSummary.v1') ?? '{}');
    expect(stored[TARGET_KEY].body).toBe('looks fine');
  });

  it('fires an info toast when the response lands while drawer is on a DIFFERENT PR', async () => {
    server.use(
      http.post('/api/pulls/:o/:r/:n/claude/ask', async () => {
        // small delay so we can swap currentPRKey before resolution
        await new Promise((r) => setTimeout(r, 20));
        return HttpResponse.json({ response: 'late answer' });
      }),
    );
    const onToast = vi.fn();
    const { result, rerender } = renderHook(
      ({ key }) => useClaudeResponses({ onToast, currentPRKey: key }),
      { initialProps: { key: TARGET_KEY as string | null } },
    );
    act(() => { result.current.askSummary(TARGET, 'q'); });
    // user closes drawer / navigates away
    rerender({ key: null });
    await waitFor(() => expect(result.current.summaryFor(TARGET)?.body).toBe('late answer'));
    expect(onToast).toHaveBeenCalledWith('info', expect.stringContaining(TARGET_KEY));
  });

  it('fires an error toast when the response fails AND drawer is closed', async () => {
    server.use(
      http.post('/api/pulls/:o/:r/:n/claude/ask', async () => {
        await new Promise((r) => setTimeout(r, 20));
        return HttpResponse.json({ code: 'CLAUDE_NOT_INSTALLED', message: 'claude CLI not found' }, { status: 502 });
      }),
    );
    const onToast = vi.fn();
    const { result, rerender } = renderHook(
      ({ key }) => useClaudeResponses({ onToast, currentPRKey: key }),
      { initialProps: { key: TARGET_KEY as string | null } },
    );
    act(() => { result.current.askSummary(TARGET, 'q'); });
    rerender({ key: null });
    await waitFor(() => expect(result.current.summaryFor(TARGET)?.error).toMatch(/claude cli/i));
    expect(onToast).toHaveBeenCalledWith('error', expect.stringMatching(/claude failed/i));
  });

  it('per-key token guard: a second ask supersedes the first', async () => {
    // First response resolves slowly with one body, second resolves fast with another.
    let call = 0;
    server.use(
      http.post('/api/pulls/:o/:r/:n/claude/ask', async () => {
        call++;
        if (call === 1) {
          await new Promise((r) => setTimeout(r, 60));
          return HttpResponse.json({ response: 'STALE' });
        }
        return HttpResponse.json({ response: 'FRESH' });
      }),
    );
    const onToast = vi.fn();
    const { result } = renderHook(() => useClaudeResponses({ onToast, currentPRKey: TARGET_KEY }));
    act(() => { result.current.askSummary(TARGET, 'a'); });
    act(() => { result.current.askSummary(TARGET, 'b'); });
    await waitFor(() => expect(result.current.summaryFor(TARGET)?.body).toBe('FRESH'));
    // Wait long enough for the stale response to also settle.
    await new Promise((r) => setTimeout(r, 80));
    expect(result.current.summaryFor(TARGET)?.body).toBe('FRESH');
  });

  it('rehydrates summary state from localStorage on mount', () => {
    localStorage.setItem('connor-review.claudeSummary.v1', JSON.stringify({
      [TARGET_KEY]: { loading: false, body: 'from prior session' },
    }));
    const { result } = renderHook(() => useClaudeResponses({ onToast: vi.fn(), currentPRKey: null }));
    expect(result.current.summaryFor(TARGET)?.body).toBe('from prior session');
  });

  it('does not persist loading=true entries (would be stuck after page reload)', async () => {
    server.use(
      http.post('/api/pulls/:o/:r/:n/claude/ask', async () => {
        await new Promise((r) => setTimeout(r, 50));
        return HttpResponse.json({ response: 'eventually' });
      }),
    );
    const { result } = renderHook(() => useClaudeResponses({ onToast: vi.fn(), currentPRKey: TARGET_KEY }));
    act(() => { result.current.askSummary(TARGET, 'q'); });
    // While still loading, localStorage should NOT contain a loading entry.
    const midflight = JSON.parse(localStorage.getItem('connor-review.claudeSummary.v1') ?? '{}');
    expect(midflight[TARGET_KEY]).toBeUndefined();
    await waitFor(() => expect(result.current.summaryFor(TARGET)?.body).toBe('eventually'));
    const settled = JSON.parse(localStorage.getItem('connor-review.claudeSummary.v1') ?? '{}');
    expect(settled[TARGET_KEY]?.body).toBe('eventually');
  });

  it('dismissSummary removes the entry from state + persists the removal', async () => {
    server.use(
      http.post('/api/pulls/:o/:r/:n/claude/ask', () => HttpResponse.json({ response: 'ok' })),
    );
    const { result } = renderHook(() => useClaudeResponses({ onToast: vi.fn(), currentPRKey: TARGET_KEY }));
    act(() => { result.current.askSummary(TARGET, 'q'); });
    await waitFor(() => expect(result.current.summaryFor(TARGET)?.body).toBe('ok'));
    act(() => { result.current.dismissSummary(TARGET); });
    expect(result.current.summaryFor(TARGET)).toBeNull();
    const stored = JSON.parse(localStorage.getItem('connor-review.claudeSummary.v1') ?? '{}');
    expect(stored[TARGET_KEY]).toBeUndefined();
  });
});

describe('useClaudeResponses — thread reply cards', () => {
  it('threadFor lookup is keyed by (PR, threadId)', async () => {
    server.use(
      http.post('/api/pulls/:o/:r/:n/claude/ask', () => HttpResponse.json({ response: 'thread answer' })),
    );
    const { result } = renderHook(() => useClaudeResponses({ onToast: vi.fn(), currentPRKey: TARGET_KEY }));
    act(() => {
      result.current.askThread(TARGET, 'THREAD_42', 'why this?', {
        path: 'app/foo.rb', endLine: 10, side: 'RIGHT',
      });
    });
    await waitFor(() => expect(result.current.threadFor(TARGET, 'THREAD_42')?.body).toBe('thread answer'));
    // Other thread id on same PR is independent.
    expect(result.current.threadFor(TARGET, 'THREAD_43')).toBeNull();
  });
});

describe('useClaudeResponses — cleanup', () => {
  it('sweeps entries older than 30 days on mount', () => {
    const ancient = Date.now() - (40 * 24 * 60 * 60 * 1000); // 40 days ago
    const recent = Date.now() - (5 * 24 * 60 * 60 * 1000);   // 5 days ago
    localStorage.setItem('connor-review.claudeSummary.v1', JSON.stringify({
      'old/repo#1': { loading: false, body: 'gone', savedAt: ancient },
      'new/repo#2': { loading: false, body: 'kept', savedAt: recent },
    }));
    const { result } = renderHook(() => useClaudeResponses({ onToast: vi.fn(), currentPRKey: null }));
    expect(result.current.summaryFor({ owner: 'old', repo: 'repo', number: 1 })).toBeNull();
    expect(result.current.summaryFor({ owner: 'new', repo: 'repo', number: 2 })?.body).toBe('kept');
  });

  it('keeps un-timestamped legacy entries (gives them a grace pass on first run)', () => {
    // Entries persisted before savedAt was added shouldn't all get nuked on the
    // first sweep — they have no timestamp.
    localStorage.setItem('connor-review.claudeSummary.v1', JSON.stringify({
      'legacy/repo#1': { loading: false, body: 'no timestamp' },
    }));
    const { result } = renderHook(() => useClaudeResponses({ onToast: vi.fn(), currentPRKey: null }));
    expect(result.current.summaryFor({ owner: 'legacy', repo: 'repo', number: 1 })?.body).toBe('no timestamp');
  });

  it('LRU-caps the summary bucket to MAX_ENTRIES on mount', () => {
    // 250 entries with strictly increasing savedAt → keep the 200 most recent.
    const baseTs = Date.now() - (1000 * 60 * 60); // 1h ago, well under the age cutoff
    const entries: Record<string, { loading: boolean; body: string; savedAt: number }> = {};
    for (let i = 0; i < 250; i++) {
      entries[`org/repo#${i}`] = { loading: false, body: `r${i}`, savedAt: baseTs + i };
    }
    localStorage.setItem('connor-review.claudeSummary.v1', JSON.stringify(entries));
    const { result } = renderHook(() => useClaudeResponses({ onToast: vi.fn(), currentPRKey: null }));
    // The 50 oldest entries (0–49) should be gone; the 200 newest (50–249) should remain.
    expect(result.current.summaryFor({ owner: 'org', repo: 'repo', number: 49 })).toBeNull();
    expect(result.current.summaryFor({ owner: 'org', repo: 'repo', number: 50 })?.body).toBe('r50');
    expect(result.current.summaryFor({ owner: 'org', repo: 'repo', number: 249 })?.body).toBe('r249');
  });

  it('dismissAllForPR drops summary + every thread entry for that PR', async () => {
    server.use(
      http.post('/api/pulls/:o/:r/:n/claude/ask', () => HttpResponse.json({ response: 'ok' })),
    );
    const otherTarget = { owner: 'Gusto', repo: 'zenpayroll', number: 999 };
    const { result } = renderHook(() => useClaudeResponses({ onToast: vi.fn(), currentPRKey: TARGET_KEY }));
    act(() => { result.current.askSummary(TARGET, 'q1'); });
    act(() => { result.current.askThread(TARGET, 'TH1', 'q2', { path: 'a', endLine: 1, side: 'RIGHT' }); });
    act(() => { result.current.askThread(TARGET, 'TH2', 'q3', { path: 'a', endLine: 2, side: 'RIGHT' }); });
    act(() => { result.current.askSummary(otherTarget, 'q4'); });
    await waitFor(() => {
      expect(result.current.summaryFor(TARGET)?.body).toBe('ok');
      expect(result.current.threadFor(TARGET, 'TH1')?.body).toBe('ok');
      expect(result.current.threadFor(TARGET, 'TH2')?.body).toBe('ok');
      expect(result.current.summaryFor(otherTarget)?.body).toBe('ok');
    });
    act(() => { result.current.dismissAllForPR(TARGET); });
    expect(result.current.summaryFor(TARGET)).toBeNull();
    expect(result.current.threadFor(TARGET, 'TH1')).toBeNull();
    expect(result.current.threadFor(TARGET, 'TH2')).toBeNull();
    // Other PR's entries are untouched.
    expect(result.current.summaryFor(otherTarget)?.body).toBe('ok');
  });
});
