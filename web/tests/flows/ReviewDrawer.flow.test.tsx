import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/App.js';

describe('ReviewDrawer flow', () => {
  beforeEach(() => localStorage.clear());

  it('adds two PRs, approves the first, Next on the second, ends the queue', async () => {
    render(<App />);

    const input = screen.getByPlaceholderText(/paste a github pr url/i);

    await userEvent.type(input, 'https://github.com/Gusto/zenpayroll/pull/1');
    await userEvent.click(screen.getByRole('button', { name: /add/i }));
    await screen.findByText(/Test PR/i);

    await userEvent.type(input, 'https://github.com/Gusto/zenpayroll/pull/2');
    await userEvent.click(screen.getByRole('button', { name: /add/i }));
    await screen.findByText(/Second PR/i);

    // open the first one
    await userEvent.click(screen.getByText(/Test PR/i));
    await screen.findByRole('button', { name: /approve/i });

    // approve PR 1
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));

    // drawer advances to PR 2 (heading shows "Second PR")
    await screen.findByRole('heading', { name: /Second PR/i });

    // Next without drafts → status flips to reviewed, drawer closes (queue empty by filter)
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await screen.findByText(/no prs to review/i);
  });

  it('Next with staged drafts triggers discard modal; cancel preserves state', async () => {
    render(<App />);

    await userEvent.type(screen.getByPlaceholderText(/paste a github pr url/i), 'https://github.com/Gusto/zenpayroll/pull/1');
    await userEvent.click(screen.getByRole('button', { name: /add/i }));
    await screen.findByText(/Test PR/i);
    await userEvent.click(screen.getByText(/Test PR/i));
    await screen.findByLabelText(/review summary/i);

    // type a summary so drafts.hasAny() is true
    await userEvent.type(screen.getByLabelText(/review summary/i), 'wip');
    expect((screen.getByLabelText(/review summary/i) as HTMLTextAreaElement).value).toBe('wip');

    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    const modal = await screen.findByRole('dialog');
    expect(within(modal).getByRole('heading', { name: /unsent comments/i })).toBeInTheDocument();

    // cancel preserves state
    await userEvent.click(within(modal).getByRole('button', { name: /cancel/i }));
    expect((screen.getByLabelText(/review summary/i) as HTMLTextAreaElement).value).toBe('wip');
  });
});
