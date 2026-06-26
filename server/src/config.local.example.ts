/**
 * Per-user server config overrides. Copy this file to `config.local.ts`
 * (gitignored) and fill in the fields you want to override. Anything not
 * defined here falls back to the defaults in `config.ts`.
 */

import type { ServerConfig } from './config.js';

export const SERVER_CONFIG: Partial<ServerConfig> = {
  // Restrict the Calendar tab to these specific calendars. Run
  // `gcalcli list` to see the exact names. Empty = all calendars.
  // calendarNames: ['your.work@example.com'],
};
