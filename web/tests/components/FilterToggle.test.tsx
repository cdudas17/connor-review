import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterToggle } from '../../src/components/FilterToggle.js';

describe('FilterToggle', () => {
  it('renders the current mode label', () => {
    render(<FilterToggle mode="untouched-only" onChange={() => {}} />);
    expect(screen.getByText(/untouched only/i)).toBeInTheDocument();
  });

  it('calls onChange with the other mode on click', async () => {
    const onChange = vi.fn();
    render(<FilterToggle mode="untouched-only" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onChange).toHaveBeenCalledWith('all');
  });
});
