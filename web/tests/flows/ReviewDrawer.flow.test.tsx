import { describe, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/App.js';

describe('ReviewDrawer flow', () => {
  beforeEach(() => localStorage.clear());

  it('adds two PRs, approves the first, Next on the second, ends the queue', async () => {
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
    await screen.findByRole('button', { name: /approve/i });

    // approve PR 1 — fires a fresh APPROVE review (no pending), advances to PR 2
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    await screen.findByRole('heading', { name: /Second PR/i });

    // Next on PR 2 — status flips to reviewed, queue empties in untouched-only mode
    await userEvent.click(screen.getByRole('button', { name: /^next$/i }));
    await screen.findByText(/no prs to review/i);
  });
});
