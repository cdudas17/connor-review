/**
 * Fix CI prompt — v1. Stable canonical version that the server has shipped
 * since the feature landed. Edit by COPYING into a new sibling file
 * (`fixCi.v2.ts`, `v3`, …) and bumping `FIX_CI_PROMPT_VERSION` in
 * `lib/fixCiTelemetry.ts`; don't mutate this file in place. Past runs are
 * tagged with the version string they ran against, so keeping the file in
 * the repo lets us look back at what was in play for any historical run
 * surfaced in the telemetry dashboard.
 */

export interface FixCiPromptInput {
  owner: string;
  repo: string;
  number: number;
  title: string;
  authorLogin: string | null;
  headRef: string;
  baseRef: string;
  headSha: string;
  worktreePath: string;
  /** Failing CI contexts on the PR's head commit. */
  failing: Array<{ name: string; state: string | null; url: string | null }>;
}

export function buildFixCiPrompt(input: FixCiPromptInput): string {
  const { owner, repo, number, title, headRef, headSha, worktreePath, failing } = input;
  const failingLines = failing.map((c) => `  - ${c.name}${c.state ? ` (${c.state})` : ''}${c.url ? `\n      ${c.url}` : ''}`);
  return [
    `You are fixing failing CI builds for PR #${number} ("${title}") in ${owner}/${repo}.`,
    '',
    `The PR branch ${headRef} is checked out at:`,
    `  ${worktreePath}`,
    '',
    'This is your CWD. Dependencies are ALREADY INSTALLED (bundle install + yarn install have already',
    'run). Do NOT re-run them — they take a long time and there is no need.',
    '',
    `The following CI checks are currently failing on the PR's head commit (${headSha}):`,
    '',
    ...failingLines,
    '',
    'Your task:',
    '',
    '1. Investigate which tests / linters / type checks are failing. Use the check names above to',
    '   identify the relevant local test commands (e.g. `bin/rspec spec/path/to/failing_spec.rb`,',
    '   `yarn jest path/to/test.test.ts`, `bundle exec rubocop file.rb`, `bundle exec srb tc`).',
    '',
    '2. Reproduce the failures locally by running the SPECIFIC failing test(s), not the full suite.',
    '   Use NON-INTERACTIVE, NON-WATCH flags to avoid hangs:',
    '     - jest: `--ci --no-watch --no-color`',
    '     - rspec: `--no-color --format documentation` (no `--watch`)',
    '     - rubocop / sorbet: their default non-interactive mode is fine',
    '   Wrap any test invocation in a 120-second outer timeout (e.g. `timeout 120 bin/rspec ...`)',
    '   so a misconfigured run cannot hang indefinitely.',
    '',
    '3. Once you have reproduced a failure, edit the relevant source files to make the test pass.',
    '   Re-run only the same test to verify the fix.',
    '',
    '4. Repeat until every failing CI check above passes locally.',
    '',
    '5. When you are done, briefly summarise:',
    '   - which checks were failing',
    '   - which files you changed',
    '   - which tests now pass',
    '',
    'You MAY use: Read, Edit, Write, Bash, Grep, Glob, LS.',
    '',
    'You MUST:',
    '  - NOT run any git commands (no commit, no push, no rebase). A wrapper will commit and push',
    '    your changes when you are done.',
    '  - NOT install dependencies (already done — re-running `bundle install` / `yarn install`',
    '    wastes minutes and risks lockfile churn).',
    '  - NOT modify Gemfile.lock, yarn.lock, package-lock.json, pnpm-lock.yaml, or any other',
    '    lockfile. Lockfile changes belong in their own PR; the wrapper will discard any',
    '    lockfile edits before committing.',
    '  - NOT enable interactive / watch modes for any test runner.',
    '  - NOT make changes unrelated to the failing CI checks. If a real fix requires broader',
    '    refactoring than the failing tests warrant, stop and explain instead of writing code.',
    '',
    'After you finish, the wrapper will commit your working-tree changes with --no-verify and push',
    'them to origin. If you made no changes, the wrapper will report that the PR needs no fixes from',
    'you.',
  ].join('\n');
}
