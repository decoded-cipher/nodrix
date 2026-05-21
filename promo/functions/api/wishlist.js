// Cloudflare Pages Function — /api/wishlist (POST only)
//
// Captures wishlist email signups into the WISHLIST_DB (D1) binding declared in
// wrangler.toml. No separate backend: this ships in the same `wrangler pages
// deploy` as the static site. The root _middleware.js passes non-redirect
// requests through to here via context.next().

const MAX_EMAIL_LEN = 254; // RFC 5321 practical maximum.
// Pragmatic email shape check — the browser already enforces type="email"; this
// is the server-side backstop, not a deliverability guarantee.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

// Verify a Cloudflare Turnstile token. https://developers.cloudflare.com/turnstile/
async function verifyTurnstile(token, secret, ip) {
  if (!token) return false;
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    });
    const data = await res.json();
    return !!data.success;
  } catch (err) {
    console.error('turnstile verify failed', err);
    return false;
  }
}

// Single catch-all handler so method routing is unambiguous within this module.
export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid request.' }, 400);
  }

  // Honeypot: real users leave this empty. Bots that fill it get a fake success.
  if (body && typeof body.website === 'string' && body.website.trim() !== '') {
    return json({ ok: true });
  }

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) {
    return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
  }

  // Bot check — only enforced when a secret is configured, so the form keeps
  // working before Turnstile keys are set up.
  if (env.TURNSTILE_SECRET_KEY) {
    const ip = request.headers.get('CF-Connecting-IP');
    const passed = await verifyTurnstile(body?.turnstileToken, env.TURNSTILE_SECRET_KEY, ip);
    if (!passed) {
      return json({ ok: false, error: 'Verification failed. Please try again.' }, 403);
    }
  }

  if (!env.WISHLIST_DB) {
    return json({ ok: false, error: 'Wishlist is temporarily unavailable.' }, 503);
  }

  const userAgent = request.headers.get('user-agent')?.slice(0, 512) ?? null;
  const referer = request.headers.get('referer')?.slice(0, 512) ?? null;

  try {
    // Duplicates are a no-op — and we still report success so the response never
    // reveals whether an address was already on the list.
    await env.WISHLIST_DB.prepare(
      'INSERT INTO wishlist (email, user_agent, referer) VALUES (?, ?, ?) ' +
        'ON CONFLICT(email) DO NOTHING',
    )
      .bind(email, userAgent, referer)
      .run();
  } catch (err) {
    console.error('wishlist insert failed', err);
    return json({ ok: false, error: 'Something went wrong. Please try again.' }, 500);
  }

  return json({ ok: true });
}
