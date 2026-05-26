import { useEffect, useRef } from 'react';
import { isHttpUrl } from '../lib/pasteLinkify.js';

interface Props {
  initialHtml: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

/**
 * `contenteditable` notes editor. Acts like a textarea you can also click links in.
 *
 * - Stores HTML. On mount we set innerHTML once; after that, the DOM is the source
 *   of truth and we just relay changes to `onChange`.
 * - Pasting a URL onto a selection inserts a real `<a>` element (no markdown
 *   intermediate). Pasting anything else is forced to plain text so we don't
 *   inherit formatting from the source page.
 * - Clicking on a link inside the editor opens it in a new tab instead of moving
 *   the caret. Caret can still be placed via arrow keys / clicking adjacent text.
 */
export function NotesEditor({ initialHtml, onChange, placeholder }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Set initial content exactly once. Re-rendering on every keystroke would fight
  // the caret position.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== initialHtml) {
      ref.current.innerHTML = initialHtml;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Allow external `Clear` actions: if the parent clears notes to '', wipe the DOM.
  useEffect(() => {
    if (ref.current && initialHtml === '' && ref.current.innerHTML !== '') {
      ref.current.innerHTML = '';
    }
  }, [initialHtml]);

  const handleInput = () => {
    if (ref.current) onChange(ref.current.innerHTML);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const selectedText = sel.toString();
    const pasted = e.clipboardData.getData('text');

    if (selectedText && isHttpUrl(pasted)) {
      e.preventDefault();
      range.deleteContents();
      const a = document.createElement('a');
      a.href = pasted.trim();
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = selectedText;
      range.insertNode(a);
      range.setStartAfter(a);
      range.setEndAfter(a);
      sel.removeAllRanges();
      sel.addRange(range);
      handleInput();
      return;
    }

    // Force plain text for any other paste so we don't inherit weird formatting.
    e.preventDefault();
    range.deleteContents();
    const text = pasted;
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    sel.removeAllRanges();
    sel.addRange(range);
    handleInput();
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const a = target.closest('a');
    if (a instanceof HTMLAnchorElement && a.href) {
      e.preventDefault();
      window.open(a.href, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      className="notes-editor"
      onInput={handleInput}
      onPaste={handlePaste}
      onClick={handleClick}
      role="textbox"
      aria-multiline="true"
      aria-label="Notes"
      data-placeholder={placeholder}
      spellCheck
    />
  );
}
