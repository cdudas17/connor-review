import type { PRLabel } from '../types.js';
import { isDarkColor } from '../lib/labelColor.js';

export function LabelChips({ labels, max }: { labels: PRLabel[]; max?: number }) {
  if (!labels || labels.length === 0) return null;
  const visible = max ? labels.slice(0, max) : labels;
  const hidden = labels.length - visible.length;
  return (
    <span className="label-chips">
      {visible.map((l) => {
        const dark = isDarkColor(l.color);
        return (
          <span
            key={l.name}
            className="label-chip"
            style={{ backgroundColor: `#${l.color}`, color: dark ? '#fff' : '#000' }}
            title={l.name}
          >
            {l.name}
          </span>
        );
      })}
      {hidden > 0 && <span className="label-chip-overflow" title={labels.slice(visible.length).map((l) => l.name).join(', ')}>+{hidden}</span>}
    </span>
  );
}
