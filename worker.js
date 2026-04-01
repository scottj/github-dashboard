// Cloudflare Worker — GitHub OAuth Device Flow CORS Proxy
// Deploy: npx wrangler deploy worker.js --name gh-dash-auth
// Then set CONFIG.WORKER_URL in index.html to your worker URL.

const GITHUB = 'https://github.com';
const ALLOWED_PATHS = ['/login/device/code', '/login/oauth/access_token'];

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const headers = corsHeaders(request.headers.get('Origin'));

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== 'POST' || !ALLOWED_PATHS.includes(url.pathname)) {
      return new Response('Not found', { status: 404, headers });
    }

    const body = await request.text();
    const ghRes = await fetch(GITHUB + url.pathname, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body,
    });

    const ghBody = await ghRes.text();
    return new Response(ghBody, {
      status: ghRes.status,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  },
};
