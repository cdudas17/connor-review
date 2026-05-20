import { describe, it, expect } from 'vitest';
import { parsePullParams, BadParamsError } from '../src/lib/parseRouteParams.js';

describe('parsePullParams', () => {
  it('returns owner/repo/number for valid input', () => {
    expect(parsePullParams({ owner: 'Gusto', repo: 'zenpayroll', number: '341597' })).toEqual({
      owner: 'Gusto',
      repo: 'zenpayroll',
      number: 341597,
    });
  });

  it('rejects non-numeric number', () => {
    expect(() => parsePullParams({ owner: 'a', repo: 'b', number: 'oops' })).toThrow(BadParamsError);
  });

  it('rejects invalid owner characters', () => {
    expect(() => parsePullParams({ owner: 'has space', repo: 'b', number: '1' })).toThrow(BadParamsError);
  });

  it('rejects empty repo', () => {
    expect(() => parsePullParams({ owner: 'a', repo: '', number: '1' })).toThrow(BadParamsError);
  });
});
