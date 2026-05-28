import { useMemo, useState } from 'react';
import { parsePRUrls, type ParsedPR } from '../lib/parsePRUrl.js';

interface Props {
  onAdd: (prs: ParsedPR[]) => void;
  /** When set, renders a "Remove approved" button next to Add. Click bulk-removes
   *  approved PRs from the calling list. */
  onRemoveApproved?: () => void;
  /** Number of approved PRs in the calling list. Drives the button label and disabled state. */
  approvedCount?: number;
}

export function AddPRBar({ onAdd, onRemoveApproved, approvedCount = 0 }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => parsePRUrls(value), [value]);

  const submit = () => {
    if (value.trim() === '') {
      setError('Paste one or more GitHub PR URLs');
      return;
    }
    if (preview.prs.length === 0) {
      setError('No valid GitHub PR URLs found');
      return;
    }
    setError(null);
    setValue('');
    onAdd(preview.prs);
  };

  return (
    <div className="add-pr-bar">
      <textarea
        placeholder="Paste a GitHub PR URL (or several, one per line)"
        value={value}
        onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
        onKeyDown={(e) => {
          // Enter submits; Shift+Enter inserts a newline (default behavior).
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={Math.min(8, Math.max(1, value.split('\n').length))}
      />
      <div className="add-pr-bar-actions">
        <button type="button" onClick={submit}>
          {preview.prs.length > 1 ? `Add ${preview.prs.length} PRs` : 'Add'}
        </button>
        {onRemoveApproved && (
          <button
            type="button"
            className="add-pr-bar-remove-approved"
            onClick={onRemoveApproved}
            disabled={approvedCount === 0}
            title="Remove every approved PR from this list"
          >
            Remove approved{approvedCount > 0 ? ` (${approvedCount})` : ''}
          </button>
        )}
        {value.trim() !== '' && (
          <p className="add-pr-bar-hint">
            {preview.prs.length === 0
              ? `0 valid URLs · ${preview.invalidCount} ignored`
              : `${preview.prs.length} valid${preview.invalidCount > 0 ? ` · ${preview.invalidCount} ignored` : ''}`}
            {' · '}<kbd>Enter</kbd> to add · <kbd>Shift</kbd>+<kbd>Enter</kbd> for new line
          </p>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
