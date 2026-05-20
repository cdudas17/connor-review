import { describe, it, expect } from 'vitest';
import { LRUCache } from '../src/lib/lruCache.js';

describe('LRUCache', () => {
  it('returns undefined for a miss', () => {
    const c = new LRUCache<string, number>(3);
    expect(c.get('a')).toBeUndefined();
  });

  it('returns the same reference on a hit', () => {
    const c = new LRUCache<string, { v: number }>(3);
    const obj = { v: 1 };
    c.set('a', obj);
    expect(c.get('a')).toBe(obj);
  });

  it('evicts the least-recently-used entry at capacity', () => {
    const c = new LRUCache<string, number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a');           // touches a → a is most-recent
    c.set('c', 3);        // should evict b
    expect(c.get('a')).toBe(1);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('c')).toBe(3);
  });

  it('overwrites and refreshes recency on a set of an existing key', () => {
    const c = new LRUCache<string, number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('a', 11);   // refresh + overwrite
    c.set('c', 3);    // should evict b
    expect(c.get('a')).toBe(11);
    expect(c.get('b')).toBeUndefined();
  });
});
