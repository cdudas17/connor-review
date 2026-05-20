import { describe, it, expect } from 'vitest';
import { parsePRUrl } from '../../src/lib/parsePRUrl.js';

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
