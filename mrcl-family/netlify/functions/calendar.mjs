// Fetches an .ics feed on the browser's behalf, because Google Calendar serves
// no CORS headers.
//
// Only URLs listed in this deploy's CALENDAR_ICS_URLS are forwarded. Without
// that allowlist this would be an open proxy that anyone on the internet could
// point at any host, including addresses inside the hosting network.

const ALLOWED_PROTOCOL = 'https:';
const MAX_BYTES = 2 * 1024 * 1024;

function allowlist() {
  return (process.env.CALENDAR_ICS_URLS || '')
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function text(body, status) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export default async (request) => {
  const requested = new URL(request.url).searchParams.get('url');
  if (!requested) return text('Missing url parameter.', 400);

  if (!allowlist().includes(requested)) {
    // Deliberately the same answer whether the URL is unknown or malformed:
    // this endpoint reveals nothing about what it can reach.
    return text('That calendar feed is not configured for this site.', 403);
  }

  let target;
  try {
    target = new URL(requested);
  } catch {
    return text('That calendar feed is not configured for this site.', 403);
  }
  if (target.protocol !== ALLOWED_PROTOCOL) return text('Calendar feeds must be https.', 403);

  try {
    const upstream = await fetch(target, {
      redirect: 'follow',
      headers: { accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!upstream.ok) return text(`Calendar feed returned ${upstream.status}.`, 502);

    const body = await upstream.text();
    if (body.length > MAX_BYTES) return text('Calendar feed is too large.', 502);

    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        // Long enough to keep a kitchen TV off Google's back, short enough
        // that a change to the calendar shows up the same morning.
        'cache-control': 'public, max-age=300, stale-while-revalidate=1800',
      },
    });
  } catch (error) {
    return text(`Could not reach the calendar feed: ${error.name}`, 504);
  }
};

export const config = { path: '/api/calendar' };
