import { describe, it, expect } from 'vitest';
import { extractBuildkiteCheckUrl } from '../src/lib/ciUrl.js';

describe('extractBuildkiteCheckUrl', () => {
  it('returns null for an empty / nullish contexts list', () => {
    expect(extractBuildkiteCheckUrl(null)).toBeNull();
    expect(extractBuildkiteCheckUrl(undefined)).toBeNull();
    expect(extractBuildkiteCheckUrl([])).toBeNull();
  });

  it('returns the targetUrl from a StatusContext named buildkite/zenpayroll', () => {
    const url = extractBuildkiteCheckUrl([
      { __typename: 'StatusContext', context: 'buildkite/zenpayroll', state: 'FAILURE', targetUrl: 'https://buildkite.com/gusto/zenpayroll/builds/1547980' },
    ]);
    expect(url).toBe('https://buildkite.com/gusto/zenpayroll/builds/1547980');
  });

  it('returns the detailsUrl from a CheckRun named buildkite/zenpayroll', () => {
    const url = extractBuildkiteCheckUrl([
      { __typename: 'CheckRun', name: 'buildkite/zenpayroll', status: 'IN_PROGRESS', conclusion: null, detailsUrl: 'https://buildkite.com/gusto/zenpayroll/builds/2' },
    ]);
    expect(url).toBe('https://buildkite.com/gusto/zenpayroll/builds/2');
  });

  it('ignores other checks (CircleCI, GitHub Actions, etc.)', () => {
    const url = extractBuildkiteCheckUrl([
      { __typename: 'StatusContext', context: 'ci/circleci', targetUrl: 'https://circleci.com/x' },
      { __typename: 'CheckRun', name: 'codeql', detailsUrl: 'https://github.com/x' },
    ]);
    expect(url).toBeNull();
  });

  it('returns null when buildkite check exists but has no URL', () => {
    expect(extractBuildkiteCheckUrl([
      { __typename: 'StatusContext', context: 'buildkite/zenpayroll', targetUrl: null },
    ])).toBeNull();
    expect(extractBuildkiteCheckUrl([
      { __typename: 'StatusContext', context: 'buildkite/zenpayroll' },
    ])).toBeNull();
  });

  it('finds the buildkite check among unrelated checks', () => {
    const url = extractBuildkiteCheckUrl([
      { __typename: 'CheckRun', name: 'codeql', detailsUrl: 'https://github.com/x' },
      { __typename: 'StatusContext', context: 'ci/circleci', targetUrl: 'https://circleci.com/x' },
      { __typename: 'StatusContext', context: 'buildkite/zenpayroll', targetUrl: 'https://buildkite.com/gusto/zenpayroll/builds/9' },
      { __typename: 'CheckRun', name: 'sonarcloud', detailsUrl: 'https://sonarcloud.io/x' },
    ]);
    expect(url).toBe('https://buildkite.com/gusto/zenpayroll/builds/9');
  });

  it('skips null entries safely', () => {
    const url = extractBuildkiteCheckUrl([
      null as unknown as Parameters<typeof extractBuildkiteCheckUrl>[0] extends Array<infer T> | null | undefined ? T : never,
      { __typename: 'StatusContext', context: 'buildkite/zenpayroll', targetUrl: 'https://buildkite.com/gusto/zenpayroll/builds/3' },
    ]);
    expect(url).toBe('https://buildkite.com/gusto/zenpayroll/builds/3');
  });
});
