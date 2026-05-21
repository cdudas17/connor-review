import { forwardRef, useCallback, useImperativeHandle, useRef, useState, type TextareaHTMLAttributes, type KeyboardEvent } from 'react';
import { search as searchEmoji } from 'node-emoji';

interface Suggestion { name: string; emoji: string; }

type Props = TextareaHTMLAttributes<HTMLTextAreaElement>;

/**
 * Textarea drop-in that opens a `:shortcode:` emoji autocomplete dropdown
 * (matches GitHub's behaviour). Typing `:fire` brings up a list; ArrowUp /
 * ArrowDown navigates, Enter or Tab inserts the selected emoji, Escape closes.
 * Mouse-click on a suggestion also inserts.
 */
export const EmojiTextarea = forwardRef<HTMLTextAreaElement, Props>(function EmojiTextarea(props, forwardedRef) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useImperativeHandle(forwardedRef, () => ref.current!, []);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(0);

  const getCurrentToken = useCallback((): { start: number; query: string } | null => {
    const el = ref.current; if (!el) return null;
    const value = el.value;
    const cursor = el.selectionStart ?? 0;
    let start = cursor - 1;
    while (start >= 0 && /[a-zA-Z0-9_+-]/.test(value[start])) start--;
    if (start < 0 || value[start] !== ':') return null;
    if (start > 0 && /[a-zA-Z0-9]/.test(value[start - 1])) return null;
    const query = value.slice(start + 1, cursor);
    if (!/^[a-zA-Z0-9_+-]*$/.test(query)) return null;
    return { start, query };
  }, []);

  const updateSuggestions = useCallback(() => {
    const tok = getCurrentToken();
    if (!tok || tok.query.length < 1) { setSuggestions([]); return; }
    const matches = (searchEmoji(tok.query) ?? []).slice(0, 7);
    setSuggestions(matches);
    setActive(0);
  }, [getCurrentToken]);

  const insert = useCallback((emoji: string) => {
    const el = ref.current; if (!el) return;
    const tok = getCurrentToken(); if (!tok) return;
    const cursor = el.selectionStart ?? 0;
    const before = el.value.slice(0, tok.start);
    const after = el.value.slice(cursor);
    const newValue = before + emoji + after;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, newValue);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const caret = before.length + emoji.length;
    el.setSelectionRange(caret, caret);
    setSuggestions([]);
    el.focus();
  }, [getCurrentToken]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % suggestions.length); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActive((a) => (a - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(suggestions[active].emoji); return; }
      if (e.key === 'Escape')    { e.preventDefault(); setSuggestions([]); return; }
    }
    props.onKeyDown?.(e);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    props.onChange?.(e);
    // Run on next tick so the textarea value/cursor are updated.
    queueMicrotask(updateSuggestions);
  };

  const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    // Delay so a click on a suggestion can register before we hide.
    setTimeout(() => setSuggestions([]), 120);
    props.onBlur?.(e);
  };

  return (
    <div className="emoji-textarea">
      <textarea {...props} ref={ref} onChange={handleChange} onKeyDown={handleKeyDown} onBlur={handleBlur} />
      {suggestions.length > 0 && (
        <ul className="emoji-suggestions" role="listbox">
          {suggestions.map((s, i) => (
            <li key={s.name}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className={`emoji-suggestion${i === active ? ' emoji-suggestion-active' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); insert(s.emoji); }}
              >
                <span className="emoji-suggestion-emoji">{s.emoji}</span>
                <span className="emoji-suggestion-name">{s.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
