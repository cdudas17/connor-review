import { marked } from 'marked';
import DOMPurify from 'dompurify';

// GFM on, line-breaks as <br/>. Sync parse — `marked.parse(str)` can return a
// Promise in async mode, so we cast.
marked.setOptions({ gfm: true, breaks: true });

/** Render an untrusted markdown string to sanitized HTML, safe for
 * dangerouslySetInnerHTML. Used for Claude responses where the upstream
 * doesn't pre-sanitize like GitHub does. */
export function renderMarkdown(markdown: string): string {
  if (!markdown) return '';
  const html = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(html);
}
