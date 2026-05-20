import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiscardDraftsModal } from '../../src/components/DiscardDraftsModal.js';

describe('DiscardDraftsModal', () => {
  it('does not render when open is false', () => {
    render(<DiscardDraftsModal open={false} onDiscard={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText(/unsent comments/i)).not.toBeInTheDocument();
  });

  it('renders and wires Discard / Cancel', async () => {
    const onDiscard = vi.fn();
    const onCancel = vi.fn();
    render(<DiscardDraftsModal open onDiscard={onDiscard} onCancel={onCancel} />);
    expect(screen.getByRole('heading', { name: /unsent comments/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /discard/i }));
    expect(onDiscard).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
