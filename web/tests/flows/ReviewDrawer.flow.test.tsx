import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/App.js';

describe('ReviewDrawer flow', () => {
  beforeEach(() => localStorage.clear());

  it('adds two PRs, approves the first, marks the second Reviewed, ends the queue', async () => {
    render(<App />);

    const input = screen.getByPlaceholderText(/paste a github pr url/i);

    await userEvent.type(input, 'https://github.com/Gusto/zenpayroll/pull/1');
    await userEvent.click(screen.getByRole('button', { name: /^add/i }));
    await screen.findByText(/Test PR/i);

    await userEvent.type(input, 'https://github.com/Gusto/zenpayroll/pull/2');
    await userEvent.click(screen.getByRole('button', { name: /^add/i }));
    await screen.findByText(/Second PR/i);

    // open the first one
    await userEvent.click(screen.getByText(/Test PR/i));
    await screen.findByRole('button', { name: /^approve$/i });

    // approve PR 1 — fires a fresh APPROVE review (no pending), advances to PR 2
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    await screen.findByRole('heading', { name: /Second PR/i });

    // Reviewed on PR 2 — status flips to reviewed, drawer closes (no more untouched in queue).
    await userEvent.click(screen.getByRole('button', { name: /^reviewed$/i }));
    // Drawer closed → no review summary textarea on screen.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByLabelText(/review summary/i)).not.toBeInTheDocument();

    // Switch filter to Untouched-only and confirm the empty state.
    await userEvent.click(screen.getByRole('button', { name: /showing all/i }));
    await screen.findByText(/no prs to review/i);
  });
});
