import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClaudeBadge } from '../../src/components/ClaudeBadge.js';

describe('ClaudeBadge', () => {
  it('renders nothing when state is null', () => {
    const { container } = render(<ClaudeBadge state={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the loading variant with a spinner', () => {
    const { container } = render(<ClaudeBadge state={{ kind: 'loading' }} />);
    expect(screen.getByText(/claude/i)).toBeInTheDocument();
    expect(container.querySelector('.claude-badge-loading')).not.toBeNull();
    expect(container.querySelector('.loading-spinner')).not.toBeNull();
  });

  it('shows the success variant', () => {
    const { container } = render(<ClaudeBadge state={{ kind: 'success' }} />);
    expect(container.querySelector('.claude-badge-success')).not.toBeNull();
    expect(screen.getByText(/claude/i).textContent).toContain('✦');
  });

  it('shows the error variant', () => {
    const { container } = render(<ClaudeBadge state={{ kind: 'error' }} />);
    expect(container.querySelector('.claude-badge-error')).not.toBeNull();
    expect(screen.getByText(/claude/i).textContent).toContain('!');
  });
});
