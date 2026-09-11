/** Creates the first account and returns a Cookie header for it. */
export async function signIn(base, { username, display_name, password }) {
  const res = await fetch(`${base}/api/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, display_name, password }),
  });
  if (!res.ok) throw new Error(`setup failed: ${res.status} ${await res.text()}`);
  return res.headers.getSetCookie()[0].split(';')[0];
}

export const jsonHeaders = (cookie) => ({ cookie, 'content-type': 'application/json' });
