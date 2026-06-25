/**
 * Fix CI prompt — v3. Tightens the directive language from v2 around speed:
 * investigate only the named failures, never run the full suite (not even to
 * "confirm"), make the narrowest change, cap individual test runs. Adopted
 * from the dashboard's first latency-cluster suggestion.
 *
 * The dynamic preamble (PR header, worktree, failing-check list) and the
 * UNRELATED_REBASE sentinel mechanism are kept verbatim — without those the
 * wrapper can't tell Claude what to fix or take the rebase path.
 *
 * Edit by COPYING into a sibling file (`fixCi.v4.ts`, …) and bumping
 * `FIX_CI_PROMPT_VERSION` in `lib/fixCiTelemetry.ts`; don't mutate this file
 * in place.
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
    'This is your CWD. Dependencies are ALREADY INSTALLED (bundle install +',
    'yarn install have already run). Do NOT re-run them — they take a long time',
    'and there is no need.',
    '',
    `The following CI checks are currently failing on the PR's head commit (${headSha}):`,
    '',
    ...failingLines,
    '',
    'You are fixing failing CI builds for a PR.',
    'Investigate ONLY the specific failing test(s) / linter rule(s) / type',
    'error(s) named in the CI output — go straight to them, do not survey',
    'the surrounding code or related files unless a fix requires it. Reproduce',
    'locally by running ONLY the individual failing test(s) (or the single',
    'failing lint/type check), never the full suite, and never re-run the full',
    'suite to "confirm" — re-run only the test(s) you changed. Edit source',
    'files to make them pass, making the narrowest change that fixes the named',
    'failure and touching the fewest files possible. Do not touch lockfiles,',
    'do not run git, do not enable interactive/watch modes, cap any single',
    'test/check run at a few minutes rather than waiting indefinitely, and',
    'stop instead of writing unrelated code if the fix requires broader',
    'refactoring.',
    '',
    'TRIAGE FIRST. If, after a brief investigation, you conclude that the',
    `failures are NOT caused by this PR's changes — they're already fixed on`,
    `${baseRef}, a pre-existing breakage that also fails on a clean ${baseRef}`,
    'checkout, or a flaky test runner / infra hiccup — DO NOT edit any files.',
    'Output exactly the line:',
    '',
    '    <<UNRELATED_REBASE>>',
    '',
    `on its own line, then stop. The wrapper will rebase this PR onto ${baseRef}`,
    'and force-push the rebased commit; CI will re-run on the up-to-date branch.',
    'NEVER output the sentinel AND edit files in the same run — pick one path.',
    '',
    'You MAY use: Read, Edit, Write, Bash, Grep, Glob, LS.',
    '',
    'When done, briefly summarise: which checks were failing, which files you',
    'changed, which tests now pass.',
  ].join('\n');
}
