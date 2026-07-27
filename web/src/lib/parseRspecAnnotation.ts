/**
 * Best-effort parser for the HTML body Buildkite annotations post when
 * rspec-buildkite-analytics (or a similar helper) surfaces test failures
 * on a build.
 *
 * Annotation bodies vary across pipelines and plugin versions, so this
 * parser is conservative: on success it returns a list of structured
 * failures the drawer can render as clean cards; on any doubt it
 * returns `null` so the caller falls back to rendering the raw HTML.
 *
 * The shapes we've seen and try to accommodate:
 *
 *   <details>
 *     <summary>❌ Payroll::DeductionCalculator when the employee …</summary>
 *     <code>./spec/services/payroll/deduction_calculator_spec.rb:88</code>
 *     <pre>expected: 712.45
 *          got: 720.00</pre>
 *   </details>
 *
 * or a flat block with <strong> + <pre> + a per-failure separator.
 *
 * The parser scans for `<details>` first; if none exist it splits on
 * horizontal rules (`<hr>`) or paragraph boundaries.
 */

export interface RspecFailure {
  /** Test description — a chain like "Class · context · it does X". */
  description: string;
  /** Path with a `:line` suffix if the parser could resolve one. */
  location: string | null;
  /** The expected/actual diff body, or the closest thing to it we
   *  could pull from the annotation. Rendered inside a monospace code
   *  block; markup stripped. */
  diff: string | null;
}

/** Turn an HTML string into a document fragment we can query with the
 *  same DOMParser + querySelector API we'd use on live DOM. Runs in
 *  the browser only. */
function parseFragment(html: string): DocumentFragment | null {
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');
  const frag = document.createDocumentFragment();
  while (doc.body.firstChild) frag.appendChild(doc.body.firstChild);
  return frag;
}

/** Rspec paths look like `./spec/foo/bar_spec.rb:42` or
 *  `spec/foo/bar_spec.rb:42`. Strip the leading `./` when present. */
function extractLocation(text: string): string | null {
  const m = text.match(/(?:^|\s)\.?\/?((?:spec|test)\/\S+?:\d+)/);
  return m ? m[1] : null;
}

/** Pull a diff-looking block out of a container. Prefers <pre> blocks
 *  that mention "expected" or "got"; falls back to the first <pre>. */
function extractDiff(container: Element): string | null {
  const pres = Array.from(container.querySelectorAll('pre'));
  if (pres.length === 0) return null;
  const scoring = pres.find((p) => /expected|got:/i.test(p.textContent ?? ''));
  const chosen = scoring ?? pres[0];
  const text = (chosen.textContent ?? '').replace(/\s+$/, '');
  return text.length > 0 ? text : null;
}

/** Description = summary of the <details> if present; otherwise the
 *  first <strong>/<h*> in the container; otherwise the first text node
 *  we can find. Whitespace collapsed. */
function extractDescription(container: Element): string {
  const sum = container.querySelector('summary');
  if (sum) return (sum.textContent ?? '').replace(/\s+/g, ' ').trim().replace(/^[❌✗✘]\s*/, '');
  const strong = container.querySelector('strong, h1, h2, h3, h4');
  if (strong) return (strong.textContent ?? '').replace(/\s+/g, ' ').trim();
  const p = container.querySelector('p');
  if (p) return (p.textContent ?? '').replace(/\s+/g, ' ').trim();
  return (container.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** Given an element that represents ONE failure, produce a structured
 *  RspecFailure. Returns null when we can't extract even a description. */
function parseSingleFailure(el: Element): RspecFailure | null {
  const description = extractDescription(el);
  if (!description) return null;
  const location = extractLocation(el.textContent ?? '');
  const diff = extractDiff(el);
  return { description, location, diff };
}

/** Entry point. Returns structured failures on confident parse, else
 *  null to signal "give up and render the raw HTML". */
export function parseRspecAnnotation(html: string): RspecFailure[] | null {
  const frag = parseFragment(html);
  if (!frag) return null;
  // Wrap so querySelectorAll works on the fragment.
  const root = document.createElement('div');
  root.appendChild(frag);

  // Preferred shape: each failure in its own <details>.
  const details = Array.from(root.querySelectorAll('details'));
  if (details.length > 0) {
    const out: RspecFailure[] = [];
    for (const d of details) {
      const parsed = parseSingleFailure(d);
      if (parsed) out.push(parsed);
    }
    return out.length > 0 ? out : null;
  }

  // Fallback: no <details>, but the annotation might be a flat sequence
  // of <p><strong>desc</strong></p><pre>diff</pre><hr>… blocks. Split
  // on <hr>; each chunk becomes a failure candidate.
  const hrs = root.querySelectorAll('hr');
  if (hrs.length > 0) {
    const chunks: HTMLElement[] = [];
    let current = document.createElement('div');
    for (const child of Array.from(root.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName === 'HR') {
        chunks.push(current);
        current = document.createElement('div');
      } else {
        current.appendChild(child.cloneNode(true));
      }
    }
    chunks.push(current);
    const out: RspecFailure[] = [];
    for (const c of chunks) {
      const parsed = parseSingleFailure(c);
      if (parsed && parsed.diff) out.push(parsed);
    }
    return out.length > 0 ? out : null;
  }

  // Last-resort — if the whole annotation reads like ONE failure we
  // still get value from returning a single-item list.
  const single = parseSingleFailure(root);
  if (single && (single.location || single.diff)) return [single];
  return null;
}
