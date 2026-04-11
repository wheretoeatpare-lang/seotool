export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/detect-cms') return handleCMSDetect(request);
    if (url.pathname === '/api/claude')     return handleClaude(request, env);
    if (url.pathname === '/api/page-data')  return handlePageData(request);

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

// ── PAGE DATA FETCHER (real HTML analysis) ────────────────────
async function handlePageData(request) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'POST')    return new Response('Method not allowed', { status: 405 });

  try {
    const { url } = await request.json();

    const startTime = Date.now();
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RankSight/2.0; +https://seotool.webmasterjamez.workers.dev)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
    });
    const ttfb = Date.now() - startTime;

    const html = await res.text();
    const headers = Object.fromEntries(res.headers.entries());
    const finalUrl = res.url;
    const statusCode = res.status;

    // ── Extract real page signals ──────────────────────────────
    const extracted = extractPageSignals(html, headers, finalUrl, statusCode, ttfb, url);

    return new Response(JSON.stringify(extracted), { headers: CORS });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message, ttfb: null }),
      { headers: CORS }
    );
  }
}

function extractPageSignals(html, headers, finalUrl, statusCode, ttfb, originalUrl) {
  const lower = html.toLowerCase();

  // Title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : null;
  const titleLen = title ? title.length : 0;

  // Meta description
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
                 || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  const metaDesc = descMatch ? descMatch[1].trim() : null;
  const descLen = metaDesc ? metaDesc.length : 0;

  // Canonical
  const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
                      || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  const canonical = canonicalMatch ? canonicalMatch[1] : null;

  // Headings
  const h1s = (html.match(/<h1[^>]*>/gi) || []).length;
  const h2s = (html.match(/<h2[^>]*>/gi) || []).length;
  const h3s = (html.match(/<h3[^>]*>/gi) || []).length;

  // Images without alt
  const allImgs = (html.match(/<img[^>]*>/gi) || []);
  const imgsWithoutAlt = allImgs.filter(img => !/alt=["'][^"']+["']/i.test(img)).length;

  // Open Graph
  const ogTitle    = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || [])[1];
  const ogDesc     = (html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || [])[1];
  const ogImage    = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || [])[1];
  const twitterCard= (html.match(/<meta[^>]+name=["']twitter:card["'][^>]+content=["']([^"']+)["']/i) || [])[1];

  // Schema / Structured Data
  const schemaScripts = (html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || []);
  const schemaTypes = schemaScripts.map(s => {
    const m = s.match(/"@type"\s*:\s*"([^"]+)"/);
    return m ? m[1] : 'Unknown';
  });

  // Robots meta
  const robotsMeta = (html.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["']/i) || [])[1];

  // Viewport
  const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);

  // HTTPS
  const isHttps = finalUrl.startsWith('https://');

  // Redirect check
  const wasRedirected = originalUrl !== finalUrl;

  // Security headers
  const secHeaders = {
    hsts: !!headers['strict-transport-security'],
    xContentType: !!headers['x-content-type-options'],
    xFrame: !!headers['x-frame-options'],
    csp: !!headers['content-security-policy'],
  };

  // Page size
  const pageSizeKb = Math.round(html.length / 1024);

  // Word count (rough)
  const textOnly = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = textOnly.split(' ').filter(w => w.length > 2).length;

  // Links
  const internalLinks = (html.match(/href=["'][\/][^"']*/gi) || []).length;
  const externalLinks = (html.match(/href=["']https?:\/\//gi) || []).length;

  // Inline scripts / styles (performance indicator)
  const inlineScripts = (html.match(/<script(?![^>]+src=)[^>]*>/gi) || []).length;
  const inlineStyles  = (html.match(/<style[^>]*>/gi) || []).length;

  // Lang attribute
  const langMatch = html.match(/<html[^>]+lang=["']([^"']+)["']/i);
  const lang = langMatch ? langMatch[1] : null;

  // Favicon
  const hasFavicon = /<link[^>]+rel=["'][^"']*icon[^"']*["']/i.test(html);

  // Robots header
  const robotsHeader = headers['x-robots-tag'] || null;

  // Noindex check
  const isNoindex = /noindex/i.test(robotsMeta || '') || /noindex/i.test(robotsHeader || '');

  // Content-Type charset
  const contentType = headers['content-type'] || '';
  const hasCharset = /charset=/i.test(contentType) || /charset=/i.test(html.slice(0, 1000));

  return {
    url: finalUrl,
    statusCode,
    ttfb,
    title, titleLen,
    metaDesc, descLen,
    canonical,
    headings: { h1: h1s, h2: h2s, h3: h3s },
    images: { total: allImgs.length, missingAlt: imgsWithoutAlt },
    openGraph: { title: ogTitle, description: ogDesc, image: ogImage, twitterCard },
    schema: { count: schemaScripts.length, types: schemaTypes },
    robotsMeta, robotsHeader, isNoindex,
    hasViewport,
    isHttps, wasRedirected,
    secHeaders,
    pageSizeKb,
    wordCount,
    links: { internal: internalLinks, external: externalLinks },
    inlineScripts, inlineStyles,
    lang, hasFavicon, hasCharset,
    server: headers['server'] || 'Unknown',
    cacheControl: headers['cache-control'] || null,
    poweredBy: headers['x-powered-by'] || null,
  };
}

// ── CMS DETECTION ─────────────────────────────────────────────
async function handleCMSDetect(request) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'POST')    return new Response('Method not allowed', { status: 405 });

  try {
    const { url } = await request.json();
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RankSight/2.0; +https://seotool.webmasterjamez.workers.dev)',
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
    // Shopify
    { cms: 'Shopify',   pattern: /cdn\.shopify\.com/i,        signal: 'Shopify CDN' },
    { cms: 'Shopify',   pattern: /shopify\.com\/s\/files/i,   signal: 'Shopify files path' },
    { cms: 'Shopify',   pattern: /Shopify\.theme/i,           signal: 'Shopify.theme JS object' },
    { cms: 'Shopify',   pattern: /myshopify\.com/i,           signal: 'myshopify.com reference' },
    // Wix
    { cms: 'Wix',       pattern: /static\.wixstatic\.com/i,   signal: 'Wix static CDN' },
    { cms: 'Wix',       pattern: /wix-code/i,                 signal: 'Wix code marker' },
    { cms: 'Wix',       pattern: /wixsite\.com/i,             signal: 'Wix site domain' },
    // Squarespace
    { cms: 'Squarespace', pattern: /squarespace\.com/i,             signal: 'Squarespace domain reference' },
    { cms: 'Squarespace', pattern: /squarespace-cdn\.com/i,         signal: 'Squarespace CDN' },
    { cms: 'Squarespace', pattern: /Static\.SQUARESPACE_CONTEXT/i,  signal: 'Squarespace JS context' },
    // Webflow
    { cms: 'Webflow',   pattern: /webflow\.com/i,             signal: 'Webflow domain reference' },
    { cms: 'Webflow',   pattern: /data-wf-page/i,             signal: 'Webflow page attribute' },
    { cms: 'Webflow',   pattern: /generator.*webflow/i,       signal: 'Webflow generator tag' },
    // Joomla
    { cms: 'Joomla',    pattern: /generator.*joomla/i,        signal: 'Joomla generator tag' },
    { cms: 'Joomla',    pattern: /\/components\/com_/i,       signal: 'Joomla components path' },
    // Drupal
    { cms: 'Drupal',    pattern: /generator.*drupal/i,        signal: 'Drupal generator tag' },
    { cms: 'Drupal',    pattern: /\/sites\/default\/files\//i,signal: 'Drupal default files path' },
    { cms: 'Drupal',    pattern: /drupal\.settings/i,         signal: 'Drupal.settings JS object' },
    // Ghost
    { cms: 'Ghost',     pattern: /generator.*ghost/i,         signal: 'Ghost generator tag' },
    { cms: 'Ghost',     pattern: /ghost\.io/i,                signal: 'Ghost.io reference' },
    // Next.js
    { cms: 'Next.js',   pattern: /__next/i,                   signal: '__next root element' },
    { cms: 'Next.js',   pattern: /_next\/static/i,            signal: 'Next.js static path' },
    // Nuxt
    { cms: 'Nuxt',      pattern: /__nuxt/i,                   signal: '__nuxt root element' },
    { cms: 'Nuxt',      pattern: /_nuxt\//i,                  signal: 'Nuxt static path' },
    // Gatsby
    { cms: 'Gatsby',    pattern: /___gatsby/i,                signal: '___gatsby root element' },
    // Hugo
    { cms: 'Hugo',      pattern: /generator.*hugo/i,          signal: 'Hugo generator tag' },
    // Jekyll
    { cms: 'Jekyll',    pattern: /generator.*jekyll/i,        signal: 'Jekyll generator tag' },
    // Magento
    { cms: 'Magento',   pattern: /mage\/cookies/i,            signal: 'Magento cookies JS' },
    { cms: 'Magento',   pattern: /\/static\/version[0-9]/i,   signal: 'Magento versioned static path' },
    // Shopify
    { cms: 'BigCommerce',pattern: /bigcommerce\.com/i,        signal: 'BigCommerce reference' },
    { cms: 'Blogger',   pattern: /blogspot\.com/i,            signal: 'Blogspot domain' },
    { cms: 'Contentful',pattern: /ctfassets\.net/i,           signal: 'Contentful assets CDN' },
    { cms: 'Sanity',    pattern: /cdn\.sanity\.io/i,          signal: 'Sanity CDN' },
    { cms: 'Framer',    pattern: /framerusercontent\.com/i,   signal: 'Framer user content CDN' },
    // Analytics
    { cms: 'Google Analytics 4',  pattern: /gtag\('config',\s*'G-/i,              signal: 'GA4 gtag config' },
    { cms: 'Google Tag Manager',  pattern: /googletagmanager\.com\/gtm\.js/i,      signal: 'GTM container script' },
    { cms: 'Facebook Pixel',      pattern: /connect\.facebook\.net.*fbevents/i,    signal: 'Facebook Pixel script' },
    { cms: 'Hotjar',              pattern: /static\.hotjar\.com/i,                 signal: 'Hotjar script' },
    { cms: 'Microsoft Clarity',   pattern: /clarity\.ms\/tag/i,                    signal: 'Microsoft Clarity' },
    { cms: 'Plausible',           pattern: /plausible\.io\/js/i,                   signal: 'Plausible analytics' },
    // JS Frameworks
    { cms: 'React',      pattern: /__reactFiber|__reactProps|data-reactroot/i,     signal: 'React runtime/DOM attributes' },
    { cms: 'Vue.js',     pattern: /__vue__|data-v-[a-f0-9]{7}/i,                   signal: 'Vue.js runtime/scoped attr' },
    { cms: 'Angular',    pattern: /ng-version=|angular\.min\.js/i,                 signal: 'Angular framework' },
    { cms: 'Alpine.js',  pattern: /x-data=|alpinejs/i,                             signal: 'Alpine.js directives' },
    { cms: 'HTMX',       pattern: /hx-get=|htmx\.org/i,                            signal: 'HTMX attributes' },
    { cms: 'Svelte',     pattern: /svelte-[a-z0-9]+/i,                             signal: 'Svelte class hashes' },
    { cms: 'Astro',      pattern: /astro-island/i,                                 signal: 'Astro island component' },
    // CSS
    { cms: 'Tailwind CSS', pattern: /tailwindcss/i,                                signal: 'Tailwind CSS' },
    { cms: 'Bootstrap',    pattern: /bootstrap\.min\.css|bootstrap\.bundle/i,      signal: 'Bootstrap CSS/JS' },
    // Payments
    { cms: 'Stripe',    pattern: /js\.stripe\.com/i,                               signal: 'Stripe.js payment' },
    { cms: 'PayPal',    pattern: /paypal\.com\/sdk\/js/i,                          signal: 'PayPal SDK' },
    { cms: 'WooCommerce',pattern: /\/wp-content\/plugins\/woocommerce/i,           signal: 'WooCommerce plugin path' },
    // Live Chat
    { cms: 'Intercom',  pattern: /widget\.intercom\.io|intercomSettings/i,         signal: 'Intercom chat widget' },
    { cms: 'Zendesk',   pattern: /static\.zdassets\.com|zopim/i,                   signal: 'Zendesk/Zopim chat' },
    { cms: 'Crisp',     pattern: /client\.crisp\.chat/i,                           signal: 'Crisp chat widget' },
    { cms: 'Tawk.to',   pattern: /embed\.tawk\.to/i,                               signal: 'Tawk.to live chat' },
    { cms: 'HubSpot',   pattern: /js\.hs-scripts\.com/i,                           signal: 'HubSpot script' },
    // Cookie Consent
    { cms: 'Cookiebot', pattern: /consent\.cookiebot\.com/i,                       signal: 'Cookiebot consent' },
    { cms: 'OneTrust',  pattern: /onetrust|optanon/i,                              signal: 'OneTrust cookie banner' },
    // CDN
    { cms: 'jsDelivr',  pattern: /cdn\.jsdelivr\.net/i,                            signal: 'jsDelivr CDN' },
  ];

  const NON_CMS = new Set([
    'Google Analytics 4','Google Analytics UA','Google Tag Manager','Facebook Pixel',
    'Hotjar','Microsoft Clarity','Mixpanel','Segment','Plausible',
    'React','Vue.js','Angular','Alpine.js','HTMX','Svelte','Astro',
    'Tailwind CSS','Bootstrap',
    'Stripe','PayPal','WooCommerce',
    'Intercom','Zendesk','Crisp','Tidio','Tawk.to','HubSpot',
    'Cookiebot','OneTrust','jsDelivr','unpkg',
  ]);

  const CATEGORIES = {
    'Google Analytics 4':'analytics','Google Analytics UA':'analytics',
    'Google Tag Manager':'analytics','Facebook Pixel':'analytics',
    'Hotjar':'analytics','Microsoft Clarity':'analytics',
    'Mixpanel':'analytics','Segment':'analytics','Plausible':'analytics',
    'React':'js','Vue.js':'js','Angular':'js','Alpine.js':'js',
    'HTMX':'js','Svelte':'js','Astro':'js',
    'Tailwind CSS':'css','Bootstrap':'css',
    'Stripe':'payment','PayPal':'payment','WooCommerce':'ecommerce',
    'Intercom':'chat','Zendesk':'chat','Crisp':'chat','Tidio':'chat',
    'Tawk.to':'chat','HubSpot':'crm',
    'Cookiebot':'consent','OneTrust':'consent',
    'jsDelivr':'cdn','unpkg':'cdn',
  };

  const scores = {};
  for (const check of checks) {
    if (check.pattern.test(html)) {
      if (!scores[check.cms]) scores[check.cms] = [];
      scores[check.cms].push(check.signal);
    }
  }

  const hdrs = headers;
  const server     = hdrs['server']       || '';
  const powered    = hdrs['x-powered-by']|| '';
  const xGenerator = hdrs['x-generator'] || '';
  if (/wordpress/i.test(xGenerator))  { if (!scores['WordPress']) scores['WordPress'] = []; scores['WordPress'].push('x-generator: WordPress'); }
  if (/drupal/i.test(xGenerator))     { if (!scores['Drupal'])    scores['Drupal']    = []; scores['Drupal'].push('x-generator: Drupal'); }
  if (/shopify/i.test(server))        { if (!scores['Shopify'])   scores['Shopify']   = []; scores['Shopify'].push('Server header: Shopify'); }
  if (/ghost/i.test(xGenerator))      { if (!scores['Ghost'])     scores['Ghost']     = []; scores['Ghost'].push('x-generator: Ghost'); }

  const hosting = detectHosting(hdrs);

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

  const techStack = Object.entries(scores).map(([name, sigs]) => ({
    name,
    category: CATEGORIES[name] || 'cms',
    signals: sigs,
    confidence: Math.min(100, sigs.length * 25),
  })).sort((a, b) => {
    const aIsCMS = !NON_CMS.has(a.name);
    const bIsCMS = !NON_CMS.has(b.name);
    if (aIsCMS && !bIsCMS) return -1;
    if (!aIsCMS && bIsCMS) return 1;
    return b.signals.length - a.signals.length;
  });

  return {
    cms: topCMS, confidence, signals: topSignals,
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

function detectHostingInfo(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.endsWith('.workers.dev'))   return { server: 'Cloudflare Workers (V8 isolates)', hosting: 'Cloudflare', cdn: 'Cloudflare CDN (global edge)', serverNote: 'Serverless edge runtime — no traditional web server.' };
    if (hostname.endsWith('.pages.dev'))     return { server: 'Cloudflare Pages', hosting: 'Cloudflare', cdn: 'Cloudflare CDN', serverNote: 'Static site on Cloudflare edge.' };
    if (hostname.endsWith('.netlify.app'))   return { server: 'Netlify Edge', hosting: 'Netlify', cdn: 'Netlify CDN', serverNote: 'JAMstack hosting with global CDN.' };
    if (hostname.endsWith('.vercel.app'))    return { server: 'Vercel Edge Network', hosting: 'Vercel', cdn: 'Vercel Edge Network', serverNote: 'Serverless + edge functions; optimized for Next.js.' };
    if (hostname.endsWith('.github.io'))     return { server: 'GitHub Pages (nginx)', hosting: 'GitHub Pages', cdn: 'Fastly CDN', serverNote: 'Static site via GitHub on Fastly.' };
    if (hostname.endsWith('.myshopify.com')) return { server: 'Shopify', hosting: 'Shopify', cdn: 'Cloudflare CDN', serverNote: 'Shopify managed e-commerce platform.' };
    if (hostname.endsWith('.wordpress.com'))return { server: 'WordPress.com (nginx)', hosting: 'Automattic', cdn: 'Jetpack CDN', serverNote: 'Managed WordPress hosting by Automattic.' };
    if (hostname.endsWith('.webflow.io'))    return { server: 'Webflow', hosting: 'Webflow', cdn: 'Fastly CDN', serverNote: 'Webflow managed hosting on Fastly edge.' };
    if (hostname.endsWith('.wixsite.com'))   return { server: 'Wix', hosting: 'Wix', cdn: 'Wix CDN', serverNote: 'Wix managed website platform.' };
    if (hostname.endsWith('.squarespace.com')) return { server: 'Squarespace (nginx)', hosting: 'Squarespace', cdn: 'Fastly CDN', serverNote: 'Squarespace managed hosting.' };
    if (hostname.endsWith('.web.app') || hostname.endsWith('.firebaseapp.com')) return { server: 'Firebase Hosting', hosting: 'Google Firebase', cdn: 'Google Cloud CDN', serverNote: 'Firebase static hosting on Google infrastructure.' };
    if (hostname.endsWith('.azurewebsites.net')) return { server: 'Azure App Service', hosting: 'Microsoft Azure', cdn: 'None', serverNote: 'Azure PaaS web app hosting.' };
    if (hostname.endsWith('.onrender.com')) return { server: 'Render', hosting: 'Render', cdn: 'None', serverNote: 'Cloud application platform.' };
    return { server: 'Undetermined (custom domain)', hosting: 'Undetermined', cdn: 'Undetermined', serverNote: 'Cannot determine from domain alone — could be Apache, nginx, Caddy, or cloud-managed.' };
  } catch {
    return { server: 'Unknown', hosting: 'Unknown', cdn: 'Unknown', serverNote: '' };
  }
}

// ── CLOUDFLARE AI (SEO AUDIT) ─────────────────────────────────
async function handleClaude(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'POST')    return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json();
    const { url, options, pageData, cmsData } = body;

    const { server, hosting, cdn, serverNote } = detectHostingInfo(url);

    // Build a rich context from real page data
    const realSignals = pageData ? buildRealSignalsContext(pageData) : 'No real page data available.';

    const systemPrompt = `You are a world-class SEO specialist with 15 years of experience ranking websites #1 on Google. You combine technical SEO mastery, content strategy, E-E-A-T principles, Core Web Vitals expertise, and CMS-specific knowledge. Always respond with valid JSON only — no markdown, no code fences, no explanation. Output must be a single raw JSON object.`;

    const userPrompt = `Perform a comprehensive, expert-level SEO audit for: ${url}

CMS/Platform detected: ${cmsData?.cms || 'Unknown'}
Server: ${server}
Hosting: ${hosting}
CDN: ${cdn}
${serverNote}

Selected audit areas: ${(options || []).join(', ')}

REAL PAGE DATA EXTRACTED FROM THE SITE:
${realSignals}

CRITICAL INSTRUCTIONS:
1. Use the real page data above as ground truth for factual metrics (title, meta desc, H1s, images, schema, OG tags, HTTPS, etc.)
2. Make ALL suggestions CMS-specific — if CMS is WordPress, reference plugins (Yoast, RankMath, WP Rocket, etc.). If Shopify, reference Shopify apps and theme liquid files. If Webflow, reference Webflow's SEO settings UI. If Wix, reference Wix SEO Wiz. If custom/unknown, give generic code examples.
3. For each suggestion's "fix" field: provide the EXACT steps a user would take in that CMS to implement the fix (UI steps, plugin names, code snippets, or file paths as appropriate).
4. Prioritize fixes by Google ranking impact: schema markup, Core Web Vitals, title/meta optimization, E-E-A-T signals, mobile UX, internal linking, content depth.
5. Include E-E-A-T analysis (Experience, Expertise, Authoritativeness, Trustworthiness) signals.
6. Include competitor keyword gap opportunities.
7. Include a "quick wins" list — fixes that take under 30 minutes but have high impact.

Respond with ONLY this exact JSON structure:

{
  "score": <integer 0-100>,
  "grade": "<A/B/C/D/F>",
  "summary": "<3-4 sentence expert summary of the site's SEO health, referencing real detected data>",
  "eeat_summary": "<2-3 sentences analyzing E-E-A-T signals found or missing on this site>",
  "quick_wins": ["<win1>", "<win2>", "<win3>", "<win4>", "<win5>"],
  "categories": {
    "technical":    { "score": <0-100>, "grade": "<A-F>", "note": "<one line>" },
    "performance":  { "score": <0-100>, "grade": "<A-F>", "note": "<one line>" },
    "content":      { "score": <0-100>, "grade": "<A-F>", "note": "<one line>" },
    "ux":           { "score": <0-100>, "grade": "<A-F>", "note": "<one line>" },
    "backlinks":    { "score": <0-100>, "grade": "<A-F>", "note": "<one line>" },
    "schema":       { "score": <0-100>, "grade": "<A-F>", "note": "<one line>" },
    "eeat":         { "score": <0-100>, "grade": "<A-F>", "note": "<one line>" },
    "social":       { "score": <0-100>, "grade": "<A-F>", "note": "<one line>" }
  },
  "overview_cards": [
    { "title": "Page Title", "value": "<detected title or 'Missing'>", "description": "<title length and quality assessment>", "status": "<pass|warn|fail>" },
    { "title": "Meta Description", "value": "<length>", "description": "<meta desc quality>", "status": "<pass|warn|fail>" },
    { "title": "HTTPS / Security", "value": "<Secure|Not Secure>", "description": "<security status>", "status": "<pass|fail>" },
    { "title": "H1 Tags", "value": "<count>", "description": "<heading structure assessment>", "status": "<pass|warn|fail>" },
    { "title": "Schema Markup", "value": "<count> schemas", "description": "<schema types found>", "status": "<pass|warn|fail>" },
    { "title": "Open Graph", "value": "<Complete|Partial|Missing>", "description": "<OG tag status>", "status": "<pass|warn|fail>" },
    { "title": "Images Alt Text", "value": "<missing count>/<total>", "description": "<alt text compliance>", "status": "<pass|warn|fail>" },
    { "title": "Page Speed (TTFB)", "value": "<ttfb>ms", "description": "<TTFB assessment vs Google's 800ms threshold>", "status": "<pass|warn|fail>" },
    { "title": "Word Count", "value": "<count> words", "description": "<content depth assessment>", "status": "<pass|warn|fail>" },
    { "title": "Canonical URL", "value": "<Set|Missing>", "description": "<canonical status>", "status": "<pass|warn|fail>" }
  ],
  "suggestions": [
    {
      "title": "<string>",
      "priority": "<high|medium|low>",
      "impact": "<High Impact|Medium Impact|Low Impact>",
      "category": "<Technical|Content|Performance|UX|Schema|E-E-A-T|Social|Backlinks>",
      "description": "<detailed description with WHY it matters for Google ranking>",
      "fix": "<EXACT CMS-specific steps: plugin name + setting path, or code snippet, or Shopify app name, etc.>",
      "effort": "<Quick (< 30 min)|Medium (1-2 hrs)|Advanced (half day+)>",
      "ranking_impact": "<Immediate|Short-term (1-4 weeks)|Long-term (3+ months)>"
    }
  ],
  "metrics": [
    { "name": "<string>", "value": "<string>", "score": <0-100>, "status": "<pass|warn|fail>", "benchmark": "<what good looks like>" }
  ],
  "keywords": [
    { "title": "Target Keywords", "value": "<keyword1, keyword2, keyword3>", "description": "Detected primary keywords from title, H1, meta", "status": "info" },
    { "title": "Keyword in Title", "value": "<Yes|No>", "description": "Primary keyword present in title tag", "status": "<pass|fail>" },
    { "title": "Keyword in Meta Description", "value": "<Yes|No>", "description": "Primary keyword present in meta description", "status": "<pass|fail>" },
    { "title": "Keyword in H1", "value": "<Yes|No>", "description": "Primary keyword present in H1 heading", "status": "<pass|fail>" },
    { "title": "Keyword Density", "value": "<percentage>", "description": "Primary keyword density (ideal: 1-2%)", "status": "<pass|warn|fail>" },
    { "title": "LSI / Semantic Keywords", "value": "<keywords>", "description": "Related semantic terms to add for topical authority", "status": "info" },
    { "title": "Long-tail Opportunities", "value": "<keywords>", "description": "High-intent long-tail phrases to target", "status": "info" },
    { "title": "Missing Keywords", "value": "<keywords>", "description": "Important keywords absent from the page", "status": "warn" }
  ],
  "schema_analysis": {
    "detected": <schema types array>,
    "missing": ["<recommended schema types for this site type>"],
    "priority_schema": "<most important schema to add next>",
    "implementation": "<CMS-specific schema implementation instructions>"
  },
  "competitor_gaps": [
    { "opportunity": "<string>", "description": "<what competitors likely have that this site is missing>", "action": "<specific action to take>" }
  ],
  "core_web_vitals": {
    "lcp_estimate": "<Good < 2.5s | Needs Improvement 2.5-4s | Poor > 4s>",
    "fid_estimate": "<Good < 100ms | Needs Improvement | Poor>",
    "cls_estimate": "<Good < 0.1 | Needs Improvement | Poor>",
    "ttfb_actual": <ttfb ms or null>,
    "recommendations": ["<cwv recommendation 1>", "<cwv recommendation 2>"]
  }
}

Generate at least 10 suggestions and 12 metrics. Base all factual data on the real page signals provided. Return ONLY the JSON object.`;

    const response = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      max_tokens: 4096,
    });

    let text = response.response;
    // Robust JSON extraction
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in AI response');
    const clean = jsonMatch[0];
    const parsed = JSON.parse(clean);

    return new Response(JSON.stringify(parsed), { headers: CORS });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: CORS }
    );
  }
}

function buildRealSignalsContext(pd) {
  return `
- URL: ${pd.url}
- HTTP Status: ${pd.statusCode}
- TTFB: ${pd.ttfb}ms
- HTTPS: ${pd.isHttps ? 'YES' : 'NO — CRITICAL ISSUE'}
- Was Redirected: ${pd.wasRedirected}
- Lang attribute: ${pd.lang || 'MISSING'}
- Charset declared: ${pd.hasCharset}
- Title: "${pd.title || 'MISSING'}" (${pd.titleLen} chars; ideal: 50-60)
- Meta Description: "${pd.metaDesc || 'MISSING'}" (${pd.descLen} chars; ideal: 120-155)
- Canonical: ${pd.canonical || 'MISSING'}
- Robots meta: ${pd.robotsMeta || 'Not set'}
- Noindex: ${pd.isNoindex ? 'YES — PAGES BLOCKED FROM GOOGLE' : 'No'}
- H1 count: ${pd.headings.h1} (ideal: exactly 1)
- H2 count: ${pd.headings.h2}
- H3 count: ${pd.headings.h3}
- Total images: ${pd.images.total} | Missing alt: ${pd.images.missingAlt}
- Open Graph title: ${pd.openGraph.title || 'MISSING'}
- Open Graph description: ${pd.openGraph.description || 'MISSING'}
- Open Graph image: ${pd.openGraph.image || 'MISSING'}
- Twitter card: ${pd.openGraph.twitterCard || 'MISSING'}
- Schema types found: ${pd.schema.count > 0 ? pd.schema.types.join(', ') : 'NONE DETECTED'}
- Schema count: ${pd.schema.count}
- Page size: ${pd.pageSizeKb}KB
- Word count: ~${pd.wordCount} words
- Internal links: ${pd.links.internal}
- External links: ${pd.links.external}
- Inline scripts: ${pd.inlineScripts}
- Viewport meta: ${pd.hasViewport ? 'Present' : 'MISSING'}
- Favicon: ${pd.hasFavicon ? 'Present' : 'MISSING'}
- Security headers: HSTS=${pd.secHeaders.hsts}, X-Content-Type=${pd.secHeaders.xContentType}, X-Frame=${pd.secHeaders.xFrame}, CSP=${pd.secHeaders.csp}
- Cache-Control: ${pd.cacheControl || 'Not set'}
- Server: ${pd.server}
- Powered-by: ${pd.poweredBy || 'Hidden'}
`.trim();
}
