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
};
