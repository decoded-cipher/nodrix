import type { APIRoute } from 'astro';

// Static routes of the promo site. Add new top-level pages here.
// Trailing slashes match the canonical URLs Astro emits for these pages.
const routes: { path: string; priority: string }[] = [
  { path: '', priority: '1.0' },
  { path: 'docs/', priority: '0.8' },
  { path: 'widgets/', priority: '0.8' },
];

export const GET: APIRoute = ({ site }) => {
  const lastmod = new Date().toISOString().split('T')[0];
  const urls = routes
    .map(({ path, priority }) => {
      const loc = new URL(path, site).href;
      return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
    })
    .join('\n');

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
