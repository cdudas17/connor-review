import { describe, it, expect } from 'vitest';
import { isHttpUrl } from '../../src/lib/pasteLinkify.js';

describe('isHttpUrl', () => {
  it('accepts canonical http(s) URLs', () => {
    expect(isHttpUrl('https://github.com/Gusto/zenpayroll/pull/1')).toBe(true);
    expect(isHttpUrl('http://example.com')).toBe(true);
  });

  it('trims surrounding whitespace before deciding', () => {
    expect(isHttpUrl('   https://example.com\n')).toBe(true);
  });

  it('rejects non-http schemes', () => {
    expect(isHttpUrl('ftp://example.com')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('mailto:x@y.com')).toBe(false);
  });

  it('rejects plain text and multi-word strings with internal whitespace', () => {
    expect(isHttpUrl('not a url')).toBe(false);
    expect(isHttpUrl('https://example.com extra')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
    expect(isHttpUrl('   ')).toBe(false);
  });

  it('rejects bare paths and hostnames without a scheme', () => {
    expect(isHttpUrl('github.com/x/y')).toBe(false);
    expect(isHttpUrl('/local/path')).toBe(false);
  });
});
