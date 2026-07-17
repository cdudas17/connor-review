import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AIResponseCard } from '../../src/components/AIResponseCard.js';

describe('AIResponseCard', () => {
  it('renders nothing when state is null', () => {
    const { container } = render(<AIResponseCard state={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the asking-spinner state', () => {
    render(<AIResponseCard state={{ loading: true }} />);
    expect(screen.getByText(/asking/i)).toBeInTheDocument();
    // No dismiss button while loading (don't let the user kill an in-flight request mid-spinner).
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
  });

  it('renders the response body when loaded', () => {
    render(<AIResponseCard state={{ loading: false, body: 'Looks good, but consider the null path.' }} />);
    expect(screen.getByText(/ai says/i)).toBeInTheDocument();
    expect(screen.getByText(/consider the null path/i)).toBeInTheDocument();
  });

  it('renders markdown formatting (bold, inline code, lists) — not literal asterisks/backticks', () => {
    const md = [
      'A few **bold** thoughts about `<hr />`:',
      '',
      '- one',
      '- two',
    ].join('\n');
    const { container } = render(<AIResponseCard state={{ loading: false, body: md }} />);
    // Marked + DOMPurify should produce real <strong>, <code>, <ul><li> elements.
    expect(container.querySelector('.ai-response-body strong')?.textContent).toBe('bold');
    expect(container.querySelector('.ai-response-body code')?.textContent).toBe('<hr />');
    expect(container.querySelectorAll('.ai-response-body ul li')).toHaveLength(2);
    // And no literal markdown leakage into the rendered text.
    expect(container.querySelector('.ai-response-body')?.textContent).not.toContain('**');
  });

  it('sanitizes injected <script> tags from Claude output', () => {
    const md = 'before<script>window.__pwned = 1</script>after';
    const { container } = render(<AIResponseCard state={{ loading: false, body: md }} />);
    expect(container.querySelector('.ai-response-body script')).toBeNull();
  });

  it('renders an error message instead of a body on failure', () => {
    render(<AIResponseCard state={{ loading: false, error: 'claude CLI not found' }} />);
    expect(screen.getByText(/claude cli not found/i)).toBeInTheDocument();
  });

  it('surfaces the truncated-diff note only when the body is present', () => {
    const { rerender } = render(<AIResponseCard state={{ loading: false, body: 'ok', truncatedDiff: true }} />);
    expect(screen.getByText(/diff was truncated/i)).toBeInTheDocument();
    // Note should not show when loading or on error, even with truncatedDiff set.
    rerender(<AIResponseCard state={{ loading: true, truncatedDiff: true }} />);
    expect(screen.queryByText(/diff was truncated/i)).not.toBeInTheDocument();
    rerender(<AIResponseCard state={{ loading: false, error: 'x', truncatedDiff: true }} />);
    expect(screen.queryByText(/diff was truncated/i)).not.toBeInTheDocument();
  });

  it('fires onDismiss when the × is clicked', async () => {
    const onDismiss = vi.fn();
    render(<AIResponseCard state={{ loading: false, body: 'ok' }} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
