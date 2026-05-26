import type { PRAssignee } from '../types.js';
import { PersonIcon } from './PersonIcon.js';

export function AssigneesRow({ assignees }: { assignees: PRAssignee[] }) {
  if (!assignees || assignees.length === 0) return null;
  return (
    <div className="pr-assignees" aria-label="Assignees">
      <span className="pr-assignees-label">
        <PersonIcon /> Assigned
      </span>
      <ul>
        {assignees.map((a) => (
          <li key={a.login}>
            {a.url ? (
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="pr-assignee">
                {a.avatarUrl && <img src={a.avatarUrl} alt="" width={20} height={20} />}
                <span>{a.login}</span>
              </a>
            ) : (
              <span className="pr-assignee">
                {a.avatarUrl && <img src={a.avatarUrl} alt="" width={20} height={20} />}
                <span>{a.login}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
