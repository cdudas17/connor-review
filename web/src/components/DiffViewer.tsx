import { useMemo, useState } from 'react';
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

interface PerFileViewMode { [path: string]: ViewType; }

interface ActiveLine {
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  changeKey: string;
}

function fileToPath(file: FileData): string {
  return (file.newPath && file.newPath !== '/dev/null') ? file.newPath : (file.oldPath ?? '');
}

function changeLineNumber(change: ChangeData): number | null {
  if (change.type === 'normal') return change.newLineNumber;
  if (change.type === 'insert') return change.lineNumber;
  if (change.type === 'delete') return change.lineNumber;
  return null;
}

function changeSide(change: ChangeData): 'LEFT' | 'RIGHT' {
  return change.type === 'delete' ? 'LEFT' : 'RIGHT';
}

export function DiffViewer({ diff, threads, stagedComments, onAddInlineComment, onRemoveStagedComment, onReplyToThread }: Props) {
  const files = useMemo(() => parseDiff(diff), [diff]);
  const [perFile, setPerFile] = useState<PerFileViewMode>({});
  const [activeLine, setActiveLine] = useState<ActiveLine | null>(null);
  const [draftBody, setDraftBody] = useState('');
  const [replyState, setReplyState] = useState<{ threadId: string; body: string } | null>(null);

  if (files.length === 0) {
    return <p className="empty">No diff to show.</p>;
  }

  return (
    <div className="diff-viewer">
      {files.map((file) => {
        const path = fileToPath(file);
        const view = perFile[path] ?? 'unified';
        const fileThreads = threads.filter((t) => t.path === path && t.line != null);
        const fileStaged = stagedComments
          .map((c, idx) => ({ c, idx }))
          .filter(({ c }) => c.path === path);

        // build widgets: a "comment" button under each change (insert/delete only)
        const widgets: Record<string, React.ReactNode> = {};
        for (const hunk of file.hunks) {
          for (const change of hunk.changes) {
            if (change.type === 'normal') continue;
            const key = getChangeKey(change);
            const line = changeLineNumber(change);
            if (line == null) continue;
            const side = changeSide(change);
            const isActive = activeLine?.changeKey === key;
            widgets[key] = (
              <div className={isActive ? 'change-widget active' : 'change-widget'}>
                {!isActive && (
                  <button
                    type="button"
                    className="change-widget-comment"
                    onClick={() => { setActiveLine({ path, line, side, changeKey: key }); setDraftBody(''); }}
                  >+ comment</button>
                )}
                {isActive && (
                  <div className="inline-editor">
                    <p>{path}:{line} ({side})</p>
                    <textarea
                      value={draftBody}
                      onChange={(e) => setDraftBody(e.target.value)}
                      aria-label="Inline comment"
                      autoFocus
                    />
                    <div className="inline-editor-actions">
                      <button
                        type="button"
                        disabled={draftBody.trim() === ''}
                        onClick={() => {
                          onAddInlineComment({ path, line, side, body: draftBody });
                          setActiveLine(null);
                          setDraftBody('');
                        }}
                      >Stage comment</button>
                      <button type="button" onClick={() => { setActiveLine(null); setDraftBody(''); }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            );
          }
        }

        return (
          <section key={path} className="diff-file">
            <header className="diff-file-header">
              <code>{path}</code>
              <button type="button" onClick={() => setPerFile((s) => ({ ...s, [path]: view === 'unified' ? 'split' : 'unified' }))}>
                {view === 'unified' ? 'Split view' : 'Unified view'}
              </button>
            </header>
            <Diff
              viewType={view}
              diffType={file.type}
              hunks={file.hunks}
              widgets={widgets}
            >
              {(hunks: HunkData[]) => hunks.map((h: HunkData) => <Hunk key={h.content} hunk={h} />)}
            </Diff>

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

            {fileStaged.map(({ c, idx }) => (
              <div key={`${idx}-${c.line}-${c.side}`} className="staged-comment">
                <p className="staged-anchor">{c.path}:{c.line} ({c.side})</p>
                <p>{c.body}</p>
                <button type="button" onClick={() => onRemoveStagedComment(idx)}>Remove</button>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
