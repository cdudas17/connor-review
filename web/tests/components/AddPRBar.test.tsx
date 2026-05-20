import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddPRBar } from '../../src/components/AddPRBar.js';

describe('AddPRBar', () => {
  it('calls onAdd with parsed PR when URL is valid', async () => {
    const onAdd = vi.fn();
    render(<AddPRBar onAdd={onAdd} />);
    await userEvent.type(screen.getByPlaceholderText(/paste a github pr url/i), 'https://github.com/Gusto/zenpayroll/pull/341597');
    await userEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(onAdd).toHaveBeenCalledWith({ owner: 'Gusto', repo: 'zenpayroll', number: 341597 });
  });

  it('shows an error and does not call onAdd for invalid URL', async () => {
    const onAdd = vi.fn();
    render(<AddPRBar onAdd={onAdd} />);
    await userEvent.type(screen.getByPlaceholderText(/paste a github pr url/i), 'not a url');
    await userEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByText(/not a valid github pr url/i)).toBeInTheDocument();
  });

  it('clears input after successful add', async () => {
    render(<AddPRBar onAdd={() => {}} />);
    const input = screen.getByPlaceholderText(/paste a github pr url/i) as HTMLInputElement;
    await userEvent.type(input, 'https://github.com/Gusto/zenpayroll/pull/1');
    await userEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(input.value).toBe('');
  });
});
