/**
 * Copy this file to `config.local.ts` (gitignored) and fill in values for
 * your team / org. Any field you omit falls back to the default in
 * `config.ts`.
 */
import type { AppConfig } from './config.js';

export const APP_CONFIG: Partial<AppConfig> = {
  // The GitHub repo + YAML file that lists your team's GitHub members.
  // The YAML must have a `github.members:` array of logins.
  teamRepo: 'YourOrg/your-monorepo',
  teamYmlPath: 'config/teams/your-team/team.yml',

  // The PR label that should populate the Oncall tab.
  oncallLabel: 'needs-review',

  // Quick links pinned to the Oncall tab. Anything you want one click away.
  oncallLinks: [
    // { label: '📊 Team SLOs (Datadog)', url: 'https://app.datadoghq.com/dashboard/...' },
    // { label: '📥 Incoming TPOs (Jira)', url: 'https://yourorg.atlassian.net/...' },
    // { label: '⚰️ Sidekiq Morgue', url: 'https://your-internal-tool/...' },
  ],

  // Your GitHub login. Powers the "My PRs" tab (your own open PRs, drafts
  // included). Leave empty to hide the tab.
  myPRsAuthor: 'your-gh-username',

  // Scope the floating "My open issues" panel to a single GitHub org / user
  // (e.g. 'Gusto'). Leave empty to include every issue gh can see.
  myIssuesOwner: '',

  // Repos managed by Trunk's merge bot rather than GitHub auto-merge. For
  // these, the "Merge when ready" button posts `/trunk merge` (or
  // `/trunk cancel` to undo) instead of calling the GitHub mutation.
  trunkMergeRepos: [], // e.g. ['web']

  // Optional Google Calendar iframe embed URL. When set, the Calendar tab
  // gains an Agenda / Embed toggle — Embed mode drops the gcalcli-driven
  // agenda in favour of an iframe pointed at this URL. Useful when your
  // org's gcalcli OAuth is unreliable (Gusto IT restricts cross-account
  // calendar sharing, tokens expire, etc.) and it's easier to just log in
  // to google.com in the same browser.
  //
  // How to get the URL: open Google Calendar → Settings → Integrate
  // calendar → "Public URL to this calendar" or "Embed code" (copy the
  // `src` attribute out of the generated <iframe>). You can tack on
  // `&mode=WEEK` / `&mode=AGENDA` / etc. to change the default view.
  // Shared and work calendars appear as long as the browser session is
  // signed into a Google account that has access.
  //
  // Leave empty to hide the toggle entirely (tab keeps its current UI).
  calendarIframeUrl: '',

  // Local git checkouts that should power the "Local" tab. Short name → absolute
  // path. Each path must be a directory with a `.git` subdir. Diff is always
  // against the checkout's local `main`. Leave empty / omit to hide the tab.
  localRepos: {
    // zenpayroll: '/Users/you/workspace/zenpayroll',
    // web:        '/Users/you/workspace/web',
  },

  // When you click "Mark ready for review" on a draft PR, also add / remove
  // these labels in one action. Leave empty arrays if your workflow doesn't
  // use this convention.
  markReadyAddLabels: [],     // e.g. ['Ready for merging']
  markReadyRemoveLabels: [],  // e.g. ['Needs initial human review']

  // Auto-apply labels when you leave visible feedback on a PR by a specific user.
  // Keys are GitHub logins; values are label names. Fires after Comment / Approve /
  // Request changes / inline comment / thread reply / submit-pending. Best-effort —
  // a labeling failure only toasts, it doesn't undo your action.
  autoLabelOnReview: {
    // someuser: ['Comments left by reviewer'],
  },

  // Tag-driven Claude workflows on the My PRs tab. Each entry surfaces as a
  // pill button on matching PR rows; clicking runs the workflow. The `run`
  // function is just an async TS function — chain as many askAI /
  // fixCi / resolveConflicts / updateBranch / toast calls as needed; each
  // step's input + output streams into a result card in the drawer.
  //
  // See `web/src/lib/workflowTypes.ts` for the full contract + types.
  prWorkflows: [
    // Example: on every green [ID->UUID] PR, ask Claude to verify no
    // GraphQL loaders are at risk.
    // {
    //   id: 'loaders-check',
    //   label: 'Check loaders',
    //   description: "Ask AI if this PR breaks any GraphQL loaders.",
    //   tag: 'ID->UUID',
    //   matchCi: 'success',
    //   run: async ({ actions }) => {
    //     await actions.askAI(
    //       "Make sure this won't adversely affect any loaders. We've seen 2 incidents " +
    //       "where we forgot to swap some stuff in loaders."
    //     );
    //   },
    // },
    // Example: on every red [ID->UUID] PR, try Fix CI. The Fix CI prompt
    // outputs the <<UNRELATED_REBASE>> sentinel for failures it deems
    // unrelated, which the wrapper then handles as a rebase; if rebase
    // hits conflicts the workflow toasts so the user can intervene.
    // {
    //   id: 'auto-fix-or-rebase',
    //   label: 'Fix or rebase',
    //   description: 'If CI is failing, Fix CI; if Fix CI says unrelated, the prompt rebases automatically.',
    //   tag: 'ID->UUID',
    //   matchCi: 'failing',
    //   run: async ({ actions }) => {
    //     const result = await actions.fixCi();
    //     if (!result.ok && result.code === 'REBASE_CONFLICTS') {
    //       actions.toast('error', 'Rebase had conflicts — open the PR and resolve manually.');
    //     }
    //   },
    // },
  ],
};
