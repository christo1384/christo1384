// Read-only Google Calendar feeds, merged onto the board.
//
// Browsers cannot fetch an .ics from Google directly (no CORS headers), so the
// request goes through netlify/functions/calendar.mjs, which only forwards
// URLs that are in the deploy's own allowlist.

import { CONFIG } from './config.js';
import { occurrencesInRange } from './ics.js';

export const PROXY_PATH = '/api/calendar';

/**
 * Accept either a bare URL string or { url, category, label }, so a feed can
 * be pointed at a specific row of the board.
 */
export function normaliseFeeds(calendars) {
  return (calendars || [])
    .map((entry) => (typeof entry === 'string' ? { url: entry } : entry))
    .filter((entry) => entry && typeof entry.url === 'string' && entry.url.trim())
    .map((entry) => ({
      url: entry.url.trim(),
      category: entry.category || 'appointment',
      label: entry.label || '',
    }));
}

export function proxyUrl(feedUrl) {
  return `${PROXY_PATH}?url=${encodeURIComponent(feedUrl)}`;
}

/**
 * Calendar occurrences for a week, shaped like board items and flagged
 * read-only so the phone page offers no Edit or Delete on them.
 *
 * A feed that fails is skipped; one broken calendar never blanks the board.
 */
export async function fetchCalendarItems(days, { fetchImpl = globalThis.fetch, calendars = CONFIG.calendars } = {}) {
  const feeds = normaliseFeeds(calendars);
  if (!feeds.length) return [];

  const start = days[0].date;
  const end = days[days.length - 1].date;

  const perFeed = await Promise.all(
    feeds.map(async (feed) => {
      try {
        const response = await fetchImpl(proxyUrl(feed.url), { cache: 'no-store' });
        if (!response.ok) return [];
        const text = await response.text();
        return occurrencesInRange(text, start, end).map((occurrence) => ({
          ...occurrence,
          id: `calendar:${feed.url}:${occurrence.uid}:${occurrence.date}`,
          category: feed.category,
          who: feed.label,
          done: false,
          annual: false,
          readOnly: true,
        }));
      } catch {
        return [];
      }
    }),
  );

  return perFeed.flat();
}
