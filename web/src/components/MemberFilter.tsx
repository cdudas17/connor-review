interface Props {
  members: string[];
  selected: Set<string>;
  countsByMember: Record<string, number>;
  onToggle: (login: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}

export function MemberFilter({ members, selected, countsByMember, onToggle, onSelectAll, onClearAll }: Props) {
  if (members.length === 0) return null;
  const allOn = members.every((m) => selected.has(m));
  return (
    <div className="member-filter" role="toolbar" aria-label="Filter by author">
      <div className="member-filter-chips">
        {members.map((m) => {
          const isOn = selected.has(m);
          const count = countsByMember[m] ?? 0;
          return (
            <button
              key={m}
              type="button"
              className={`member-chip${isOn ? ' member-chip-on' : ''}`}
              onClick={() => onToggle(m)}
              aria-pressed={isOn}
              title={isOn ? `Hide ${m}'s PRs` : `Show ${m}'s PRs`}
            >
              <span className="member-chip-name">{m}</span>
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
