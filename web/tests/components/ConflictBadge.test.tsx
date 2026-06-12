import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConflictBadge } from '../../src/components/ConflictBadge.js';

describe('ConflictBadge', () => {
  it('renders nothing when hasConflicts is false', () => {
    const { container } = render(<ConflictBadge hasConflicts={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a non-interactive span when no onClick is passed', () => {
    render(<ConflictBadge hasConflicts={true} />);
    const el = screen.getByLabelText('Merge conflicts');
    expect(el.tagName).toBe('SPAN');
  });

  it('renders a button when onClick is provided + fires the callback', () => {
    const onClick = vi.fn();
    render(<ConflictBadge hasConflicts={true} onClick={onClick} />);
    const btn = screen.getByLabelText('Merge conflicts');
    expect(btn.tagName).toBe('BUTTON');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows the spinner + disables the button while state="running"', () => {
    const onClick = vi.fn();
    const { container } = render(
      <ConflictBadge hasConflicts={true} onClick={onClick} state="running" />,
    );
    const btn = screen.getByLabelText('Resolving merge conflicts') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(container.querySelector('.loading-spinner')).not.toBeNull();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('header variant renders a labelled pill', () => {
    render(<ConflictBadge hasConflicts={true} variant="header" />);
    expect(screen.getByText('Merge conflicts')).toBeInTheDocument();
  });

  it('header variant shows "Resolving…" label during running state', () => {
    render(<ConflictBadge hasConflicts={true} variant="header" onClick={() => {}} state="running" />);
    expect(screen.getByText('Resolving…')).toBeInTheDocument();
  });

  it('failed state shows the retry tooltip', () => {
    const onClick = vi.fn();
    render(<ConflictBadge hasConflicts={true} onClick={onClick} state="failed" />);
    const btn = screen.getByLabelText('Merge conflicts');
    expect(btn.getAttribute('data-tooltip')).toContain('retry');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
