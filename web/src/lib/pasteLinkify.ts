/**
 * GitHub-style paste behavior: when the user pastes a URL while text is selected
 * in a textarea, replace the selection with `[selected](url)` markdown.
 * Returns true if it handled the paste (and called preventDefault on the event).
 */

export function isHttpUrl(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length === 0) return false;
  // Reject anything with internal whitespace — keeps multi-line text from being treated
  // as a URL even if its first token happens to be one.
  if (/\s/.test(trimmed)) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

export function handlePasteLinkify(e: React.ClipboardEvent<HTMLTextAreaElement>): boolean {
  const el = e.currentTarget;
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  if (start === end) return false; // nothing selected — let the default paste happen
  const pasted = e.clipboardData.getData('text');
  if (!isHttpUrl(pasted)) return false;
  e.preventDefault();
  const selected = el.value.slice(start, end);
  const replacement = `[${selected}](${pasted.trim()})`;
  const next = el.value.slice(0, start) + replacement + el.value.slice(end);
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(el, next);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  // Caret lands at the end of the inserted link so the next paste continues writing.
  const caret = start + replacement.length;
  el.setSelectionRange(caret, caret);
  return true;
}
