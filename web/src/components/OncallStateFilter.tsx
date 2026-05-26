export type OncallState = 'draft' | 'ready';

interface Props {
  selected: Set<OncallState>;
  countsByState: Record<OncallState, number>;
  onToggle: (state: OncallState) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}

const LABELS: Record<OncallState, string> = {
  draft: 'Draft',
  ready: 'Ready for review',
};

export function OncallStateFilter({ selected, countsByState, onToggle, onSelectAll, onClearAll }: Props) {
  const states: OncallState[] = ['draft', 'ready'];
  const allOn = states.every((s) => selected.has(s));
  return (
    <div className="member-filter" role="toolbar" aria-label="Filter by PR state">
      <div className="member-filter-chips">
        {states.map((s) => {
          const isOn = selected.has(s);
          const count = countsByState[s] ?? 0;
          return (
            <button
              key={s}
              type="button"
              className={`member-chip${isOn ? ' member-chip-on' : ''}`}
              onClick={() => onToggle(s)}
              aria-pressed={isOn}
              title={isOn ? `Hide ${LABELS[s]} PRs` : `Show ${LABELS[s]} PRs`}
            >
              <span className="member-chip-name">{LABELS[s]}</span>
              {count > 0 && <span className="member-chip-count">{count}</span>}
            </button>
          );
        })}
      </div>
      <div className="member-filter-bulk">
        <button type="button" onClick={allOn ? onClearAll : onSelectAll}>
          {allOn ? 'Clear all' : 'Select all'}
        </button>
      </div>
    </div>
  );
}
