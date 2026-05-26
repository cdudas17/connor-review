import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Decoration,
  Diff,
  Hunk,
  parseDiff,
  getChangeKey,
  tokenize,
  markEdits,
  expandFromRawCode,
  type ViewType,
  type ChangeData,
  type FileData,
  type HunkData,
} from 'react-diff-view';
import 'react-diff-view/style/index.css';
import { api } from '../lib/api.js';
import { EmojiTextarea } from './EmojiTextarea.js';
import { PersonIcon } from './PersonIcon.js';
import type { ReviewThread, StagedInlineComment } from '../types.js';

export interface DiffViewerProps {
  diff: string;
  threads: ReviewThread[];
  hasPendingReview: boolean;
  /** PR identity + base ref needed to fetch file content for hunk expansion. */
  pr: { owner: string; repo: string; number: number; baseRef: string };
  /** Post a new thread immediately as a standalone PR comment. */
  onCommitComment: (c: StagedInlineComment) => Promise<void>;
  /** Post a new thread as part of a pending review (creates one if needed). */
  onAddToReview: (c: StagedInlineComment) => Promise<void>;
  /** Post a reply on an existing thread. */
  onReply: (threadId: string, body: string) => Promise<void>;
}

function ChevronUpIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M3.22 9.78a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 1 1-1.06 1.06L8 6.06 4.28 9.78a.75.75 0 0 1-1.06 0z"/>
    </svg>
  );
}
function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12.78 6.22a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 7.28a.75.75 0 0 1 1.06-1.06L8 9.94l3.72-3.72a.75.75 0 0 1 1.06 0z"/>
    </svg>
  );
}
function UnfoldIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M8.177.677 10.5 3l-1.06 1.06L8 2.621 6.56 4.06 5.5 3 7.823.677a.25.25 0 0 1 .354 0zM5.5 13l1.06-1.06L8 13.378 9.44 11.94 10.5 13l-2.323 2.323a.25.25 0 0 1-.354 0L5.5 13zM0 7.75A.75.75 0 0 1 .75 7h14.5a.75.75 0 0 1 0 1.5H.75A.75.75 0 0 1 0 7.75z"/>
    </svg>
  );
}

function fileToPath(file: FileData): string {
  return (file.newPath && file.newPath !== '/dev/null') ? file.newPath : (file.oldPath ?? '');
}

interface ChangeAnchor {
  change: ChangeData;
  changeKey: string;
  line: number | null;
  side: 'LEFT' | 'RIGHT';
}

function lineOf(change: ChangeData): number | null {
  if (change.type === 'normal') return change.newLineNumber;
  if (change.type === 'insert') return change.lineNumber;
  if (change.type === 'delete') return change.lineNumber;
  return null;
}

function sideOf(change: ChangeData): 'LEFT' | 'RIGHT' {
  return change.type === 'delete' ? 'LEFT' : 'RIGHT';
}

function buildAnchors(file: FileData): ChangeAnchor[] {
  const out: ChangeAnchor[] = [];
  for (const hunk of file.hunks) {
    for (const change of hunk.changes) {
      out.push({ change, changeKey: getChangeKey(change), line: lineOf(change), side: sideOf(change) });
    }
  }
  return out;
}

interface DragRange { startIdx: number; endIdx: number; }
interface EditorRange {
  startLine?: number;
  startSide?: 'LEFT' | 'RIGHT';
  line: number;
  side: 'LEFT' | 'RIGHT';
  anchorKey: string;
}

function DiffFile({
  file,
  threads,
  hasPendingReview,
  pr,
  onCommitComment,
  onAddToReview,
  onReply,
}: {
  file: FileData;
  threads: ReviewThread[];
  hasPendingReview: boolean;
  pr: { owner: string; repo: string; number: number; baseRef: string };
  onCommitComment: (c: StagedInlineComment) => Promise<void>;
  onAddToReview: (c: StagedInlineComment) => Promise<void>;
  onReply: (threadId: string, body: string) => Promise<void>;
}) {
  const path = fileToPath(file);
  const [view, setView] = useState<ViewType>('unified');
  const [hunks, setHunks] = useState<HunkData[]>(file.hunks);
  const sourceRef = useRef<string[] | null>(null);
  const sourceFetching = useRef<Promise<string[]> | null>(null);
  useEffect(() => { setHunks(file.hunks); sourceRef.current = null; }, [file]);
  const anchors = useMemo(() => buildAnchors({ ...file, hunks }), [file, hunks]);
  const tokens = useMemo(() => {
    try {
      return tokenize(hunks, {
        highlight: false,
        enhancers: [markEdits(hunks, { type: 'block' })],
      });
    } catch (err) {
      console.warn('tokenize failed; rendering diff without intra-line edit marks', err);
      return undefined;
    }
  }, [hunks]);

  async function ensureSource(): Promise<string[]> {
    if (sourceRef.current) return sourceRef.current;
    if (sourceFetching.current) return sourceFetching.current;
    const oldPath = file.oldPath && file.oldPath !== '/dev/null' ? file.oldPath : path;
    sourceFetching.current = api.getFileContent(pr.owner, pr.repo, pr.number, oldPath, pr.baseRef)
      .then((text) => {
        const lines = text.split('\n');
        if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
        sourceRef.current = lines;
        return lines;
      })
      .finally(() => { sourceFetching.current = null; });
    return sourceFetching.current;
  }

  async function expandRange(start: number, endInclusive: number) {
    if (start > endInclusive) return;
    try {
      const source = await ensureSource();
      const safeEnd = Math.min(endInclusive, source.length);
      if (start > safeEnd) return;
      // expandFromRawCode treats `end` as EXCLUSIVE (slice(start-1, end-1)). To include
      // safeEnd, we pass safeEnd + 1.
      setHunks((cur) => expandFromRawCode(cur, source, start, safeEnd + 1));
    } catch (err) {
      console.warn('expandFromRawCode failed', err);
    }
  }

  const CONTEXT = 20;
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragRange | null>(null);
  const [editor, setEditor] = useState<EditorRange | null>(null);
  const [editorBody, setEditorBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyState, setReplyState] = useState<{ threadId: string; body: string } | null>(null);
  const [replyBusy, setReplyBusy] = useState(false);

  function rowIndexFromTarget(target: EventTarget | null): number | null {
    if (!(target instanceof HTMLElement) || !containerRef.current) return null;
    const row = target.closest('tr.diff-line') as HTMLTableRowElement | null;
    if (!row) return null;
    const rows = containerRef.current.querySelectorAll('tr.diff-line');
    return Array.prototype.indexOf.call(rows, row);
  }

  function isGutter(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && target.closest('.diff-gutter') != null;
  }

  function finalizeRange(range: DragRange) {
    const a = Math.min(range.startIdx, range.endIdx);
    const b = Math.max(range.startIdx, range.endIdx);
    const startA = anchors[a];
    const endA = anchors[b];
    if (!startA || !endA || endA.line == null) return;
    const multiLine = a !== b && startA.line != null && startA.side === endA.side;
    setEditor({
      line: endA.line,
      side: endA.side,
      ...(multiLine ? { startLine: startA.line!, startSide: startA.side } : {}),
      anchorKey: endA.changeKey,
    });
    setEditorBody('');
    setError(null);
  }

  useEffect(() => {
    if (!drag) return;
    const onUp = () => { finalizeRange(drag); setDrag(null); };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);

  useEffect(() => {
    if (!containerRef.current) return;
    const rows = containerRef.current.querySelectorAll('tr.diff-line');
    rows.forEach((r) => r.removeAttribute('data-cr-selected'));
    if (drag) {
      const a = Math.min(drag.startIdx, drag.endIdx);
      const b = Math.max(drag.startIdx, drag.endIdx);
      for (let i = a; i <= b && i < rows.length; i++) rows[i].setAttribute('data-cr-selected', '');
    }
  }, [drag, anchors]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (view !== 'unified') return;
    if (!isGutter(e.target)) return;
    const idx = rowIndexFromTarget(e.target);
    if (idx == null || idx < 0) return;
    e.preventDefault();
    setDrag({ startIdx: idx, endIdx: idx });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drag) return;
    if (!isGutter(e.target)) return;
    const idx = rowIndexFromTarget(e.target);
    if (idx == null || idx < 0) return;
    if (idx !== drag.endIdx) setDrag({ ...drag, endIdx: idx });
  };

  async function postEditor(target: 'standalone' | 'review') {
    if (!editor || editorBody.trim() === '') return;
    setBusy(true);
    setError(null);
    const comment: StagedInlineComment = {
      path,
      line: editor.line,
      side: editor.side,
      body: editorBody,
      ...(editor.startLine != null ? { startLine: editor.startLine, startSide: editor.startSide ?? editor.side } : {}),
    };
    try {
      if (target === 'standalone') await onCommitComment(comment);
      else await onAddToReview(comment);
      setEditor(null);
      setEditorBody('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Build a map: changeKey -> array of threads anchored there. Render threads as widgets.
  const threadsByAnchor = useMemo(() => {
    const byKey: Record<string, ReviewThread[]> = {};
    for (const t of threads.filter((th) => th.path === path && th.line != null && !th.isResolved)) {
      // find the anchor change at (path, line, side). Prefer matching side; fall back to line-only.
      const anchor = anchors.find((a) => a.line === t.line && a.side === sideOf(makePseudoChangeForSide(t)))
        ?? anchors.find((a) => a.line === t.line);
      if (!anchor) continue;
      (byKey[anchor.changeKey] ||= []).push(t);
    }
    return byKey;
  }, [threads, anchors, path]);

  function rangeLabel(): string {
    if (!editor) return '';
    if (editor.startLine != null) return `${path}:${editor.startLine}–${editor.line} (${editor.side})`;
    return `${path}:${editor.line} (${editor.side})`;
  }

  // Construct widgets per change: any threads + the editor (if active on this change).
  const widgets: Record<string, React.ReactNode> = {};
  for (const [key, ts] of Object.entries(threadsByAnchor)) {
    widgets[key] = (
      <div className="thread-stack">
        {ts.map((t) => (
          <article key={t.id} className="thread-card">
            <header className="thread-card-header">
              <span className="thread-anchor">{t.path}:{t.line}</span>
            </header>
            {t.comments.map((c) => (
              <div key={c.id} className="thread-message">
                <div className="thread-message-author"><PersonIcon /><strong>{c.authorLogin ?? '?'}</strong></div>
                <p>{c.body}</p>
              </div>
            ))}
            <div className="thread-reply">
              <EmojiTextarea
                placeholder="Write a reply…"
                value={replyState?.threadId === t.id ? replyState.body : ''}
                onChange={(e) => setReplyState({ threadId: t.id, body: e.target.value })}
              />
              <div className="thread-reply-actions">
                <button
                  type="button"
                  disabled={replyBusy || !replyState || replyState.threadId !== t.id || replyState.body.trim() === ''}
                  onClick={async () => {
                    if (!replyState) return;
                    setReplyBusy(true);
                    try {
                      await onReply(replyState.threadId, replyState.body);
                      setReplyState(null);
                    } finally { setReplyBusy(false); }
                  }}
                >Reply</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    );
  }
  if (editor) {
    const existing = widgets[editor.anchorKey];
    widgets[editor.anchorKey] = (
      <>
        {existing}
        <div className="inline-editor">
          <p className="inline-editor-anchor">{rangeLabel()}</p>
          <EmojiTextarea
            value={editorBody}
            onChange={(e) => setEditorBody(e.target.value)}
            aria-label="Add a comment"
            placeholder="Leave a comment…"
            autoFocus
          />
          {error && <p className="inline-editor-error">{error}</p>}
          <div className="inline-editor-actions">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setEditor(null); setEditorBody(''); setError(null); }}>Cancel</button>
            <button type="button" className="btn-secondary" disabled={busy || editorBody.trim() === ''} onClick={() => postEditor('standalone')}>Comment</button>
            <button type="button" className="btn-primary" disabled={busy || editorBody.trim() === ''} onClick={() => postEditor('review')}>
              {hasPendingReview ? 'Add review comment' : 'Start a review'}
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <section className="diff-file">
      <header className="diff-file-header">
        <code>{path}</code>
        <button
          type="button"
          onClick={() => setView((v) => (v === 'unified' ? 'split' : 'unified'))}
        >
          {view === 'unified' ? 'Split view' : 'Unified view'}
        </button>
      </header>
      <div
        className={`diff-file-body${drag ? ' cr-dragging' : ''}`}
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
      >
        <Diff
          viewType={view}
          diffType={file.type}
          hunks={hunks}
          widgets={widgets}
          tokens={tokens}
        >
          {(renderedHunks: HunkData[]) => renderedHunks.flatMap((h: HunkData, idx: number) => {
            const prevEnd = idx === 0 ? 1 : renderedHunks[idx - 1].oldStart + renderedHunks[idx - 1].oldLines;
            const gapTopStart = prevEnd;
            const gapTopEnd = h.oldStart - 1;
            const hasGapAbove = gapTopEnd >= gapTopStart;
            const out: React.ReactElement[] = [];
            if (hasGapAbove) {
              const isSmallGap = gapTopEnd - gapTopStart + 1 <= CONTEXT;
              out.push(
                <Decoration key={`gap-${idx}`}>
                  <div className="diff-expand-row">
                    {!isSmallGap && (
                      <button
                        type="button"
                        className="diff-expand-button"
                        title={`Expand ${CONTEXT} lines up`}
                        onClick={(e) => { e.stopPropagation(); expandRange(Math.max(gapTopStart, h.oldStart - CONTEXT), h.oldStart - 1); }}
                      ><ChevronUpIcon /></button>
                    )}
                    <button
                      type="button"
                      className="diff-expand-button"
                      title={isSmallGap ? `Expand ${gapTopEnd - gapTopStart + 1} hidden lines` : `Expand all ${gapTopEnd - gapTopStart + 1} hidden lines`}
                      onClick={(e) => { e.stopPropagation(); expandRange(gapTopStart, gapTopEnd); }}
                    ><UnfoldIcon /></button>
                    {!isSmallGap && idx > 0 && (
                      <button
                        type="button"
                        className="diff-expand-button"
                        title={`Expand ${CONTEXT} lines down`}
                        onClick={(e) => { e.stopPropagation(); const prev = renderedHunks[idx - 1]; const prevEndLine = prev.oldStart + prev.oldLines; expandRange(prevEndLine, Math.min(gapTopEnd, prevEndLine + CONTEXT - 1)); }}
                      ><ChevronDownIcon /></button>
                    )}
                  </div>
                </Decoration>,
              );
            }
            out.push(<Hunk key={h.content} hunk={h} />);
            if (idx === renderedHunks.length - 1) {
              const tailStart = h.oldStart + h.oldLines;
              out.push(
                <Decoration key={`gap-tail-${idx}`}>
                  <div className="diff-expand-row">
                    <button
                      type="button"
                      className="diff-expand-button"
                      title={`Expand ${CONTEXT} lines below`}
                      onClick={(e) => { e.stopPropagation(); expandRange(tailStart, tailStart + CONTEXT - 1); }}
                    ><ChevronDownIcon /></button>
                  </div>
                </Decoration>,
              );
            }
            return out;
          })}
        </Diff>
      </div>
    </section>
  );
}

/**
 * A diff hunk has its own concept of "side". A review thread's `side` comes from
 * `diffSide` on the GraphQL type, but we trimmed that. As a best-effort, treat
 * the thread as RIGHT (most reviews comment on additions); fallback finds any
 * anchor at that line if RIGHT misses.
 */
function makePseudoChangeForSide(_t: ReviewThread): ChangeData {
  // We don't actually have side info on the thread (we trimmed diffSide). Assume RIGHT.
  return { type: 'insert', content: '', lineNumber: 0, isInsert: true } as unknown as ChangeData;
}

export function DiffViewer({ diff, threads, hasPendingReview, pr, onCommitComment, onAddToReview, onReply }: DiffViewerProps) {
  const files = useMemo(() => parseDiff(diff), [diff]);

  if (files.length === 0) {
    return <p className="empty">No diff to show.</p>;
  }

  return (
    <div className="diff-viewer">
      {files.map((file) => (
        <DiffFile
          key={fileToPath(file)}
          file={file}
          threads={threads}
          hasPendingReview={hasPendingReview}
          pr={pr}
          onCommitComment={onCommitComment}
          onAddToReview={onAddToReview}
          onReply={onReply}
        />
      ))}
    </div>
  );
}
