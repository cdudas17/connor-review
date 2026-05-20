# Connor Review — Design Spec

- **Date:** 2026-05-20
- **Tracking issue:** [Gusto/zenpayroll#341597](https://github.com/Gusto/zenpayroll/issues/341597)
- **Author:** Connor Dudas (with Claude)
- **Status:** Approved — ready for implementation planning

## 1. Goal

A local-only web app that streamlines reviewing teammates' GitHub PRs. PR links arrive through several channels (Slack DMs, a private channel, GitHub-app notifications). The app gives one home where pasted PRs live as a queue, each can be reviewed in a side drawer (no extra tabs), and the next PR's diff is prefetched while the current one is on screen.

## 2. Non-goals (v1)

- No multi-user / hosted mode. Single user, single machine, `localhost`.
- No automatic PR ingestion from Slack, the GitHub app, or "review requested" queries. v1 is paste-only.
- No CI / Playwright end-to-end suite. Unit and integration tests only.
- No PAT-based auth flow. The app relies on the user's existing `gh auth login`.
- No mobile / responsive polish. Desktop browser only.

## 3. Stack

- **Frontend:** Vite + React 18 + TypeScript. Diff rendering via `react-diff-view` + `prismjs` (supports unified ↔ split per-file toggle).
- **Backend:** Fastify + TypeScript, run with `tsx watch` in dev. Single process on port `5174`.
- **GitHub integration:** every backend route shells out to the user's `gh` CLI (already authenticated via `gh auth login`). No tokens stored anywhere in the app.
- **State:** all tracked-PR data and per-PR status persist in `localStorage`. Server is stateless apart from an in-memory LRU diff/thread cache.
- **Layout:** two top-level dirs (`web/`, `server/`) inside `~/workspace/connor-review`, run together via root `package.json` + `concurrently`. No monorepo tooling.

## 4. Architecture

```
connor-review/
  package.json         # root: "dev" runs server + web via concurrently
  web/                 # Vite + React + TypeScript
    package.json
    vite.config.ts
    src/
  server/              # Fastify + TypeScript
    package.json
    tsconfig.json
    src/
  docs/
  .gitignore
  README.md
```

### Components — frontend (`web/src/`)

- `App.tsx` — top-level layout; owns tracked-PR state; mounts `<AddPRBar>`, `<FilterToggle>`, `<PRList>`, and `<ReviewDrawer>`.
- `AddPRBar.tsx` — input + "Add" button. Parses GitHub PR URLs via `parsePRUrl`; rejects malformed URLs inline.
- `PRList.tsx` — renders tracked PRs as rows: title, repo, author, status badge (`untouched` · `reviewed` · `approved`). Click → opens drawer for that PR.
- `FilterToggle.tsx` — toggles between `Untouched only` (default) and `Show all`.
- `ReviewDrawer.tsx` — overlay drawer that slides in from the right (~70% width). Background list dims but stays visible. Contains:
  - `PRHeader` — title, author, repo, source → target branch, open/closed/merged badge.
  - `DiffViewer` — file list + per-file diff. Per-file toggle for unified ↔ split. Click a line → inline comment editor. Existing review threads overlaid at their `(path, line)` anchor; replies can be staged on each.
  - `ReviewFooter` — sticky bottom: summary textarea + `Approve` / `Request Changes` / `Comment` / `Next` buttons.
- Hooks:
  - `useTrackedPRs()` — `[prs, { add, remove, setStatus }]`; syncs to `localStorage` on every change.
  - `usePRDetails(prId)` — fetches PR meta + review threads and diff in parallel, returns loading/error/data.
  - `useNextPRPrefetch(currentPrId)` — finds the next `untouched` PR after current and fires `usePRDetails`-equivalent requests in the background to warm the server cache.
- `lib/parsePRUrl.ts` — pure function: `https://github.com/owner/repo/pull/123` → `{ owner, repo, number }` (and rejects everything else).

### Components — backend (`server/src/`)

- `index.ts` — Fastify bootstrap; registers routes on port 5174; CORS allows `http://localhost:5173` (Vite default).
- `routes/pulls.ts`:
  - `GET /api/pulls/:owner/:repo/:number` → PR meta + `reviewThreads` connection via `gh api graphql`.
  - `GET /api/pulls/:owner/:repo/:number/diff` → unified diff via `gh pr diff <n> --repo owner/repo`. Accepts `?fresh=1` to bypass cache.
  - `POST /api/pulls/:owner/:repo/:number/reviews` → submits a review. Body: `{ event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT", body?: string, comments?: Array<{ path, line, side, body }> }`. Server calls the `addPullRequestReview` GraphQL mutation via `gh api graphql`.
  - `POST /api/pulls/:owner/:repo/:number/threads/:threadId/reply` → calls `addPullRequestReviewThreadReply` GraphQL mutation.
- `lib/ghExec.ts` — async wrapper around `child_process.execFile('gh', args)`. Captures stdout/stderr. Throws a typed `GhCliError` with a `code` field on nonzero exit. Sniffs stderr for auth failures → tags as `AUTH_REQUIRED`.
- `lib/lruCache.ts` — Map-based LRU, capacity 20. Keys: `${owner}/${repo}#${number}@${headSha}`. Separate caches for "meta + threads" and "diff".

## 5. Data flow

### Adding a PR
1. User pastes a URL → `parsePRUrl` extracts `owner/repo/number`.
2. Frontend GETs `/api/pulls/owner/repo/number`.
3. Server: LRU miss → `gh api graphql` for meta + threads → cache under `headSha` → return JSON.
4. Frontend stores `{ owner, repo, number, title, author, status: "untouched", addedAt }` in `localStorage` and renders a row in `PRList`.

### Opening a PR
1. Row click → drawer opens; `usePRDetails` runs.
2. Parallel requests for meta + threads (already cached from step above on the just-added path) and diff.
3. Server: cache lookup on both. On hit, returns immediately. On miss, shells out via `ghExec`, caches by `headSha`, returns.
4. `DiffViewer` parses the unified diff with `react-diff-view`. Review threads are anchored at `(path, line)` from the threads response.
5. `useNextPRPrefetch` fires meta + diff requests for the next `untouched` PR in the filtered list. UI does not wait on this.

### Reviewing
1. Click a line → inline comment editor mounts → on save, comment is staged in React state (not yet sent).
2. Summary textarea content stays in React state.
3. Replies on existing threads are staged the same way.
4. Staged comments and summary text persist across drawer close/reopen for the same PR (held in `App`-level state keyed by `owner/repo/number`, not in the drawer component). They do not persist across full page reloads — `localStorage` holds only the tracked PR list + statuses, never draft comment text.
5. Action buttons:
   - `Approve` / `Request Changes` / `Comment` → POST `/reviews` with `{ event, body, comments }` plus any staged thread replies (one extra POST per reply). On 2xx → set status to `approved` (Approve) or `reviewed` (RC/Comment) in `localStorage`, clear that PR's staged drafts, advance drawer to next `untouched` PR.
   - `Next` → no API call. If there are any staged inline comments or non-empty summary text, show a confirmation modal: "Discard unsent comments?" with Discard / Cancel. On Discard → clear drafts for this PR, set status to `reviewed` locally, advance drawer. On Cancel → no state change.
6. End of queue → drawer shows empty state; next advance closes it.

## 6. Error handling

### Server
- `ghExec` failure mapping:
  - Stderr matches auth pattern (`gh auth login`, "no token", etc.) → HTTP **401** `{ code: "AUTH_REQUIRED" }`.
  - GraphQL error payload → HTTP **502** `{ code: "GH_API_ERROR", message, stderr }`.
  - Any other nonzero exit → HTTP **500** `{ code: "GH_CLI_FAILED", stderr }`.
- Invalid `owner/repo/number` params → HTTP **400** `{ code: "BAD_PARAMS" }`.
- Conflict on review submission (head SHA changed, thread resolved) → GitHub's message passed through in the 502 payload.

### Frontend
- `parsePRUrl` rejection → inline red message on `AddPRBar`, no request fires.
- Drawer surfaces server errors as a toast; drafts stay in component state so nothing is lost.
- `AUTH_REQUIRED` → top-level banner: "Run `gh auth login` and reload" with a copy-to-clipboard button.
- **Stale diff:** PR response carries `headSha`. If a freshly fetched meta `headSha` differs from the cached version, frontend re-requests `/diff?fresh=1`. If a `reviews` POST fails with a head-SHA conflict, drawer shows "PR was updated — reload to see latest" and disables Approve/RC/Comment until reload.
- **Closed/merged PR:** badge in `PRHeader`; Approve/RC/Comment disabled with tooltip; Next still works.
- **Submission failure:** buttons re-enable, staged comments remain staged, error toast shows the message.
- **Prefetch failures** are silent — best-effort cache warming, never user-visible.

## 7. Testing

### Server (vitest)
- `ghExec`: mock `child_process.execFile`; assert (a) nonzero exits become typed errors, (b) auth-pattern stderr → `AUTH_REQUIRED`, (c) successful calls return parsed JSON.
- `lruCache`: insertion, eviction at capacity, hit returns same reference, different `headSha` → different entry.
- Routes via Fastify `app.inject()`:
  - `GET /api/pulls/...` caches on second call (mocked `ghExec` invoked once).
  - `?fresh=1` bypasses cache.
  - `POST /reviews` builds the correct GraphQL mutation payload from the input body.
  - Error code mapping (401 / 400 / 500 / 502) behaves as specified.

### Frontend (vitest + React Testing Library + msw)
- `parsePRUrl`: valid / invalid URLs (with and without trailing slashes, files paths, comment anchors).
- `useTrackedPRs`: add / remove / setStatus round-trip through `localStorage`; state survives a remount (mock storage).
- `PRList` + `FilterToggle`: "Untouched only" hides `reviewed` and `approved` rows.
- `ReviewDrawer` flows with `msw` mocking backend:
  - Click row → drawer opens with PR meta and diff.
  - Click a diff line → inline editor mounts → staged comment appears.
  - Close + reopen drawer for the same PR → staged comment and summary text are still there.
  - Submit Approve → POST fires with `{ event: "APPROVE", body, comments }` → on 2xx, status flips to `approved`, drafts cleared, drawer advances to next untouched PR.
  - Next with no staged drafts → no POST, no modal → status flips to `reviewed`, drawer advances.
  - Next with staged drafts → confirmation modal appears; cancel preserves state; discard advances and clears drafts.
  - End of queue → empty state.
- `useNextPRPrefetch`: opening a PR triggers exactly one background fetch for the next `untouched` PR (assert via msw call count).

## 8. Open items deferred to the implementation plan

- Specific `react-diff-view` API choices (parser, decorations for inline comments and existing threads) — verify in plan after a spike.
- Exact GraphQL queries (field selection on `pullRequest`, `reviewThreads`, `reviewComments`) — finalize when wiring real responses.
- Styling system (CSS modules vs vanilla CSS) — minor; pick during scaffolding.

These are intentionally not blockers for design approval; they're naturally answered while writing the implementation plan.
