# Connor Review

A local-only, single-user web app for reviewing GitHub PRs without juggling
browser tabs. Paste PR URLs (or auto-load your team's queue from a `team.yml`
file), step through them in a slide-in drawer with GitHub-style diffs, and
Approve / Request changes / Comment / mark Reviewed inline. Built for personal
on-call workflows where the friction of `cmd+click` on every PR link adds up.

![Connor Review screenshot — placeholder](docs/screenshot.png)

## Highlights

- **Three tabs**: My PRs (manual paste), Team PRs (auto from a team-members
  YAML in any GitHub repo, refreshes every minute), and Oncall (manual-fetch
  by label, drafts and ready-for-review split into filter chips).
- **GitHub-parity drawer**: PR description (rendered markdown), conversations
  (with diff hunks + author avatars), the full diff with unified/split toggle,
  expand-context arrows, intra-line edit highlights, and review summaries.
- **Real review workflow**: select a line or drag across a range to comment,
  publish a single comment immediately, start a pending review, or finish your
  in-progress review. Approve advances to the next PR and toasts on success.
- **Quality of life**: per-file "Viewed" checkboxes, bulk-delete on My PRs,
  emoji shortcode autocomplete in comments, paste a URL onto selected text to
  linkify it, a draggable always-on-screen Notes pencil with a file-backed
  scratchpad, persistent prev/next nav, and a small "Refresh" indicator while
  data is reloading after a comment.
- **Pulls the right metadata**: GitHub status (Draft / Open / Changes
  requested / Approved / Merged), CI rollup with a click-through to Buildkite,
  labels, assignees, opened date, and outdated-thread badges.
- **Authenticated via `gh`**: no tokens to manage; reuses your existing
  `gh auth login` session via `gh api graphql` subprocesses.

## Stack

- **Frontend**: Vite + React 18 + TypeScript, `react-diff-view`, `node-emoji`
- **Backend**: Fastify + TypeScript on `127.0.0.1:5174`, shells out to the
  user's `gh` CLI for every GitHub call
- **Data storage**: localStorage for per-PR state + per-file Viewed flags,
  `~/.connor-review/notes.html` for the durable Notes scratchpad

## Run

Requires Node ≥ 20, npm ≥ 9, and an authenticated `gh` CLI.

```bash
gh auth login          # if you haven't already
npm run install:all    # one-time
npm run dev            # both the API (5174) and the SPA (5173)
```

Then open <http://localhost:5173>.

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
  web/      Vite + React + TS frontend
  server/   Fastify + TS backend (shells out to gh)
  docs/     Original design + implementation plan
```

Two top-level dirs with their own `package.json`. Root `npm run dev` uses
`concurrently` to start both. There's no monorepo tooling — the indirection
isn't worth it for two packages.

The Fastify server is a thin wrapper around `gh api graphql`. Every endpoint
shells out, parses the response, and returns it. A small in-memory LRU cache
keys diffs and meta by `headSha`, with `?fresh=1` to bypass. There's an
exponential-backoff retry layer around `ghExec` that re-runs on transient
upstream errors (HTTP 5xx, HTTP/2 stream cancel, ECONNRESET) — github.com
occasionally hiccups on big GraphQL queries.

## Tests

```bash
npm test
```

Server + web suites run in ~3 seconds total (~140 tests). Includes ghExec
retry classification, route param validation, the YIQ-luminance label color
picker, all persistence hooks, parsePRUrls / paste-to-link helpers, and a
flow test that drives the whole drawer through MSW.

## Why?

I review my teammates' PRs through a mess of channels — Slack DMs, a private
#productive-requests channel, GitHub-app notifications. The
`cmd+click → cmd+w` rhythm on every link compounds, and reviewing a PR on
github.com means yet another tab. This is a single home where they all land
in a queue, the diff and conversations and CI status are visible without
leaving the page, and Approve actually moves me to the next PR.

The whole project was [vibe-coded with Claude](https://claude.com/) over
several sessions. The original design spec and implementation plan
([docs/superpowers/](docs/superpowers/)) are checked in for the curious.

## License

MIT — see [LICENSE](LICENSE). Personal tool, no warranty, but happy if it's
useful to anyone else.
