import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkflowRun, WorkflowStep, WorkflowRunKind } from '../lib/workflowTypes.js';

/**
 * Persistent per-(workflow, PR) run state for tag-driven workflows on the
 * My PRs tab. Mirrors useCiFixes — separate localStorage bucket, LRU cap,
 * 30-day sweep, stale-running auto-recovery. The extra wrinkle: each run
 * stores an array of WorkflowSteps so a multi-action workflow's full
 * timeline survives a page reload.
 */

interface PRTarget { owner: string; repo: string; number: number; }

function prKeyOf(t: PRTarget): string { return `${t.owner}/${t.repo}#${t.number}`; }
function entryKey(workflowId: string, t: PRTarget): string { return `${workflowId}::${prKeyOf(t)}`; }

const STORAGE_KEY = 'connor-review.workflowRuns.v1';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_ENTRIES = 200;
/** A workflow lingering in `running` longer than this is treated as
 *  abandoned (closed tab, server died, etc.) and surfaced as failed so
 *  the user has an escape hatch. */
const STALE_RUNNING_MS = 45 * 60 * 1000;

function loadStore(): Record<string, WorkflowRun> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed != null ? parsed : {};
  } catch { return {}; }
}
function saveStore(store: Record<string, WorkflowRun>) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }
  catch { /* quota exceeded — fine */ }
}

function sweep(store: Record<string, WorkflowRun>, now: number): Record<string, WorkflowRun> {
  const cutoff = now - MAX_AGE_MS;
  const fresh = Object.entries(store)
    .filter(([, v]) => (v.lastFiredAt ?? v.startedAt ?? 0) > cutoff)
    .map(([k, v]): [string, WorkflowRun] => {
      if (v.kind === 'running' && (now - (v.startedAt ?? 0)) > STALE_RUNNING_MS) {
        return [k, {
          ...v,
          kind: 'failed',
          error: 'Workflow was abandoned — no client signal within 45 minutes. Server-side actions may still complete.',
          finishedAt: now,
        }];
      }
      return [k, v];
    })
    .sort(([, a], [, b]) => (a.lastFiredAt ?? a.startedAt ?? 0) - (b.lastFiredAt ?? b.startedAt ?? 0));
  if (fresh.length <= MAX_ENTRIES) return Object.fromEntries(fresh);
  return Object.fromEntries(fresh.slice(fresh.length - MAX_ENTRIES));
}

export function useWorkflowRuns() {
  const [store, setStore] = useState<Record<string, WorkflowRun>>(() => sweep(loadStore(), Date.now()));
  const storeRef = useRef(store);
  useEffect(() => { storeRef.current = store; }, [store]);
  useEffect(() => { saveStore(store); }, [store]);

  const inFlightRef = useRef<Set<string>>(new Set());
  // Synchronous step counters per run, so appendStep can return the
  // new step's index immediately. Returning the index from inside a
  // setStore updater would be unreliable — the updater runs async,
  // and the caller needs the index right away to pass to updateStep.
  const stepCountsRef = useRef<Record<string, number>>({});

  const start = useCallback((workflowId: string, t: PRTarget): boolean => {
    const k = entryKey(workflowId, t);
    if (inFlightRef.current.has(k)) return false;
    inFlightRef.current.add(k);
    stepCountsRef.current[k] = 0;
    const now = Date.now();
    setStore((s) => ({
      ...s,
      [k]: {
        workflowId,
        prKey: prKeyOf(t),
        kind: 'running',
        startedAt: now,
        steps: [],
        lastFiredAt: now,
      },
    }));
    return true;
  }, []);

  const appendStep = useCallback((workflowId: string, t: PRTarget, step: WorkflowStep): number => {
    const k = entryKey(workflowId, t);
    const idx = stepCountsRef.current[k] ?? 0;
    stepCountsRef.current[k] = idx + 1;
    setStore((s) => {
      const cur = s[k];
      if (!cur) return s;
      return { ...s, [k]: { ...cur, steps: [...cur.steps, step] } };
    });
    return idx;
  }, []);

  const updateStep = useCallback((workflowId: string, t: PRTarget, idx: number, patch: Partial<WorkflowStep>) => {
    const k = entryKey(workflowId, t);
    setStore((s) => {
      const cur = s[k];
      if (!cur || idx < 0 || idx >= cur.steps.length) return s;
      const nextSteps = cur.steps.slice();
      nextSteps[idx] = { ...nextSteps[idx], ...patch };
      return { ...s, [k]: { ...cur, steps: nextSteps } };
    });
  }, []);

  const finish = useCallback((workflowId: string, t: PRTarget, kind: WorkflowRunKind, error?: string) => {
    const k = entryKey(workflowId, t);
    inFlightRef.current.delete(k);
    // The counter stays — if the user dismisses + re-runs, `start` resets it.
    setStore((s) => {
      const cur = s[k];
      if (!cur) return s;
      return { ...s, [k]: { ...cur, kind, error, finishedAt: Date.now() } };
    });
  }, []);

  const dismiss = useCallback((workflowId: string, t: PRTarget) => {
    const k = entryKey(workflowId, t);
    inFlightRef.current.delete(k);
    delete stepCountsRef.current[k];
    setStore((s) => {
      if (!s[k]) return s;
      const { [k]: _drop, ...rest } = s;
      void _drop;
      return rest;
    });
  }, []);

  const stateFor = useCallback((workflowId: string, t: PRTarget): WorkflowRun | null => {
    return storeRef.current[entryKey(workflowId, t)] ?? null;
  }, []);

  /** Latest run (any workflow) for a given PR — used by the drawer card
   *  which only shows ONE run at a time per PR. */
  const latestForPR = useCallback((t: PRTarget): WorkflowRun | null => {
    const prefix = `::${prKeyOf(t)}`;
    let best: WorkflowRun | null = null;
    for (const [k, v] of Object.entries(storeRef.current)) {
      if (!k.endsWith(prefix)) continue;
      if (!best || (v.lastFiredAt ?? 0) > (best.lastFiredAt ?? 0)) best = v;
    }
    return best;
  }, []);

  return { start, appendStep, updateStep, finish, dismiss, stateFor, latestForPR, store };
}
