import type { FastifyInstance } from 'fastify';
import { gcalcliExec, GcalcliError } from '../lib/gcalcliExec.js';
import { SERVER_CONFIG } from '../config.js';

/**
 * Google Calendar tab support — via the user's local `gcalcli` CLI.
 * Mirrors the `gh` / `claude` shell-out pattern: no SDK, no token
 * management, no GCP project to create. gcalcli ships its own
 * pre-registered OAuth client, so setup is just:
 *
 *   brew install gcalcli
 *   gcalcli init
 *
 * The CLI handles token refresh on its own; we just shell out for
 * `agenda --tsv` and parse the result.
 */

interface NormalizedAttendee {
  email: string | null;
  displayName: string | null;
  responseStatus: string | null;
  isSelf: boolean;
  isOrganizer: boolean;
}

interface NormalizedEvent {
  id: string;
  title: string;
  start: string | null;
  end: string | null;
  isAllDay: boolean;
  status: string | null;
  location: string | null;
  description: string | null;
  htmlLink: string | null;
  attendees: NormalizedAttendee[];
  organizer: { email: string | null; displayName: string | null; isSelf: boolean } | null;
  conferenceUri: string | null;
  conferenceName: string | null;
  myResponseStatus: string | null;
}

/**
 * Parse `gcalcli agenda --tsv` output. The default TSV format is five
 * tab-separated columns (in this exact order, every gcalcli 4.x):
 *
 *   start_date \t start_time \t end_date \t end_time \t title
 *
 * All-day events leave start_time / end_time empty. Title can contain
 * arbitrary characters except tab + newline — we treat anything after
 * the 4th tab as the title (so the rare title with a stray tab still
 * works).
 *
 * We deliberately don't use `--details=...` flags here: their column
 * order varies between gcalcli versions, which earlier broke the
 * parser. JSON mode is the right upgrade path if we want rich event
 * detail inline later.
 */
function parseAgendaTsv(stdout: string): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  const lines = stdout.split('\n').filter((l) => l.length > 0);
  for (const line of lines) {
    const cells = line.split('\t');
    if (cells.length < 5) continue;
    const [sd, st, ed, et, ...titleParts] = cells;
    const title = titleParts.join('\t').trim();
    const isAllDay = !st;
    const startIso = isAllDay ? sd : `${sd}T${st}:00`;
    const endIso = isAllDay ? ed : (et ? `${ed}T${et}:00` : null);
    events.push({
      id: `${startIso}|${title}`,
      title: title || '(no title)',
      start: startIso,
      end: endIso,
      isAllDay,
      status: null,
      location: null,
      description: null,
      htmlLink: null,
      attendees: [],
      organizer: null,
      conferenceUri: null,
      conferenceName: null,
      myResponseStatus: null,
    });
  }
  return events;
}

function ymd(d: Date): string {
  // gcalcli accepts ISO dates / common natural-language forms.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export async function registerCalendarRoutes(app: FastifyInstance) {
  /** Quick liveness check — is `gcalcli` installed and authenticated? */
  app.get('/api/calendar/auth-status', async () => {
    try {
      // `gcalcli list` requires auth; `--version` doesn't. We want both checks.
      await gcalcliExec(['--version'], { timeoutMs: 3_000 });
    } catch (e) {
      if (e instanceof GcalcliError && e.code === 'GCALCLI_NOT_INSTALLED') {
        return { connected: false, configured: false, configurationError: 'gcalcli is not installed. Run: `brew install gcalcli` (or `pipx install gcalcli`).' };
      }
      return { connected: false, configured: false, configurationError: (e as Error).message };
    }
    try {
      // `list` is a cheap auth-gated call — fails with NOT_AUTHENTICATED if
      // the user hasn't run `gcalcli init` yet.
      await gcalcliExec(['--nocolor', 'list'], { timeoutMs: 5_000 });
    } catch (e) {
      if (e instanceof GcalcliError && e.code === 'GCALCLI_NOT_AUTHENTICATED') {
        return { connected: false, configured: true, configurationError: 'gcalcli is installed but not authenticated. Run `gcalcli init` in your shell, sign in with the Google account you want to use, then come back.' };
      }
      return { connected: false, configured: true, configurationError: (e as Error).message };
    }
    return { connected: true, configured: true, configurationError: null };
  });

  app.get<{ Querystring: { start?: string; end?: string } }>('/api/calendar/events', async (req, reply) => {
    const now = new Date();
    // Default window: start of today through +7 days. The client almost
    // always passes an explicit `start`/`end` so it can request whatever
    // window it's displaying (e.g. Mon–Fri of the current work week,
    // which includes earlier-this-week events). We don't filter by end
    // time on the server — the client decides what's in-window.
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = req.query.start ? new Date(req.query.start) : startOfToday;
    const end = req.query.end ? new Date(req.query.end) : new Date(now.getTime() + 7 * 24 * 60 * 60_000);

    // Restrict gcalcli to only the configured calendar(s) — set in
    // `server/src/config.local.ts` (gitignored). Empty list = fetch every
    // calendar gcalcli has access to. Run `gcalcli list` locally to see
    // the exact names.
    const calendarFlags = SERVER_CONFIG.calendarNames.flatMap((n) => ['--calendar', n]);

    try {
      const stdout = await gcalcliExec([
        '--nocolor',
        ...calendarFlags,
        'agenda',
        '--tsv',
        ymd(start),
        ymd(end),
      ], { timeoutMs: 15_000 });
      const events = parseAgendaTsv(stdout);
      return { events, start: start.toISOString(), end: end.toISOString() };
    } catch (e) {
      if (e instanceof GcalcliError) {
        const status = e.code === 'GCALCLI_NOT_INSTALLED' ? 503 : e.code === 'GCALCLI_NOT_AUTHENTICATED' ? 401 : 502;
        return reply.code(status).send({ code: e.code, message: e.message, stderr: e.stderr });
      }
      return reply.code(502).send({ code: 'CALENDAR_API_ERROR', message: (e as Error).message });
    }
  });
}

// Suppress unused-warning helper — keeping the type export for the API
// client's response shape.
export type { NormalizedEvent };
