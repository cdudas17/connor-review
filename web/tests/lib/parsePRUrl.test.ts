import { describe, it, expect } from 'vitest';
import { parsePRUrl, parsePRUrls } from '../../src/lib/parsePRUrl.js';

describe('parsePRUrl', () => {
  it('parses a canonical PR URL', () => {
    expect(parsePRUrl('https://github.com/Gusto/zenpayroll/pull/341597')).toEqual({
      owner: 'Gusto', repo: 'zenpayroll', number: 341597,
    });
  });
  it('parses with trailing slash', () => {
    expect(parsePRUrl('https://github.com/Gusto/zenpayroll/pull/341597/')).toEqual({
      owner: 'Gusto', repo: 'zenpayroll', number: 341597,
    });
  });
  it('parses with /files suffix', () => {
    expect(parsePRUrl('https://github.com/Gusto/zenpayroll/pull/341597/files')).toEqual({
      owner: 'Gusto', repo: 'zenpayroll', number: 341597,
    });
  });
  it('parses with hash anchor', () => {
    expect(parsePRUrl('https://github.com/Gusto/zenpayroll/pull/341597#discussion_r123')).toEqual({
      owner: 'Gusto', repo: 'zenpayroll', number: 341597,
    });
  });
  it('returns null for an issue URL', () => {
    expect(parsePRUrl('https://github.com/Gusto/zenpayroll/issues/1')).toBeNull();
  });
  it('returns null for a non-github URL', () => {
    expect(parsePRUrl('https://gitlab.com/Gusto/zenpayroll/pull/1')).toBeNull();
  });
  it('returns null for malformed input', () => {
    expect(parsePRUrl('not a url')).toBeNull();
  });
});

describe('parsePRUrls', () => {
  it('returns empty result for empty input', () => {
    expect(parsePRUrls('')).toEqual({ prs: [], invalidCount: 0 });
    expect(parsePRUrls('   \n\t  ')).toEqual({ prs: [], invalidCount: 0 });
  });

  it('parses a single URL', () => {
    const result = parsePRUrls('https://github.com/Gusto/zenpayroll/pull/1');
    expect(result.prs).toEqual([{ owner: 'Gusto', repo: 'zenpayroll', number: 1 }]);
    expect(result.invalidCount).toBe(0);
  });

  it('parses multiple URLs separated by spaces', () => {
    const result = parsePRUrls('https://github.com/a/b/pull/1 https://github.com/a/b/pull/2');
    expect(result.prs).toHaveLength(2);
    expect(result.prs.map((p) => p.number)).toEqual([1, 2]);
  });

  it('parses multiple URLs separated by newlines', () => {
    const input = `https://github.com/Gusto/zenpayroll/pull/1
https://github.com/Gusto/zenpayroll/pull/2
https://github.com/Gusto/zenpayroll/pull/3`;
    const result = parsePRUrls(input);
    expect(result.prs).toHaveLength(3);
    expect(result.invalidCount).toBe(0);
  });

  it('parses URLs separated by mixed whitespace (spaces, tabs, newlines)', () => {
    const input = 'https://github.com/a/b/pull/1\n\thttps://github.com/a/b/pull/2   https://github.com/a/b/pull/3';
    const result = parsePRUrls(input);
    expect(result.prs).toHaveLength(3);
  });

  it('drops invalid URLs and counts them', () => {
    const input = 'https://github.com/a/b/pull/1\nnot-a-url\nhttps://github.com/a/b/pull/2';
    const result = parsePRUrls(input);
    expect(result.prs).toHaveLength(2);
    expect(result.invalidCount).toBe(1);
  });

  it('dedupes identical PR URLs in input', () => {
    const input = 'https://github.com/a/b/pull/1\nhttps://github.com/a/b/pull/1';
    const result = parsePRUrls(input);
    expect(result.prs).toHaveLength(1);
  });
});
