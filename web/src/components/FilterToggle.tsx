export type FilterMode = 'untouched-only' | 'all';

interface Props {
  mode: FilterMode;
  onChange: (mode: FilterMode) => void;
}

export function FilterToggle({ mode, onChange }: Props) {
  const next = mode === 'untouched-only' ? 'all' : 'untouched-only';
  const label = mode === 'untouched-only' ? 'Untouched only' : 'Showing all';
  return (
    <button type="button" className="filter-toggle" onClick={() => onChange(next)} aria-pressed={mode === 'untouched-only'}>
      {label}
    </button>
  );
}
