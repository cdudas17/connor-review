import { useCallback, useEffect, useState } from 'react';

/** Per-issue "pinned to the top" preference, with enough display data
 * persisted alongside the key so the pinned section can render even when
 * the issue isn't in the current fetch (zero results, dropped from the
 * server's search window, etc.). Stored as a JSON object keyed by
 * \`${owner}/${repo}#${number}\` so lookup is constant-time and unpin is
 * cheap. */

export interface PinnedIssue {
  owner: string;
  repo: string;
  number: number;
  /** "owner/repo" — denormalised because the issues list uses it directly. */
  repository: string;
  title: string;
  authorLogin: string | null;
  /** Plain label names (matches MyIssue, no colours needed at the row). */
  labels: string[];
  /** ISO timestamp from the source feed. Used for the optional updatedAt sort. */
  updatedAt: string;
  /** Epoch ms when the user pinned. Used to keep the pinned list stable in
   * the order the user pinned things (most-recently-pinned first). */
  pinnedAt: number;
}

const STORAGE_KEY = 'connor-review.pinnedIssues.v2';
/** Legacy key — string[] of `owner/repo#number`. Migrated on first load:
 * we keep the keys and create stub PinnedIssue entries that get enriched
 * by the next fetch (see `reconcile` below). */
const LEGACY_STORAGE_KEY = 'connor-review.pinnedIssues.v1';

export function pinnedIssueKey(t: { owner: string; repo: string; number: number }): string {
  return `${t.owner}/${t.repo}#${t.number}`;
}

function load(): Record<string, PinnedIssue> {
  if (typeof localStorage === 'undefined') return {};
  // v2: full snapshots.
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, PinnedIssue>;
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch { /* fall through to migration */ }
  // v1 migration: keys-only array. Convert to stubs so the section renders
  // something (owner/repo#number) until a fetch enriches them.
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return {};
    const keys = JSON.parse(raw);
    if (!Array.isArray(keys)) return {};
    const now = Date.now();
    const out: Record<string, PinnedIssue> = {};
    for (const k of keys) {
      if (typeof k !== 'string') continue;
      const hashIdx = k.lastIndexOf('#');
      if (hashIdx <= 0) continue;
      const ownerRepo = k.slice(0, hashIdx);
      const number = parseInt(k.slice(hashIdx + 1), 10);
      const slash = ownerRepo.indexOf('/');
      if (slash <= 0 || !Number.isFinite(number)) continue;
      const owner = ownerRepo.slice(0, slash);
      const repo = ownerRepo.slice(slash + 1);
      out[k] = {
        owner, repo, number,
        repository: ownerRepo,
        title: `${ownerRepo}#${number}`,
        authorLogin: null,
        labels: [],
        updatedAt: '',
        pinnedAt: now,
      };
    }
    return out;
  } catch { return {}; }
}

function save(pinned: Record<string, PinnedIssue>) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pinned)); }
  catch { /* quota — fine */ }
}

export function usePinnedIssues() {
  const [pinned, setPinned] = useState<Record<string, PinnedIssue>>(() => load());
  useEffect(() => { save(pinned); }, [pinned]);

  /** Toggle the pin for a given issue. When pinning the caller must supply
   * the full display data so the pinned section can render the row even if
   * the issue isn't in the current fetch. */
  const toggle = useCallback((issue: PinnedIssue) => {
    setPinned((p) => {
      const key = pinnedIssueKey(issue);
      if (p[key]) {
        const next = { ...p };
        delete next[key];
        return next;
      }
      return { ...p, [key]: issue };
    });
  }, []);

  const unpin = useCallback((key: string) => {
    setPinned((p) => {
      if (!p[key]) return p;
      const next = { ...p };
      delete next[key];
      return next;
    });
  }, []);

  /** Refresh the stored snapshots for any pinned issues that appear in a
   * new fetch. Keeps titles, labels, and timestamps current without losing
   * the pin. Safe to call with non-pinned items — they're ignored. */
  const reconcile = useCallback((latest: Array<{ owner: string; repo: string; number: number; repository: string; title: string; authorLogin: string | null; labels: string[]; updatedAt: string }>) => {
    setPinned((p) => {
      let mutated = false;
      const next: Record<string, PinnedIssue> = { ...p };
      for (const i of latest) {
        const key = pinnedIssueKey(i);
        if (!next[key]) continue;
        const prev = next[key];
        // Only write back if something actually changed (cheap referential
        // comparison would miss the labels array; do a coarse field check).
        if (prev.title !== i.title || prev.authorLogin !== i.authorLogin || prev.updatedAt !== i.updatedAt || prev.labels.join(',') !== i.labels.join(',')) {
          next[key] = { ...prev, repository: i.repository, title: i.title, authorLogin: i.authorLogin, labels: i.labels, updatedAt: i.updatedAt };
          mutated = true;
        }
      }
      return mutated ? next : p;
    });
  }, []);

  const isPinned = useCallback((key: string) => key in pinned, [pinned]);

  return { pinned, isPinned, toggle, unpin, reconcile };
}
