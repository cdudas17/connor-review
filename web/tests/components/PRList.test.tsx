import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PRList } from '../../src/components/PRList.js';
import type { TrackedPR } from '../../src/types.js';

const PRS: TrackedPR[] = [
  { owner: 'a', repo: 'b', number: 1, title: 'First', authorLogin: 'alice', status: 'untouched', addedAt: 1 },
  { owner: 'a', repo: 'b', number: 2, title: 'Second', authorLogin: 'bob', status: 'reviewed', addedAt: 2 },
  { owner: 'a', repo: 'b', number: 3, title: 'Third', authorLogin: 'carol', status: 'approved', addedAt: 3 },
];

describe('PRList', () => {
  it('renders all PRs in `all` mode', () => {
    render(<PRList prs={PRS} mode="all" onOpen={() => {}} />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(screen.getByText('Third')).toBeInTheDocument();
  });

  it('hides reviewed and approved PRs in `untouched-only`', () => {
    render(<PRList prs={PRS} mode="untouched-only" onOpen={() => {}} />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.queryByText('Second')).not.toBeInTheDocument();
    expect(screen.queryByText('Third')).not.toBeInTheDocument();
  });

  it('calls onOpen with identity on row click', async () => {
    const onOpen = vi.fn();
    render(<PRList prs={PRS} mode="all" onOpen={onOpen} />);
    await userEvent.click(screen.getByText('Second'));
    expect(onOpen).toHaveBeenCalledWith({ owner: 'a', repo: 'b', number: 2 });
  });

  it('shows empty state when filtered list is empty', () => {
    render(<PRList prs={[]} mode="all" onOpen={() => {}} />);
    expect(screen.getByText(/no prs/i)).toBeInTheDocument();
  });
});
