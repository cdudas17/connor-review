import { forwardRef, useCallback, useImperativeHandle, useRef, useState, type TextareaHTMLAttributes, type KeyboardEvent } from 'react';
import { search as searchEmoji, get as getEmoji } from 'node-emoji';
import { handlePasteLinkify } from '../lib/pasteLinkify.js';
import { useMentionCandidates } from '../contexts/MentionsContext.js';

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
/** Token-detector for either trigger style. Returns `null` if the caret isn't
 * inside a recognisable trigger. `kind: 'emoji'` for `:foo`, `kind: 'mention'`
 * for `@foo`. Both require a non-alphanumeric (or start-of-string) character
 * immediately before the trigger so e.g. `email:foo` or `a@b` don't fire. */
function getCurrentToken(el: HTMLTextAreaElement): { kind: 'emoji' | 'mention'; start: number; query: string } | null {
  const value = el.value;
  const cursor = el.selectionStart ?? 0;
  let start = cursor - 1;
  while (start >= 0 && /[a-zA-Z0-9_+-]/.test(value[start])) start--;
  if (start < 0) return null;
  const triggerChar = value[start];
  if (triggerChar !== ':' && triggerChar !== '@') return null;
  if (start > 0 && /[a-zA-Z0-9]/.test(value[start - 1])) return null;
  const query = value.slice(start + 1, cursor);
  if (!/^[a-zA-Z0-9_+-]*$/.test(query)) return null;
  return { kind: triggerChar === ':' ? 'emoji' : 'mention', start, query };
}

/** Filter the user-supplied mention candidates by the typed query. Case-
 * insensitive prefix match first (most relevant), then case-insensitive
 * substring match (still helpful). Caps at 7 results to match the emoji
 * popup's footprint. */
function filterMentions(candidates: readonly string[], query: string): string[] {
  if (candidates.length === 0) return [];
  const q = query.toLowerCase();
  if (q.length === 0) {
    // No query yet — return the first 7 to give the user something to click.
    return candidates.slice(0, 7);
  }
  const prefix: string[] = [];
  const substring: string[] = [];
  for (const c of candidates) {
    const lc = c.toLowerCase();
    if (lc.startsWith(q)) prefix.push(c);
    else if (lc.includes(q)) substring.push(c);
  }
  return [...prefix, ...substring].slice(0, 7);
}

type ActiveSuggestions =
  | { kind: 'emoji'; items: Suggestion[] }
  | { kind: 'mention'; items: string[] }
  | null;

export const EmojiTextarea = forwardRef<HTMLTextAreaElement, Props>(function EmojiTextarea(props, forwardedRef) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useImperativeHandle(forwardedRef, () => ref.current!, []);
  const mentionCandidates = useMentionCandidates();
  const [suggestions, setSuggestions] = useState<ActiveSuggestions>(null);
  const [active, setActive] = useState(0);
  const [caret, setCaret] = useState<{ top: number; left: number; lineHeight: number; flipUp: boolean } | null>(null);

  const updateSuggestions = useCallback(() => {
    const el = ref.current;
    const tok = el ? getCurrentToken(el) : null;
    if (!el || !tok) { setSuggestions(null); setCaret(null); return; }

    let items: ActiveSuggestions = null;
    if (tok.kind === 'emoji') {
      if (tok.query.length < 1) { setSuggestions(null); setCaret(null); return; }
      items = { kind: 'emoji', items: safeSearchEmoji(tok.query).slice(0, 7) };
    } else {
      // Mentions: allow showing a list even with empty query so the user can
      // browse candidates after typing just `@`.
      const matches = filterMentions(mentionCandidates, tok.query);
      if (matches.length === 0) { setSuggestions(null); setCaret(null); return; }
      items = { kind: 'mention', items: matches };
    }
    setSuggestions(items);
    setActive(0);
    const c = getCaretPixelOffset(el, el.selectionStart ?? 0);
    // Estimate dropdown size (7 rows × ~34px + 8px padding) and flip above the caret
    // if it would otherwise clip the viewport bottom.
    const rowCount = items.kind === 'emoji' ? items.items.length : items.items.length;
    const DROPDOWN_HEIGHT = rowCount * 34 + 12;
    const elRect = el.getBoundingClientRect();
    const caretBottomInViewport = elRect.top + c.top + c.lineHeight;
    const spaceBelow = window.innerHeight - caretBottomInViewport;
    const spaceAbove = elRect.top + c.top;
    const flipUp = spaceBelow < DROPDOWN_HEIGHT && spaceAbove > spaceBelow;
    setCaret({ ...c, flipUp });
  }, [mentionCandidates]);

  /** Replace the active trigger token with `replacement` (the emoji glyph
   * itself, or `@<login> ` for a mention). */
  const insert = useCallback((replacement: string) => {
    const el = ref.current; if (!el) return;
    const tok = getCurrentToken(el); if (!tok) return;
    const cursor = el.selectionStart ?? 0;
    const before = el.value.slice(0, tok.start);
    const after = el.value.slice(cursor);
    const newValue = before + replacement + after;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, newValue);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const caretPos = before.length + replacement.length;
    el.setSelectionRange(caretPos, caretPos);
    setSuggestions(null);
    el.focus();
  }, []);

  const insertActiveSuggestion = useCallback((s: ActiveSuggestions, i: number) => {
    if (!s) return;
    if (s.kind === 'emoji') { insert(s.items[i].emoji); return; }
    insert(`@${s.items[i]} `);
  }, [insert]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions) {
      const len = suggestions.items.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % len); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActive((a) => (a - 1 + len) % len); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertActiveSuggestion(suggestions, active); return; }
      if (e.key === 'Escape')    { e.preventDefault(); setSuggestions(null); return; }
    }
    props.onKeyDown?.(e);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    props.onChange?.(e);
    // Run on next tick so the textarea value/cursor are updated.
    queueMicrotask(updateSuggestions);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const handled = handlePasteLinkify(e);
    if (!handled) props.onPaste?.(e);
  };

  const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    // Delay so a click on a suggestion can register before we hide.
    setTimeout(() => setSuggestions(null), 120);
    props.onBlur?.(e);
  };

  // Also surface the popup the moment the user types `@` (no query yet) so
  // they can browse. The change handler already runs on every keystroke;
  // updateSuggestions handles the empty-query mention case.

  return (
    <div className="emoji-textarea">
      <textarea {...props} ref={ref} onChange={handleChange} onKeyDown={handleKeyDown} onBlur={handleBlur} onPaste={handlePaste} />
      {suggestions && caret && (
        <ul
          className={`emoji-suggestions${suggestions.kind === 'mention' ? ' emoji-suggestions-mention' : ''}`}
          role="listbox"
          style={caret.flipUp
            ? { bottom: `calc(100% - ${caret.top}px + 2px)`, left: caret.left }
            : { top: caret.top + caret.lineHeight + 2, left: caret.left }}
        >
          {suggestions.kind === 'emoji'
            ? suggestions.items.map((s, i) => (
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
              ))
            : suggestions.items.map((login, i) => (
                <li key={login}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    className={`emoji-suggestion${i === active ? ' emoji-suggestion-active' : ''}`}
                    onMouseDown={(e) => { e.preventDefault(); insert(`@${login} `); }}
                  >
                    <span className="emoji-suggestion-emoji" aria-hidden="true">@</span>
                    <span className="emoji-suggestion-name">{login}</span>
                  </button>
                </li>
              ))}
        </ul>
      )}
    </div>
  );
});
