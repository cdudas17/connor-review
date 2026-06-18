/**
 * Fix CI prompt — v2. Adds a triage-first branch: if Claude concludes the
 * failing checks are NOT caused by this PR's changes, it should output the
 * sentinel `<<UNRELATED_REBASE>>` and stop. The route detects the sentinel
 * and rebases the PR onto its base + force-pushes instead of trying to
 * commit a fix. Net result: CI re-runs against the up-to-date base, and if
 * the failure is already fixed there (or was flaky), the build goes green.
 *
 * Everything else matches v1.
 */

export type { FixCiPromptInput } from './fixCi.v1.js';
import type { FixCiPromptInput } from './fixCi.v1.js';

export function buildFixCiPrompt(input: FixCiPromptInput): string {
  const { owner, repo, number, title, headRef, baseRef, headSha, worktreePath, failing } = input;
  const failingLines = failing.map((c) => `  - ${c.name}${c.state ? ` (${c.state})` : ''}${c.url ? `\n      ${c.url}` : ''}`);
  return [
    `You are fixing failing CI builds for PR #${number} ("${title}") in ${owner}/${repo}.`,
    '',
    `The PR branch ${headRef} is checked out at:`,
    `  ${worktreePath}`,
    '',
    `Its base branch is ${baseRef}. The PR's current head SHA is ${headSha}.`,
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
    '0. **Triage first.** Before editing anything, decide whether the failures are caused by this',
    `   PR's changes or by something else. "Something else" includes:`,
    `   - the failure is already fixed on the base branch (${baseRef}) and this PR is stale,`,
    '   - the failure is a pre-existing breakage on the base branch (same test fails on a clean',
    `     checkout of ${baseRef}),`,
    '   - the failure is from flaky test infrastructure (random network, timeout, runner OOM),',
    '   - the failure is from an unrelated dependency / config change that landed on the base.',
    '',
    `   If you conclude the failures are NOT caused by this PR's changes, DO NOT edit any files.`,
    '   Instead, output exactly the line:',
    '',
    '       <<UNRELATED_REBASE>>',
    '',
    '   on its own line, then stop. The wrapper will rebase this PR onto its base branch and',
    '   force-push the rebased commit. CI will re-run on the up-to-date branch; if the base',
    '   has the fix (or the failure was flaky), the new build will go green.',
    '',
    '   Quick triage tips: `git log --oneline -20 origin/' + baseRef + '` and',
    '   `git diff origin/' + baseRef + '...HEAD --stat` (the latter shows only files this PR',
    `   touches — if a failing test isn't in that list, the failure probably isn't ours).`,
    '',
    '1. If the triage says the failures ARE caused by this PR, investigate which tests / linters /',
    '   type checks are failing. Use the check names above to identify the relevant local test',
    '   commands (e.g. `bin/rspec spec/path/to/failing_spec.rb`, `yarn jest path/to/test.test.ts`,',
    '   `bundle exec rubocop file.rb`, `bundle exec srb tc`).',
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
    '  - NOT run any git commands that mutate state (no commit, no push, no rebase). Read-only',
    '    `git log` / `git diff` / `git show` for triage are fine.',
    '  - NOT install dependencies (already done — re-running `bundle install` / `yarn install`',
    '    wastes minutes and risks lockfile churn).',
    '  - NOT modify Gemfile.lock, yarn.lock, package-lock.json, pnpm-lock.yaml, or any other',
    '    lockfile. Lockfile changes belong in their own PR; the wrapper will discard any',
    '    lockfile edits before committing.',
    '  - NOT enable interactive / watch modes for any test runner.',
    '  - NOT make changes unrelated to the failing CI checks. If a real fix requires broader',
    '    refactoring than the failing tests warrant, stop and explain instead of writing code.',
    '  - NOT output `<<UNRELATED_REBASE>>` AND edit files in the same run. Pick one: rebase path',
    `    or fix path. If you're unsure, prefer the fix path.`,
    '',
    'After you finish, the wrapper will either commit your working-tree changes (fix path) or',
    'rebase the PR onto its base and force-push (rebase path). If you made no changes and did',
    'not output the sentinel, the wrapper will report that the PR needs no fixes from you.',
  ].join('\n');
}
