import { useState } from 'react';

interface Props {
  /** Configured repo names from AppConfig.localRepos. */
  repos: string[];
  /** Initial repo selection (first available). */
  initialRepo?: string;
  /** Fired when user submits a (repo, branch) pair. */
  onAdd: (repo: string, branch: string) => Promise<void> | void;
}

export function AddLocalBranchBar({ repos, initialRepo, onAdd }: Props) {
  const [repo, setRepo] = useState(initialRepo ?? repos[0] ?? '');
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = branch.trim();
    if (!repo) { setError('Pick a repo first'); return; }
    if (!trimmed) { setError('Enter a branch name'); return; }
    setError(null);
    setBusy(true);
    try {
      await onAdd(repo, trimmed);
      setBranch('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (repos.length === 0) {
    return (
      <div className="add-pr-bar">
        <p className="error">
          No <code>localRepos</code> configured. Add an entry to <code>web/src/config.local.ts</code> (see <code>config.local.example.ts</code>) to enable this tab.
        </p>
      </div>
    );
  }

  return (
    <div className="add-pr-bar">
      <div className="add-local-branch-row">
        <select value={repo} onChange={(e) => setRepo(e.target.value)} aria-label="Repo">
          {repos.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <input
          type="text"
          placeholder="branch name (e.g. feature/foo)"
          value={branch}
          onChange={(e) => { setBranch(e.target.value); if (error) setError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
          spellCheck={false}
        />
        <button type="button" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
