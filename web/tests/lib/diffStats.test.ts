import { describe, it, expect } from 'vitest';
import { computeDiffStats } from '../../src/lib/diffStats.js';

describe('computeDiffStats', () => {
  it('returns zeroes for null / undefined / empty input', () => {
    expect(computeDiffStats(null)).toEqual({ additions: 0, deletions: 0, files: 0 });
    expect(computeDiffStats(undefined)).toEqual({ additions: 0, deletions: 0, files: 0 });
    expect(computeDiffStats('')).toEqual({ additions: 0, deletions: 0, files: 0 });
  });

  it('counts additions / deletions / files in a single-file unified diff', () => {
    const diff = [
      'diff --git a/foo.ts b/foo.ts',
      'index 1234..5678 100644',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -1,3 +1,4 @@',
      ' const x = 1;',
      '-const y = 2;',
      '+const y = 3;',
      '+const z = 4;',
      ' const done = true;',
    ].join('\n');
    expect(computeDiffStats(diff)).toEqual({ additions: 2, deletions: 1, files: 1 });
  });

  it('does not count the `+++` / `---` file headers as content lines', () => {
    const diff = [
      'diff --git a/foo.ts b/foo.ts',
      '--- a/foo.ts',
      '+++ b/foo.ts',
    ].join('\n');
    expect(computeDiffStats(diff)).toEqual({ additions: 0, deletions: 0, files: 1 });
  });

  it('aggregates across multiple files', () => {
    const diff = [
      'diff --git a/foo.ts b/foo.ts',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '+added in foo',
      'diff --git a/bar.ts b/bar.ts',
      '--- a/bar.ts',
      '+++ b/bar.ts',
      '-removed in bar',
      '-also removed',
      '+added in bar',
    ].join('\n');
    expect(computeDiffStats(diff)).toEqual({ additions: 2, deletions: 2, files: 2 });
  });
});
