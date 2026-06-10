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
