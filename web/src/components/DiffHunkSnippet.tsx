interface Props {
  hunk: string | null | undefined;
  path?: string;
}

/**
 * Renders a `PullRequestReviewComment.diffHunk` — the unified-diff snippet GitHub
 * attaches to inline review comments — as a compact code block with insert/delete
 * row coloring (matches the main diff palette).
 */
export function DiffHunkSnippet({ hunk, path }: Props) {
  if (!hunk) return null;
  const lines = hunk.split('\n');
  return (
    <div className="diff-hunk-snippet" role="region" aria-label={path ? `Diff hunk for ${path}` : 'Diff hunk'}>
      {path && <header className="diff-hunk-snippet-header"><code>{path}</code></header>}
      <pre className="diff-hunk-snippet-body">
        {lines.map((line, i) => {
          let cls = 'diff-hunk-line';
          if (line.startsWith('@@')) cls += ' diff-hunk-line-hunk';
          else if (line.startsWith('+') && !line.startsWith('+++')) cls += ' diff-hunk-line-add';
          else if (line.startsWith('-') && !line.startsWith('---')) cls += ' diff-hunk-line-del';
          return <div key={i} className={cls}>{line || ' '}</div>;
        })}
      </pre>
    </div>
  );
}
