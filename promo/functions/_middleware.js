// Cloudflare Pages Functions middleware — canonical host redirects.
//
// Pages serves the site on the custom domain AND on *.pages.dev (and
// optionally www). To avoid duplicate-content and keep one canonical
// origin, 301-redirect everything to the apex domain. Path + query are
// preserved. `_redirects` can't do this — its source is path-only.
const CANONICAL_HOST = 'nodrix.live';
// Only the production pages.dev alias — NOT preview/branch deployments
// (e.g. <hash>.nodrix.pages.dev), which must stay reachable for testing.
const PROD_PAGES_HOST = 'nodrix.pages.dev';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const host = url.hostname;

  const shouldRedirect = host === `www.${CANONICAL_HOST}` || host === PROD_PAGES_HOST;

  if (shouldRedirect) {
    url.protocol = 'https:';
    url.hostname = CANONICAL_HOST;
    url.port = '';
    return Response.redirect(url.toString(), 301);
  }

  return context.next();
}
