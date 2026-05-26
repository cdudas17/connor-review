import { PersonIcon } from './PersonIcon.js';

interface Props {
  url: string | null | undefined;
  login: string | null;
  size?: number;
}

/**
 * Round avatar image. Falls back to the generic PersonIcon when no URL is
 * available (e.g. a deleted GitHub account). Inline element so it sits next
 * to text comfortably.
 */
export function Avatar({ url, login, size = 20 }: Props) {
  if (url) {
    return (
      <img
        src={url}
        alt={login ?? ''}
        width={size}
        height={size}
        className="avatar"
        loading="lazy"
      />
    );
  }
  return <PersonIcon size={size} />;
}
