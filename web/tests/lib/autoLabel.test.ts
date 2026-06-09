import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server.js';
import { APP_CONFIG } from '../../src/config.js';
import { maybeAutoLabelOnReview } from '../../src/lib/autoLabel.js';

describe('maybeAutoLabelOnReview', () => {
  const originalRules = APP_CONFIG.autoLabelOnReview;
  beforeEach(() => {
    (APP_CONFIG as { autoLabelOnReview: Record<string, string[]> }).autoLabelOnReview = {
      newtonry: ['Comments left by reviewer'],
      someone_else: ['Multiple', 'Labels'],
    };
  });
  afterEach(() => {
    (APP_CONFIG as { autoLabelOnReview: Record<string, string[]> }).autoLabelOnReview = originalRules;
  });

  it('fires POST /labels with the configured labels when author matches', async () => {
    let captured: { labels?: string[] } | null = null;
    server.use(
      http.post('/api/pulls/Gusto/zenpayroll/1/labels', async ({ request }) => {
        captured = await request.json() as { labels?: string[] };
        return HttpResponse.json({ ok: true });
      }),
    );
    await maybeAutoLabelOnReview({ owner: 'Gusto', repo: 'zenpayroll', number: 1 }, 'newtonry');
    expect(captured).not.toBeNull();
    expect(captured!.labels).toEqual(['Comments left by reviewer']);
  });

  it('does nothing when author does not match any rule', async () => {
    let hit = false;
    server.use(
      http.post('/api/pulls/:o/:r/:n/labels', () => { hit = true; return HttpResponse.json({ ok: true }); }),
    );
    await maybeAutoLabelOnReview({ owner: 'Gusto', repo: 'zenpayroll', number: 1 }, 'someone_unconfigured');
    expect(hit).toBe(false);
  });

  it('does nothing when author is null/empty', async () => {
    let hit = false;
    server.use(
      http.post('/api/pulls/:o/:r/:n/labels', () => { hit = true; return HttpResponse.json({ ok: true }); }),
    );
    await maybeAutoLabelOnReview({ owner: 'Gusto', repo: 'zenpayroll', number: 1 }, null);
    await maybeAutoLabelOnReview({ owner: 'Gusto', repo: 'zenpayroll', number: 1 }, '');
    expect(hit).toBe(false);
  });

  it('toasts on failure but never throws (best-effort)', async () => {
    server.use(
      http.post('/api/pulls/:o/:r/:n/labels', () => HttpResponse.json({ code: 'AUTH_REQUIRED', message: 'no auth' }, { status: 401 })),
    );
    const onToast = vi.fn();
    await expect(maybeAutoLabelOnReview({ owner: 'Gusto', repo: 'zenpayroll', number: 1 }, 'newtonry', { onToast }))
      .resolves.toBeUndefined();
    expect(onToast).toHaveBeenCalledWith('error', expect.stringContaining('Comments left by reviewer'));
  });

  it('passes all labels through when a rule has multiple', async () => {
    let captured: { labels?: string[] } | null = null;
    server.use(
      http.post('/api/pulls/:o/:r/:n/labels', async ({ request }) => {
        captured = await request.json() as { labels?: string[] };
        return HttpResponse.json({ ok: true });
      }),
    );
    await maybeAutoLabelOnReview({ owner: 'a', repo: 'b', number: 5 }, 'someone_else');
    expect(captured!.labels).toEqual(['Multiple', 'Labels']);
  });
});
