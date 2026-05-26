import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useViewedPaths } from '../../src/hooks/useViewedPaths.js';

const STORAGE_KEY = 'connor-review.viewedPaths.v1';
const PR_A = { owner: 'Gusto', repo: 'zenpayroll', number: 1 };
const PR_B = { owner: 'Gusto', repo: 'zenpayroll', number: 2 };

describe('useViewedPaths', () => {
  beforeEach(() => localStorage.clear());

  it('returns empty set for an unknown PR', () => {
    const { result } = renderHook(() => useViewedPaths());
    expect(Array.from(result.current.getViewedFor(PR_A))).toEqual([]);
  });

  it('returns empty set for null identity', () => {
    const { result } = renderHook(() => useViewedPaths());
    expect(Array.from(result.current.getViewedFor(null))).toEqual([]);
  });

  it('marks a path as viewed and persists to localStorage', () => {
    const { result } = renderHook(() => useViewedPaths());
    act(() => result.current.setViewed(PR_A, 'path/to/file.rb', true));
    expect(Array.from(result.current.getViewedFor(PR_A))).toEqual(['path/to/file.rb']);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored['Gusto/zenpayroll#1']).toEqual(['path/to/file.rb']);
  });

  it('toggles a path off when viewed=false', () => {
    const { result } = renderHook(() => useViewedPaths());
    act(() => result.current.setViewed(PR_A, 'a.rb', true));
    act(() => result.current.setViewed(PR_A, 'b.rb', true));
    act(() => result.current.setViewed(PR_A, 'a.rb', false));
    expect(Array.from(result.current.getViewedFor(PR_A))).toEqual(['b.rb']);
  });

  it('keeps viewed sets scoped per PR', () => {
    const { result } = renderHook(() => useViewedPaths());
    act(() => result.current.setViewed(PR_A, 'a.rb', true));
    act(() => result.current.setViewed(PR_B, 'b.rb', true));
    expect(Array.from(result.current.getViewedFor(PR_A))).toEqual(['a.rb']);
    expect(Array.from(result.current.getViewedFor(PR_B))).toEqual(['b.rb']);
  });

  it('survives a remount via localStorage', () => {
    const first = renderHook(() => useViewedPaths());
    act(() => first.result.current.setViewed(PR_A, 'a.rb', true));
    first.unmount();
    const second = renderHook(() => useViewedPaths());
    expect(Array.from(second.result.current.getViewedFor(PR_A))).toEqual(['a.rb']);
  });

  it('ignores malformed localStorage and starts empty', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const { result } = renderHook(() => useViewedPaths());
    expect(Array.from(result.current.getViewedFor(PR_A))).toEqual([]);
  });

  it('marking the same path viewed=true twice is idempotent', () => {
    const { result } = renderHook(() => useViewedPaths());
    act(() => result.current.setViewed(PR_A, 'a.rb', true));
    act(() => result.current.setViewed(PR_A, 'a.rb', true));
    expect(Array.from(result.current.getViewedFor(PR_A))).toEqual(['a.rb']);
  });
});
