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
};
