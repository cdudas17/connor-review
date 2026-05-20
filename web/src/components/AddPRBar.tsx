import { useState } from 'react';
import { parsePRUrl, type ParsedPR } from '../lib/parsePRUrl.js';

interface Props {
  onAdd: (pr: ParsedPR) => void;
}

export function AddPRBar({ onAdd }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const parsed = parsePRUrl(value);
    if (!parsed) {
      setError('Not a valid GitHub PR URL');
      return;
    }
    setError(null);
    setValue('');
    onAdd(parsed);
  };

  return (
    <div className="add-pr-bar">
      <input
        type="url"
        placeholder="Paste a GitHub PR URL"
        value={value}
        onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
      />
      <button type="button" onClick={submit}>Add</button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
