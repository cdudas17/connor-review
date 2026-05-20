import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTrackedPRs, STORAGE_KEY } from '../../src/hooks/useTrackedPRs.js';

describe('useTrackedPRs', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty when localStorage is empty', () => {
    const { result } = renderHook(() => useTrackedPRs());
    expect(result.current.prs).toEqual([]);
  });

  it('adds a PR and persists to localStorage', () => {
    const { result } = renderHook(() => useTrackedPRs());
    act(() => result.current.add({
      owner: 'Gusto', repo: 'zenpayroll', number: 1, title: 'x', authorLogin: 'a',
    }));
    expect(result.current.prs).toHaveLength(1);
    expect(result.current.prs[0].status).toBe('untouched');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toHaveLength(1);
  });

  it('does not add a duplicate (same owner/repo/number)', () => {
    const { result } = renderHook(() => useTrackedPRs());
    act(() => result.current.add({ owner: 'a', repo: 'b', number: 1, title: 'x', authorLogin: 'a' }));
    act(() => result.current.add({ owner: 'a', repo: 'b', number: 1, title: 'x', authorLogin: 'a' }));
    expect(result.current.prs).toHaveLength(1);
  });

  it('setStatus updates and persists', () => {
    const { result } = renderHook(() => useTrackedPRs());
    act(() => result.current.add({ owner: 'a', repo: 'b', number: 1, title: 'x', authorLogin: 'a' }));
    act(() => result.current.setStatus({ owner: 'a', repo: 'b', number: 1 }, 'approved'));
    expect(result.current.prs[0].status).toBe('approved');
  });

  it('remove drops the PR', () => {
    const { result } = renderHook(() => useTrackedPRs());
    act(() => result.current.add({ owner: 'a', repo: 'b', number: 1, title: 'x', authorLogin: 'a' }));
    act(() => result.current.remove({ owner: 'a', repo: 'b', number: 1 }));
    expect(result.current.prs).toEqual([]);
  });

  it('survives a remount via localStorage', () => {
    const first = renderHook(() => useTrackedPRs());
    act(() => first.result.current.add({ owner: 'a', repo: 'b', number: 1, title: 'x', authorLogin: 'a' }));
    first.unmount();
    const second = renderHook(() => useTrackedPRs());
    expect(second.result.current.prs).toHaveLength(1);
  });
});
