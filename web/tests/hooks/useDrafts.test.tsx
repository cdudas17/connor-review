import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDrafts } from '../../src/hooks/useDrafts.js';

const id = { owner: 'a', repo: 'b', number: 1 };

describe('useDrafts', () => {
  it('returns empty drafts for an unknown PR', () => {
    const { result } = renderHook(() => useDrafts());
    expect(result.current.getDrafts(id)).toEqual({ summary: '', inlineComments: [], replies: [] });
  });

  it('updates and reads summary', () => {
    const { result } = renderHook(() => useDrafts());
    act(() => result.current.setSummary(id, 'hello'));
    expect(result.current.getDrafts(id).summary).toBe('hello');
  });

  it('adds inline comment and reply', () => {
    const { result } = renderHook(() => useDrafts());
    act(() => result.current.addInlineComment(id, { path: 'f', line: 2, side: 'RIGHT', body: 'nit' }));
    act(() => result.current.addReply(id, { threadId: 'T_1', body: 'ack' }));
    const d = result.current.getDrafts(id);
    expect(d.inlineComments).toHaveLength(1);
    expect(d.replies).toEqual([{ threadId: 'T_1', body: 'ack' }]);
  });

  it('hasAny returns true when any draft exists', () => {
    const { result } = renderHook(() => useDrafts());
    expect(result.current.hasAny(id)).toBe(false);
    act(() => result.current.setSummary(id, 'x'));
    expect(result.current.hasAny(id)).toBe(true);
  });

  it('clear empties drafts for a PR', () => {
    const { result } = renderHook(() => useDrafts());
    act(() => result.current.setSummary(id, 'x'));
    act(() => result.current.clear(id));
    expect(result.current.hasAny(id)).toBe(false);
  });
});
