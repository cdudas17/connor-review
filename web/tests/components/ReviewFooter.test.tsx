import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewFooter } from '../../src/components/ReviewFooter.js';

function ControlledHarness({ onSummary }: { onSummary?: (v: string) => void }) {
  const [summary, setSummary] = useState('');
  return (
    <ReviewFooter
      summary={summary}
      onSummaryChange={(v) => { setSummary(v); onSummary?.(v); }}
      onSubmit={() => {}}
      onNext={() => {}}
      canSubmit
      canNext
    />
  );
}

describe('ReviewFooter', () => {
  it('updates summary via onSummaryChange', async () => {
    const onSummary = vi.fn();
    render(<ControlledHarness onSummary={onSummary} />);
    await userEvent.type(screen.getByLabelText(/review summary/i), 'lgtm');
    expect((screen.getByLabelText(/review summary/i) as HTMLTextAreaElement).value).toBe('lgtm');
    expect(onSummary).toHaveBeenLastCalledWith('lgtm');
  });

  it('calls onSubmit with APPROVE / REQUEST_CHANGES / COMMENT', async () => {
    const onSubmit = vi.fn();
    render(<ReviewFooter summary="ok" onSummaryChange={() => {}} onSubmit={onSubmit} onNext={() => {}} canSubmit canNext />);
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(onSubmit).toHaveBeenLastCalledWith('APPROVE');
    await userEvent.click(screen.getByRole('button', { name: /request changes/i }));
    expect(onSubmit).toHaveBeenLastCalledWith('REQUEST_CHANGES');
    await userEvent.click(screen.getByRole('button', { name: /^comment$/i }));
    expect(onSubmit).toHaveBeenLastCalledWith('COMMENT');
  });

  it('disables submit buttons when canSubmit is false', () => {
    render(<ReviewFooter summary="" onSummaryChange={() => {}} onSubmit={() => {}} onNext={() => {}} canSubmit={false} canNext />);
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
  });

  it('calls onNext when clicking Next', async () => {
    const onNext = vi.fn();
    render(<ReviewFooter summary="" onSummaryChange={() => {}} onSubmit={() => {}} onNext={onNext} canSubmit canNext />);
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(onNext).toHaveBeenCalled();
  });
});
