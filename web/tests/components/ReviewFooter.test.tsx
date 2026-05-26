import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewFooter } from '../../src/components/ReviewFooter.js';

interface HarnessHooks {
  onSummary?: (v: string) => void;
  onSubmit?: ReturnType<typeof vi.fn>;
  onReviewed?: ReturnType<typeof vi.fn>;
  onPrev?: ReturnType<typeof vi.fn>;
  onNextPR?: ReturnType<typeof vi.fn>;
  canSubmit?: boolean;
  canReviewed?: boolean;
  canPrev?: boolean;
  canNextPR?: boolean;
}

function Harness(props: HarnessHooks) {
  const [summary, setSummary] = useState('');
  return (
    <ReviewFooter
      summary={summary}
      onSummaryChange={(v) => { setSummary(v); props.onSummary?.(v); }}
      onSubmit={props.onSubmit ?? (() => {})}
      onReviewed={props.onReviewed ?? (() => {})}
      onPrev={props.onPrev ?? (() => {})}
      onNextPR={props.onNextPR ?? (() => {})}
      canSubmit={props.canSubmit ?? true}
      canReviewed={props.canReviewed ?? true}
      canPrev={props.canPrev ?? true}
      canNextPR={props.canNextPR ?? true}
    />
  );
}

describe('ReviewFooter', () => {
  it('updates summary via onSummaryChange', async () => {
    const onSummary = vi.fn();
    render(<Harness onSummary={onSummary} />);
    await userEvent.type(screen.getByLabelText(/review summary/i), 'lgtm');
    expect((screen.getByLabelText(/review summary/i) as HTMLTextAreaElement).value).toBe('lgtm');
    expect(onSummary).toHaveBeenLastCalledWith('lgtm');
  });

  it('calls onSubmit with APPROVE / REQUEST_CHANGES / COMMENT', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(onSubmit).toHaveBeenLastCalledWith('APPROVE');
    await userEvent.click(screen.getByRole('button', { name: /request changes/i }));
    expect(onSubmit).toHaveBeenLastCalledWith('REQUEST_CHANGES');
    await userEvent.click(screen.getByRole('button', { name: /^comment$/i }));
    expect(onSubmit).toHaveBeenLastCalledWith('COMMENT');
  });

  it('disables submit buttons when canSubmit is false', () => {
    render(<Harness canSubmit={false} />);
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
  });

  it('calls onReviewed when clicking Reviewed', async () => {
    const onReviewed = vi.fn();
    render(<Harness onReviewed={onReviewed} />);
    await userEvent.click(screen.getByRole('button', { name: /^reviewed$/i }));
    expect(onReviewed).toHaveBeenCalled();
  });

  it('navigation arrows call onPrev / onNextPR without changing review state', async () => {
    const onPrev = vi.fn();
    const onNextPR = vi.fn();
    const onReviewed = vi.fn();
    render(<Harness onPrev={onPrev} onNextPR={onNextPR} onReviewed={onReviewed} />);
    await userEvent.click(screen.getByRole('button', { name: /previous pr/i }));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onReviewed).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /^next pr$/i }));
    expect(onNextPR).toHaveBeenCalledTimes(1);
    expect(onReviewed).not.toHaveBeenCalled();
  });

  it('disables nav arrows independently from the Reviewed button', () => {
    render(<Harness canPrev={false} canNextPR={true} />);
    expect(screen.getByRole('button', { name: /previous pr/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^next pr$/i })).not.toBeDisabled();
  });
});
