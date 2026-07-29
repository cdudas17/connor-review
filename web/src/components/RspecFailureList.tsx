import { useMemo, useState } from 'react';
import { api, ApiCallError } from '../lib/api.js';
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

/** Called when the drilldown has no parseable annotations. Offers a
 *  one-click log-tail fetch (lazy — logs can be large, no need to
 *  spend the API call unless the user asks for it) and, once loaded,
 *  an "Ask AI about this log" button that seeds the PR chat with a
 *  prompt built from the log tail. */
function LogTailFallback({ jobName, jobWebUrl, onAskAI }: {
  jobName: string;
  jobWebUrl: string;
  onAskAI?: (prompt: string) => void;
}) {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ok'; text: string; truncated: boolean; totalLines: number }
    | { kind: 'error'; code: string; message: string }
  >({ kind: 'idle' });

  const load = () => {
    setState({ kind: 'loading' });
    api.getBuildkiteJobLog(jobWebUrl)
      .then((r) => setState({ kind: 'ok', text: r.text, truncated: r.truncated, totalLines: r.totalLines }))
      .catch((e) => {
        const err = e as ApiCallError & { code?: string };
        setState({ kind: 'error', code: err.code ?? 'UNKNOWN', message: err.message ?? 'Log fetch failed' });
      });
  };

  if (state.kind === 'idle') {
    return (
      <div className="rs-list">
        <p className="ci-checks-buildkite-empty" style={{ marginBottom: 0 }}>
          No parsed failure summary on this job — the failure output is only in the raw log.
        </p>
        <div className="rs-group-actions">
          <button type="button" className="rs-group-ai" onClick={load}>Fetch log tail</button>
          <a href={jobWebUrl} target="_blank" rel="noopener noreferrer">Open on Buildkite ↗</a>
        </div>
      </div>
    );
  }
  if (state.kind === 'loading') {
    return <p className="ci-checks-buildkite-loading"><span className="loading-spinner" aria-hidden="true" /> Fetching log tail…</p>;
  }
  if (state.kind === 'error') {
    return (
      <div className="ci-checks-buildkite-error">
        <strong>Couldn't fetch log.</strong>
        <p>{state.message}</p>
        {state.code === 'MISSING_SCOPE' && (
          <p className="ci-checks-buildkite-hint">
            Add the <code>read_build_logs</code> scope to your Buildkite token at{' '}
            <a href="https://buildkite.com/user/api-access-tokens" target="_blank" rel="noopener noreferrer">buildkite.com/user/api-access-tokens</a>,
            re-export it in your shell, and restart the server.
          </p>
        )}
      </div>
    );
  }

  const prompt = [
    `A CI job failed on this PR: ${jobName}. There's no rspec-style failure summary; the failing output is in the raw log tail below (last ~300 lines, prefix noise stripped).`,
    'Job: ' + jobWebUrl,
    'Read the tail, identify the actual failure, and tell me what to change. If the tail is truncated, note it and ask before requesting more.',
    '',
    '```',
    state.text.slice(-20_000), // keep prompt under a manageable size
    '```',
  ].join('\n');

  return (
    <div className="rs-list">
      <div className="rs-group-actions">
        {onAskAI && (
          <button type="button" className="rs-group-ai" onClick={() => onAskAI(prompt)}>
            Ask AI about this log
          </button>
        )}
        <a href={jobWebUrl} target="_blank" rel="noopener noreferrer">Open on Buildkite ↗</a>
      </div>
      <pre className="rs-log-tail">{state.text}
{state.truncated && <span className="rs-log-truncated">
… truncated (last 300 of {state.totalLines} lines)
</span>}</pre>
    </div>
  );
}

/** Renders a failing Buildkite job's annotation content in the "Option A"
 *  shape from the design preview: batch Ask-AI at the top, then one
 *  card per parsed failure with clickable-to-copy path + copy-icon on
 *  the expected/actual diff. Falls back to raw annotation HTML when the
 *  parser can't extract structured failures. */
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
    // Fall back to fetching the tail of the failing job's log — the
    // failure output for graphql-score-ratchet, pact-can-i-merge,
    // rubocop, etc. only exists in the log, not in an annotation.
    return (
      <LogTailFallback jobName={jobName} jobWebUrl={jobWebUrl ?? buildWebUrl} onAskAI={onAskAI} />
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
