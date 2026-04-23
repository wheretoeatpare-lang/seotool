// ─── RankSorcery AI Proxy — Cloudflare Worker (OpenRouter) ───────────────────
//
// Environment variables to set in Cloudflare Workers dashboard:
//   OPENROUTER_API_KEY  — your OpenRouter API key (get it free at openrouter.ai)
//
// Free model options (change MODEL below to any of these):
//   "meta-llama/llama-4-scout:free"
//   "google/gemma-3-27b-it:free"
//   "mistralai/mistral-small-3.1-24b-instruct:free"
//   "deepseek/deepseek-chat-v3-0324:free"
// ─────────────────────────────────────────────────────────────────────────────

const MODEL = 'deepseek/deepseek-chat-v3-0324:free';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const ALLOWED_ORIGINS = [
  'https://ranksorcery.com',
  'https://www.ranksorcery.com',
];

function getCorsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const origin = request.headers.get('Origin') || '';
  const corsHeaders = getCorsHeaders(origin);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  // Check API key is present
  if (!OPENROUTER_API_KEY) {
    return new Response(JSON.stringify({ error: 'Missing OPENROUTER_API_KEY — add it in Worker Settings → Variables' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    const body = await request.json();
    const { messages } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Invalid request — messages array missing' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + OPENROUTER_API_KEY,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ranksorcery.com',
        'X-Title': 'RankSorcery AI Chat',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: messages,
        max_tokens: 1000,
      }),
    });

    const data = await response.json();

    // If OpenRouter returned an error, forward it clearly
    if (!response.ok || data.error) {
      return new Response(JSON.stringify({
        error: data.error || ('OpenRouter error: status ' + response.status),
        debug: data,
      }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Extract content safely
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) {
      return new Response(JSON.stringify({
        error: 'Model returned empty response',
        debug: data,
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Worker error: ' + err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
