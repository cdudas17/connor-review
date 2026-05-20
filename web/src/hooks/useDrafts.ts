import { useCallback, useState } from 'react';
import type { ReviewDrafts, StagedInlineComment, StagedThreadReply } from '../types.js';

interface Identity { owner: string; repo: string; number: number; }
function key(id: Identity) { return `${id.owner}/${id.repo}#${id.number}`; }
const EMPTY: ReviewDrafts = { summary: '', inlineComments: [], replies: [] };

export function useDrafts() {
  const [byPR, setByPR] = useState<Record<string, ReviewDrafts>>({});

  const getDrafts = useCallback((id: Identity): ReviewDrafts => byPR[key(id)] ?? EMPTY, [byPR]);
  const hasAny = useCallback((id: Identity) => {
    const d = byPR[key(id)];
    if (!d) return false;
    return d.summary.trim().length > 0 || d.inlineComments.length > 0 || d.replies.length > 0;
  }, [byPR]);

  const update = useCallback((id: Identity, fn: (d: ReviewDrafts) => ReviewDrafts) => {
    setByPR((cur) => ({ ...cur, [key(id)]: fn(cur[key(id)] ?? EMPTY) }));
  }, []);

  const setSummary = useCallback((id: Identity, summary: string) => update(id, (d) => ({ ...d, summary })), [update]);
  const addInlineComment = useCallback((id: Identity, c: StagedInlineComment) => update(id, (d) => ({ ...d, inlineComments: [...d.inlineComments, c] })), [update]);
  const removeInlineComment = useCallback((id: Identity, idx: number) => update(id, (d) => ({ ...d, inlineComments: d.inlineComments.filter((_, i) => i !== idx) })), [update]);
  const addReply = useCallback((id: Identity, r: StagedThreadReply) => update(id, (d) => ({ ...d, replies: [...d.replies, r] })), [update]);
  const clear = useCallback((id: Identity) => setByPR((cur) => { const next = { ...cur }; delete next[key(id)]; return next; }), []);

  return { getDrafts, hasAny, setSummary, addInlineComment, removeInlineComment, addReply, clear };
}
