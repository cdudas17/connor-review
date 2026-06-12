/**
 * Application configuration. This file ships with safe, generic defaults so
 * the repo is shareable. Real values for your team / org live in
 * `config.local.ts` (gitignored), which is loaded at build time and overrides
 * any fields it defines.
 *
 * Copy `config.local.example.ts` to `config.local.ts` and edit the values for
 * your environment.
 */

export interface ExternalLink {
  /** Visible label, can include leading emoji. */
  label: string;
  /** Absolute URL — opens in a new tab. */
  url: string;
  /** Optional group name. Links sharing a group render together in their own row, after the ungrouped ones. */
  group?: string;
}

export interface AppConfig {
  /** GitHub repo to read team members from, e.g. "Gusto/zenpayroll". Empty disables the Team PRs tab. */
  teamRepo: string;
  /** Path inside teamRepo to the YAML file with `github.members`. */
  teamYmlPath: string;
  /** PR label that drives the Oncall tab, e.g. "needs-review". */
  oncallLabel: string;
  /** External quick-links pinned to the top of the Oncall tab. */
  oncallLinks: ExternalLink[];
  /** GitHub login whose authored PRs populate the My PRs tab. Empty disables the tab. */
  myPRsAuthor: string;
  /**
   * Map of short repo names → absolute paths to local git checkouts that drive the Local tab.
   * Empty disables the Local tab. Example: { zenpayroll: '/Users/.../zenpayroll' }.
   * Server receives the path as a query param and validates it's a git repo before shelling out.
   */
  localRepos: Record<string, string>;
  /** Labels to ADD when clicking "Mark ready for review" on a draft PR. Empty = no-op. */
  markReadyAddLabels: string[];
  /** Labels to REMOVE when clicking "Mark ready for review" on a draft PR. Empty = no-op. */
  markReadyRemoveLabels: string[];
  /** When set (e.g. 'Gusto'), the floating "My open issues" panel only fetches
   * issues from this GitHub org/user. Empty = no filter (everything `gh` can see). */
  myIssuesOwner: string;
  /**
   * Auto-apply labels when you leave visible feedback on a PR authored by a specific user.
   * Keys are GitHub logins; values are the labels to add. Fired after a successful Comment,
   * Approve, Request changes, standalone inline comment, thread reply, or submit-pending.
   * (Not fired for staged/pending reviews — only when something becomes visible upstream.)
   * Best-effort: failure to add a label only toasts; it doesn't undo the user's action.
   * Example: { newtonry: ['Comments left by reviewer'] }
   */
  autoLabelOnReview: Record<string, string[]>;
}

const DEFAULTS: AppConfig = {
  teamRepo: '',
  teamYmlPath: '',
  oncallLabel: 'needs-review',
  oncallLinks: [],
  myPRsAuthor: '',
  localRepos: {},
  autoLabelOnReview: {},
  markReadyAddLabels: [],
  markReadyRemoveLabels: [],
  myIssuesOwner: '',
};

// Vite's import.meta.glob lets us optionally pull in config.local.ts if it
// exists, without TS / the bundler erroring when it's missing.
const overrides = import.meta.glob<{ APP_CONFIG?: Partial<AppConfig> }>('./config.local.ts', { eager: true });
const local = Object.values(overrides)[0]?.APP_CONFIG ?? {};

export const APP_CONFIG: AppConfig = { ...DEFAULTS, ...local };
