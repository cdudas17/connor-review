import { describe, expect, it } from 'vitest';
import { ANY_TAG, effectiveTags, extractTags } from '../../src/lib/extractTags.js';

describe('extractTags', () => {
  it('extracts a single leading bracket tag', () => {
    expect(extractTags('[ID->UUID] Rename V0::Review id/employee_id/...')).toEqual(['ID->UUID']);
  });

  it('extracts multiple contiguous tags', () => {
    expect(extractTags('[ATM-SYNC][FF-ON] Enable meli_atm_flow_refactor'))
      .toEqual(['ATM-SYNC', 'FF-ON']);
  });

  it('returns empty for titles with no tags', () => {
    expect(extractTags('Plain title without tags')).toEqual([]);
  });

  it('tolerates whitespace around and between tags', () => {
    expect(extractTags('  [FOO]  [BAR] body')).toEqual(['FOO', 'BAR']);
  });

  it('does not pick up bracketed text later in the title', () => {
    expect(extractTags('WIP: rename [Foo] bar')).toEqual([]);
  });

  it('handles null/undefined/empty titles safely', () => {
    expect(extractTags(null)).toEqual([]);
    expect(extractTags(undefined)).toEqual([]);
    expect(extractTags('')).toEqual([]);
  });

  it('skips empty-content brackets', () => {
    expect(extractTags('[]  body')).toEqual([]);
    expect(extractTags('[FOO][] body')).toEqual(['FOO']);
  });
});

describe('effectiveTags', () => {
  it('returns extracted tags when present', () => {
    expect(effectiveTags('[FOO][BAR] body')).toEqual(['FOO', 'BAR']);
  });

  it('returns the ANY sentinel when no tags', () => {
    expect(effectiveTags('Plain title')).toEqual([ANY_TAG]);
    expect(effectiveTags('')).toEqual([ANY_TAG]);
    expect(effectiveTags(null)).toEqual([ANY_TAG]);
  });
});
