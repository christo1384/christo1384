// The family's own calendars, read-only, merged onto the board.
//
// The browser never sees a feed address. A Google "secret address in iCal
// format" grants read access to that calendar to anyone holding it, so the
// addresses stay in the server's environment and the browser asks for a feed
// by index instead.

import { toBoardItem } from './classify.js';
import { CONFIG } from './config.js';
import { occurrencesInRange } from './ics.js';

export const LIST_PATH = '/api/calendars';
export const FEED_PATH = '/api/calendar';

export function feedUrl(id) {
  return `${FEED_PATH}?feed=${encodeURIComponent(id)}`;
}

/** What feeds this deploy has, and which row each is pinned to (if any). */
export async function listFeeds({ fetchImpl = globalThis.fetch } = {}) {
  try {
    const response = await fetchImpl(LIST_PATH, { cache: 'no-store' });
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload.calendars) ? payload.calendars : [];
  } catch {
    return [];
  }
}

/**
 * Calendar occurrences for a week, shaped like board items and flagged
 * read-only so the phone page offers no Edit or Delete on them.
 *
 * A feed that fails is skipped: one broken calendar never blanks the board.
 */
export async function fetchCalendarItems(
  days,
  { fetchImpl = globalThis.fetch, feeds = null, names = CONFIG.familyNames } = {},
) {
  const list = feeds ?? (await listFeeds({ fetchImpl }));
  if (!list.length) return [];

  const start = days[0].date;
  const end = days[days.length - 1].date;

  const perFeed = await Promise.all(
    list.map(async (feed) => {
      try {
        const response = await fetchImpl(feedUrl(feed.id), { cache: 'no-store' });
        if (!response.ok) return [];
        const text = await response.text();

        return occurrencesInRange(text, start, end).map((occurrence) => {
          const item = toBoardItem(occurrence, { names, defaultCategory: feed.category });
          return {
            ...item,
            id: `calendar:${feed.id}:${occurrence.uid}:${occurrence.date}`,
            who: item.who || feed.label,
            done: false,
            annual: false,
            readOnly: true,
          };
        });
      } catch {
        return [];
      }
    }),
  );

  return perFeed.flat();
}
