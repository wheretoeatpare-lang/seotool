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

// ── CMS DETECTION ────────────────────────────────────────────
async function handleCMSDetect(request) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { ...corsHeaders, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }

  const { url } = await request.json();

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RankSight/1.0)' },
      redirect: 'follow',
    });

    const html = await res.text();
    const headers = Object.fromEntries(res.headers.entries());
    const finalUrl = res.url;

    const result = detectCMS(html, headers, finalUrl);

    return new Response(JSON.stringify(result), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ cms: 'Unknown', confidence: 0, signals: [], error: err.message }), {
      status: 200,
      headers: corsHeaders,
    });
  }
}

function detectCMS(html, headers, url) {
  const signals = [];
  const h = html.toLowerCase();

  const checks = [
    // ── WordPress
    { cms: 'WordPress', pattern: /wp-content\//i, signal: 'wp-content path found' },
    { cms: 'WordPress', pattern: /wp-includes\//i, signal: 'wp-includes path found' },
    { cms: 'WordPress', pattern: /<meta[^>]+generator[^>]+wordpress/i, signal: 'WordPress generator meta tag' },
    { cms: 'WordPress', pattern: /\/wp-json\//i, signal: 'wp-json REST API path' },
    { cms: 'WordPress', pattern: /wp-emoji-release\.min\.js/i, signal: 'WordPress emoji script' },

    // ── Shopify
    { cms: 'Shopify', pattern: /cdn\.shopify\.com/i, signal: 'Shopify CDN' },
    { cms: 'Shopify', pattern: /shopify\.com\/s\/files/i, signal: 'Shopify files path' },
    { cms: 'Shopify', pattern: /Shopify\.theme/i, signal: 'Shopify.theme JS object' },
    { cms: 'Shopify', pattern: /<meta[^>]+generator[^>]+shopify/i, signal: 'Shopify generator tag' },

    // ── Wix
    { cms: 'Wix', pattern: /static\.wixstatic\.com/i, signal: 'Wix static CDN' },
    { cms: 'Wix', pattern: /wix-code/i, signal: 'Wix code marker' },
    { cms: 'Wix', pattern: /"siteRevision"/i, signal: 'Wix site revision object' },

    // ── Squarespace
    { cms: 'Squarespace', pattern: /squarespace\.com/i, signal: 'Squarespace domain reference' },
    { cms: 'Squarespace', pattern: /squarespace-cdn\.com/i, signal: 'Squarespace CDN' },
    { cms: 'Squarespace', pattern: /<meta[^>]+generator[^>]+squarespace/i, signal: 'Squarespace generator tag' },
    { cms: 'Squarespace', pattern: /Static\.SQUARESPACE_CONTEXT/i, signal: 'Squarespace JS context' },

    // ── Webflow
    { cms: 'Webflow', pattern: /webflow\.com/i, signal: 'Webflow domain reference' },
    { cms: 'Webflow', pattern: /data-wf-page/i, signal: 'Webflow page attribute' },
    { cms: 'Webflow', pattern: /<meta[^>]+generator[^>]+webflow/i, signal: 'Webflow generator tag' },

    // ── Joomla
    { cms: 'Joomla', pattern: /<meta[^>]+generator[^>]+joomla/i, signal: 'Joomla generator tag' },
    { cms: 'Joomla', pattern: /\/components\/com_/i, signal: 'Joomla components path' },
    { cms: 'Joomla', pattern: /\/media\/jui\//i, signal: 'Joomla UI media path' },

    // ── Drupal
    { cms: 'Drupal', pattern: /<meta[^>]+generator[^>]+drupal/i, signal: 'Drupal generator tag' },
    { cms: 'Drupal', pattern: /\/sites\/default\/files\//i, signal: 'Drupal default files path' },
    { cms: 'Drupal', pattern: /drupal\.settings/i, signal: 'Drupal.settings JS object' },
    { cms: 'Drupal', pattern: /data-drupal/i, signal: 'Drupal data attribute' },

    // ── Ghost
    { cms: 'Ghost', pattern: /<meta[^>]+generator[^>]+ghost/i, signal: 'Ghost generator tag' },
    { cms: 'Ghost', pattern: /ghost\.io/i, signal: 'Ghost.io reference' },
    { cms: 'Ghost', pattern: /content="Ghost /i, signal: 'Ghost version tag' },

    // ── Next.js
    { cms: 'Next.js', pattern: /__next/i, signal: '__next root element' },
    { cms: 'Next.js', pattern: /_next\/static/i, signal: 'Next.js static path' },
    { cms: 'Next.js', pattern: /next\/dist/i, signal: 'Next.js dist path' },

    // ── Nuxt
    { cms: 'Nuxt', pattern: /__nuxt/i, signal: '__nuxt root element' },
    { cms: 'Nuxt', pattern: /_nuxt\//i, signal: 'Nuxt static path' },

    // ── Gatsby
    { cms: 'Gatsby', pattern: /___gatsby/i, signal: '___gatsby root element' },
    { cms: 'Gatsby', pattern: /gatsby-chunk/i, signal: 'Gatsby chunk file' },

    // ── Hugo
    { cms: 'Hugo', pattern: /<meta[^>]+generator[^>]+hugo/i, signal: 'Hugo generator tag' },

    // ── Jekyll
    { cms: 'Jekyll', pattern: /<meta[^>]+generator[^>]+jekyll/i, signal: 'Jekyll generator tag' },

    // ── Magento
    { cms: 'Magento', pattern: /mage\/cookies/i, signal: 'Magento cookies JS' },
    { cms: 'Magento', pattern: /skin\/frontend\//i, signal: 'Magento frontend skin path' },
    { cms: 'Magento', pattern: /\/static\/version[0-9]/i, signal: 'Magento static versioned path' },

    // ── PrestaShop
    { cms: 'PrestaShop', pattern: /prestashop/i, signal: 'PrestaShop reference' },
    { cms: 'PrestaShop', pattern: /\/modules\/ps_/i, signal: 'PrestaShop module path' },

    // ── BigCommerce
    { cms: 'BigCommerce', pattern: /bigcommerce\.com/i, signal: 'BigCommerce reference' },
    { cms: 'BigCommerce', pattern: /cdn11\.bigcommerce\.com/i, signal: 'BigCommerce CDN' },

    // ── Webnode
    { cms: 'Webnode', pattern: /webnode\.com/i, signal: 'Webnode reference' },

    // ── Blogger
    { cms: 'Blogger', pattern: /blogger\.com/i, signal: 'Blogger reference' },
    { cms: 'Blogger', pattern: /blogspot\.com/i, signal: 'Blogspot domain' },
  ];

  // Score each CMS
  const scores = {};
  for (const check of checks) {
    if (check.pattern.test(html)) {
      scores[check.cms] = (scores[check.cms] || []);
      scores[check.cms].push(check.signal);
    }
  }

  // Check response headers
  const server = headers['server'] || '';
  const powered = headers['x-powered-by'] || '';
  const via = headers['via'] || '';
  const xGenerator = headers['x-generator'] || '';

  if (/wordpress/i.test(xGenerator)) scores['WordPress'] = [...(scores['WordPress'] || []), 'x-generator header: WordPress'];
  if (/drupal/i.test(xGenerator)) scores['Drupal'] = [...(scores['Drupal'] || []), 'x-generator header: Drupal'];
  if (/shopify/i.test(server)) scores['Shopify'] = [...(scores['Shopify'] || []), 'Server header: Shopify'];

  // Server / hosting detection
  const hosting = detectHosting(headers, url);

  // Find top CMS by signal count
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

function detectHosting(headers, url) {
  const server = (headers['server'] || '').toLowerCase();
  const via = (headers['via'] || '').toLowerCase();
  const cfRay = headers['cf-ray'];
  const xVercel = headers['x-vercel-id'];
  const xNetlify = headers['x-nf-request-id'];

  if (cfRay || /cloudflare/i.test(server)) return 'Cloudflare';
  if (xVercel) return 'Vercel';
  if (xNetlify) return 'Netlify';
  if (/amazonaws/i.test(server) || /cloudfront/i.test(via)) return 'AWS';
  if (/github/i.test(server)) return 'GitHub Pages';
  if (/nginx/i.test(server)) return 'Nginx';
  if (/apache/i.test(server)) return 'Apache';
  if (/litespeed/i.test(server)) return 'LiteSpeed';
  return 'Unknown';
}

// ── CLAUDE / AI ───────────────────────────────────────────────
async function handleClaude(request, env) {
  // ... your existing handleClaude code stays here unchanged
}
