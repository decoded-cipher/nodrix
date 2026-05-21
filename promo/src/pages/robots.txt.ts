import type { APIRoute } from 'astro';

// Generated at build time so the Sitemap URL always matches `site`
// in astro.config.mjs. AI/LLM crawlers are explicitly welcomed.
export const GET: APIRoute = ({ site }) => {
  const sitemap = new URL('sitemap.xml', site).href;
  const aiBots = [
    'GPTBot',
    'ChatGPT-User',
    'OAI-SearchBot',
    'ClaudeBot',
    'Claude-Web',
    'anthropic-ai',
    'PerplexityBot',
    'Google-Extended',
    'Applebot-Extended',
    'CCBot',
    'Bytespider',
    'Amazonbot',
    'cohere-ai',
  ];

  const body = [
    '# nodrix — https://github.com/decoded-cipher/nodrix',
    'User-agent: *',
    'Allow: /',
    '',
    '# AI / LLM crawlers are welcome',
    ...aiBots.flatMap((bot) => [`User-agent: ${bot}`, 'Allow: /', '']),
    `Sitemap: ${sitemap}`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
