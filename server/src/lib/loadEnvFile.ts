import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Tiny zero-dep .env loader. Reads `.env` from the repo root (one level
 * above the server's cwd) or the current working directory and assigns any
 * `KEY=value` pairs into `process.env` — but only when the key is NOT
 * already set. Shell-exported variables always win, so a `.zshrc` export
 * takes precedence over the .env file.
 *
 * Why roll our own instead of pulling in dotenv: the surface area is tiny
 * (we have a handful of vars), and a server-side load step is more
 * predictable than dotenv's auto-load-on-import behavior.
 *
 * Format supported:
 *   - `KEY=value` (no spaces around `=`)
 *   - Surrounding `"…"` or `'…'` quotes are stripped
 *   - Lines starting with `#` are comments
 *   - Blank lines ignored
 */
export function loadEnvFile(): { source: string; loaded: string[] } | null {
  const candidates = [
    resolve(process.cwd(), '.env'),         // server-run cwd (when started directly)
    resolve(process.cwd(), '..', '.env'),   // repo root (when started from server/)
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const loaded: string[] = [];
    for (const raw of readFileSync(path, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] == null) {
        process.env[key] = value;
        loaded.push(key);
      }
    }
    return { source: path, loaded };
  }
  return null;
}
