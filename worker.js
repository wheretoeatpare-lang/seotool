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

    // ── Analytics & Tag Managers ──────────────────────────────────────────
    { cms: 'Google Analytics 4', pattern: /gtag\('config',\s*'G-/i,       signal: 'GA4 gtag config' },
    { cms: 'Google Analytics 4', pattern: /googletagmanager\.com\/gtag/i,  signal: 'GA4 gtag.js script' },
    { cms: 'Google Analytics (UA)', pattern: /gtag\('config',\s*'UA-/i,   signal: 'Universal Analytics config' },
    { cms: 'Google Analytics (UA)', pattern: /google-analytics\.com\/analytics\.js/i, signal: 'analytics.js script' },
    { cms: 'Google Tag Manager', pattern: /googletagmanager\.com\/gtm\.js/i, signal: 'GTM container script' },
    { cms: 'Google Tag Manager', pattern: /GTM-[A-Z0-9]+/i,               signal: 'GTM container ID' },
    { cms: 'Facebook Pixel',    pattern: /connect\.facebook\.net.*fbevents/i, signal: 'Facebook Pixel script' },
    { cms: 'Hotjar',            pattern: /static\.hotjar\.com/i,           signal: 'Hotjar script' },
    { cms: 'Hotjar',            pattern: /hjid:/i,                         signal: 'Hotjar site ID' },
    { cms: 'Clarity',           pattern: /clarity\.ms\/tag/i,              signal: 'Microsoft Clarity script' },
    { cms: 'Mixpanel',          pattern: /cdn\.mxpnl\.com/i,               signal: 'Mixpanel CDN' },
    { cms: 'Segment',           pattern: /cdn\.segment\.com/i,             signal: 'Segment analytics' },
    { cms: 'Plausible',         pattern: /plausible\.io\/js/i,             signal: 'Plausible analytics' },
    { cms: 'Umami',             pattern: /umami\.is\/script/i,             signal: 'Umami analytics script' },

    // ── JS Frameworks ──────────────────────────────────────────────────────
    { cms: 'React',     pattern: /__reactFiber|__reactProps|react\.development|react\.production\.min/i, signal: 'React runtime detected' },
    { cms: 'React',     pattern: /data-reactroot|data-reactid/i,           signal: 'React DOM attributes' },
    { cms: 'Vue.js',    pattern: /__vue__|vue\.runtime|vue@[0-9]/i,        signal: 'Vue.js runtime' },
    { cms: 'Vue.js',    pattern: /data-v-[a-f0-9]{7,}/i,                  signal: 'Vue scoped attribute' },
    { cms: 'Angular',   pattern: /ng-version=|angular\.min\.js|@angular\//i, signal: 'Angular framework' },
    { cms: 'Alpine.js', pattern: /x-data=|x-init=|alpinejs/i,             signal: 'Alpine.js directives' },
    { cms: 'HTMX',      pattern: /hx-get=|hx-post=|htmx\.org/i,           signal: 'HTMX attributes' },
    { cms: 'Svelte',    pattern: /svelte-[a-z0-9]+/i,                     signal: 'Svelte class hashes' },
    { cms: 'Astro',     pattern: /astro-island|astro:load/i,               signal: 'Astro island component' },
    { cms: 'Remix',     pattern: /__remixContext|\/build\/root-[a-z0-9]+\.js/i, signal: 'Remix runtime' },
    { cms: 'Ember.js',  pattern: /ember-application|emberjs\.com/i,        signal: 'Ember.js framework' },

    // ── CSS Frameworks ─────────────────────────────────────────────────────
    { cms: 'Tailwind CSS', pattern: /tailwindcss|class="[^"]*(?:flex|grid|px-|py-|text-|bg-)[^"]*"/i, signal: 'Tailwind utility classes' },
    { cms: 'Bootstrap',    pattern: /bootstrap\.min\.css|bootstrap\.min\.js|class="[^"]*(?:btn btn-|col-md-|navbar-)/i, signal: 'Bootstrap classes/scripts' },

    // ── E-commerce & Payments ──────────────────────────────────────────────
    { cms: 'Stripe',       pattern: /js\.stripe\.com/i,                    signal: 'Stripe.js payment' },
    { cms: 'PayPal',       pattern: /paypal\.com\/sdk\/js/i,               signal: 'PayPal SDK' },
    { cms: 'WooCommerce',  pattern: /woocommerce/i,                        signal: 'WooCommerce plugin' },
    { cms: 'WooCommerce',  pattern: /\/wp-content\/plugins\/woocommerce/i, signal: 'WooCommerce plugin path' },

    // ── Live Chat & Support ────────────────────────────────────────────────
    { cms: 'Intercom',     pattern: /widget\.intercom\.io|intercomSettings/i, signal: 'Intercom chat widget' },
    { cms: 'Zendesk',      pattern: /static\.zdassets\.com|zopim/i,        signal: 'Zendesk/Zopim chat' },
    { cms: 'Crisp',        pattern: /client\.crisp\.chat/i,                signal: 'Crisp chat widget' },
    { cms: 'Tidio',        pattern: /code\.tidio\.co/i,                    signal: 'Tidio chat' },
    { cms: 'Tawk.to',      pattern: /embed\.tawk\.to/i,                    signal: 'Tawk.to live chat' },
    { cms: 'HubSpot',      pattern: /js\.hs-scripts\.com|hubspot/i,        signal: 'HubSpot script' },

    // ── Cookie Consent ─────────────────────────────────────────────────────
    { cms: 'Cookiebot',    pattern: /consent\.cookiebot\.com/i,            signal: 'Cookiebot consent' },
    { cms: 'OneTrust',     pattern: /onetrust|optanon/i,                   signal: 'OneTrust cookie banner' },
    { cms: 'Osano',        pattern: /osano\.com/i,                         signal: 'Osano consent' },

    // ── CDN / Performance ──────────────────────────────────────────────────
    { cms: 'Cloudflare',   pattern: /cloudflare\.com\/ajax|cdnjs\.cloudflare/i, signal: 'Cloudflare CDN assets' },
    { cms: 'jsDelivr',     pattern: /cdn\.jsdelivr\.net/i,                 signal: 'jsDelivr CDN' },
    { cms: 'unpkg',        pattern: /unpkg\.com\//i,                       signal: 'unpkg CDN' },
  ];

  const scores = {};

  // Category mapping — these won't compete for "top CMS"
  const NON_CMS = new Set([
    'Google Analytics 4','Google Analytics (UA)','Google Tag Manager',
    'Facebook Pixel','Hotjar','Clarity','Mixpanel','Segment','Plausible','Umami',
    'React','Vue.js','Angular','Alpine.js','HTMX','Svelte','Astro','Remix','Ember.js',
    'Tailwind CSS','Bootstrap',
    'Stripe','PayPal','WooCommerce',
    'Intercom','Zendesk','Crisp','Tidio','Tawk.to','HubSpot',
    'Cookiebot','OneTrust','Osano',
    'Cloudflare','jsDelivr','unpkg',
  ]);

  const CATEGORIES = {
    'Google Analytics 4':'analytics','Google Analytics (UA)':'analytics',
    'Google Tag Manager':'analytics','Facebook Pixel':'analytics',
    'Hotjar':'analytics','Clarity':'analytics','Mixpanel':'analytics',
    'Segment':'analytics','Plausible':'analytics','Umami':'analytics',
    'React':'js','Vue.js':'js','Angular':'js','Alpine.js':'js',
    'HTMX':'js','Svelte':'js','Astro':'js','Remix':'js','Ember.js':'js',
    'Tailwind CSS':'css','Bootstrap':'css',
    'Stripe':'payment','PayPal':'payment','WooCommerce':'ecommerce',
    'Intercom':'chat','Zendesk':'chat','Crisp':'chat','Tidio':'chat',
    'Tawk.to':'chat','HubSpot':'crm',
    'Cookiebot':'consent','OneTrust':'consent','Osano':'consent',
    'Cloudflare':'cdn','jsDelivr':'cdn','unpkg':'cdn',
  };

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

  // Find CMS winner — only from CMS candidates (not analytics/js/etc.)
  let topCMS = 'Custom / Unknown';
  let topCount = 0;
  let topSignals = [];

  for (const [cms, sigs] of Object.entries(scores)) {
    if (NON_CMS.has(cms)) continue;
    if (sigs.length > topCount) {
      topCount = sigs.length;
      topCMS = cms;
      topSignals = sigs;
    }
  }

  const confidence = Math.min(100, topCount * 25);

  // Build full tech stack list
  const techStack = [];
  for (const [tech, sigs] of Object.entries(scores)) {
    techStack.push({
      name: tech,
      category: CATEGORIES[tech] || 'cms',
      signals: sigs,
      confidence: Math.min(100, sigs.length * 25),
    });
  }
  // Sort: cms first, then by signal count
  techStack.sort((a, b) => {
    const aIsCMS = !NON_CMS.has(a.name);
    const bIsCMS = !NON_CMS.has(b.name);
    if (aIsCMS && !bIsCMS) return -1;
    if (!aIsCMS && bIsCMS) return 1;
    return b.signals.length - a.signals.length;
  });

  return {
    cms: topCMS,
    confidence,
    signals: topSignals,
    server: server || 'Unknown',
    powered_by: powered || null,
    hosting,
    all_detected: Object.keys(scores),
    tech_stack: techStack,
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
