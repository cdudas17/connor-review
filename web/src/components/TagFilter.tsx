/**
 * Chip-based filter for PR title tags ([ID->UUID], [ATM-SYNC], …). Mirrors the
 * MemberFilter layout/UX — toggling each chip changes the OR-filter, and a
 * "Select all / Clear all" bulk button sits at the end. PRs that match ANY
 * selected tag are shown; PRs whose tag set is disjoint from the selection
 * are hidden. PRs with no bracket tags fall under the synthetic [ANY] chip.
 *
 * The dashboard only renders the filter when there are ≥2 tags — a single tag
 * would collapse the list to all or nothing, which is useless noise.
 */

import { ANY_TAG } from '../lib/extractTags.js';

interface Props {
  tags: string[];
  selected: Set<string>;
  countsByTag: Record<string, number>;
  onToggle: (tag: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}

export function TagFilter({ tags, selected, countsByTag, onToggle, onSelectAll, onClearAll }: Props) {
  if (tags.length < 2) return null;
  const allOn = tags.every((t) => selected.has(t));
  return (
    <div className="member-filter" role="toolbar" aria-label="Filter by tag">
      <div className="member-filter-chips">
        {tags.map((t) => {
          const isOn = selected.has(t);
          const count = countsByTag[t] ?? 0;
          const isAny = t === ANY_TAG;
          const label = `[${t}]`;
          const title = isAny
            ? isOn ? 'Hide PRs without any leading bracket tags' : 'Show PRs without any leading bracket tags'
            : isOn ? `Hide PRs tagged [${t}]` : `Show PRs tagged [${t}]`;
          return (
            <button
              key={t}
              type="button"
              className={`member-chip${isOn ? ' member-chip-on' : ''}`}
              onClick={() => onToggle(t)}
              aria-pressed={isOn}
              title={title}
            >
              <span className="member-chip-name">{label}</span>
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
