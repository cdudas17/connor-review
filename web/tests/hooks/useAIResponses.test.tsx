import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server.js';
import { useAIResponses, __resetClaudeResponseStorage } from '../../src/hooks/useAIResponses.js';

const TARGET = { owner: 'Gusto', repo: 'zenpayroll', number: 1 };
const TARGET_KEY = 'Gusto/zenpayroll#1';

beforeEach(() => {
  __resetClaudeResponseStorage();
});

describe('useAIResponses — chat (multi-turn summary panel)', () => {
  it('first askInChat appends user + claude turns and resolves with body', async () => {
    server.use(
      http.post('/api/pulls/:o/:r/:n/ai/ask', () => HttpResponse.json({ response: 'first answer' })),
    );
    const { result } = renderHook(() => useAIResponses({ onToast: vi.fn(), currentPRKey: TARGET_KEY }));
    act(() => { result.current.askInChat(TARGET, 'is this safe?'); });
    // Optimistic: user turn + loading claude turn appear immediately.
    const optimistic = result.current.chatFor(TARGET)!;
    expect(optimistic.turns).toHaveLength(2);
    expect(optimistic.turns[0]).toMatchObject({ role: 'user', body: 'is this safe?' });
    expect(optimistic.turns[1]).toMatchObject({ role: 'ai', loading: true });
    await waitFor(() => expect(result.current.chatFor(TARGET)!.turns[1].loading).toBeFalsy());
    expect(result.current.chatFor(TARGET)!.turns[1].body).toBe('first answer');
  });

  it('follow-up ask sends the prior turns as `conversation`', async () => {
    const capturedBodies: Array<{ draft: string; conversation?: Array<{ role: string; body: string }> }> = [];
    server.use(
      http.post('/api/pulls/:o/:r/:n/ai/ask', async ({ request }) => {
        const body = await request.json() as { draft: string; conversation?: Array<{ role: string; body: string }> };
        capturedBodies.push(body);
        return HttpResponse.json({ response: capturedBodies.length === 1 ? 'A1' : 'A2' });
      }),
    );
    const { result } = renderHook(() => useAIResponses({ onToast: vi.fn(), currentPRKey: TARGET_KEY }));
    act(() => { result.current.askInChat(TARGET, 'q1'); });
    await waitFor(() => expect(result.current.chatFor(TARGET)?.turns[1].body).toBe('A1'));
    act(() => { result.current.askInChat(TARGET, 'q2'); });
    await waitFor(() => expect(result.current.chatFor(TARGET)?.turns[3].body).toBe('A2'));
    expect(capturedBodies).toHaveLength(2);
    // First call sends no prior turns.
    expect(capturedBodies[0].conversation ?? []).toEqual([]);
    // Second call sends the first user + claude turn.
    expect(capturedBodies[1].conversation).toEqual([
      { role: 'user', body: 'q1' },
      { role: 'ai', body: 'A1' },
    ]);
    expect(capturedBodies[1].draft).toBe('q2');
  });

  it('persists chats to localStorage with loading stripped', async () => {
    server.use(
      http.post('/api/pulls/:o/:r/:n/ai/ask', () => HttpResponse.json({ response: 'done' })),
    );
    const { result } = renderHook(() => useAIResponses({ onToast: vi.fn(), currentPRKey: TARGET_KEY }));
    act(() => { result.current.askInChat(TARGET, 'q'); });
    await waitFor(() => expect(result.current.chatFor(TARGET)?.turns[1].body).toBe('done'));
    const stored = JSON.parse(localStorage.getItem('connor-review.aiChat.v1') ?? '{}');
    expect(stored[TARGET_KEY].turns[0]).toMatchObject({ role: 'user', body: 'q' });
    expect(stored[TARGET_KEY].turns[1]).toMatchObject({ role: 'ai', body: 'done' });
    expect(stored[TARGET_KEY].turns[1].loading).toBeFalsy();
  });

  it('migrates legacy single-card summary entries to a single-turn chat on first read', () => {
    localStorage.setItem('connor-review.claudeSummary.v1', JSON.stringify({
      [TARGET_KEY]: { loading: false, body: 'legacy answer', truncatedDiff: true, savedAt: Date.now() },
    }));
    const { result } = renderHook(() => useAIResponses({ onToast: vi.fn(), currentPRKey: null }));
    const chat = result.current.chatFor(TARGET);
    expect(chat).not.toBeNull();
    expect(chat!.turns).toHaveLength(1);
    expect(chat!.turns[0]).toMatchObject({ role: 'ai', body: 'legacy answer', truncatedDiff: true });
  });

  it('toasts when a chat reply lands while drawer has moved to a different PR', async () => {
    server.use(
      http.post('/api/pulls/:o/:r/:n/ai/ask', async () => {
        await new Promise((r) => setTimeout(r, 30));
        return HttpResponse.json({ response: 'late' });
      }),
    );
    const onToast = vi.fn();
    const { result, rerender } = renderHook(
      ({ key }) => useAIResponses({ onToast, currentPRKey: key }),
      { initialProps: { key: TARGET_KEY as string | null } },
    );
    act(() => { result.current.askInChat(TARGET, 'q'); });
    rerender({ key: null });
    await waitFor(() => expect(result.current.chatFor(TARGET)?.turns[1].body).toBe('late'));
    expect(onToast).toHaveBeenCalledWith('info', expect.stringContaining(TARGET_KEY));
  });

  it('a failed response settles the claude turn with an error', async () => {
    server.use(
      http.post('/api/pulls/:o/:r/:n/ai/ask', () => HttpResponse.json({ code: 'CLAUDE_FAILED', message: 'boom' }, { status: 500 })),
    );
    const { result } = renderHook(() => useAIResponses({ onToast: vi.fn(), currentPRKey: TARGET_KEY }));
    act(() => { result.current.askInChat(TARGET, 'q'); });
    await waitFor(() => expect(result.current.chatFor(TARGET)?.turns[1].error).toMatch(/boom/i));
    expect(result.current.chatFor(TARGET)?.turns[1].loading).toBeFalsy();
  });

  it('dismissChat removes the conversation', async () => {
    server.use(
      http.post('/api/pulls/:o/:r/:n/ai/ask', () => HttpResponse.json({ response: 'ok' })),
    );
    const { result } = renderHook(() => useAIResponses({ onToast: vi.fn(), currentPRKey: TARGET_KEY }));
    act(() => { result.current.askInChat(TARGET, 'q'); });
    await waitFor(() => expect(result.current.chatFor(TARGET)?.turns[1].body).toBe('ok'));
    act(() => { result.current.dismissChat(TARGET); });
    expect(result.current.chatFor(TARGET)).toBeNull();
    const stored = JSON.parse(localStorage.getItem('connor-review.aiChat.v1') ?? '{}');
    expect(stored[TARGET_KEY]).toBeUndefined();
  });
});

describe('useAIResponses — thread reply cards (unchanged single-shot)', () => {
  it('threadFor lookup is keyed by (PR, threadId)', async () => {
    server.use(
      http.post('/api/pulls/:o/:r/:n/ai/ask', () => HttpResponse.json({ response: 'thread answer' })),
    );
    const { result } = renderHook(() => useAIResponses({ onToast: vi.fn(), currentPRKey: TARGET_KEY }));
    act(() => {
      result.current.askThread(TARGET, 'THREAD_42', 'why this?', {
        path: 'app/foo.rb', endLine: 10, side: 'RIGHT',
      });
    });
    await waitFor(() => expect(result.current.threadFor(TARGET, 'THREAD_42')?.body).toBe('thread answer'));
    expect(result.current.threadFor(TARGET, 'THREAD_43')).toBeNull();
  });
});

describe('useAIResponses — aggregateFor (PR-list indicator)', () => {
  it('returns null when there is no Claude state for the PR', () => {
    const { result } = renderHook(() => useAIResponses({ onToast: vi.fn(), currentPRKey: null }));
    expect(result.current.aggregateFor(TARGET)).toBeNull();
  });

  it('returns kind:success when there is at least one settled claude turn body', async () => {
    server.use(http.post('/api/pulls/:o/:r/:n/ai/ask', () => HttpResponse.json({ response: 'ok' })));
    const { result } = renderHook(() => useAIResponses({ onToast: vi.fn(), currentPRKey: TARGET_KEY }));
    act(() => { result.current.askInChat(TARGET, 'q'); });
    await waitFor(() => expect(result.current.aggregateFor(TARGET)?.kind).toBe('success'));
  });

  it('returns kind:loading when ANY chat turn or thread is in-flight (priority over success)', async () => {
    server.use(
      http.post('/api/pulls/:o/:r/:n/ai/ask', async () => {
        await new Promise((r) => setTimeout(r, 100));
        return HttpResponse.json({ response: 'late' });
      }),
    );
    // Pre-seed a settled chat so we start in success.
    localStorage.setItem('connor-review.aiChat.v1', JSON.stringify({
      [TARGET_KEY]: { savedAt: Date.now(), turns: [
        { role: 'user', body: 'q', ts: Date.now() },
        { role: 'ai', body: 'old', ts: Date.now() },
      ] },
    }));
    const { result } = renderHook(() => useAIResponses({ onToast: vi.fn(), currentPRKey: TARGET_KEY }));
    expect(result.current.aggregateFor(TARGET)?.kind).toBe('success');
    act(() => { result.current.askInChat(TARGET, 'q2'); });
    expect(result.current.aggregateFor(TARGET)?.kind).toBe('loading');
    await waitFor(() => expect(result.current.aggregateFor(TARGET)?.kind).toBe('success'));
  });

  it('returns kind:error when only error turns exist', async () => {
    server.use(
      http.post('/api/pulls/:o/:r/:n/ai/ask', () => HttpResponse.json({ code: 'CLAUDE_FAILED', message: 'no' }, { status: 500 })),
    );
    const { result } = renderHook(() => useAIResponses({ onToast: vi.fn(), currentPRKey: TARGET_KEY }));
    act(() => { result.current.askInChat(TARGET, 'q'); });
    await waitFor(() => expect(result.current.aggregateFor(TARGET)?.kind).toBe('error'));
  });
});

describe('useAIResponses — local inline threads', () => {
  const ANCHOR = { path: 'app/widget.rb', line: 42, startLine: 38, side: 'RIGHT' as const };

  it('askInLocalThread creates a thread keyed by (PR, anchor) and seeds turns', async () => {
    server.use(http.post('/api/pulls/:o/:r/:n/ai/ask', () => HttpResponse.json({ response: 'looks dicey' })));
    const { result } = renderHook(() => useAIResponses({ onToast: vi.fn(), currentPRKey: TARGET_KEY }));
    act(() => { result.current.askInLocalThread(TARGET, ANCHOR, 'why mutate here?'); });
    const after = result.current.localThreadsForPR(TARGET);
    expect(after).toHaveLength(1);
    expect(after[0].turns[0]).toMatchObject({ role: 'user', body: 'why mutate here?' });
    expect(after[0].turns[1]).toMatchObject({ role: 'ai', loading: true });
    expect(after[0].anchor).toEqual(ANCHOR);
    await waitFor(() => expect(result.current.localThreadsForPR(TARGET)[0].turns[1].body).toBe('looks dicey'));
  });

  it('follow-up turn sends prior conversation', async () => {
    const captured: Array<{ conversation?: Array<{ role: string; body: string }>; lineRange?: { path: string; endLine: number; side: string } }> = [];
    server.use(http.post('/api/pulls/:o/:r/:n/ai/ask', async ({ request }) => {
      const body = await request.json() as { conversation?: Array<{ role: string; body: string }>; lineRange?: { path: string; endLine: number; side: string } };
      captured.push(body);
      return HttpResponse.json({ response: `A${captured.length}` });
    }));
    const { result } = renderHook(() => useAIResponses({ onToast: vi.fn(), currentPRKey: TARGET_KEY }));
    act(() => { result.current.askInLocalThread(TARGET, ANCHOR, 'q1'); });
    await waitFor(() => expect(result.current.localThreadsForPR(TARGET)[0].turns[1].body).toBe('A1'));
    act(() => { result.current.askInLocalThread(TARGET, ANCHOR, 'q2'); });
    await waitFor(() => expect(result.current.localThreadsForPR(TARGET)[0].turns[3].body).toBe('A2'));
    expect(captured[1].conversation).toEqual([
      { role: 'user', body: 'q1' },
      { role: 'ai', body: 'A1' },
    ]);
    // lineRange is always sent so Claude knows which code is being asked about.
    expect(captured[1].lineRange).toMatchObject({ path: 'app/widget.rb', endLine: 42, side: 'RIGHT' });
  });

  it('threads at different anchors are independent on the same PR', async () => {
    server.use(http.post('/api/pulls/:o/:r/:n/ai/ask', () => HttpResponse.json({ response: 'ok' })));
    const A1 = { ...ANCHOR, line: 10, startLine: undefined };
    const A2 = { ...ANCHOR, line: 20, startLine: undefined };
    const { result } = renderHook(() => useAIResponses({ onToast: vi.fn(), currentPRKey: TARGET_KEY }));
    act(() => { result.current.askInLocalThread(TARGET, A1, 'q'); });
    act(() => { result.current.askInLocalThread(TARGET, A2, 'q'); });
    await waitFor(() => expect(result.current.localThreadsForPR(TARGET)).toHaveLength(2));
  });

  it('dismissLocalThread drops just that thread', async () => {
    server.use(http.post('/api/pulls/:o/:r/:n/ai/ask', () => HttpResponse.json({ response: 'ok' })));
    const { result } = renderHook(() => useAIResponses({ onToast: vi.fn(), currentPRKey: TARGET_KEY }));
    act(() => { result.current.askInLocalThread(TARGET, ANCHOR, 'q'); });
    await waitFor(() => expect(result.current.localThreadsForPR(TARGET)).toHaveLength(1));
    act(() => { result.current.dismissLocalThread(TARGET, ANCHOR); });
    expect(result.current.localThreadsForPR(TARGET)).toEqual([]);
  });

  it('aggregateFor includes local-thread state', async () => {
    server.use(http.post('/api/pulls/:o/:r/:n/ai/ask', () => HttpResponse.json({ response: 'ok' })));
    const { result } = renderHook(() => useAIResponses({ onToast: vi.fn(), currentPRKey: TARGET_KEY }));
    expect(result.current.aggregateFor(TARGET)).toBeNull();
    act(() => { result.current.askInLocalThread(TARGET, ANCHOR, 'q'); });
    expect(result.current.aggregateFor(TARGET)?.kind).toBe('loading');
    await waitFor(() => expect(result.current.aggregateFor(TARGET)?.kind).toBe('success'));
  });
});

describe('useAIResponses — cleanup', () => {
  it('sweeps chat entries older than 30 days on mount', () => {
    const ancient = Date.now() - (40 * 24 * 60 * 60 * 1000);
    const recent = Date.now() - (5 * 24 * 60 * 60 * 1000);
    localStorage.setItem('connor-review.aiChat.v1', JSON.stringify({
      'old/repo#1': { savedAt: ancient, turns: [{ role: 'ai', body: 'gone', ts: ancient }] },
      'new/repo#2': { savedAt: recent, turns: [{ role: 'ai', body: 'kept', ts: recent }] },
    }));
    const { result } = renderHook(() => useAIResponses({ onToast: vi.fn(), currentPRKey: null }));
    expect(result.current.chatFor({ owner: 'old', repo: 'repo', number: 1 })).toBeNull();
    expect(result.current.chatFor({ owner: 'new', repo: 'repo', number: 2 })?.turns[0].body).toBe('kept');
  });

  it('dismissAllForPR drops chat + every thread entry for that PR', async () => {
    server.use(http.post('/api/pulls/:o/:r/:n/ai/ask', () => HttpResponse.json({ response: 'ok' })));
    const other = { owner: 'Gusto', repo: 'zenpayroll', number: 999 };
    const { result } = renderHook(() => useAIResponses({ onToast: vi.fn(), currentPRKey: TARGET_KEY }));
    act(() => { result.current.askInChat(TARGET, 'q'); });
    act(() => { result.current.askThread(TARGET, 'TH1', 'q', { path: 'a', endLine: 1, side: 'RIGHT' }); });
    act(() => { result.current.askInChat(other, 'q'); });
    await waitFor(() => {
      expect(result.current.chatFor(TARGET)?.turns[1].body).toBe('ok');
      expect(result.current.threadFor(TARGET, 'TH1')?.body).toBe('ok');
      expect(result.current.chatFor(other)?.turns[1].body).toBe('ok');
    });
    act(() => { result.current.dismissAllForPR(TARGET); });
    expect(result.current.chatFor(TARGET)).toBeNull();
    expect(result.current.threadFor(TARGET, 'TH1')).toBeNull();
    expect(result.current.chatFor(other)?.turns[1].body).toBe('ok');
  });
});
