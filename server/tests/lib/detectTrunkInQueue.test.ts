import { describe, it, expect } from 'vitest';
import { detectTrunkInQueue } from '../../src/lib/ciUrl.js';

describe('detectTrunkInQueue', () => {
  it('returns false for null / undefined / empty input', () => {
    expect(detectTrunkInQueue(null)).toBe(false);
    expect(detectTrunkInQueue(undefined)).toBe(false);
    expect(detectTrunkInQueue([])).toBe(false);
  });

  it('detects a CheckRun whose name starts with "Trunk" in IN_PROGRESS', () => {
    const contexts = [
      { __typename: 'CheckRun', name: 'CI', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { __typename: 'CheckRun', name: 'Trunk Merge', status: 'IN_PROGRESS', conclusion: null },
    ];
    expect(detectTrunkInQueue(contexts)).toBe(true);
  });

  it('detects a CheckRun in QUEUED state too', () => {
    const contexts = [
      { __typename: 'CheckRun', name: 'trunk-merge', status: 'QUEUED', conclusion: null },
    ];
    expect(detectTrunkInQueue(contexts)).toBe(true);
  });

  it('returns false when the Trunk check is COMPLETED (already finished)', () => {
    const contexts = [
      { __typename: 'CheckRun', name: 'Trunk Merge', status: 'COMPLETED', conclusion: 'SUCCESS' },
    ];
    expect(detectTrunkInQueue(contexts)).toBe(false);
  });

  it('ignores non-Trunk CheckRuns even if they are in progress', () => {
    const contexts = [
      { __typename: 'CheckRun', name: 'CI / lint', status: 'IN_PROGRESS', conclusion: null },
      { __typename: 'CheckRun', name: 'CI / test', status: 'IN_PROGRESS', conclusion: null },
    ];
    expect(detectTrunkInQueue(contexts)).toBe(false);
  });

  it('detects a StatusContext named "trunk-merge" in PENDING state', () => {
    const contexts = [
      { __typename: 'StatusContext', context: 'trunk-merge', state: 'PENDING' },
    ];
    expect(detectTrunkInQueue(contexts)).toBe(true);
  });

  it('ignores a non-Trunk StatusContext in PENDING', () => {
    const contexts = [
      { __typename: 'StatusContext', context: 'buildkite/zenpayroll', state: 'PENDING' },
    ];
    expect(detectTrunkInQueue(contexts)).toBe(false);
  });
});
