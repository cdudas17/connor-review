# Connor Command Center

A local-only, single-user web app for reviewing GitHub PRs without juggling
browser tabs. Paste PR URLs (or auto-load your team's queue from a `team.yml`
file), step through them in a slide-in drawer with GitHub-style diffs, and
Approve / Request changes / Comment / mark Reviewed inline. Built for personal
on-call workflows where the friction of `cmd+click` on every PR link adds up.

![Connor Review screenshot — placeholder](docs/screenshot.png)

## Highlights

- **Five tabs**: My PRs (authored, auto-fetched), Added PRs (manual paste),
  Team PRs (auto from a team-members YAML in any GitHub repo, refreshes every
  minute), Oncall (manual-fetch by label, drafts and ready-for-review split
  into filter chips), and Issues (GitHub issues you've been assigned, with a
  drawer view + pin-to-top).
- **GitHub-parity drawer**: PR description (rendered markdown), conversations
  (with diff hunks + author avatars), the full diff with unified/split toggle,
  expand-context arrows, intra-line edit highlights, review summaries, and
  GitHub-style `+N −M` counts.
- **Real review workflow**: select a line or drag across a range to comment,
  publish a single comment immediately, start a pending review, or finish your
  in-progress review. Approve advances to the next PR and toasts on success.
- **Claude-driven actions on red PRs**:
  - **Fix CI** — spins up an ephemeral worktree, pre-installs deps, and runs
    `claude -p` to fix failing tests / lints / type errors. Pushes the result
    straight to the PR branch. If Claude flags the failures as unrelated to
    the PR (`<<UNRELATED_REBASE>>`), the wrapper rebases onto the base branch
    and force-with-lease-pushes instead. Telemetry every step, prompt
    versioned (`server/src/prompts/fixCi.vN.ts`).
  - **Resolve merge conflicts** — Claude resolves conflicts against the base
    in a throwaway worktree and pushes the merged commit.
  - **CI checks drawer** — click the CI badge for a per-check breakdown.
    Failing Buildkite rows have an expand chevron that hits the Buildkite REST
    API and renders annotations inline (rspec failure bodies, screenshot
    paths, the failed-test list — the same content as Buildkite's Failures
    tab).
- **Quality of life**: per-file "Viewed" checkboxes, bulk-select & copy PR
  links across tabs, emoji shortcode autocomplete, `@-mention` autocomplete
  against your team roster in every drawer textarea, paste a URL onto
  selected text to linkify it, a draggable always-on-screen Notes pencil with
  a file-backed scratchpad, persistent prev/next nav, refresh button inside
  every drawer, and a "Refresh" indicator while data is reloading.
- **Bracket-tag filter on My PRs**: titles like `[ID->UUID] Rename ...` or
  `[ATM-SYNC][FF-ON] Enable ...` become toggleable chips (OR semantics). PRs
  with no leading bracket-tags land under `[NONE]`.
- **Pulls the right metadata**: GitHub status (Draft / Open / Changes
  requested / Approved / Merged), CI rollup (with `✓ N/M` / `✗ N/M` counts),
  labels, assignees, opened date, approver logins on hover, outdated-thread
  badges, auto-merge / Trunk merge-queue state, and conflict-with-base flag.
- **Authenticated via `gh`**: no GitHub tokens to manage; reuses your
  existing `gh auth login` session via `gh api graphql` subprocesses.

## Stack

- **Frontend** (`web/`, port 5173): Vite + React 18 + TypeScript,
  `react-diff-view`, `node-emoji`, `@primer/octicons-react`
- **Backend** (`server/`, port 5174): Fastify + TypeScript; shells out to
  the user's `gh` / `git` / `claude` CLIs for every external call
- **Fix CI telemetry service** (`services/fix-ci-telemetry/`, port 5180):
  separate Fastify + `better-sqlite3` app that captures every Fix CI run
  end-to-end, polls GitHub for the real outcome (CI green, merged,
  reverted), and clusters failures + slow successes into prompt-revision
  suggestions overnight. Dashboard at <http://127.0.0.1:5180/dashboard>.
- **Data storage**: localStorage for per-PR state + per-file Viewed flags;
  `~/.connor-review/notes.html` for the durable Notes scratchpad; SQLite at
  `services/fix-ci-telemetry/data/telemetry.db` for Fix CI runs.

## Run

Requires Node ≥ 20, npm ≥ 9, an authenticated `gh` CLI, and `git`. The
Claude-driven actions (Fix CI, resolve conflicts) additionally need the
[`claude` CLI](https://claude.com/claude-code).

```bash
gh auth login          # if you haven't already
npm run install:all    # one-time — installs root + server/ + web/ + services/fix-ci-telemetry/
npm run dev            # starts server (5174), web (5173), and telemetry (5180) in one terminal
```

Then open <http://localhost:5173>. Ctrl-C drops all three.

### Environment

The server loads `.env` from the repo root on startup as a fallback;
shell-exported variables (e.g. from `~/.zshrc`) still take precedence. Copy
`.env.example` to `.env` and fill in what you want, OR export the same vars
in your shell rc.

| Var | Purpose |
|-----|---------|
| `BUILDKITE_API_TOKEN` | Per-row Buildkite drill-in in the CI checks drawer. Create at <https://buildkite.com/user/api-access-tokens> with at minimum the `read_builds` scope. Unset = the drawer falls back to "open in Buildkite" links. |
| `FIX_CI_TELEMETRY_URL` | Where the server posts Fix CI milestones. Defaults to `http://127.0.0.1:5180` when launched via the root `npm run dev`; only needs setting if you run the server independently. Unset = telemetry is a no-op. |

The server logs which secrets are wired on boot — watch the cyan `[server]`
stripe for a `BUILDKITE_API_TOKEN: set ✓ / NOT set` line so you can confirm
the wiring without clicking through the UI.

## Configure for your team

Most personal references (team-members YAML location, Oncall label, external
quick-links pinned in the Oncall tab) live in **`web/src/config.local.ts`**,
which is gitignored.

1. Copy the example file:
   ```bash
   cp web/src/config.local.example.ts web/src/config.local.ts
   ```
2. Edit `web/src/config.local.ts`:
   - `teamRepo` — `OwnerName/repo` whose YAML lists your team's members
   - `teamYmlPath` — path inside that repo to the YAML file
   - `oncallLabel` — the PR label that drives the Oncall tab
   - `oncallLinks` — array of `{ label, url }` for the pinned shortcut row
   - `trunkMergeRepos` — repos where the auto-merge toggle should call
     `/trunk merge` instead of GitHub's native merge queue

The YAML you point `teamRepo` + `teamYmlPath` at needs to have:

```yaml
github:
  members:
    - alice
    - bob
    - your-gh-username
```

The Team PRs tab will then auto-load every open, non-draft, not-yet-approved
PR authored by those logins, refresh every 60 seconds while the tab is
visible, and pause when you hide it (no rate-limit risk — ~120 API calls/hr).

If you don't configure `teamRepo` / `teamYmlPath`, the Team PRs tab simply
shows "No PRs to review."; everything else works.

## Architecture

```
connor-review/
  web/                          Vite + React + TS frontend (port 5173)
  server/                       Fastify + TS backend (port 5174)
    src/prompts/                Fix CI prompt — versioned, file per shipped version
      fixCi.v1.ts, v2.ts, v3.ts
      index.ts                  getFixCiPrompt(version) dispatcher
  services/
    fix-ci-telemetry/           Standalone telemetry + suggestions service (port 5180)
      src/db.ts                 SQLite schema (runs / outcomes / prompt_suggestions)
      src/routes/               /events, /runs, /suggestions, /stats/by-version, /dashboard
      src/workers/              outcomePoller (5m), proposePrompt (24h + "Run now" button)
      data/telemetry.db         (gitignored)
  docs/                         Original design + implementation plan
```

Three packages with their own `package.json`. Root `npm run dev` uses
`concurrently -k --kill-signal SIGINT` to start all three; each child has its
own SIGINT handler with a 2s force-exit fallback so Ctrl-C reliably drops the
whole stack.

The Fastify server is a thin wrapper around `gh api graphql` for the GitHub
side, plus shell-outs to `git` (worktrees, rebases, force-with-lease pushes)
and `claude -p` (the Fix CI / resolve-conflicts flows). A small in-memory
LRU cache keys diffs and meta by `headSha`, with `?fresh=1` to bypass. An
exponential-backoff retry layer around `ghExec` re-runs on transient upstream
errors (HTTP 5xx, HTTP/2 stream cancel, ECONNRESET) — github.com occasionally
hiccups on big GraphQL queries.

The fix-ci-telemetry service is intentionally self-contained — it copies
its own `ghExec` / `claudeExec` helpers rather than importing from the
review-app server. The two apps share only a single env-gated HTTP contact
surface (`POST /events`), so the telemetry service can be offline, swapped,
or removed without affecting the review app.

## Fix CI workflow

How prompt iteration actually ships:

1. Telemetry dashboard at <http://127.0.0.1:5180/dashboard> shows
   success rate per `prompt_version`, plus a Prompt suggestions panel
   populated by Claude overnight (or on-demand via the **Run now** button).
2. Suggestions cluster runs by `(status, abort_code)` — failures
   (`safety_aborted`, `push_failed`, `install_failed`) AND slow successes
   (`success_pushed` / `success_rebased` past 15 min). `claude_failed` is
   excluded (CLI crash, not a prompt issue).
3. Click **View diff** on a suggestion to see the current prompt side-by-side
   with Claude's proposal, plus a Copy button.
4. To ship: `cp server/src/prompts/fixCi.vN.ts server/src/prompts/fixCi.v{N+1}.ts`,
   edit the new file, bump `FIX_CI_PROMPT_VERSION` in
   `server/src/lib/fixCiTelemetry.ts`, register the new builder in
   `server/src/prompts/index.ts`, restart the server. New runs are tagged
   with the new version, and the dashboard's version-comparison panel
   A/B-tracks them automatically.

## Tests

```bash
npm test
```

Server (111) + web (168) suites run in ~3 seconds total (~280 tests).
Covers ghExec retry classification, route param validation, the
YIQ-luminance label color picker, all persistence hooks, parsePRUrls /
paste-to-link helpers, bracket-tag extraction, and a flow test that drives
the whole drawer through MSW.

## Why?

I review my teammates' PRs through a mess of channels — Slack DMs, a private
#productive-requests channel, GitHub-app notifications. The
`cmd+click → cmd+w` rhythm on every link compounds, and reviewing a PR on
github.com means yet another tab. This is a single home where they all land
in a queue, the diff and conversations and CI status are visible without
leaving the page, Approve actually moves me to the next PR, and Claude can
take a stab at red CI without me having to drop into the repo.

The whole project was [vibe-coded with Claude](https://claude.com/) over
several sessions. The original design spec and implementation plan
([docs/superpowers/](docs/superpowers/)) are checked in for the curious.

## License

MIT — see [LICENSE](LICENSE). Personal tool, no warranty, but happy if it's
useful to anyone else.
