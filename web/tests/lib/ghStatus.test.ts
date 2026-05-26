import { describe, it, expect } from 'vitest';
import { computeGhStatus, GH_STATUS_LABEL } from '../../src/lib/ghStatus.js';

const base = {
  state: 'OPEN' as const,
  merged: false,
  isDraft: false,
  reviewDecision: null as null | 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED',
};

describe('computeGhStatus', () => {
  it('returns merged when merged is true (regardless of state)', () => {
    expect(computeGhStatus({ ...base, merged: true })).toBe('merged');
    expect(computeGhStatus({ ...base, merged: true, state: 'OPEN' })).toBe('merged');
  });

  it('returns merged when state is MERGED even if merged flag is false (unusual but possible)', () => {
    expect(computeGhStatus({ ...base, state: 'MERGED' })).toBe('merged');
  });

  it('returns closed when state is CLOSED and not merged', () => {
    expect(computeGhStatus({ ...base, state: 'CLOSED' })).toBe('closed');
  });

  it('returns draft when isDraft is true on an open PR', () => {
    expect(computeGhStatus({ ...base, isDraft: true })).toBe('draft');
  });

  it('does not return draft if the PR is merged (merged wins)', () => {
    expect(computeGhStatus({ ...base, merged: true, isDraft: true })).toBe('merged');
  });

  it('returns approved when reviewDecision is APPROVED', () => {
    expect(computeGhStatus({ ...base, reviewDecision: 'APPROVED' })).toBe('approved');
  });

  it('returns changes-requested when reviewDecision is CHANGES_REQUESTED', () => {
    expect(computeGhStatus({ ...base, reviewDecision: 'CHANGES_REQUESTED' })).toBe('changes-requested');
  });

  it('falls back to open when REVIEW_REQUIRED or null', () => {
    expect(computeGhStatus({ ...base, reviewDecision: 'REVIEW_REQUIRED' })).toBe('open');
    expect(computeGhStatus({ ...base, reviewDecision: null })).toBe('open');
  });

  it('precedence is merged > closed > draft > approved > changes-requested > open', () => {
    // closed beats draft (closed PR can also be marked as draft historically)
    expect(computeGhStatus({ ...base, state: 'CLOSED', isDraft: true })).toBe('closed');
    // draft beats approved (you can request review on a draft that already had a review)
    expect(computeGhStatus({ ...base, isDraft: true, reviewDecision: 'APPROVED' })).toBe('draft');
  });
});

describe('GH_STATUS_LABEL', () => {
  it('has a label for every status enum value', () => {
    expect(GH_STATUS_LABEL.draft).toBe('Draft');
    expect(GH_STATUS_LABEL.open).toBe('Open');
    expect(GH_STATUS_LABEL.approved).toBe('Approved');
    expect(GH_STATUS_LABEL['changes-requested']).toBe('Changes requested');
    expect(GH_STATUS_LABEL.merged).toBe('Merged');
    expect(GH_STATUS_LABEL.closed).toBe('Closed');
  });
});
