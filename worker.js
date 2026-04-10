export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/detect-cms') {
      return handleCMSDetect(request);
    }

    if (url.pathname === '/api/claude') {
      return handleClaude(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

// ── CORS HEADERS ─────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// ── CMS DETECTION ─────────────────────────────────────────────
async function handleCMSDetect(request) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const { url } = await request.json();

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RankSight/1.0; +https://seotool.webmasterjamez.workers.dev)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });

    const html = await res.text();
    const headers = Object.fromEntries(res.headers.entries());

    const result = detectCMS(html, headers, res.url);
    return new Response(JSON.stringify(result), { headers: CORS });

  } catch (err) {
    return new Response(
      JSON.stringify({ cms: 'Unknown', confidence: 0, signals: [], server: 'Unknown', hosting: 'Unknown', error: err.message }),
      { headers: CORS }
    );
  }
}

function detectCMS(html, headers, finalUrl) {
  const checks = [
    // WordPress
    { cms: 'WordPress', pattern: /wp-content\//i,             signal: 'wp-content path in HTML' },
    { cms: 'WordPress', pattern: /wp-includes\//i,            signal: 'wp-includes path in HTML' },
    { cms: 'WordPress', pattern: /generator.*wordpress/i,     signal: 'WordPress generator meta tag' },
    { cms: 'WordPress', pattern: /\/wp-json\//i,              signal: 'WordPress REST API path' },
    { cms: 'WordPress', pattern: /wp-emoji-release/i,         signal: 'WordPress emoji script' },
    { cms: 'WordPress', pattern: /wpml_/i,                    signal: 'WPML plugin detected' },

    // Shopify
    { cms: 'Shopify',   pattern: /cdn\.shopify\.com/i,        signal: 'Shopify CDN' },
    { cms: 'Shopify',   pattern: /shopify\.com\/s\/files/i,   signal: 'Shopify files path' },
    { cms: 'Shopify',   pattern: /Shopify\.theme/i,           signal: 'Shopify.theme JS object' },
    { cms: 'Shopify',   pattern: /generator.*shopify/i,       signal: 'Shopify generator tag' },
    { cms: 'Shopify',   pattern: /myshopify\.com/i,           signal: 'myshopify.com reference' },

    // Wix
    { cms: 'Wix',       pattern: /static\.wixstatic\.com/i,   signal: 'Wix static CDN' },
    { cms: 'Wix',       pattern: /wix-code/i,                 signal: 'Wix code marker' },
    { cms: 'Wix',       pattern: /"siteRevision"/i,           signal: 'Wix site revision object' },
    { cms: 'Wix',       pattern: /wixsite\.com/i,             signal: 'Wix site domain' },

    // Squarespace
    { cms: 'Squarespace', pattern: /squarespace\.com/i,             signal: 'Squarespace domain reference' },
    { cms: 'Squarespace', pattern: /squarespace-cdn\.com/i,         signal: 'Squarespace CDN' },
    { cms: 'Squarespace', pattern: /generator.*squarespace/i,       signal: 'Squarespace generator tag' },
    { cms: 'Squarespace', pattern: /Static\.SQUARESPACE_CONTEXT/i,  signal: 'Squarespace JS context' },

    // Webflow
    { cms: 'Webflow',   pattern: /webflow\.com/i,             signal: 'Webflow domain reference' },
    { cms: 'Webflow',   pattern: /data-wf-page/i,             signal: 'Webflow page attribute' },
    { cms: 'Webflow',   pattern: /generator.*webflow/i,       signal: 'Webflow generator tag' },
    { cms: 'Webflow',   pattern: /\.webflow\.io/i,            signal: 'Webflow subdomain' },

    // Joomla
    { cms: 'Joomla',    pattern: /generator.*joomla/i,        signal: 'Joomla generator tag' },
    { cms: 'Joomla',    pattern: /\/components\/com_/i,       signal: 'Joomla components path' },
    { cms: 'Joomla',    pattern: /\/media\/jui\//i,           signal: 'Joomla UI media path' },
    { cms: 'Joomla',    pattern: /joomla!/i,                  signal: 'Joomla! text found' },

    // Drupal
    { cms: 'Drupal',    pattern: /generator.*drupal/i,        signal: 'Drupal generator tag' },
    { cms: 'Drupal',    pattern: /\/sites\/default\/files\//i,signal: 'Drupal default files path' },
    { cms: 'Drupal',    pattern: /drupal\.settings/i,         signal: 'Drupal.settings JS object' },
    { cms: 'Drupal',    pattern: /data-drupal/i,              signal: 'Drupal data attribute' },

    // Ghost
    { cms: 'Ghost',     pattern: /generator.*ghost/i,         signal: 'Ghost generator tag' },
    { cms: 'Ghost',     pattern: /ghost\.io/i,                signal: 'Ghost.io reference' },
    { cms: 'Ghost',     pattern: /content="Ghost /i,          signal: 'Ghost version in meta' },

    // Next.js
    { cms: 'Next.js',   pattern: /__next/i,                   signal: '__next root element' },
    { cms: 'Next.js',   pattern: /_next\/static/i,            signal: 'Next.js static path' },
    { cms: 'Next.js',   pattern: /next\/dist/i,               signal: 'Next.js dist path' },

    // Nuxt
    { cms: 'Nuxt',      pattern: /__nuxt/i,                   signal: '__nuxt root element' },
    { cms: 'Nuxt',      pattern: /_nuxt\//i,                  signal: 'Nuxt static path' },

    // Gatsby
    { cms: 'Gatsby',    pattern: /___gatsby/i,                signal: '___gatsby root element' },
    { cms: 'Gatsby',    pattern: /gatsby-chunk/i,             signal: 'Gatsby chunk file' },

    // Hugo
    { cms: 'Hugo',      pattern: /generator.*hugo/i,          signal: 'Hugo generator tag' },

    // Jekyll
    { cms: 'Jekyll',    pattern: /generator.*jekyll/i,        signal: 'Jekyll generator tag' },

    // Magento
    { cms: 'Magento',   pattern: /mage\/cookies/i,            signal: 'Magento cookies JS' },
    { cms: 'Magento',   pattern: /skin\/frontend\//i,         signal: 'Magento frontend skin path' },
    { cms: 'Magento',   pattern: /\/static\/version[0-9]/i,   signal: 'Magento versioned static path' },

    // PrestaShop
    { cms: 'PrestaShop',pattern: /prestashop/i,               signal: 'PrestaShop reference' },
    { cms: 'PrestaShop',pattern: /\/modules\/ps_/i,           signal: 'PrestaShop module path' },

    // BigCommerce
    { cms: 'BigCommerce',pattern: /bigcommerce\.com/i,        signal: 'BigCommerce reference' },
    { cms: 'BigCommerce',pattern: /cdn11\.bigcommerce\.com/i, signal: 'BigCommerce CDN' },

    // Blogger
    { cms: 'Blogger',   pattern: /blogger\.com/i,             signal: 'Blogger reference' },
    { cms: 'Blogger',   pattern: /blogspot\.com/i,            signal: 'Blogspot domain' },

    // Contentful
    { cms: 'Contentful',pattern: /ctfassets\.net/i,           signal: 'Contentful assets CDN' },

    // Sanity
    { cms: 'Sanity',    pattern: /cdn\.sanity\.io/i,          signal: 'Sanity CDN' },

    // Framer
    { cms: 'Framer',    pattern: /framer\.com/i,              signal: 'Framer reference' },
    { cms: 'Framer',    pattern: /framerusercontent\.com/i,   signal: 'Framer user content CDN' },
  ];

  const scores = {};

  for (const check of checks) {
    if (check.pattern.test(html)) {
      if (!scores[check.cms]) scores[check.cms] = [];
      scores[check.cms].push(check.signal);
    }
  }

  // Header-based signals
  const server      = headers['server']        || '';
  const powered     = headers['x-powered-by'] || '';
  const xGenerator  = headers['x-generator']  || '';

  if (/wordpress/i.test(xGenerator))  { if (!scores['WordPress']) scores['WordPress'] = []; scores['WordPress'].push('x-generator: WordPress'); }
  if (/drupal/i.test(xGenerator))     { if (!scores['Drupal'])    scores['Drupal']    = []; scores['Drupal'].push('x-generator: Drupal'); }
  if (/shopify/i.test(server))        { if (!scores['Shopify'])   scores['Shopify']   = []; scores['Shopify'].push('Server header: Shopify'); }
  if (/ghost/i.test(xGenerator))      { if (!scores['Ghost'])     scores['Ghost']     = []; scores['Ghost'].push('x-generator: Ghost'); }

  // Hosting detection
  const hosting = detectHosting(headers);

  // Find winner
  let topCMS = 'Custom / Unknown';
  let topCount = 0;
  let topSignals = [];

  for (const [cms, sigs] of Object.entries(scores)) {
    if (sigs.length > topCount) {
      topCount = sigs.length;
      topCMS = cms;
      topSignals = sigs;
    }
  }

  const confidence = Math.min(100, topCount * 25);

  return {
    cms: topCMS,
    confidence,
    signals: topSignals,
    server: server || 'Unknown',
    powered_by: powered || null,
    hosting,
    all_detected: Object.keys(scores),
  };
}

function detectHosting(headers) {
  const server = (headers['server'] || '').toLowerCase();
  const via    = (headers['via']    || '').toLowerCase();

  if (headers['cf-ray']            || /cloudflare/i.test(server)) return 'Cloudflare';
  if (headers['x-vercel-id'])                                      return 'Vercel';
  if (headers['x-nf-request-id'])                                  return 'Netlify';
  if (/amazonaws/i.test(server)    || /cloudfront/i.test(via))    return 'AWS CloudFront';
  if (headers['x-github-request-id'])                              return 'GitHub Pages';
  if (/litespeed/i.test(server))                                   return 'LiteSpeed';
  if (/nginx/i.test(server))                                       return 'Nginx';
  if (/apache/i.test(server))                                      return 'Apache';
  return 'Unknown';
}

// ── CLOUDFLARE AI (SEO AUDIT) ─────────────────────────────────
async function handleClaude(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'POST')    return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json();

    const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        {
          role: 'system',
          content: 'You are an expert SEO auditor. Always respond with valid JSON only — no markdown, no code fences, no explanation. Output must be a single raw JSON object.',
        },
        {
          role: 'user',
          content: body.prompt,
        },
      ],
      max_tokens: 4096,
    });

    const text = response.response;
    const clean = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(clean);

    return new Response(JSON.stringify(parsed), { headers: CORS });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: CORS }
    );
  }
}
