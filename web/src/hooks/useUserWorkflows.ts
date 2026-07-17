import { useCallback, useEffect, useState } from 'react';
import type { UserWorkflow } from '../lib/userWorkflowTypes.js';

/**
 * localStorage-backed CRUD for the user-authored workflows that the
 * in-app Workflows drawer manages. Independent bucket from the
 * code-authored workflows in `APP_CONFIG.prWorkflows` — both lists are
 * merged in App.tsx before reaching PRList.
 */

const STORAGE_KEY = 'connor-review.userWorkflows.v1';

function load(): UserWorkflow[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((w): w is UserWorkflow =>
        !!w && typeof w.id === 'string' && typeof w.label === 'string' && Array.isArray(w.steps),
      )
      // Rename-time migration: pre-swap workflows persisted 'askClaude'
      // as the step-action discriminator. Convert on load so existing
      // user workflows keep working without a manual edit.
      .map((w) => ({
        ...w,
        steps: w.steps.map((s) => {
          const step = s as { action?: string };
          if (step.action === 'askClaude') return { ...s, action: 'askAI' } as typeof s;
          return s;
        }),
      }));
  } catch { return []; }
}

function save(list: UserWorkflow[]): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }
  catch { /* quota exceeded — fine */ }
}

export function useUserWorkflows() {
  const [workflows, setWorkflows] = useState<UserWorkflow[]>(load);
  useEffect(() => { save(workflows); }, [workflows]);

  const upsert = useCallback((workflow: UserWorkflow) => {
    setWorkflows((cur) => {
      const idx = cur.findIndex((w) => w.id === workflow.id);
      if (idx === -1) return [...cur, workflow];
      const next = cur.slice();
      next[idx] = workflow;
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setWorkflows((cur) => cur.filter((w) => w.id !== id));
  }, []);

  return { workflows, upsert, remove };
}
