import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClaudeResponseCard } from '../../src/components/ClaudeResponseCard.js';

describe('ClaudeResponseCard', () => {
  it('renders nothing when state is null', () => {
    const { container } = render(<ClaudeResponseCard state={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the asking-spinner state', () => {
    render(<ClaudeResponseCard state={{ loading: true }} />);
    expect(screen.getByText(/asking claude/i)).toBeInTheDocument();
    // No dismiss button while loading (don't let the user kill an in-flight request mid-spinner).
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
  });

  it('renders the response body when loaded', () => {
    render(<ClaudeResponseCard state={{ loading: false, body: 'Looks good, but consider the null path.' }} />);
    expect(screen.getByText(/claude says/i)).toBeInTheDocument();
    expect(screen.getByText(/consider the null path/i)).toBeInTheDocument();
  });

  it('renders an error message instead of a body on failure', () => {
    render(<ClaudeResponseCard state={{ loading: false, error: 'claude CLI not found' }} />);
    expect(screen.getByText(/claude cli not found/i)).toBeInTheDocument();
  });

  it('surfaces the truncated-diff note only when the body is present', () => {
    const { rerender } = render(<ClaudeResponseCard state={{ loading: false, body: 'ok', truncatedDiff: true }} />);
    expect(screen.getByText(/diff was truncated/i)).toBeInTheDocument();
    // Note should not show when loading or on error, even with truncatedDiff set.
    rerender(<ClaudeResponseCard state={{ loading: true, truncatedDiff: true }} />);
    expect(screen.queryByText(/diff was truncated/i)).not.toBeInTheDocument();
    rerender(<ClaudeResponseCard state={{ loading: false, error: 'x', truncatedDiff: true }} />);
    expect(screen.queryByText(/diff was truncated/i)).not.toBeInTheDocument();
  });

  it('fires onDismiss when the × is clicked', async () => {
    const onDismiss = vi.fn();
    render(<ClaudeResponseCard state={{ loading: false, body: 'ok' }} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
