import type { Env } from '../env';

// Dynamic SEO/social meta for the public dashboard viewer (/share/:token):
// rewrite the SPA index.html's <head> via HTMLRewriter with the dashboard's
// name/description and flip robots to "index". Every other route is untouched.

type DashMeta = { name: string; description: string | null; project_description: string | null };

async function lookupDashMeta(env: Env, token: string): Promise<DashMeta | null> {
  if (!token) return null;
  return env.DB.prepare(
    `SELECT d.name, d.description, p.description AS project_description
       FROM dashboards d
       JOIN projects p ON p.id = d.project_id
      WHERE d.share_token = ? AND d.visibility = 'public' AND d.archived_at IS NULL`
  )
    .bind(token)
    .first<DashMeta>();
}

class SetAttr {
  constructor(private readonly value: string) {}
  element(el: Element): void {
    el.setAttribute('content', this.value);
  }
}

class SetText {
  constructor(private readonly value: string) {}
  element(el: Element): void {
    el.setInnerContent(this.value);
  }
}

// HTMLRewriter's html:true append takes a raw fragment, so escape values here.
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function serveDashboardSeo(env: Env, req: Request, token: string): Promise<Response> {
  const res = await env.ASSETS.fetch(req); // SPA fallback → index.html
  if (!(res.headers.get('content-type') ?? '').includes('text/html')) return res;

  const meta = await lookupDashMeta(env, token);
  if (!meta) return res; // unknown/private token → default meta; SPA renders its 404

  const name = meta.name.trim() || 'Dashboard';
  const title = `${name} · nodrix`;
  // Description falls back: dashboard → project → generic.
  const description = (
    meta.description?.trim() ||
    meta.project_description?.trim() ||
    `Live "${name}" dashboard on nodrix.`
  ).slice(0, 200);
  const shareUrl = `${new URL(req.url).origin}/share/${token}`;

  return new HTMLRewriter()
    .on('title', new SetText(title))
    .on('meta[name="robots"]', new SetAttr('index, follow'))
    .on('meta[property="og:title"]', new SetAttr(title))
    .on('meta[name="twitter:title"]', new SetAttr(title))
    .on('meta[property="og:description"]', new SetAttr(description))
    .on('meta[name="twitter:description"]', new SetAttr(description))
    .on('head', {
      element(el: Element): void {
        el.append(
          `<meta name="description" content="${escapeAttr(description)}">` +
            `<meta property="og:url" content="${escapeAttr(shareUrl)}">` +
            `<link rel="canonical" href="${escapeAttr(shareUrl)}">`,
          { html: true }
        );
      },
    })
    .transform(res);
}
