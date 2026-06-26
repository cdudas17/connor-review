import type { FastifyInstance } from 'fastify';
import { gcalcliExec, GcalcliError } from '../lib/gcalcliExec.js';

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
 * Parse `gcalcli agenda --tsv --details=length,description,location,calendar,url,attendees,conference,attachments`
 * output. gcalcli's TSV format is:
 *   start_date \t start_time \t end_date \t end_time \t <details columns> \t title
 *
 * Column order for --details varies by gcalcli version; we read by
 * position based on which --details flags we passed. Some columns may
 * be empty strings.
 */
function parseAgendaTsv(stdout: string, baseColumns: string[]): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  const lines = stdout.split('\n').filter((l) => l.length > 0);
  for (const line of lines) {
    const cells = line.split('\t');
    // First 4 cells are always start_date, start_time, end_date, end_time.
    if (cells.length < 5) continue;
    const [sd, st, ed, et, ...rest] = cells;
    // baseColumns describes the optional detail columns we asked for
    // (in the order we passed them via --details=...). gcalcli emits
    // them in the canonical order (regardless of --details order), so
    // we rely on the known canonical order rather than the flag order.
    const details: Record<string, string> = {};
    for (let i = 0; i < baseColumns.length && i < rest.length - 1; i++) {
      details[baseColumns[i]] = rest[i] ?? '';
    }
    const title = rest[rest.length - 1] ?? '';

    const isAllDay = !st;
    const startIso = isAllDay ? sd : `${sd}T${st}:00`;
    const endIso = isAllDay ? ed : (et ? `${ed}T${et}:00` : null);

    events.push({
      id: `${startIso}-${title}`,
      title: title || '(no title)',
      start: startIso,
      end: endIso,
      isAllDay,
      status: null,
      location: details.location || null,
      description: details.description || null,
      htmlLink: details.url || null,
      attendees: details.attendees
        ? details.attendees.split(/[,;] */).filter(Boolean).map((s) => ({
            email: s.includes('@') ? s : null,
            displayName: s,
            responseStatus: null,
            isSelf: false,
            isOrganizer: false,
          }))
        : [],
      organizer: null,
      conferenceUri: details.hangoutLink || details.conference || null,
      conferenceName: details.conference ? 'Meet' : null,
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
    const start = req.query.start ? new Date(req.query.start) : new Date(now.getTime() - 2 * 60 * 60_000);
    const end = req.query.end ? new Date(req.query.end) : new Date(now.getTime() + 7 * 24 * 60 * 60_000);

    // gcalcli's --details flags — canonical order in the TSV output, NOT
    // the order we list them here. We just need to know which columns to
    // expect.
    const detailColumns = ['url', 'conference', 'hangoutLink', 'attendees', 'attachments', 'length', 'reminders', 'description', 'location', 'calendar', 'email'];

    try {
      const stdout = await gcalcliExec([
        '--nocolor',
        'agenda',
        '--tsv',
        '--details=url',
        '--details=conference',
        '--details=attendees',
        '--details=length',
        '--details=description',
        '--details=location',
        '--details=calendar',
        ymd(start),
        ymd(end),
      ], { timeoutMs: 15_000 });
      const events = parseAgendaTsv(stdout, detailColumns);
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
