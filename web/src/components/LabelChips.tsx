import type { PRLabel } from '../types.js';

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace('#', '');
  return {
    r: parseInt(m.slice(0, 2), 16) || 0,
    g: parseInt(m.slice(2, 4), 16) || 0,
    b: parseInt(m.slice(4, 6), 16) || 0,
  };
}

function isDarkColor(hex: string): boolean {
  const { r, g, b } = hexToRgb(hex);
  // YIQ luminance — same heuristic GitHub Primer uses
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

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
