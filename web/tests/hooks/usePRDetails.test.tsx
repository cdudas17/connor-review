import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
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
});
