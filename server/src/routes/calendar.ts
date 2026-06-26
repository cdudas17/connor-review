import type { FastifyInstance } from 'fastify';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { google } from 'googleapis';

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;
type Credentials = ConstructorParameters<typeof google.auth.OAuth2>[0] extends infer _T
  ? Parameters<OAuth2Client['setCredentials']>[0]
  : never;

/**
 * Google Calendar tab support.
 *
 * Auth: native OAuth via googleapis. User clicks "Connect" in the app →
 * we open Google's consent URL → Google redirects back to our /callback
 * with a code → we exchange it for tokens and write the refresh token to
 * `~/.connor-review/google-calendar-token.json`. Subsequent requests use
 * the refresh token to mint fresh access tokens automatically.
 *
 * Requires:
 *   - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET in env (or .env).
 *   - The OAuth client's authorized redirect URI must include
 *     `http://localhost:5174/api/calendar/callback`.
 *   - The Calendar API enabled on the parent GCP project.
 */

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
const REDIRECT_URI = 'http://localhost:5174/api/calendar/callback';

// Lazy so vitest mocks of `os.homedir` (see notes.test.ts) are honored.
// Module-load access would resolve to the real homedir before the spy
// initializes.
function tokenPaths() {
  const dir = join(homedir(), '.connor-review');
  return { dir, file: join(dir, 'google-calendar-token.json') };
}

function makeClient(): OAuth2Client | { error: string } {
  const clientId = (process.env.GOOGLE_CLIENT_ID ?? '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET ?? '').trim();
  if (!clientId || !clientSecret) {
    return {
      error: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set. See https://console.cloud.google.com/apis/credentials — create an OAuth 2.0 Client (type: Web application), add http://localhost:5174/api/calendar/callback as an authorized redirect URI, then export the ID/secret in your shell or .env.',
    };
  }
  return new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
}

async function loadStoredTokens(): Promise<Credentials | null> {
  try {
    const raw = await fs.readFile(tokenPaths().file, 'utf8');
    return JSON.parse(raw) as Credentials;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

async function saveTokens(tokens: Credentials): Promise<void> {
  const { dir, file } = tokenPaths();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

async function makeAuthorizedClient(): Promise<OAuth2Client | { error: string; status: number }> {
  const client = makeClient();
  if ('error' in client) return { error: client.error, status: 503 };
  const tokens = await loadStoredTokens();
  if (!tokens) return { error: 'NOT_CONNECTED', status: 401 };
  client.setCredentials(tokens);
  // Persist any refreshed token Google issues so we don't have to re-auth
  // when the access_token expires.
  client.on('tokens', (next) => {
    void saveTokens({ ...tokens, ...next }).catch((e) => {
      console.warn('[calendar] failed to persist refreshed token:', (e as Error).message);
    });
  });
  return client;
}

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
  /** Conference (Meet/Zoom/etc.) join URI when present. */
  conferenceUri: string | null;
  conferenceName: string | null;
  /** My own RSVP status, when known. */
  myResponseStatus: string | null;
}

export async function registerCalendarRoutes(app: FastifyInstance) {
  app.get('/api/calendar/auth-status', async () => {
    const tokens = await loadStoredTokens();
    const client = makeClient();
    return {
      connected: !!tokens && !('error' in client),
      configured: !('error' in client),
      configurationError: 'error' in client ? client.error : null,
    };
  });

  app.get('/api/calendar/auth-url', async (_req, reply) => {
    const client = makeClient();
    if ('error' in client) return reply.code(503).send({ code: 'NO_OAUTH_CONFIG', message: client.error });
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
    });
    return { url };
  });

  app.get<{ Querystring: { code?: string; error?: string } }>('/api/calendar/callback', async (req, reply) => {
    if (req.query.error) {
      reply.header('content-type', 'text/html; charset=utf-8');
      return reply.code(400).send(`<!doctype html><body style="font:14px sans-serif; padding:24px">Google sign-in failed: ${req.query.error}. You can close this tab.</body>`);
    }
    if (!req.query.code) {
      reply.header('content-type', 'text/html; charset=utf-8');
      return reply.code(400).send('<!doctype html><body style="font:14px sans-serif; padding:24px">Missing OAuth code.</body>');
    }
    const client = makeClient();
    if ('error' in client) {
      reply.header('content-type', 'text/html; charset=utf-8');
      return reply.code(503).send(`<!doctype html><body style="font:14px sans-serif; padding:24px">${client.error}</body>`);
    }
    try {
      const { tokens } = await client.getToken(req.query.code);
      // Merge with any existing tokens so we don't lose the refresh_token —
      // Google only returns it on the first consent.
      const existing = (await loadStoredTokens()) ?? {};
      await saveTokens({ ...existing, ...tokens });
      reply.header('content-type', 'text/html; charset=utf-8');
      return reply.code(200).send(`<!doctype html><body style="font:14px sans-serif; padding:24px; color:#1f8826">Connected. You can close this tab — the Calendar tab in Connor Command Center will refresh automatically.</body><script>window.close();</script>`);
    } catch (e) {
      reply.header('content-type', 'text/html; charset=utf-8');
      return reply.code(502).send(`<!doctype html><body style="font:14px sans-serif; padding:24px">Token exchange failed: ${(e as Error).message}</body>`);
    }
  });

  app.post('/api/calendar/sign-out', async (_req, reply) => {
    try {
      await fs.unlink(tokenPaths().file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        return reply.code(500).send({ code: 'UNLINK_FAILED', message: (e as Error).message });
      }
    }
    return { ok: true };
  });

  app.get<{ Querystring: { start?: string; end?: string; calendarId?: string } }>('/api/calendar/events', async (req, reply) => {
    const authed = await makeAuthorizedClient();
    if ('error' in authed) {
      return reply.code(authed.status).send({
        code: authed.error === 'NOT_CONNECTED' ? 'NOT_CONNECTED' : 'NO_OAUTH_CONFIG',
        message: authed.error,
      });
    }

    const now = new Date();
    // Default window: from now-2h (so a meeting that just started is still
    // visible) through now+7d.
    const start = req.query.start ? new Date(req.query.start) : new Date(now.getTime() - 2 * 60 * 60_000);
    const end = req.query.end ? new Date(req.query.end) : new Date(now.getTime() + 7 * 24 * 60 * 60_000);
    const calendarId = req.query.calendarId ?? 'primary';

    const calendar = google.calendar({ version: 'v3', auth: authed });
    try {
      const res = await calendar.events.list({
        calendarId,
        singleEvents: true,
        orderBy: 'startTime',
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        maxResults: 250,
      });
      const items = res.data.items ?? [];
      const events: NormalizedEvent[] = items.map((e) => {
        const isAllDay = !!e.start?.date && !e.start?.dateTime;
        const attendees: NormalizedAttendee[] = (e.attendees ?? []).map((a) => ({
          email: a.email ?? null,
          displayName: a.displayName ?? null,
          responseStatus: a.responseStatus ?? null,
          isSelf: !!a.self,
          isOrganizer: !!a.organizer,
        }));
        const me = attendees.find((a) => a.isSelf);
        // Surface the first conference join link if any (Google Meet,
        // Zoom-via-add-on, etc.). The Calendar API normalises these to
        // entryPoints[].uri with type=video.
        const entry = (e.conferenceData?.entryPoints ?? []).find((ep) => ep.entryPointType === 'video')
          ?? (e.conferenceData?.entryPoints ?? [])[0]
          ?? null;
        return {
          id: e.id ?? '',
          title: e.summary ?? '(no title)',
          start: e.start?.dateTime ?? e.start?.date ?? null,
          end: e.end?.dateTime ?? e.end?.date ?? null,
          isAllDay,
          status: e.status ?? null,
          location: e.location ?? null,
          description: e.description ?? null,
          htmlLink: e.htmlLink ?? null,
          attendees,
          organizer: e.organizer
            ? { email: e.organizer.email ?? null, displayName: e.organizer.displayName ?? null, isSelf: !!e.organizer.self }
            : null,
          conferenceUri: entry?.uri ?? null,
          conferenceName: e.conferenceData?.conferenceSolution?.name ?? null,
          myResponseStatus: me?.responseStatus ?? null,
        };
      });
      return { events, calendarId, start: start.toISOString(), end: end.toISOString() };
    } catch (e) {
      const err = e as Error & { code?: number; response?: { status?: number } };
      const status = err.response?.status ?? err.code ?? 502;
      return reply.code(status === 401 ? 401 : 502).send({
        code: status === 401 ? 'TOKEN_REVOKED' : 'CALENDAR_API_ERROR',
        message: err.message,
      });
    }
  });
}
