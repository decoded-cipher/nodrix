import { createMiddleware } from 'hono/factory';

// Security headers on every response — in the Worker, not _headers, so API
// responses are covered too. 'unsafe-inline' (inline theme script + lib styles)
// and https: images (external map tiles) are required by the app.
const CSP_COMMON =
  "default-src 'self'; base-uri 'self'; object-src 'none'; " +
  'img-src \'self\' data: blob: https:; font-src \'self\' data: https://fonts.gstatic.com; ' +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' 'unsafe-inline'; " +
  "connect-src 'self' https: wss:; worker-src 'self' blob:; " +
  'manifest-src \'self\'; form-action \'self\'';

const buildCsp = (isEmbed: boolean): string =>
  `${CSP_COMMON}; frame-ancestors ${isEmbed ? '*' : "'self'"}`;

export const securityHeaders = createMiddleware(async (c, next) => {
  await next();
  if (c.res.status === 101) return; // WebSocket upgrade — leave its headers alone

  const isEmbed = c.req.path.startsWith('/embed/'); // embeddable, must stay frame-able
  const apply = (h: Headers): void => {
    h.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
    h.set('x-content-type-options', 'nosniff');
    h.set('referrer-policy', 'strict-origin-when-cross-origin');
    h.set('permissions-policy', 'geolocation=(), camera=(), microphone=(), payment=()');
    h.set('content-security-policy', buildCsp(isEmbed));
    if (isEmbed) h.delete('x-frame-options');
    else h.set('x-frame-options', 'SAMEORIGIN');
  };

  try {
    // Mutable headers (Hono responses): set in place so Set-Cookie is untouched.
    apply(c.res.headers);
  } catch {
    // Immutable headers (asset passthrough): rebuild, preserving multiple
    // Set-Cookie that a plain Headers copy would collapse. getSetCookie() is in
    // the Workers runtime but not the TS Headers type.
    const old = c.res;
    const headers = new Headers(old.headers);
    const getSetCookie = (old.headers as { getSetCookie?: () => string[] }).getSetCookie;
    const cookies = typeof getSetCookie === 'function' ? getSetCookie.call(old.headers) : [];
    apply(headers);
    if (cookies.length) {
      headers.delete('set-cookie');
      for (const ck of cookies) headers.append('set-cookie', ck);
    }
    c.res = new Response(old.body, { status: old.status, statusText: old.statusText, headers });
  }
});
