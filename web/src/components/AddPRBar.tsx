import { useMemo, useState } from 'react';
import { parsePRUrls, type ParsedPR } from '../lib/parsePRUrl.js';

interface Props {
  onAdd: (prs: ParsedPR[]) => void;
}

export function AddPRBar({ onAdd }: Props) {
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
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
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
        {value.trim() !== '' && (
          <p className="add-pr-bar-hint">
            {preview.prs.length === 0
              ? `0 valid URLs · ${preview.invalidCount} ignored`
              : `${preview.prs.length} valid${preview.invalidCount > 0 ? ` · ${preview.invalidCount} ignored` : ''}`}
            {' · '}<kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd> to add
          </p>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
