import { forwardRef, useCallback, useImperativeHandle, useRef, useState, type TextareaHTMLAttributes, type KeyboardEvent } from 'react';
import { search as searchEmoji, get as getEmoji } from 'node-emoji';

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;
function escapeRegex(s: string): string { return s.replace(REGEX_SPECIAL, '\\$&'); }

/**
 * `node-emoji`'s `search()` treats the query as a regex pattern, which crashes on
 * inputs like `:+1`. Wrap it: escape regex specials, and merge in an exact-key
 * lookup so canonical names like "+1" or "-1" still surface as the top hit.
 */
function safeSearchEmoji(query: string): Array<{ name: string; emoji: string }> {
  const exact = getEmoji(query);
  let matches: Array<{ name: string; emoji: string }> = [];
  try {
    matches = searchEmoji(escapeRegex(query)) ?? [];
  } catch {
    matches = [];
  }
  if (exact) {
    const filtered = matches.filter((m) => m.name !== query);
    return [{ name: query, emoji: exact }, ...filtered];
  }
  return matches;
}

interface Suggestion { name: string; emoji: string; }

type Props = TextareaHTMLAttributes<HTMLTextAreaElement>;

/**
 * Mirror-div technique: build a hidden block element matching the textarea's text
 * layout, fill it with text up to the caret + a marker, measure the marker's
 * position relative to the textarea. Works in every modern browser.
 */
function getCaretPixelOffset(el: HTMLTextAreaElement, position: number): { top: number; left: number; lineHeight: number } {
  const style = window.getComputedStyle(el);
  const mirror = document.createElement('div');
  const props = [
    'boxSizing', 'width',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'fontStretch',
    'letterSpacing', 'wordSpacing', 'textIndent', 'textAlign', 'textTransform',
    'lineHeight', 'tabSize', 'MozTabSize',
    'whiteSpace', 'wordWrap', 'wordBreak', 'overflowWrap', 'direction',
  ] as const;
  for (const p of props) {
    // @ts-expect-error – dynamic style copy
    mirror.style[p] = style[p];
  }
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.overflow = 'hidden';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordWrap = 'break-word';
  mirror.style.width = `${el.clientWidth}px`;
  mirror.textContent = el.value.substring(0, position);
  const marker = document.createElement('span');
  marker.textContent = el.value.substring(position) || '.';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const lineHeight = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) * 1.4);
  const top = marker.offsetTop - el.scrollTop;
  const left = marker.offsetLeft - el.scrollLeft;
  document.body.removeChild(mirror);
  return { top, left, lineHeight };
}

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
  const [caret, setCaret] = useState<{ top: number; left: number; lineHeight: number; flipUp: boolean } | null>(null);

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
    const el = ref.current;
    const tok = getCurrentToken();
    if (!el || !tok || tok.query.length < 1) { setSuggestions([]); setCaret(null); return; }
    const matches = safeSearchEmoji(tok.query).slice(0, 7);
    setSuggestions(matches);
    setActive(0);
    const c = getCaretPixelOffset(el, el.selectionStart ?? 0);
    // Estimate dropdown size (7 rows × ~34px + 8px padding) and flip above the caret
    // if it would otherwise clip the viewport bottom.
    const DROPDOWN_HEIGHT = matches.length * 34 + 12;
    const elRect = el.getBoundingClientRect();
    const caretBottomInViewport = elRect.top + c.top + c.lineHeight;
    const spaceBelow = window.innerHeight - caretBottomInViewport;
    const spaceAbove = elRect.top + c.top;
    const flipUp = spaceBelow < DROPDOWN_HEIGHT && spaceAbove > spaceBelow;
    setCaret({ ...c, flipUp });
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
      {suggestions.length > 0 && caret && (
        <ul
          className="emoji-suggestions"
          role="listbox"
          style={caret.flipUp
            ? { bottom: `calc(100% - ${caret.top}px + 2px)`, left: caret.left }
            : { top: caret.top + caret.lineHeight + 2, left: caret.left }}
        >
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
