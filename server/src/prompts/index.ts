/**
 * Fix CI prompt registry. Each version lives in its own sibling file
 * (`fixCi.v1.ts`, `fixCi.v2.ts`, …) so historical runs tagged by version
 * stay reproducible — you can always read back exactly what was in play.
 *
 * To ship a new prompt:
 *   1. `cp server/src/prompts/fixCi.vN.ts server/src/prompts/fixCi.v{N+1}.ts`
 *      and edit the new file.
 *   2. Import + register it below.
 *   3. Bump FIX_CI_PROMPT_VERSION in `server/src/lib/fixCiTelemetry.ts`.
 *   4. Restart the server. New runs are tagged with the new version; the
 *      telemetry dashboard compares vN vs v{N+1} success rates automatically.
 */

import { buildFixCiPrompt as v1, type FixCiPromptInput } from './fixCi.v1.js';
import { buildFixCiPrompt as v2 } from './fixCi.v2.js';
import { buildFixCiPrompt as v3 } from './fixCi.v3.js';

export type { FixCiPromptInput };

/** Resolve the prompt builder for a given version string. Falls back to the
 * latest known builder for anything we don't recognise — that way the server
 * never throws on a stale FIX_CI_PROMPT_VERSION constant during development. */
export function getFixCiPrompt(version: string): (input: FixCiPromptInput) => string {
  if (version.startsWith('v1-')) return v1;
  if (version.startsWith('v2-')) return v2;
  if (version.startsWith('v3-')) return v3;
  return v3;
}
