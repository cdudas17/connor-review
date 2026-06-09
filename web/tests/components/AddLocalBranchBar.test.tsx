import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddLocalBranchBar } from '../../src/components/AddLocalBranchBar.js';

describe('AddLocalBranchBar', () => {
  it('renders a "no localRepos configured" hint when the repo list is empty', () => {
    const { container } = render(<AddLocalBranchBar repos={[]} onAdd={() => {}} />);
    // The hint spans multiple text nodes (it includes <code> tags), so match against
    // the rendered text content rather than a single text node.
    expect(container.textContent?.toLowerCase()).toContain('no');
    expect(container.textContent?.toLowerCase()).toContain('localrepos');
    expect(container.textContent?.toLowerCase()).toContain('configured');
    expect(screen.queryByRole('button', { name: /^add$/i })).not.toBeInTheDocument();
  });

  it('calls onAdd with (repo, branch) on submit and clears the branch input on success', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<AddLocalBranchBar repos={['zenpayroll', 'web']} onAdd={onAdd} />);
    const branchInput = screen.getByPlaceholderText(/branch name/i) as HTMLInputElement;
    await userEvent.selectOptions(screen.getByRole('combobox'), 'web');
    await userEvent.type(branchInput, 'feature/foo');
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(onAdd).toHaveBeenCalledWith('web', 'feature/foo');
    // input clears after a successful add
    expect(branchInput.value).toBe('');
  });

  it('shows an inline error when onAdd rejects and keeps the branch input populated', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('branch not found'));
    render(<AddLocalBranchBar repos={['web']} onAdd={onAdd} />);
    const branchInput = screen.getByPlaceholderText(/branch name/i) as HTMLInputElement;
    await userEvent.type(branchInput, 'does-not-exist');
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(await screen.findByText(/branch not found/i)).toBeInTheDocument();
    // input is retained so the user can edit + retry
    expect(branchInput.value).toBe('does-not-exist');
  });

  it('refuses to submit with an empty branch', async () => {
    const onAdd = vi.fn();
    render(<AddLocalBranchBar repos={['web']} onAdd={onAdd} />);
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(await screen.findByText(/enter a branch name/i)).toBeInTheDocument();
  });

  it('submits on Enter inside the branch input', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<AddLocalBranchBar repos={['web']} onAdd={onAdd} />);
    const branchInput = screen.getByPlaceholderText(/branch name/i);
    await userEvent.type(branchInput, 'feature/bar{Enter}');
    expect(onAdd).toHaveBeenCalledWith('web', 'feature/bar');
  });
});
