# Feature catalog

A list of self-contained features in this repo, with file pointers and
dependencies, intended as a pick-and-choose menu for adapting parts into
other apps. Each entry covers:

- **What it does** — one-paragraph pitch.
- **Files** — where the implementation lives. Pointing Claude at these is
  enough to reproduce the feature elsewhere.
- **Requires** — runtime/env dependencies and any sibling features needed.
- **Adapt for your app** — what's domain-specific and likely needs swapping.

The catalog is grouped by area, not by ship date. For chronological context
see `git log --reverse`. For overall app architecture see [README.md](README.md).

---

## 1. Foundation

### 1.1 `gh` CLI shell-out with typed errors + retry
**What it does.** Every GitHub call is a `gh api …` subprocess, not an SDK
or token. Classifies stderr into AUTH_REQUIRED / RATE_LIMITED / GH_API_ERROR
/ GH_CLI_FAILED, and retries transient upstream errors (HTTP 5xx, HTTP/2
stream cancel, ECONNRESET, EAI_AGAIN, ETIMEDOUT) with exponential backoff
+ 20% jitter. 6 attempts ≈ a ~12s worst-case retry window.

**Files.** `server/src/lib/ghExec.ts`, `server/src/tests/ghExec.test.ts`.

**Requires.** A locally-authenticated `gh auth login` session.

**Adapt for your app.** Drop in as-is; rename if you use a different CLI
(claude, kubectl, etc.) by following the same shape — see
`server/src/lib/claudeExec.ts` for the same pattern around `claude -p`.

### 1.2 `git` shell-out
**What it does.** Subprocess wrapper for `git` with the same typed-error +
retry pattern. Used by Fix CI / resolve-conflicts worktree flows.

**Files.** `server/src/lib/gitExec.ts`.

**Adapt for your app.** Self-contained, no domain coupling.

### 1.3 Self-contained Claude CLI wrapper
**What it does.** Spawns `claude -p` with stdin-fed prompt (so argv-length
limits never trip on big diffs), configurable timeout, optional cwd,
`--allowedTools`, and `--permission-mode`. Surfaces ENOENT / TIMEOUT /
CLAUDE_FAILED.

**Files.** `server/src/lib/claudeExec.ts`. Same wrapper copied (intentionally)
into `services/fix-ci-telemetry/src/lib/claudeExec.ts` so the telemetry
service stays independent.

**Requires.** [`claude` CLI](https://claude.com/claude-code) on PATH.

**Adapt for your app.** Drop in; safe to copy across packages instead of
sharing a dep.

### 1.4 In-memory TTL/LRU cache
**What it does.** Tiny dependency-free Map-backed cache keyed by string,
with optional TTL. Used for PR meta and diffs keyed by `headSha` so the
drawer doesn't re-fetch on tab-switch.

**Files.** `server/src/lib/lruCache.ts`, `server/src/lib/ttlCache.ts`.

**Requires.** Nothing.

### 1.5 Fastify server scaffold
**What it does.** One-file `buildServer()` that registers CORS + every
route module. Health endpoint at `/api/health`. Explicit SIGINT/SIGTERM
handlers with a 2-second force-exit fallback so Ctrl-C reliably drops
the process even when in-flight async work would normally block
`app.close()`.

**Files.** `server/src/index.ts`.

**Requires.** `fastify`, `@fastify/cors`.

### 1.6 Zero-dep `.env` loader (with shell-wins precedence)
**What it does.** Reads `.env` from cwd or one level up before any other
import runs. Shell-exported vars take precedence so an `~/.zshrc` export
still wins over the file. Lets secrets work in both IDE terminals (which
sometimes skip `.zshrc`) and normal shells.

**Files.** `server/src/lib/loadEnvFile.ts`, called first in
`server/src/index.ts`. See also `.env.example`.

**Requires.** Nothing.

**Adapt for your app.** Drop in; safer than `dotenv` because the shell
always wins (so production secrets injected via systemd/k8s env don't get
quietly overridden by a stale `.env`).

### 1.7 Multi-process dev script with reliable Ctrl-C
**What it does.** `concurrently -k --kill-signal SIGINT` orchestrates
multiple dev servers in one terminal. Each child invokes
`cd <pkg> && exec ./node_modules/.bin/<tool>` so the signal-forwarding
chain skips the npm wrapper. Combined with the explicit SIGINT/SIGTERM
handlers in each Node entrypoint, one Ctrl-C drops everything within ~2s.

**Files.** `package.json` `dev` script.

**Requires.** `concurrently`. Per-process signal handlers (see 1.5).

**Adapt for your app.** Replace the per-child commands.

---

## 2. PR review drawer (the core UX)

### 2.1 Slide-in drawer with backdrop + Escape close
**What it does.** Right-side `position: fixed` drawer (70vw, min-width
720px) with a click-the-backdrop and Escape-to-close pattern. Scoped
`overscroll-behavior: contain` so the drawer scroll doesn't chain into
the underlying list.

**Files.** `web/src/components/ReviewDrawer.tsx`, `.drawer` /
`.drawer-backdrop` rules in `web/src/styles/app.css`.

**Adapt for your app.** Z-index 11 for the drawer, 10 for the backdrop;
bump higher if you stack drawers (see 2.2).

### 2.2 Stacked drawers (drawer-over-drawer)
**What it does.** Pattern for opening a second drawer on top of an open
one. Uses dedicated z-index pair (13 drawer + 12 backdrop) and bumps
specificity with `.drawer.<variant>` so the override beats the later-in-file
`.drawer { z-index: 11 }` rule.

**Files.** `.drawer.ci-checks-drawer` + `.drawer-backdrop.ci-checks-backdrop`
in `web/src/styles/app.css`; the CI checks drawer mounts as a sibling of
the review drawer in `web/src/App.tsx`.

### 2.3 GitHub-style diff viewer with intra-line highlights
**What it does.** Unified + split toggle, expand-context arrows between
hunks (▲ ▼ Octicon-style), intra-line edit highlights (the GitHub
"changed-word" tinting), per-file "Viewed" checkbox that collapses the
file card.

**Files.** `web/src/components/DiffViewer.tsx` (+ subcomponents in the
same folder).

**Requires.** `react-diff-view`. Server route that returns the unified
diff (`/api/pulls/:o/:r/:n/diff`) — see `server/src/routes/pulls.ts`.

### 2.4 Drag-to-select-lines inline comment composer
**What it does.** Select a single line or click-drag across a range to
attach a comment. Three actions: **Comment** (publishes one-shot),
**Start a review** (creates a PENDING review, returns id for subsequent
threads), **Approve / Request changes** (publishes the pending review
with an event).

**Files.** Drag selection in `web/src/components/DiffViewer.tsx`; review
composer in `web/src/components/ReviewFooter.tsx`; staging hook in
`web/src/hooks/useStagedDrafts.ts`; server endpoints in
`server/src/routes/pulls.ts` (`/threads`, `/reviews`, `/reviews/:id/submit`).

### 2.5 Conversations panel with inline diff-hunk snippets
**What it does.** Each thread renders the diff hunk it's anchored to,
collapsible cards tinted by row color, author avatars, Outdated badges
for threads whose anchor line has changed.

**Files.** `web/src/components/ConversationsList.tsx`,
`web/src/components/ConversationCard.tsx`.

### 2.6 "Newest wins" reconciliation
**What it does.** When the drawer's own meta-fetch and the list's
auto-refresh both update the same PR, neither one blindly overwrites the
other — they compare `metaFetchedAt` timestamps and the newer fetch wins.

**Files.** `web/src/App.tsx` (`handleMetaLoaded`); timestamp stamped on
every update via `useTrackedPRs.update`.

### 2.7 Prev/next PR nav + scroll-reset-on-advance
**What it does.** Drawer footer arrows step through the queue without
status change. On Approve / Request-changes / Mark-Reviewed, advances to
the next untouched PR and scrolls the drawer to the top.

**Files.** Footer in `web/src/components/ReviewFooter.tsx`; advance logic
in `web/src/App.tsx`.

### 2.8 @-mention autocomplete in every drawer textarea
**What it does.** Type `@` in any drawer composer (top-level summary,
inline thread reply, conflict-resolve box) and a dropdown surfaces the
team roster. Uses a two-trigger pattern that handles both `@` and `:`
(emoji shortcodes — see 6.3) without collisions.

**Files.** `web/src/components/EmojiTextarea.tsx` (handles both triggers),
`web/src/contexts/MentionsContext.tsx`.

### 2.9 Markdown rendering for review bodies + Claude responses
**What it does.** Renders Markdown (lists, code blocks, links, inline
code) in comment bodies + Claude responses.

**Files.** `web/src/lib/renderNotes.ts`, also reused by the Notes panel.

---

## 3. PR list, tabs, and filters

### 3.1 Multi-tab queue (My / Added / Team / Local / Oncall / Issues)
**What it does.** Tabbed router state that swaps the underlying PR source
without re-mounting the rest of the app. Each tab has its own auto-refresh
cadence (or is manual).

**Files.** `web/src/components/Tabs.tsx`, tab-id switching in
`web/src/App.tsx`. Per-tab data hooks in `web/src/hooks/` —
`useMyPRs.ts` (authored), `useTeamPRs.ts`, `useOncallPRs.ts`, etc.

**Note.** Tab IDs are intentionally backwards: `id='my'` is the "Added
PRs" tab, `id='mine'` is the "My PRs" (authored) tab. Historical naming.

### 3.2 Team-roster YAML auto-fetch
**What it does.** Tab loads every open, non-draft, not-yet-approved PR
authored by members listed in a configurable YAML in any GitHub repo.
Refreshes on a configurable interval while the tab is visible; pauses on
hidden. Paginates past the 100-row GraphQL cap.

**Files.** `web/src/hooks/useTeamPRs.ts` (auto-refresh, visibility-aware,
pagination), `server/src/routes/team.ts` (YAML fetch + GraphQL search).

**Requires.** A team-members YAML in a GitHub repo with shape
`github: { members: [login1, login2, …] }`. Configured via
`web/src/config.local.ts`.

### 3.3 Member-toggle chips (filter by author)
**What it does.** Pill-button chips, one per member, with a count badge.
Click to hide that member's PRs (OR semantics). Bulk Select-all /
Clear-all.

**Files.** `web/src/components/MemberFilter.tsx`. State + handlers in
`web/src/App.tsx`. CSS: `.member-filter`, `.member-chip`.

### 3.4 Bracket-tag filter chips (`[ID->UUID]`, `[NONE]`, etc.)
**What it does.** Extracts contiguous `[BRACKET]` prefixes from PR titles
and turns them into toggle chips. PRs with no leading bracket-tags fall
under a `[NONE]` chip pinned at the end. OR semantics on multiple chips.
Skips render when there's <2 tags.

**Files.** `web/src/lib/extractTags.ts` + `web/tests/lib/extractTags.test.ts`,
`web/src/components/TagFilter.tsx`. Wiring in `web/src/App.tsx`.

**Adapt for your app.** The extract-tags regex is generic; rebrand the
chip component (CSS class names) and you're done.

### 3.5 Bulk-select + Copy GitHub links
**What it does.** Checkbox per row + a `bulk-actions-bar` that surfaces
when ≥1 row is selected. "Copy links" puts newline-separated URLs on the
clipboard.

**Files.** `web/src/components/BulkActionsBar.tsx`, selection state in
`web/src/App.tsx`.

### 3.6 Untouched-only filter (mode toggle)
**What it does.** Two-mode toggle: Show all / Untouched only. Drives
which PRs the prev/next nav walks through.

**Files.** `web/src/components/FilterToggle.tsx`.

### 3.7 Green-CI-only filter (Team PRs)
**What it does.** Toggle on the Team PRs tab that hides any PR whose CI
rollup isn't SUCCESS. Persists across reloads.

**Files.** `web/src/App.tsx` (`teamGreenCiOnly` + the persistence effect),
inline `<label className="team-green-ci-toggle">…`.

### 3.8 Oncall tab — label-filtered + state chips + pinned links
**What it does.** Manual-fetch tab that filters PRs by a configurable
label (e.g. `talent-alerts`). Two-state chip filter: Draft vs Ready for
review. Pinned external links (Datadog dashboards, Jira, etc.) configured
via `oncallLinks` with optional `group` clustering.

**Files.** `web/src/hooks/useOncallPRs.ts`,
`web/src/components/OncallStateFilter.tsx`. Links rendered inline in
`web/src/App.tsx`.

### 3.9 Local tab — review unpushed branches
**What it does.** Diffs a local branch against the checkout's `main`
using the same drawer UI. No review actions (no GitHub server-of-record).

**Files.** `web/src/components/AddLocalBranchBar.tsx`,
`server/src/routes/local.ts` (uses `git diff` + filesystem paths).

### 3.10 Per-row status badges (Reviewed/Approved/Draft/Closed/Claude)
**What it does.** Trailing icon cluster on every row: ClaudeBadge (when
Claude has run against this PR), ConflictBadge (when GH says merge
conflicts), draft/closed Octicons, Reviewed / Approved icons, the CI
badge, etc. Each badge has its own conditional render and stops event
propagation so clicks don't open the drawer.

**Files.** `web/src/components/PRList.tsx`. Individual badges in
`web/src/components/{Conflict,Gh,Ci,Status,Claude}Badge.tsx`.

### 3.11 PR-row auto-merge toggle + Trunk merge-queue support
**What it does.** Icon-only square button per row + drawer footer. Three
states: off (outlined), on (filled green), queued (amber when the PR is
approved + the merge queue has accepted it). For repos in
`trunkMergeRepos`, calls Trunk via `/trunk merge` PR-comment shim instead
of GitHub native auto-merge. Optimistic flip + refetch to confirm.

**Files.** `web/src/components/PRList.tsx` (per-row toggle),
`server/src/routes/pulls.ts` (`/auto-merge`, `/trunk-merge`).

### 3.12 Per-row "Copy PR link" button
**What it does.** Tiny copy-icon button on each row that puts the GitHub
URL on the clipboard. Shows a check briefly on success.

**Files.** `web/src/components/CopyLinkButton.tsx`.

---

## 4. PR header / metadata surface

### 4.1 GhStatusBadge — Draft / Open / Approved / Merged / Closed / etc.
**What it does.** Single pill-or-icon component that renders the right
GitHub status with the right Octicon. Approver logins surface in the
hover tooltip ("Approved by alice, bob") when known.

**Files.** `web/src/components/GhStatusBadge.tsx`.

### 4.2 CI rollup badge with N/M counts
**What it does.** Aggregates all check contexts on the PR head into a
single badge, rendering `✓ 12/12`, `✗ 3/9`, or `● 4/9` (passing /
failing / pending) GitHub-style. Per-status color (red/amber/green).
Click → CI checks drawer (see 7.x). Optional spinner overlay when a
Fix CI run is in flight for that PR.

**Files.** `web/src/components/CiBadge.tsx`.

### 4.3 +N −M diff totals chip
**What it does.** Drawer header shows GitHub-style green-`+N` red-`−M`
counts derived from the unified diff. Tabular numerals so plus and minus
columns line up. Hover tooltip shows the file count.

**Files.** `web/src/lib/diffStats.ts`,
`web/src/components/PRHeader.tsx`.

### 4.4 Conflict badge
**What it does.** Renders only when GitHub reports
`mergeable=CONFLICTING`. Two variants: 18×18 icon for the row cluster,
labelled pill for the drawer header. Clickable to fire the resolve flow
(see 5.2).

**Files.** `web/src/components/ConflictBadge.tsx`.

### 4.5 Labels + Assignees rows
**What it does.** `LabelChips` renders PR labels with YIQ-luminance-driven
text color so light/dark backgrounds always have readable text.
`AssigneesRow` renders avatar + login, hidden when empty.

**Files.** `web/src/components/LabelChips.tsx`, `web/src/lib/labelColor.ts`,
`web/src/components/AssigneesRow.tsx`.

### 4.6 Outdated-thread badge
**What it does.** Tags review threads whose anchor line has been replaced
in a later commit. Hover-tooltip explains why.

**Files.** Computed inline in `web/src/components/ConversationsList.tsx`.

---

## 5. Claude-driven actions

### 5.1 Ask Claude — single-call per composer
**What it does.** Every draft-comment composer has an "Ask Claude" button
that pipes the diff + draft to `claude -p` (run in the target repo's
cwd, so Claude can read surrounding code). Response renders as Markdown
inline. Multi-turn chat available on the top-level composer.

**Files.** `web/src/components/ClaudeChatPanel.tsx`,
`web/src/hooks/useClaudeResponses.ts` (persistence with 30-day sweep +
LRU cap + on-PR-delete), `server/src/routes/pulls.ts` (`/ask-claude`).

**Requires.** `claude` CLI. The user's gh PATH (the local checkout) for
the `cwd` so Claude can read the actual code.

### 5.2 Resolve merge conflicts
**What it does.** Click the ConflictBadge → server spins up a throwaway
worktree off the PR head, runs `git merge origin/<baseRef>`, hands the
conflict files to `claude -p` with a tight `Read,Edit,Bash` allowlist,
commits with `--no-verify`, pushes. Safety check uses a content-hash diff
(not `--cc`) so stale-branch false-positives don't trigger an unwanted
push.

**Files.** `server/src/routes/pulls.ts` (`/resolve-conflicts`),
`server/src/prompts/` (the conflict-resolution prompt body is inline in
the route currently; could be lifted into the same `prompts/` registry
as Fix CI).

### 5.3 Fix CI button (the headline Claude flow)
**What it does.** When a PR has failing CI checks, the drawer footer
surfaces a "Fix failing CI builds" button. Clicking it spins up an
ephemeral worktree, pre-installs deps via the user's login shell (so
mise/rbenv/asdf activates), runs Claude with a 30-min timeout, reverts
any lockfile churn, and pushes the result. The Fix CI button is also
embedded inside the CI-checks drawer.

If Claude concludes the failures are unrelated (`<<UNRELATED_REBASE>>`
sentinel), the route rebases onto base and force-with-lease-pushes
instead (see 5.4).

**Files.** `server/src/routes/pulls.ts` (`/fix-ci`),
`server/src/prompts/fixCi.v3.ts` (current shipped prompt body) +
`server/src/prompts/index.ts` (version-keyed dispatcher),
`server/src/lib/fixCiTelemetry.ts` (the `FIX_CI_PROMPT_VERSION`
constant and the telemetry emit helper),
`web/src/hooks/useCiFixes.ts` (per-PR state, rescue-stuck-runs).

**Requires.** `git`, `gh`, `claude`, the user's login shell tooling.
Optional: `FIX_CI_TELEMETRY_URL` for observability.

**Per-PR resilience.** Spinner overlay on the CI badge while running.
Dismiss button + 45-min stale auto-flip so a hung browser session can't
show a permanent "running" state. Lockfile guard reverts
`Gemfile.lock` / `yarn.lock` / etc. before commit. Worktree branch
name (`connor-review-fix-ci-…`) avoids collision with existing checkouts.

### 5.4 `<<UNRELATED_REBASE>>` rebase-not-fix path
**What it does.** The Fix CI prompt explicitly instructs Claude to output
`<<UNRELATED_REBASE>>` and stop when the failures aren't caused by this
PR (fixed on base, pre-existing main breakage, flaky infra). The route
captures Claude's stdout, detects the sentinel, discards any stray edits,
`git rebase origin/<baseRef>`, then
`git push --force-with-lease=<headRef>:<originalHeadSha>` (pinned so a
teammate's concurrent push fails safely). If the rebase has conflicts, it
aborts — no merge-conflict resolution attempted in this path.

**Files.** Sentinel handling in `server/src/routes/pulls.ts`; sentinel
documented in `server/src/prompts/fixCi.v3.ts`.

### 5.5 File-per-version prompt registry
**What it does.** Externalizes Claude prompts to `server/src/prompts/`
with one file per shipped version
(`fixCi.v1.ts`, `fixCi.v2.ts`, `fixCi.v3.ts`). A registry function
(`getFixCiPrompt(version)`) returns the matching builder, falling back to
the latest. Historical runs stay reproducible — you can always read back
exactly what was in play.

**Files.** `server/src/prompts/index.ts`, `server/src/prompts/fixCi.v*.ts`.

**Adapt for your app.** Drop in; the shape is `{ version-string ->
(input) => string }` and any model-call dispatcher will work.

---

## 6. Quality-of-life polish

### 6.1 Draggable Notes pencil (file-backed scratchpad)
**What it does.** Always-on-screen FAB (defaults bottom-left, draggable)
opens a 440×620 panel with a free-form note-taking textarea. Persists to
`~/.connor-review/notes.html` (file-backed, so it survives browser
profile resets).

**Files.** `web/src/components/NotesFab.tsx` +
`web/src/components/NotesPanel.tsx`,
`server/src/routes/notes.ts` (GET/PUT against the file).

### 6.2 "My open issues" floating widget
**What it does.** Separate draggable FAB + panel that lazy-fetches
GitHub issues assigned to OR authored by the viewer in selected repos.

**Files.** `web/src/components/IssuesFab.tsx` + `IssuesPanel.tsx`.

### 6.3 Emoji shortcode autocomplete (`:foo:`)
**What it does.** Type `:` in any drawer composer; dropdown surfaces
matching emoji shortcodes. Positioned next to the caret, flipped above
when it would clip the viewport. Shares the same trigger-detection
component as @-mentions.

**Files.** `web/src/components/EmojiTextarea.tsx`.

**Requires.** `node-emoji`.

### 6.4 Paste-to-linkify selected text
**What it does.** Select text in any composer, paste a URL → the
selection gets wrapped in `[text](url)` markdown (GitHub-style).

**Files.** `web/src/lib/pasteLinkify.ts`.

### 6.5 Per-PR refresh button in the drawer header
**What it does.** Small icon button next to the close button that
force-refreshes meta + diff for the current PR via `?fresh=1`. Spinner
while loading.

**Files.** `web/src/components/ReviewDrawer.tsx` (drawer-refresh button).

### 6.6 Toast stack (bottom-left)
**What it does.** Self-dismissing toast notifications with a clean stack
animation, used for review-submit success/failure, error fallbacks, etc.

**Files.** `web/src/components/ToastStack.tsx`,
`web/src/hooks/useToasts.ts`.

### 6.7 "Connor Command Center" CSS starfield title
**What it does.** Pure-CSS animated radial-gradient star field behind the
title text, no images.

**Files.** Inline title + animation in `web/src/styles/app.css`.

---

## 7. CI checks drawer + Buildkite drill-in

### 7.1 CI checks drawer (per-check breakdown)
**What it does.** Click the CI badge → opens a right-side drawer that
lists every check on the PR's head commit, grouped failing → pending →
skipped → passing. Each row shows the state icon, name, current state,
and a Details link. Headlines summary count ("3 failing, 12 passing").

**Files.** `web/src/components/CiChecksDrawer.tsx`. Wires in
`web/src/App.tsx` (target state + onOpenCiChecks plumbed to every
CiBadge usage).

### 7.2 Buildkite per-row drill-in
**What it does.** For checks whose URL points to `buildkite.com`, the row
gets an expand chevron. Click → fetches the build's annotations via the
Buildkite REST API and renders them inline (rspec failure bodies,
screenshot paths, the failed-test list). Annotations are rendered with
their existing HTML via `dangerouslySetInnerHTML` — annotations come
from a trusted internal API behind your own token, so the XSS surface is
acceptable for a local-only dev tool.

**Files.** `server/src/routes/buildkite.ts` (URL parsing + API calls),
`web/src/components/CiChecksDrawer.tsx` (chevron + cached per-row state),
`web/src/lib/api.ts` (`getBuildkiteFailures`).

**Requires.** `BUILDKITE_API_TOKEN` env var with at minimum the
`read_builds` scope.

**Adapt for your app.** Swap the API for CircleCI / GitHub Actions / etc.
The chevron-with-cached-loading pattern in
`CiChecksDrawer.tsx#toggleBuildkiteRow` is generic.

### 7.3 Buildkite-style red-X row treatment
**What it does.** Failing Buildkite rows render with a full-height
orange-red square containing an X icon on the left, plus a red-outlined
card body — matches Buildkite's build-page Failures tab. Non-Buildkite
failures keep the standard inline layout.

**Files.** `.ci-checks-buildkite-failure` CSS rules in
`web/src/styles/app.css`.

---

## 8. Issues tab + pinned issues

### 8.1 Issues tab + drawer
**What it does.** Tab listing GitHub issues assigned to the viewer in
selected repos. Click an issue → drawer shows its body rendered as
Markdown, plus header metadata. Persists between sessions and
auto-refreshes; survives the user being offline.

**Files.** `web/src/components/IssueDrawer.tsx`,
`web/src/hooks/useMyIssues.ts`, `web/src/hooks/useIssueDetails.ts`.
Server route: `server/src/routes/issues.ts`.

### 8.2 Pin issues to the top
**What it does.** Pin any issue to the top of the Issues tab. Pinned set
persists to `localStorage`, **and** the full row is cached locally — so
if a fetch returns empty (rate limit, transient gh error), the pinned
rows still show. Prefetch their drawer content while on the Issues tab
so click-to-open is instant.

**Files.** `web/src/hooks/usePinnedIssues.ts`,
`web/src/hooks/useIssueDetails.ts` (`prefetchIssue`).

---

## 9. Fix-CI telemetry + auto-prompt-iteration service

### 9.1 Standalone telemetry app (sibling Node service)
**What it does.** Separate Fastify + `better-sqlite3` app under
`services/fix-ci-telemetry/`. Captures every Fix CI run end-to-end (one
SQLite row per run, milestone updates) and surfaces analytics + nightly
auto-generated prompt suggestions on a local dashboard.

**Files.** Entire `services/fix-ci-telemetry/` directory.

**Architecture.** Three tables (`runs`, `outcomes`, `prompt_suggestions`),
HTTP ingest at `POST /events`, dashboard at `GET /dashboard` (single-file
HTML, no framework), two background workers (outcome poller, propose-prompt).

### 9.2 Single env-var contact surface to the parent app
**What it does.** The review-app server emits Fix CI milestones via a
single helper, `emitFixCiEvent`. If `FIX_CI_TELEMETRY_URL` is unset every
call is a no-op. Each emit is bounded to 1 second and swallows all errors,
so a slow / dead telemetry service can never block a Fix CI run.

**Files.** `server/src/lib/fixCiTelemetry.ts` (the helper +
`FIX_CI_PROMPT_VERSION` constant). Called from
`server/src/routes/pulls.ts` at the four natural milestones (started,
install_done, claude_done, finished).

**Adapt for your app.** Drop in directly for any "observe a long-running
shell-out across versions" scenario.

### 9.3 Outcome poller — re-asks GitHub what happened
**What it does.** Every 5 minutes, the poller picks up runs that pushed a
commit and asks GitHub (via `gh api`) for the PR's current CI state,
merge timestamp, and a reverted flag (commit no longer in the PR's commit
list). Upserts into `outcomes`. No SDK / token — uses the same locally
authenticated `gh`.

**Files.** `services/fix-ci-telemetry/src/workers/outcomePoller.ts`.

### 9.4 Propose-prompt worker — clusters + Claude rewrite
**What it does.** Daily worker (and on-demand via the dashboard's "Run
now" button) that clusters the last 7 days of "interesting" runs by
`(status, abort_code)` and asks Claude to draft a revised prompt. Two
eligibility buckets:

- **Failures** — `safety_aborted`, `push_failed`, `install_failed`.
  `claude_failed` excluded (CLI crash, not a prompt issue).
- **Slow successes** — `success_pushed` / `success_rebased` past 15
  minutes wall-clock. Tagged with synthetic `SLOW` abort code so they
  cluster together regardless of push vs rebase.

Meta-prompt branches on shape: failure clusters get "steer away from this
failure", SLOW clusters get "produce the same fixes faster" with the
timing breakdown + files-changed list fed in.

**Files.** `services/fix-ci-telemetry/src/workers/proposePrompt.ts`.

### 9.5 Dashboard with version-comparison panel + expandable diff
**What it does.** Tiny single-file HTML/JS at `/dashboard`. Three sections:

- **By prompt version** — total / success / rebased / safety aborts /
  claude failed / rebase conflicts / no changes / avg wall-clock.
  Auto A/B-tracks any new shipped version.
- **Recent runs** — last 50 runs with PR links, per-step timings, status
  pills, and the post-hoc CI/merged/reverted state from the poller.
- **Prompt suggestions** — expandable rows that show the current prompt
  vs Claude's proposal side-by-side (green-tinted) with a Copy button
  and links to the runs that drove the cluster. "Run now" button
  fires the worker on demand (single-slot guarded).

**Files.** `services/fix-ci-telemetry/src/views/dashboard.html` (HTML +
inline JS), `services/fix-ci-telemetry/src/routes/dashboard.ts`
(re-reads file each request so HTML edits hot-reload without restart).

### 9.6 Self-contained shell-out helpers (intentional copy)
**What it does.** The telemetry service has its own
`src/lib/ghExec.ts` + `src/lib/claudeExec.ts` instead of importing from
the review app. The two apps stay independent — the telemetry service
can be moved, swapped, or turned off without coordinating across
packages. The copies stay tiny (~80 LOC each) and can diverge later.

**Files.** `services/fix-ci-telemetry/src/lib/{ghExec,claudeExec}.ts`.

---

## 10. Persistence patterns

### 10.1 localStorage-backed PR queue with LRU + sweep
**What it does.** Tracked PRs persist to `localStorage` keyed by
`owner/repo/number`. Includes:

- **Backfill effect** — older entries that pre-date a field (e.g.
  `ciStatus`) get re-fetched once on app load and the row updated.
- **Source-tagged** entries — `authored` vs `pasted` vs `local-branch`
  flow through the same hook but the UI can dedupe / differentiate.
- **30-day sweep + LRU cap** on derived data (Claude responses) so the
  store doesn't grow unbounded.

**Files.** `web/src/hooks/useTrackedPRs.ts` (base),
`web/src/hooks/useClaudeResponses.ts` (sweep pattern),
`web/src/hooks/useCiFixes.ts` / `useConflictResolutions.ts` (per-PR
in-flight state with stale auto-flip).

### 10.2 File-backed Notes scratchpad
**What it does.** A textarea-backed scratchpad that survives browser
profile resets. Server endpoint reads/writes a single file at
`~/.connor-review/notes.html`.

**Files.** `web/src/components/NotesPanel.tsx`,
`server/src/routes/notes.ts`.

### 10.3 SQLite (better-sqlite3) for the telemetry service
**What it does.** WAL-mode SQLite at
`services/fix-ci-telemetry/data/telemetry.db`. Three tables, plus
schema-on-startup so a fresh DB just works.

**Files.** `services/fix-ci-telemetry/src/db.ts`.

---

## How to adapt a feature into another app

A simple prompt for Claude (or you):

```
Read /path/to/connor-review/FEATURES.md. I want feature X — read the files
listed there, plus their immediate dependencies, then lift the code into
<your repo> at <your path>. Skip anything connor-review-specific (the GH
auth assumption, the team-YAML config, etc.); call out anywhere I'll need
to substitute my own backend / config.
```

Most features are 1-3 small files plus a CSS block in
`web/src/styles/app.css`. The pre-shipped ones with no GitHub-specific
coupling are: the `.env` loader (1.6), the multi-process dev script (1.7),
the slide-in drawer chrome (2.1), the drag-to-select composer (2.4), the
@-mention + emoji autocomplete (2.8 + 6.3), the bracket-tag filter (3.4),
the toast stack (6.6), the file-per-version prompt registry (5.5), the
chevron-with-cached-loading row pattern (7.2), and the entire telemetry
service if you want a separate "observe a CLI-driven action across
versions" app.
