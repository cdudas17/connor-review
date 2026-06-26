/**
 * Server-side application configuration. Mirrors the web's `config.ts`:
 * defaults here; per-user overrides in `config.local.ts` (gitignored).
 *
 * The dynamic `import('./config.local.js')` is wrapped in try/catch so a
 * fresh clone with no `config.local.ts` still boots cleanly.
 */

export interface ServerConfig {
  /** Restrict the Calendar tab to only these gcalcli calendars. Each
   * entry is matched against the calendar names shown by `gcalcli list`.
   * Empty = pull every calendar gcalcli has access to. */
  calendarNames: string[];
}

const DEFAULTS: ServerConfig = {
  calendarNames: [],
};

let overrides: Partial<ServerConfig> = {};
try {
  const mod = (await import('./config.local.js')) as { SERVER_CONFIG?: Partial<ServerConfig> };
  overrides = mod.SERVER_CONFIG ?? {};
} catch {
  // No config.local.ts — defaults only.
}

export const SERVER_CONFIG: ServerConfig = { ...DEFAULTS, ...overrides };
