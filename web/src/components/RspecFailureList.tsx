import { useMemo } from 'react';
import { parseRspecAnnotation, type RspecFailure } from '../lib/parseRspecAnnotation.js';

interface Annotation {
  id: string;
  context: string;
  style: 'success' | 'info' | 'warning' | 'error';
  body_html: string;
}

interface Props {
  jobName: string;
  jobWebUrl?: string;
  buildWebUrl: string;
  /** All annotations attached to the build. We parse each one; anything
   *  the parser can't turn into structured failures falls back to raw
   *  HTML render inside a details block below the parsed list. */
  annotations: Annotation[];
  /** Called with a prefilled prompt when the user clicks "Ask AI about
   *  these N failures". App-level handler wires this to the PR's
   *  persistent AI chat (askInChat). */
  onAskAI?: (prompt: string) => void;
}

/** Assemble the batch prompt from the parsed failures. Format matches
 *  the mock in web/public/rubocop-drilldown-preview.html so the AI's
 *  response quality tracks the mock. */
function buildBatchPrompt(jobName: string, failures: RspecFailure[]): string {
  const header = `${failures.length} rspec failure${failures.length === 1 ? '' : 's'} on this PR, all in the same job (${jobName}). Investigate ${failures.length === 1 ? 'it' : 'them together — usually a single root cause when they\'re batched like this'}.`;
  const body = failures.map((f, i) => {
    const parts = [`${i + 1}. ${f.location ?? '(no path parsed)'}`];
    parts.push(`   ${f.description}`);
    if (f.diff) {
      // Indent the diff two spaces for readability inside the prompt.
      parts.push(f.diff.split('\n').map((l) => `     ${l}`).join('\n'));
    }
    return parts.join('\n');
  }).join('\n\n');
  const footer = 'Read the spec files and the PR diff. Tell me if it\'s one shared regression or separate issues, and what to change.';
  return `${header}\n\n${body}\n\n${footer}`;
}

/** Small icon-only button that copies text on click. Green while :active,
 *  no timers. Matches the preview UX. */
function CopyIcon({ text, label }: { text: string; label: string }) {
  return (
    <button
      type="button"
      className="rs-copy"
      aria-label={label}
      title={label}
      onClick={(e) => { e.stopPropagation(); try { void navigator.clipboard.writeText(text); } catch { /* ignore */ } }}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path fill="currentColor" d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/>
        <path fill="currentColor" d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>
      </svg>
    </button>
  );
}

/** Renders a failing Buildkite job's annotation content in the "Option A"
 *  shape from the design preview: batch Ask-AI at the top, then one
 *  card per parsed failure with clickable-to-copy path + copy-icon on
 *  the expected/actual diff. When there are no parseable annotations,
 *  we now show a simple "no summary — open on Buildkite" empty state
 *  instead of auto-fetching a log tail (which turned out to be noise
 *  more often than signal). */
export function RspecFailureList({ jobName, jobWebUrl, buildWebUrl, annotations, onAskAI }: Props) {
  const { parsed, unparsed } = useMemo(() => {
    const parsed: RspecFailure[] = [];
    const unparsed: Annotation[] = [];
    for (const a of annotations) {
      // Only try to parse error-styled annotations. Info/success bodies
      // (test-mapping-build, build-resources, etc.) are noise here.
      if (a.style !== 'error' && a.style !== 'warning') continue;
      const failures = parseRspecAnnotation(a.body_html);
      if (failures && failures.length > 0) parsed.push(...failures);
      else unparsed.push(a);
    }
    return { parsed, unparsed };
  }, [annotations]);

  if (parsed.length === 0 && unparsed.length === 0) {
    return (
      <p className="ci-checks-buildkite-empty">
        No failure summary posted on this job — <a href={jobWebUrl ?? buildWebUrl} target="_blank" rel="noopener noreferrer">open on Buildkite ↗</a> for the raw log.
      </p>
    );
  }

  return (
    <div className="rs-list">
      {parsed.length > 0 && (
        <div className="rs-group-actions">
          {onAskAI && (
            <button
              type="button"
              className="rs-group-ai"
              onClick={() => onAskAI(buildBatchPrompt(jobName, parsed))}
            >
              Ask AI about {parsed.length === 1 ? 'this failure' : `these ${parsed.length} failures`}
            </button>
          )}
          <a href={jobWebUrl ?? buildWebUrl} target="_blank" rel="noopener noreferrer">Open build on Buildkite ↗</a>
        </div>
      )}
      {parsed.map((f, i) => (
        <div key={`${f.location ?? 'no-loc'}-${i}`} className="rs-failure">
          <div className="rs-desc">{f.description}</div>
          {f.location && (
            <button
              type="button"
              className="rs-path"
              title="Click to copy path"
              onClick={(e) => { e.stopPropagation(); try { void navigator.clipboard.writeText(f.location!); } catch { /* ignore */ } }}
            >{f.location}</button>
          )}
          {f.diff && (
            <div className="rs-diff">
              <CopyIcon text={f.diff} label="Copy diff" />
              {f.diff}
            </div>
          )}
        </div>
      ))}
      {unparsed.length > 0 && (
        <details className="rs-unparsed">
          <summary>Additional annotations ({unparsed.length}) — raw</summary>
          {unparsed.map((a) => (
            <div key={a.id} className={`ci-checks-buildkite-annotation ci-checks-buildkite-annotation-${a.style}`}>
              {a.context && a.context !== 'default' && (
                <div className="ci-checks-buildkite-annotation-context">{a.context}</div>
              )}
              <div className="ci-checks-buildkite-annotation-body" dangerouslySetInnerHTML={{ __html: a.body_html }} />
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
