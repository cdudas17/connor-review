interface Props {
  size?: number;
}

/** Octicons-style person glyph. Inline SVG, currentColor for easy theming. */
export function PersonIcon({ size = 16 }: Props) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false" className="person-icon">
      <path fill="currentColor" d="M10.5 5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM12 13c0-2.21-1.79-4-4-4s-4 1.79-4 4a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1z"/>
    </svg>
  );
}
