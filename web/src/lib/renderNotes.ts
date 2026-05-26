/**
 * Tiny markdown → HTML renderer for the Notes panel. Intentionally small:
 *
 * - Escapes HTML in the source first so user input can't inject tags.
 * - Converts `[text](http(s)://url)` into safe `<a>` tags with target=_blank.
 * - Auto-linkifies bare http(s) URLs that aren't already inside a markdown link.
 * - Preserves line breaks via `<br>` (no paragraph parsing — notes are a stream).
 *
 * We do NOT support bold/italic/headers/etc. The goal is *just* link clickability
 * in a scratchpad. If we ever need real markdown, switch to a real library.
 */

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const MD_LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const BARE_URL = /(^|[^"=>])(https?:\/\/[^\s<]+)/g;

export function renderNotesToHtml(source: string): string {
  if (!source) return '';
  let s = escapeHtml(source);

  // [text](url) → <a href="url">text</a>. Use a placeholder so the bare-URL pass
  // doesn't re-linkify the href we just inserted.
  s = s.replace(MD_LINK, (_m, text: string, url: string) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  // Linkify bare URLs not already inside an <a href="…">.
  s = s.replace(BARE_URL, (_m, lead: string, url: string) => {
    return `${lead}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });

  // Preserve line breaks visually.
  s = s.replace(/\n/g, '<br>');
  return s;
}
