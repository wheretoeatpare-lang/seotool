export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── CORS preflight for all API routes ──────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // ── /api/probe  — fetch target site & return real headers + HTML snippet ─
    if (url.pathname === '/api/probe') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }
      try {
        const { targetUrl } = await request.json();
        if (!targetUrl) throw new Error('targetUrl is required');

        // Fetch the target site with a real browser UA so sites don't block us
        const siteRes = await fetch(targetUrl, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; RankSightBot/1.0; +https://ranksight.dev)',
            'Accept': 'text/html,application/xhtml+xml,*/*',
          },
          redirect: 'follow',
          cf: { cacheTtl: 60, cacheEverything: false },
        });

        // Collect all response headers as a plain object
        const headers = {};
        for (const [k, v] of siteRes.headers.entries()) {
          headers[k.toLowerCase()] = v;
        }

        // Read up to 50 KB of HTML — enough for <head> fingerprinting
        const reader = siteRes.body.getReader();
        let html = '';
        let bytes = 0;
        const limit = 50 * 1024;
        while (bytes < limit) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = new TextDecoder().decode(value);
          html += chunk;
          bytes += value.byteLength;
        }
        reader.cancel();

        return new Response(JSON.stringify({ headers, html, status: siteRes.status }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      } catch (err) {
        // Probe failures are non-fatal — return empty so frontend falls back gracefully
        return new Response(JSON.stringify({ headers: {}, html: '', status: 0, error: err.message }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
    }

    // ── /api/claude  — proxy to Anthropic ─────────────────────────────────
    if (url.pathname === '/api/claude') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }
      try {
        const body = await request.json();

        const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-opus-4-5',
            max_tokens: 4096,
            messages: [{ role: 'user', content: body.prompt }],
          }),
        });

        if (!anthropicRes.ok) {
          const err = await anthropicRes.text();
          return new Response(JSON.stringify({ error: err }), {
            status: anthropicRes.status,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          });
        }

        const result = await anthropicRes.json();
        const text = result.content[0].text;

        // Strip markdown fences if present
        const clean = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        const parsed = JSON.parse(clean);

        return new Response(JSON.stringify(parsed), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
    }

    // ── All other routes — serve static assets ────────────────────────────
    return fetch(request);
  },
};
