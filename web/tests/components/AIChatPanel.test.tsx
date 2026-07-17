import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AIChatPanel } from '../../src/components/AIChatPanel.js';
import type { AIChat } from '../../src/hooks/useAIResponses.js';

describe('AIChatPanel', () => {
  it('renders nothing when chat is null or empty', () => {
    const { container, rerender } = render(<AIChatPanel chat={null} onAsk={() => {}} onClear={() => {}} />);
    expect(container.firstChild).toBeNull();
    rerender(<AIChatPanel chat={{ turns: [], savedAt: Date.now() }} onAsk={() => {}} onClear={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders user + claude turns with markdown-rendered claude content', () => {
    const chat: AIChat = {
      savedAt: Date.now(),
      turns: [
        { role: 'user', body: 'is this safe?', ts: 1 },
        { role: 'ai', body: '**Yes** with caveats', ts: 2 },
      ],
    };
    const { container } = render(<AIChatPanel chat={chat} onAsk={() => {}} onClear={() => {}} />);
    expect(screen.getByText(/is this safe/)).toBeInTheDocument();
    // markdown rendered
    expect(container.querySelector('.ai-chat-turn-ai .ai-chat-turn-body strong')?.textContent).toBe('Yes');
  });

  it('shows a spinner on a loading claude turn', () => {
    const chat: AIChat = {
      savedAt: Date.now(),
      turns: [
        { role: 'user', body: 'q', ts: 1 },
        { role: 'ai', body: '', ts: 2, loading: true },
      ],
    };
    const { container } = render(<AIChatPanel chat={chat} onAsk={() => {}} onClear={() => {}} />);
    expect(container.querySelector('.ai-chat-turn-loading')).not.toBeNull();
    expect(container.querySelector('.loading-spinner')).not.toBeNull();
  });

  it('renders an error in a settled claude turn', () => {
    const chat: AIChat = {
      savedAt: Date.now(),
      turns: [
        { role: 'user', body: 'q', ts: 1 },
        { role: 'ai', body: '', ts: 2, error: 'claude CLI not found' },
      ],
    };
    render(<AIChatPanel chat={chat} onAsk={() => {}} onClear={() => {}} />);
    expect(screen.getByText(/claude cli not found/i)).toBeInTheDocument();
  });

  it('Send fires onAsk with the input draft, clears the input', async () => {
    const chat: AIChat = {
      savedAt: Date.now(),
      turns: [
        { role: 'user', body: 'q1', ts: 1 },
        { role: 'ai', body: 'A1', ts: 2 },
      ],
    };
    const onAsk = vi.fn();
    render(<AIChatPanel chat={chat} onAsk={onAsk} onClear={() => {}} />);
    const textarea = screen.getByPlaceholderText(/follow up/i) as HTMLTextAreaElement;
    await userEvent.type(textarea, 'and what about edge cases?');
    await userEvent.click(screen.getByRole('button', { name: /^send$/i }));
    expect(onAsk).toHaveBeenCalledWith('and what about edge cases?');
    expect(textarea.value).toBe('');
  });

  it('Enter submits, Shift+Enter inserts a newline', async () => {
    const chat: AIChat = {
      savedAt: Date.now(),
      turns: [
        { role: 'user', body: 'q', ts: 1 },
        { role: 'ai', body: 'A', ts: 2 },
      ],
    };
    const onAsk = vi.fn();
    render(<AIChatPanel chat={chat} onAsk={onAsk} onClear={() => {}} />);
    const textarea = screen.getByPlaceholderText(/follow up/i) as HTMLTextAreaElement;
    // Shift+Enter → newline, no submit.
    await userEvent.type(textarea, 'line 1{Shift>}{Enter}{/Shift}line 2');
    expect(onAsk).not.toHaveBeenCalled();
    expect(textarea.value).toBe('line 1\nline 2');
    // Plain Enter → submit, input clears.
    await userEvent.type(textarea, '{Enter}');
    expect(onAsk).toHaveBeenCalledWith('line 1\nline 2');
    expect(textarea.value).toBe('');
  });

  it('Send is disabled while any turn is loading', () => {
    const chat: AIChat = {
      savedAt: Date.now(),
      turns: [
        { role: 'user', body: 'q1', ts: 1 },
        { role: 'ai', body: '', ts: 2, loading: true },
      ],
    };
    render(<AIChatPanel chat={chat} onAsk={() => {}} onClear={() => {}} />);
    expect((screen.getByRole('button', { name: /asking…/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Clear chat fires onClear', async () => {
    const chat: AIChat = {
      savedAt: Date.now(),
      turns: [
        { role: 'user', body: 'q', ts: 1 },
        { role: 'ai', body: 'A', ts: 2 },
      ],
    };
    const onClear = vi.fn();
    render(<AIChatPanel chat={chat} onAsk={() => {}} onClear={onClear} />);
    await userEvent.click(screen.getByRole('button', { name: /clear chat/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
