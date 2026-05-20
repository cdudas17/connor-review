import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Diff,
  Hunk,
  parseDiff,
  getChangeKey,
  type ViewType,
  type ChangeData,
  type FileData,
  type HunkData,
} from 'react-diff-view';
import 'react-diff-view/style/index.css';
import type { ReviewThread, StagedInlineComment } from '../types.js';

interface Props {
  diff: string;
  threads: ReviewThread[];
  stagedComments: StagedInlineComment[];
  onAddInlineComment: (c: StagedInlineComment) => void;
  onRemoveStagedComment: (idx: number) => void;
  onReplyToThread: (threadId: string, body: string) => void;
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

interface ActiveRange {
  path: string;
  startIdx: number;
  endIdx: number;
}

interface EditorRange {
  path: string;
  startLine?: number;
  startSide?: 'LEFT' | 'RIGHT';
  line: number;
  side: 'LEFT' | 'RIGHT';
  anchorKey: string;
}

function DiffFile({
  file,
  threads,
  stagedComments,
  onAddInlineComment,
  onRemoveStagedComment,
  onReplyToThread,
}: {
  file: FileData;
  threads: ReviewThread[];
  stagedComments: StagedInlineComment[];
  onAddInlineComment: (c: StagedInlineComment) => void;
  onRemoveStagedComment: (idx: number) => void;
  onReplyToThread: (threadId: string, body: string) => void;
}) {
  const path = fileToPath(file);
  const [view, setView] = useState<ViewType>('unified');
  const anchors = useMemo(() => buildAnchors(file), [file]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<ActiveRange | null>(null);
  const [editor, setEditor] = useState<EditorRange | null>(null);
  const [editorBody, setEditorBody] = useState('');
  const [replyState, setReplyState] = useState<{ threadId: string; body: string } | null>(null);

  // Map each `.diff-line` row (in DOM render order) to its anchor index.
  // The library renders changes in flattened-hunks order, so DOM row N == anchors[N].
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

  function finalizeRange(range: ActiveRange) {
    const a = Math.min(range.startIdx, range.endIdx);
    const b = Math.max(range.startIdx, range.endIdx);
    const startA = anchors[a];
    const endA = anchors[b];
    if (!startA || !endA || endA.line == null) return;
    const multiLine = a !== b && startA.line != null && startA.side === endA.side;
    setEditor({
      path,
      line: endA.line,
      side: endA.side,
      ...(multiLine ? { startLine: startA.line!, startSide: startA.side } : {}),
      anchorKey: endA.changeKey,
    });
    setEditorBody('');
  }

  // Window-level mouseup so dragging off the table still completes the selection.
  useEffect(() => {
    if (!drag) return;
    const onUp = () => {
      finalizeRange(drag);
      setDrag(null);
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);

  // Apply a `data-cr-selected` attribute to rows in the active drag range so CSS can highlight them.
  useEffect(() => {
    if (!containerRef.current) return;
    const rows = containerRef.current.querySelectorAll('tr.diff-line');
    rows.forEach((r) => r.removeAttribute('data-cr-selected'));
    if (drag) {
      const a = Math.min(drag.startIdx, drag.endIdx);
      const b = Math.max(drag.startIdx, drag.endIdx);
      for (let i = a; i <= b && i < rows.length; i++) {
        rows[i].setAttribute('data-cr-selected', '');
      }
    }
  }, [drag, anchors]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (view !== 'unified') return; // multi-line drag is unified-view only for v1
    if (!isGutter(e.target)) return;
    const idx = rowIndexFromTarget(e.target);
    if (idx == null || idx < 0) return;
    e.preventDefault();
    setDrag({ path, startIdx: idx, endIdx: idx });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drag) return;
    if (!isGutter(e.target)) return;
    const idx = rowIndexFromTarget(e.target);
    if (idx == null || idx < 0) return;
    if (idx !== drag.endIdx) setDrag({ ...drag, endIdx: idx });
  };

  const fileThreads = threads.filter((t) => t.path === path && t.line != null);
  const fileStaged = stagedComments
    .map((c, idx) => ({ c, idx }))
    .filter(({ c }) => c.path === path);

  // Render the editor as a widget on the end-of-range anchor.
  const widgets: Record<string, React.ReactNode> = {};
  if (editor && editor.path === path) {
    const rangeLabel = editor.startLine != null
      ? `${path}:${editor.startLine}–${editor.line} (${editor.side})`
      : `${path}:${editor.line} (${editor.side})`;
    widgets[editor.anchorKey] = (
      <div className="inline-editor" data-line={editor.line}>
        <p className="inline-editor-anchor">{rangeLabel}</p>
        <textarea
          value={editorBody}
          onChange={(e) => setEditorBody(e.target.value)}
          aria-label="Inline comment"
          autoFocus
        />
        <div className="inline-editor-actions">
          <button
            type="button"
            disabled={editorBody.trim() === ''}
            onClick={() => {
              const comment: StagedInlineComment = {
                path: editor.path,
                line: editor.line,
                side: editor.side,
                body: editorBody,
                ...(editor.startLine != null ? { startLine: editor.startLine, startSide: editor.startSide ?? editor.side } : {}),
              };
              onAddInlineComment(comment);
              setEditor(null);
              setEditorBody('');
            }}
          >Stage comment</button>
          <button type="button" onClick={() => { setEditor(null); setEditorBody(''); }}>Cancel</button>
        </div>
      </div>
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
          hunks={file.hunks}
          widgets={widgets}
        >
          {(hunks: HunkData[]) => hunks.map((h: HunkData) => <Hunk key={h.content} hunk={h} />)}
        </Diff>
      </div>

      {fileThreads.map((t) => (
        <div key={t.id} className="thread" data-line={t.line ?? undefined}>
          <p className="thread-anchor">{path}:{t.line}</p>
          {t.comments.map((c) => (
            <article key={c.id} className="thread-comment">
              <strong>{c.authorLogin ?? '?'}</strong>
              <p>{c.body}</p>
            </article>
          ))}
          <div className="thread-reply">
            <textarea
              placeholder="Reply..."
              value={replyState?.threadId === t.id ? replyState.body : ''}
              onChange={(e) => setReplyState({ threadId: t.id, body: e.target.value })}
            />
            <button
              type="button"
              disabled={!replyState || replyState.threadId !== t.id || replyState.body.trim() === ''}
              onClick={() => {
                if (!replyState) return;
                onReplyToThread(replyState.threadId, replyState.body);
                setReplyState(null);
              }}
            >Stage reply</button>
          </div>
        </div>
      ))}

      {fileStaged.map(({ c, idx }) => {
        const label = c.startLine != null ? `${c.path}:${c.startLine}–${c.line} (${c.side})` : `${c.path}:${c.line} (${c.side})`;
        return (
          <div key={`${idx}-${c.line}-${c.side}`} className="staged-comment">
            <p className="staged-anchor">{label}</p>
            <p>{c.body}</p>
            <button type="button" onClick={() => onRemoveStagedComment(idx)}>Remove</button>
          </div>
        );
      })}
    </section>
  );
}

export function DiffViewer({ diff, threads, stagedComments, onAddInlineComment, onRemoveStagedComment, onReplyToThread }: Props) {
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
          stagedComments={stagedComments}
          onAddInlineComment={onAddInlineComment}
          onRemoveStagedComment={onRemoveStagedComment}
          onReplyToThread={onReplyToThread}
        />
      ))}
    </div>
  );
}
