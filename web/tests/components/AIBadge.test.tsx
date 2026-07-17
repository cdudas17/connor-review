import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AIBadge } from '../../src/components/AIBadge.js';

describe('AIBadge', () => {
  it('renders nothing when state is null', () => {
    const { container } = render(<AIBadge state={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the loading variant with a spinner', () => {
    const { container } = render(<AIBadge state={{ kind: 'loading' }} />);
    expect(screen.getByLabelText(/asking claude/i)).toBeInTheDocument();
    expect(container.querySelector('.claude-badge-loading')).not.toBeNull();
    expect(container.querySelector('.loading-spinner')).not.toBeNull();
  });

  it('shows the success variant', () => {
    const { container } = render(<AIBadge state={{ kind: 'success' }} />);
    expect(container.querySelector('.claude-badge-success')).not.toBeNull();
    expect(screen.getByLabelText(/claude has a saved response/i).textContent).toContain('✦');
  });

  it('shows the error variant', () => {
    const { container } = render(<AIBadge state={{ kind: 'error' }} />);
    expect(container.querySelector('.claude-badge-error')).not.toBeNull();
    expect(screen.getByLabelText(/claude request failed/i).textContent).toContain('!');
  });
});
