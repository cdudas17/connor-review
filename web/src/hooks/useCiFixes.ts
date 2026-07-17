import { useCallback, useEffect, useRef, useState } from 'react';

/** Persistent per-PR state for the "Fix failing CI builds" flow. Stored in
 * its own localStorage bucket so the AIBadge never picks up this
 * activity (mirrors useConflictResolutions's "don't count toward Claude
 * badge" promise). */

interface PRTarget { owner: string; repo: string; number: number; }
function key(t: PRTarget) { return `${t.owner}/${t.repo}#${t.number}`; }

export interface CiFixEntry {
  kind: 'running' | 'failed' | 'success' | 'no-failures' | 'no-changes';
  /** Failure message for the drawer card. */
  error?: string;
  /** Server-provided code (INSTALL_FAILED, CLAUDE_FAILED, PUSH_FAILED, ...). */
  code?: string;
  /** Commit SHA pushed by a successful run. */
  commitSha?: string;
  /** Files committed by Claude's fix. */
  filesChanged?: string[];
  /** Names of CI checks the run intended to fix. */
  failingChecksFixed?: string[];
  /** Epoch ms — drives the sweep + LRU. */
  savedAt: number;
}

const STORAGE_KEY = 'connor-review.ciFixes.v1';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_ENTRIES = 200;

function loadStore(): Record<string, CiFixEntry> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed != null ? parsed : {};
  } catch { return {}; }
}
function saveStore(store: Record<string, CiFixEntry>) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }
  catch { /* quota exceeded; fine */ }
}
/** A running entry older than this is treated as crashed and auto-flipped
 * to failed. The fix-CI route's own outer timeout is 30 minutes, so any
 * `running` lingering past ~45 min has lost its server-side counterpart
 * (process restart, browser tab closed before the response landed, etc.). */
const STALE_RUNNING_MS = 45 * 60 * 1000;

function sweep(store: Record<string, CiFixEntry>, now: number): Record<string, CiFixEntry> {
  const cutoff = now - MAX_AGE_MS;
  const fresh = Object.entries(store)
    .filter(([, v]) => (v.savedAt ?? 0) > cutoff)
    .map(([k, v]): [string, CiFixEntry] => {
      // Stale-running rescue: if a tab closed mid-run or the server crashed
      // mid-request, the persisted state would otherwise stay 'running'
      // forever. Convert to a failed entry on next mount so the user sees
      // the escape hatch + Try-again button.
      if (v.kind === 'running' && (now - (v.savedAt ?? 0)) > STALE_RUNNING_MS) {
        return [k, { kind: 'failed', error: 'Run was abandoned — no server response within 45 minutes. The server-side run may still complete; check the PR for new commits.', code: 'STALE', savedAt: now }];
      }
      return [k, v];
    })
    .sort(([, a], [, b]) => (a.savedAt ?? 0) - (b.savedAt ?? 0));
  if (fresh.length <= MAX_ENTRIES) return Object.fromEntries(fresh);
  return Object.fromEntries(fresh.slice(fresh.length - MAX_ENTRIES));
}

export function useCiFixes() {
  const [store, setStore] = useState<Record<string, CiFixEntry>>(() => sweep(loadStore(), Date.now()));
  const storeRef = useRef(store);
  useEffect(() => { storeRef.current = store; }, [store]);
  useEffect(() => { saveStore(store); }, [store]);

  const inFlightRef = useRef<Set<string>>(new Set());

  const start = useCallback((t: PRTarget): boolean => {
    const k = key(t);
    if (inFlightRef.current.has(k)) return false;
    inFlightRef.current.add(k);
    setStore((prev) => ({ ...prev, [k]: { kind: 'running', savedAt: Date.now() } }));
    return true;
  }, []);
  const finishOk = useCallback((t: PRTarget, body: { commitSha: string; filesChanged: string[]; failingChecksFixed: string[] }) => {
    const k = key(t);
    inFlightRef.current.delete(k);
    setStore((prev) => ({ ...prev, [k]: { kind: 'success', savedAt: Date.now(), ...body } }));
  }, []);
  const finishNoFailures = useCallback((t: PRTarget) => {
    const k = key(t);
    inFlightRef.current.delete(k);
    setStore((prev) => ({ ...prev, [k]: { kind: 'no-failures', savedAt: Date.now() } }));
  }, []);
  const finishNoChanges = useCallback((t: PRTarget) => {
    const k = key(t);
    inFlightRef.current.delete(k);
    setStore((prev) => ({ ...prev, [k]: { kind: 'no-changes', savedAt: Date.now() } }));
  }, []);
  const finishErr = useCallback((t: PRTarget, message: string, code?: string) => {
    const k = key(t);
    inFlightRef.current.delete(k);
    setStore((prev) => ({ ...prev, [k]: { kind: 'failed', error: message, code, savedAt: Date.now() } }));
  }, []);
  const dismiss = useCallback((t: PRTarget) => {
    const k = key(t);
    inFlightRef.current.delete(k);
    setStore((prev) => {
      const next = { ...prev };
      delete next[k];
      return next;
    });
  }, []);
  const stateFor = useCallback((t: PRTarget): CiFixEntry | null => store[key(t)] ?? null, [store]);

  return { start, finishOk, finishNoFailures, finishNoChanges, finishErr, dismiss, stateFor };
}
