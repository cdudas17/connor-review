import { describe, it, expect } from 'vitest';
import { renderNotesToHtml } from '../../src/lib/renderNotes.js';

describe('renderNotesToHtml', () => {
  it('returns empty string for empty input', () => {
    expect(renderNotesToHtml('')).toBe('');
  });

  it('escapes HTML so user content can\'t inject tags', () => {
    expect(renderNotesToHtml('<script>alert(1)</script>')).not.toContain('<script>');
    expect(renderNotesToHtml('<script>alert(1)</script>')).toContain('&lt;script&gt;');
  });

  it('converts [text](http://url) into a real anchor with target=_blank', () => {
    const html = renderNotesToHtml('see [GitHub](https://github.com/x/y) for context');
    expect(html).toContain('<a href="https://github.com/x/y" target="_blank" rel="noopener noreferrer">GitHub</a>');
  });

  it('only links http/https schemes in markdown link syntax', () => {
    // javascript: should not match the MD_LINK regex (requires http(s)://) and stays as plain text
    const html = renderNotesToHtml('[click](javascript:alert(1))');
    expect(html).not.toContain('<a ');
    expect(html).toContain('javascript:alert(1)');
  });

  it('auto-linkifies bare http(s) URLs', () => {
    const html = renderNotesToHtml('go to https://buildkite.com/gusto/zenpayroll/builds/9 now');
    expect(html).toContain('<a href="https://buildkite.com/gusto/zenpayroll/builds/9"');
  });

  it('does not double-linkify URLs already inside a markdown link', () => {
    const html = renderNotesToHtml('[link](https://example.com)');
    // Exactly one <a> tag.
    const matches = html.match(/<a /g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('converts newlines to <br>', () => {
    expect(renderNotesToHtml('line one\nline two')).toBe('line one<br>line two');
  });
});
