import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConflictResolutions } from '../../src/hooks/useConflictResolutions.js';

const T = { owner: 'Gusto', repo: 'zenpayroll', number: 1 };

describe('useConflictResolutions', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts as null for an unknown PR', () => {
    const { result } = renderHook(() => useConflictResolutions());
    expect(result.current.stateFor(T)).toBeNull();
  });

  it('transitions idle → running → success', () => {
    const { result } = renderHook(() => useConflictResolutions());
    act(() => { result.current.start(T); });
    expect(result.current.stateFor(T)?.kind).toBe('running');
    act(() => { result.current.finishOk(T, 'sha-12345'); });
    expect(result.current.stateFor(T)).toMatchObject({ kind: 'success', commitSha: 'sha-12345' });
  });

  it('transitions idle → running → failed with error + code', () => {
    const { result } = renderHook(() => useConflictResolutions());
    act(() => { result.current.start(T); });
    act(() => { result.current.finishErr(T, 'Claude touched README.md', 'OVERCOMMIT_DETECTED'); });
    expect(result.current.stateFor(T)).toMatchObject({
      kind: 'failed',
      error: 'Claude touched README.md',
      code: 'OVERCOMMIT_DETECTED',
    });
  });

  it('dismiss clears the entry entirely', () => {
    const { result } = renderHook(() => useConflictResolutions());
    act(() => { result.current.start(T); });
    act(() => { result.current.finishErr(T, 'boom'); });
    expect(result.current.stateFor(T)).not.toBeNull();
    act(() => { result.current.dismiss(T); });
    expect(result.current.stateFor(T)).toBeNull();
  });

  it('start() returns false when a resolve is already in flight (no double-fire)', () => {
    const { result } = renderHook(() => useConflictResolutions());
    let firstOk = false;
    let secondOk = true;
    act(() => { firstOk = result.current.start(T); });
    act(() => { secondOk = result.current.start(T); });
    expect(firstOk).toBe(true);
    expect(secondOk).toBe(false);
  });

  it('persists across remounts via localStorage', () => {
    const first = renderHook(() => useConflictResolutions());
    act(() => { first.result.current.start(T); });
    act(() => { first.result.current.finishErr(T, 'still here'); });
    first.unmount();
    const second = renderHook(() => useConflictResolutions());
    expect(second.result.current.stateFor(T)).toMatchObject({ kind: 'failed', error: 'still here' });
  });
});
