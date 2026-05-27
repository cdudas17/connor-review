import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddPRBar } from '../../src/components/AddPRBar.js';

const placeholder = /paste a github pr url/i;

describe('AddPRBar', () => {
  it('calls onAdd with an array containing the parsed PR for one URL', async () => {
    const onAdd = vi.fn();
    render(<AddPRBar onAdd={onAdd} />);
    await userEvent.type(screen.getByPlaceholderText(placeholder), 'https://github.com/Gusto/zenpayroll/pull/341597');
    await userEvent.click(screen.getByRole('button', { name: /^add/i }));
    expect(onAdd).toHaveBeenCalledWith([{ owner: 'Gusto', repo: 'zenpayroll', number: 341597 }]);
  });

  it('calls onAdd with all parsed PRs from multi-line input', async () => {
    const onAdd = vi.fn();
    render(<AddPRBar onAdd={onAdd} />);
    const textarea = screen.getByPlaceholderText(placeholder);
    const input = [
      'https://github.com/Gusto/zenpayroll/pull/341496',
      'https://github.com/Gusto/zenpayroll/pull/340963',
      'https://github.com/Gusto/zenpayroll/pull/338351',
    ].join('\n');
    // Use fireEvent-style paste via .clear + .type would be slow; userEvent.paste is faster.
    textarea.focus();
    await userEvent.paste(input);
    expect(screen.getByText(/3 valid/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /add 3 prs/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    const arg = onAdd.mock.calls[0][0] as Array<{ number: number }>;
    expect(arg.map((p) => p.number)).toEqual([341496, 340963, 338351]);
  });

  it('shows an error and does not call onAdd when no valid URLs are present', async () => {
    const onAdd = vi.fn();
    render(<AddPRBar onAdd={onAdd} />);
    await userEvent.type(screen.getByPlaceholderText(placeholder), 'not a url');
    await userEvent.click(screen.getByRole('button', { name: /^add/i }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByText(/no valid github pr urls found/i)).toBeInTheDocument();
  });

  it('clears textarea after successful add', async () => {
    render(<AddPRBar onAdd={() => {}} />);
    const textarea = screen.getByPlaceholderText(placeholder) as HTMLTextAreaElement;
    await userEvent.type(textarea, 'https://github.com/Gusto/zenpayroll/pull/1');
    await userEvent.click(screen.getByRole('button', { name: /^add/i }));
    expect(textarea.value).toBe('');
  });

  it('Enter submits, Shift+Enter inserts a newline', async () => {
    const onAdd = vi.fn();
    render(<AddPRBar onAdd={onAdd} />);
    const textarea = screen.getByPlaceholderText(placeholder) as HTMLTextAreaElement;

    // Shift+Enter inside an in-progress entry — should NOT submit and should leave a newline.
    await userEvent.type(textarea, 'https://github.com/Gusto/zenpayroll/pull/1{Shift>}{Enter}{/Shift}https://github.com/Gusto/zenpayroll/pull/2');
    expect(onAdd).not.toHaveBeenCalled();
    expect(textarea.value).toContain('\n');

    // Plain Enter submits both URLs.
    await userEvent.type(textarea, '{Enter}');
    expect(onAdd).toHaveBeenCalledTimes(1);
    const args = onAdd.mock.calls[0][0] as Array<{ number: number }>;
    expect(args.map((p) => p.number)).toEqual([1, 2]);
    expect(textarea.value).toBe('');
  });

  it('shows an ignored count when input has mixed valid + invalid lines', async () => {
    render(<AddPRBar onAdd={() => {}} />);
    const textarea = screen.getByPlaceholderText(placeholder);
    textarea.focus();
    await userEvent.paste('https://github.com/a/b/pull/1\noops\nhttps://github.com/a/b/pull/2');
    expect(screen.getByText(/2 valid · 1 ignored/i)).toBeInTheDocument();
  });
});
