export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/detect-cms') return handleCMSDetect(request);
    if (url.pathname === '/api/claude')     return handleClaude(request, env);
    if (url.pathname === '/api/page-data')  return handlePageData(request);
    return env.ASSETS.fetch(request);
  },
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// ── PAGE DATA FETCHER ─────────────────────────────────────────
async function handlePageData(request) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'POST')    return new Response('Method not allowed', { status: 405 });
  try {
    const { url } = await request.json();
    const t0 = Date.now();
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RankSight/2.0; +https://seotool.webmasterjamez.workers.dev)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    const ttfb = Date.now() - t0;
    const html = await res.text();
    const headers = Object.fromEntries(res.headers.entries());
    return new Response(JSON.stringify(extractPageSignals(html, headers, res.url, res.status, ttfb, url)), { headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, ttfb: null }), { headers: CORS });
  }
}

function extractPageSignals(html, headers, finalUrl, statusCode, ttfb, originalUrl) {
  const g = (re, src = html, i = 1) => { const m = (src || '').match(re); return m ? m[i] : null; };

  const title    = g(/<title[^>]*>([^<]+)<\/title>/i);
  const titleLen = title ? title.trim().length : 0;
  const metaDesc = g(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
                || g(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  const descLen  = metaDesc ? metaDesc.trim().length : 0;
  const canonical= g(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
                || g(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  const h1s = (html.match(/<h1[^>]*>/gi) || []).length;
  const h2s = (html.match(/<h2[^>]*>/gi) || []).length;
  const h3s = (html.match(/<h3[^>]*>/gi) || []).length;
  const allImgs = html.match(/<img[^>]*>/gi) || [];
  const imgsNoAlt = allImgs.filter(i => !/alt=["'][^"']+["']/i.test(i)).length;
  const ogTitle    = g(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const ogDesc     = g(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const ogImage    = g(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  const twitterCard= g(/<meta[^>]+name=["']twitter:card["'][^>]+content=["']([^"']+)["']/i);
  const schemaBlocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  const schemaTypes = schemaBlocks.map(s => { const m = s.match(/"@type"\s*:\s*"([^"]+)"/); return m ? m[1] : 'Unknown'; });
  const robotsMeta = g(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["']/i);
  const robotsHeader = headers['x-robots-tag'] || null;
  const isNoindex = /noindex/i.test(robotsMeta || '') || /noindex/i.test(robotsHeader || '');
  const pageSizeKb = Math.round(html.length / 1024);
  const wordCount = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(w => w.length > 2).length;

  return {
    url: finalUrl, statusCode, ttfb,
    title: title?.trim(), titleLen,
    metaDesc: metaDesc?.trim(), descLen, canonical,
    headings: { h1: h1s, h2: h2s, h3: h3s },
    images: { total: allImgs.length, missingAlt: imgsNoAlt },
    openGraph: { title: ogTitle, description: ogDesc, image: ogImage, twitterCard },
    schema: { count: schemaBlocks.length, types: schemaTypes },
    robotsMeta, robotsHeader, isNoindex,
    hasViewport: /<meta[^>]+name=["']viewport["']/i.test(html),
    isHttps: finalUrl.startsWith('https://'),
    wasRedirected: originalUrl !== finalUrl,
    secHeaders: {
      hsts: !!headers['strict-transport-security'],
      xContentType: !!headers['x-content-type-options'],
      xFrame: !!headers['x-frame-options'],
      csp: !!headers['content-security-policy'],
    },
    pageSizeKb, wordCount,
    links: {
      internal: (html.match(/href=["'][\/][^"']*/gi) || []).length,
      external: (html.match(/href=["']https?:\/\//gi) || []).length,
    },
    inlineScripts: (html.match(/<script(?![^>]+src=)[^>]*>/gi) || []).length,
    lang: g(/<html[^>]+lang=["']([^"']+)["']/i),
    hasFavicon: /<link[^>]+rel=["'][^"']*icon[^"']*["']/i.test(html),
    hasCharset: /charset=/i.test(headers['content-type'] || '') || /charset=/i.test(html.slice(0, 1000)),
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
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RankSight/2.0)', 'Accept': 'text/html' },
      redirect: 'follow',
    });
    const html = await res.text();
    const headers = Object.fromEntries(res.headers.entries());
    return new Response(JSON.stringify(detectCMS(html, headers, res.url)), { headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ cms: 'Unknown', confidence: 0, signals: [], tech_stack: [], error: err.message }), { headers: CORS });
  }
}

function detectCMS(html, headers, finalUrl) {
  const checks = [
    { cms: 'WordPress',   pattern: /wp-content\//i,             signal: 'wp-content path' },
    { cms: 'WordPress',   pattern: /wp-includes\//i,            signal: 'wp-includes path' },
    { cms: 'WordPress',   pattern: /generator.*wordpress/i,     signal: 'WordPress generator' },
    { cms: 'WordPress',   pattern: /\/wp-json\//i,              signal: 'WP REST API' },
    { cms: 'Shopify',     pattern: /cdn\.shopify\.com/i,        signal: 'Shopify CDN' },
    { cms: 'Shopify',     pattern: /Shopify\.theme/i,           signal: 'Shopify.theme JS' },
    { cms: 'Shopify',     pattern: /myshopify\.com/i,           signal: 'myshopify.com ref' },
    { cms: 'Wix',         pattern: /static\.wixstatic\.com/i,   signal: 'Wix static CDN' },
    { cms: 'Squarespace', pattern: /squarespace\.com/i,          signal: 'Squarespace ref' },
    { cms: 'Squarespace', pattern: /Static\.SQUARESPACE_CONTEXT/i, signal: 'Squarespace JS' },
    { cms: 'Webflow',     pattern: /data-wf-page/i,             signal: 'Webflow attr' },
    { cms: 'Webflow',     pattern: /webflow\.com/i,             signal: 'Webflow ref' },
    { cms: 'Joomla',      pattern: /generator.*joomla/i,        signal: 'Joomla generator' },
    { cms: 'Drupal',      pattern: /drupal\.settings/i,         signal: 'Drupal.settings' },
    { cms: 'Ghost',       pattern: /generator.*ghost/i,         signal: 'Ghost generator' },
    { cms: 'Next.js',     pattern: /_next\/static/i,            signal: 'Next.js static' },
    { cms: 'Nuxt',        pattern: /_nuxt\//i,                  signal: 'Nuxt path' },
    { cms: 'Gatsby',      pattern: /___gatsby/i,                signal: 'Gatsby root' },
    { cms: 'Magento',     pattern: /\/static\/version[0-9]/i,   signal: 'Magento static' },
    { cms: 'BigCommerce', pattern: /bigcommerce\.com/i,         signal: 'BigCommerce ref' },
    { cms: 'Contentful',  pattern: /ctfassets\.net/i,           signal: 'Contentful CDN' },
    { cms: 'Framer',      pattern: /framerusercontent\.com/i,   signal: 'Framer CDN' },
    { cms: 'Google Analytics 4',  pattern: /gtag\('config',\s*'G-/i, signal: 'GA4' },
    { cms: 'Google Tag Manager',  pattern: /googletagmanager\.com\/gtm/i, signal: 'GTM' },
    { cms: 'Facebook Pixel',      pattern: /fbevents\.js/i,     signal: 'FB Pixel' },
    { cms: 'Hotjar',              pattern: /static\.hotjar\.com/i, signal: 'Hotjar' },
    { cms: 'React',    pattern: /__reactFiber|data-reactroot/i, signal: 'React' },
    { cms: 'Vue.js',   pattern: /__vue__|data-v-[a-f0-9]{7}/i, signal: 'Vue.js' },
    { cms: 'Angular',  pattern: /ng-version=/i,                 signal: 'Angular' },
    { cms: 'Svelte',   pattern: /svelte-[a-z0-9]+/i,           signal: 'Svelte' },
    { cms: 'Tailwind CSS', pattern: /tailwindcss/i,            signal: 'Tailwind' },
    { cms: 'Bootstrap',    pattern: /bootstrap\.min\.css/i,    signal: 'Bootstrap' },
    { cms: 'Stripe',      pattern: /js\.stripe\.com/i,         signal: 'Stripe.js' },
    { cms: 'WooCommerce', pattern: /\/plugins\/woocommerce/i,  signal: 'WooCommerce' },
    { cms: 'Intercom',    pattern: /widget\.intercom\.io/i,    signal: 'Intercom' },
    { cms: 'HubSpot',     pattern: /js\.hs-scripts\.com/i,     signal: 'HubSpot' },
  ];

  const NON_CMS = new Set([
    'Google Analytics 4','Google Tag Manager','Facebook Pixel','Hotjar',
    'React','Vue.js','Angular','Svelte','Tailwind CSS','Bootstrap',
    'Stripe','WooCommerce','Intercom','HubSpot',
  ]);
  const CATEGORIES = {
    'Google Analytics 4':'analytics','Google Tag Manager':'analytics',
    'Facebook Pixel':'analytics','Hotjar':'analytics',
    'React':'js','Vue.js':'js','Angular':'js','Svelte':'js',
    'Tailwind CSS':'css','Bootstrap':'css',
    'Stripe':'payment','WooCommerce':'ecommerce',
    'Intercom':'chat','HubSpot':'crm',
  };

  const scores = {};
  for (const c of checks) {
    if (c.pattern.test(html)) {
      scores[c.cms] = scores[c.cms] || [];
      scores[c.cms].push(c.signal);
    }
  }

  const xGen = headers['x-generator'] || '';
  if (/wordpress/i.test(xGen)) { scores['WordPress'] = scores['WordPress'] || []; scores['WordPress'].push('x-generator'); }
  if (/drupal/i.test(xGen))    { scores['Drupal']    = scores['Drupal'] || [];    scores['Drupal'].push('x-generator'); }

  const hosting = detectHosting(headers);
  let topCMS = 'Custom / Unknown', topCount = 0, topSignals = [];
  for (const [cms, sigs] of Object.entries(scores)) {
    if (NON_CMS.has(cms)) continue;
    if (sigs.length > topCount) { topCount = sigs.length; topCMS = cms; topSignals = sigs; }
  }

  const techStack = Object.entries(scores).map(([name, sigs]) => ({
    name, category: CATEGORIES[name] || 'cms', signals: sigs,
    confidence: Math.min(100, sigs.length * 25),
  })).sort((a, b) => {
    const aC = !NON_CMS.has(a.name), bC = !NON_CMS.has(b.name);
    return aC === bC ? b.signals.length - a.signals.length : aC ? -1 : 1;
  });

  return {
    cms: topCMS, confidence: Math.min(100, topCount * 25),
    signals: topSignals, server: headers['server'] || 'Unknown',
    powered_by: headers['x-powered-by'] || null, hosting,
    all_detected: Object.keys(scores), tech_stack: techStack,
  };
}

function detectHosting(headers) {
  const s = (headers['server'] || '').toLowerCase();
  const v = (headers['via'] || '').toLowerCase();
  if (headers['cf-ray'] || /cloudflare/i.test(s)) return 'Cloudflare';
  if (headers['x-vercel-id'])                       return 'Vercel';
  if (headers['x-nf-request-id'])                   return 'Netlify';
  if (/amazonaws/i.test(s) || /cloudfront/i.test(v)) return 'AWS';
  if (/nginx/i.test(s))  return 'Nginx';
  if (/apache/i.test(s)) return 'Apache';
  return 'Unknown';
}

function detectHostingInfo(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h.endsWith('.workers.dev'))   return { server: 'Cloudflare Workers', hosting: 'Cloudflare', cdn: 'Cloudflare CDN' };
    if (h.endsWith('.pages.dev'))     return { server: 'Cloudflare Pages', hosting: 'Cloudflare', cdn: 'Cloudflare CDN' };
    if (h.endsWith('.netlify.app'))   return { server: 'Netlify Edge', hosting: 'Netlify', cdn: 'Netlify CDN' };
    if (h.endsWith('.vercel.app'))    return { server: 'Vercel Edge', hosting: 'Vercel', cdn: 'Vercel Edge Network' };
    if (h.endsWith('.github.io'))     return { server: 'GitHub Pages', hosting: 'GitHub Pages', cdn: 'Fastly' };
    if (h.endsWith('.myshopify.com')) return { server: 'Shopify', hosting: 'Shopify', cdn: 'Cloudflare CDN' };
    if (h.endsWith('.wordpress.com')) return { server: 'WordPress.com', hosting: 'Automattic', cdn: 'Jetpack CDN' };
    if (h.endsWith('.webflow.io'))    return { server: 'Webflow', hosting: 'Webflow', cdn: 'Fastly CDN' };
    if (h.endsWith('.wixsite.com'))   return { server: 'Wix', hosting: 'Wix', cdn: 'Wix CDN' };
    return { server: 'Unknown', hosting: 'Unknown', cdn: 'Unknown' };
  } catch { return { server: 'Unknown', hosting: 'Unknown', cdn: 'Unknown' }; }
}

// ─────────────────────────────────────────────────────────────
// AI AUDIT — ROOT CAUSE & FIX
//
// WHY "AI returned empty response":
//   The previous prompt was ~3,500+ tokens input. Cloudflare Workers AI
//   free tier has a ~4096 total token context window shared between input
//   AND output. A 3500-token prompt left only ~600 tokens for the response,
//   causing the model to either truncate or return null entirely.
//
// FIX:
//   1. Compact prompt: signals compressed to ~800 input tokens.
//   2. Model waterfall: 8b (reliable) → 11b → mistral-7b (fallbacks).
//   3. max_tokens: 6000 (enough for full JSON output with 8+ suggestions and 10+ metrics).
//   4. Robust extraction handles all known CF AI response shapes.
// ─────────────────────────────────────────────────────────────
async function handleClaude(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'POST')    return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json();
    const { url, options, pageData, cmsData } = body;

    if (!env.AI) throw new Error('Workers AI binding missing. Check wrangler.toml [ai] section and redeploy.');

    const { server, hosting, cdn } = detectHostingInfo(url);
    const cms = cmsData?.cms || 'Unknown';
    const pd  = pageData  || {};

    // ── COMPACT SIGNALS (~800 tokens) ─────────────────────────
    const sig = [
      `URL:${url}`,
      `CMS:${cms}|Host:${hosting}|CDN:${cdn}|Server:${server}`,
      `HTTPS:${pd.isHttps?'Yes':'NO-CRITICAL'}|Status:${pd.statusCode||'?'}|TTFB:${pd.ttfb||'?'}ms`,
      `Title:"${pd.title||'MISSING'}"(${pd.titleLen||0}chars,ideal50-60)`,
      `MetaDesc:"${pd.metaDesc?(pd.metaDesc.slice(0,60)+'...'):'MISSING'}"(${pd.descLen||0}chars,ideal120-155)`,
      `H1:${pd.headings?.h1||0}(ideal:1) H2:${pd.headings?.h2||0} H3:${pd.headings?.h3||0}`,
      `Images:${pd.images?.total||0}total,${pd.images?.missingAlt||0}missingAlt`,
      `Schema:${pd.schema?.count||0}found(${pd.schema?.types?.join(',')||'none'})`,
      `OG:title=${pd.openGraph?.title?'Yes':'No'},desc=${pd.openGraph?.description?'Yes':'No'},img=${pd.openGraph?.image?'Yes':'No'}`,
      `Twitter:${pd.openGraph?.twitterCard||'Missing'}`,
      `Canonical:${pd.canonical||'Missing'}|Noindex:${pd.isNoindex?'YES-BLOCKED':'No'}`,
      `Words:~${pd.wordCount||'?'}|Size:${pd.pageSizeKb||'?'}KB|IntLinks:${pd.links?.internal||0}|ExtLinks:${pd.links?.external||0}`,
      `Viewport:${pd.hasViewport?'Yes':'MISSING'}|Favicon:${pd.hasFavicon?'Yes':'No'}|Lang:${pd.lang||'Missing'}`,
      `HSTS:${pd.secHeaders?.hsts?'Yes':'No'}|XFrame:${pd.secHeaders?.xFrame?'Yes':'No'}|CSP:${pd.secHeaders?.csp?'Yes':'No'}`,
      `Cache:${pd.cacheControl||'Not set'}|InlineScripts:${pd.inlineScripts||0}`,
    ].join('\n');

    // ── CMS-SPECIFIC FIX GUIDE ─────────────────────────────────
    const cmsGuides = {
      'WordPress':      'Use Yoast SEO / RankMath plugin. Reference WordPress admin panel paths. Mention WP Rocket for speed, Smush for images.',
      'Shopify':        'Reference Shopify admin (Online Store > Preferences), theme liquid files, Shopify App Store (TinyIMG, SEO Manager, JSON-LD for SEO).',
      'Webflow':        'Reference Webflow Designer Page Settings > SEO tab, Site Settings > SEO, CMS Collections settings.',
      'Wix':            'Reference Wix SEO Wiz, Page Settings > SEO, Wix App Market for SEO tools.',
      'Squarespace':    'Reference Pages > Page Settings > SEO, Marketing > SEO settings, Connected Accounts.',
      'Next.js':        'Use next/head or Next.js 13+ metadata API, generateMetadata(), next-sitemap, next/image.',
      'Nuxt':           'Use useHead(), useSeoMeta(), nuxt-simple-sitemap, nuxt.config.ts app.head.',
      'Gatsby':         'Use gatsby-plugin-react-helmet, gatsby-plugin-sitemap, gatsby-image.',
      'Custom / Unknown': 'Provide HTML code snippets the developer can paste directly.',
    };
    const cmsGuide = cmsGuides[cms] || cmsGuides['Custom / Unknown'];

    // ── SMART SUPPRESSION — avoid nonsense suggestions ─────────
    // If site is already HTTPS, AI must NOT suggest "add HTTPS" or "configure HTTPS".
    // If HSTS header IS present, AI must NOT suggest adding HSTS.
    // These rules eliminate the #1 complaint from users: irrelevant quick wins.
    const suppressionRules = [
      pd.isHttps        ? 'RULE: Site IS already on HTTPS. Do NOT suggest enabling HTTPS or SSL. Do NOT suggest "Configure HTTPS". HTTPS is confirmed working.' : '',
      pd.secHeaders?.hsts ? 'RULE: HSTS header IS already set. Do NOT suggest adding HSTS.' : '',
      pd.hasViewport    ? 'RULE: Viewport meta tag IS present. Do NOT suggest adding viewport tag.' : '',
      pd.hasFavicon     ? 'RULE: Favicon IS present. Do NOT suggest adding a favicon.' : '',
      pd.canonical      ? 'RULE: Canonical URL IS set. Do NOT suggest adding canonical tags.' : '',
      pd.lang           ? 'RULE: Lang attribute IS set. Do NOT suggest adding lang attribute.' : '',
      pd.schema?.count > 0 ? `RULE: Site ALREADY HAS ${pd.schema.count} schema(s): ${pd.schema.types.join(', ')}. Focus on adding MISSING schema types, not the ones already there.` : '',
    ].filter(Boolean).join('\n');

    // ── PROMPT (~1000 tokens total input) ─────────────────────
    const prompt = `SEO audit for: ${url}

PAGE DATA:
${sig}

CMS FIX STYLE: ${cmsGuide}

CRITICAL SUPPRESSION RULES (MUST FOLLOW — violations make the audit useless):
${suppressionRules || 'No suppressions needed.'}
RULE: Quick wins must only include issues that are ACTUALLY MISSING or broken on this site based on PAGE DATA above. Never suggest fixing something that is already working correctly.
RULE: HSTS (HTTP Strict Transport Security) is a SECURITY HEADER that tells browsers to always use HTTPS even if the user types http://. It is SEPARATE from having HTTPS. Only suggest it if HSTS header is NOT set AND site is on HTTPS.
RULE: All string values in the JSON must NOT contain raw double-quotes, raw newlines, or raw tab characters. Use single quotes or rephrase instead. Keep "fix" and "description" values on a single line.

Output ONLY valid JSON (no markdown, no code fences, no explanation):
{"score":<0-100>,"grade":"<A-F>","summary":"<3 sentences based on real data>","eeat_summary":"<2 sentences on trust/authority signals>","quick_wins":["<win1>","<win2>","<win3>","<win4>","<win5>"],"categories":{"technical":{"score":<0-100>,"grade":"<A-F>","note":"<brief>"},"performance":{"score":<0-100>,"grade":"<A-F>","note":"<brief>"},"content":{"score":<0-100>,"grade":"<A-F>","note":"<brief>"},"ux":{"score":<0-100>,"grade":"<A-F>","note":"<brief>"},"backlinks":{"score":<0-100>,"grade":"<A-F>","note":"<brief>"},"schema":{"score":<0-100>,"grade":"<A-F>","note":"<brief>"},"eeat":{"score":<0-100>,"grade":"<A-F>","note":"<brief>"},"social":{"score":<0-100>,"grade":"<A-F>","note":"<brief>"}},"overview_cards":[{"title":"Page Title","value":"<title or Missing>","description":"<assessment>","status":"<pass|warn|fail>"},{"title":"Meta Description","value":"<X chars or Missing>","description":"<assessment>","status":"<pass|warn|fail>"},{"title":"HTTPS","value":"<Secure|Not Secure>","description":"<detail>","status":"<pass|fail>"},{"title":"H1 Tags","value":"<count>","description":"<assessment>","status":"<pass|warn|fail>"},{"title":"Schema Markup","value":"<X found>","description":"<types>","status":"<pass|warn|fail>"},{"title":"Open Graph","value":"<Complete|Partial|Missing>","description":"<detail>","status":"<pass|warn|fail>"},{"title":"Image Alt Text","value":"<X missing / Y total>","description":"<detail>","status":"<pass|warn|fail>"},{"title":"Page Speed","value":"<TTFB Xms>","description":"<assessment vs 800ms threshold>","status":"<pass|warn|fail>"},{"title":"Word Count","value":"<X words>","description":"<depth assessment>","status":"<pass|warn|fail>"},{"title":"Canonical URL","value":"<Set|Missing>","description":"<detail>","status":"<pass|warn|fail>"}],"suggestions":[{"title":"<issue title>","priority":"<high|medium|low>","impact":"<High|Medium|Low> Impact","category":"<Technical|Content|Performance|UX|Schema|E-E-A-T|Social|Backlinks>","description":"<why this hurts ranking>","fix":"<exact CMS-specific steps to fix>","effort":"<Quick <30min|Medium 1-2hr|Advanced half-day+>","ranking_impact":"<Immediate|Short-term 1-4wks|Long-term 3mo+>"}],"metrics":[{"name":"<metric name>","value":"<value>","score":<0-100>,"status":"<pass|warn|fail>","benchmark":"<what good looks like>"}],"keywords":[{"title":"Target Keywords","value":"<kw1, kw2, kw3>","description":"From title+H1+meta","status":"info"},{"title":"Keyword in Title","value":"<Yes|No>","description":"Primary kw in title tag","status":"<pass|fail>"},{"title":"Keyword Density","value":"<X%>","description":"Ideal: 1-2%","status":"<pass|warn|fail>"},{"title":"LSI Keywords","value":"<terms>","description":"Add for topical authority","status":"info"},{"title":"Long-tail Opportunities","value":"<phrases>","description":"High-intent phrases","status":"info"},{"title":"Missing Keywords","value":"<terms>","description":"Absent but important","status":"warn"}],"schema_analysis":{"detected":[${JSON.stringify(pd.schema?.types||[])}],"missing":["<recommended schema>"],"priority_schema":"<most important to add>","implementation":"<exact CMS steps>"},"competitor_gaps":[{"opportunity":"<gap>","description":"<what top competitors have>","action":"<specific action>"}],"core_web_vitals":{"lcp_estimate":"<Good <2.5s|Needs Improvement 2.5-4s|Poor >4s>","fid_estimate":"<Good <100ms|Needs Improvement|Poor>","cls_estimate":"<Good <0.1|Needs Improvement|Poor>","ttfb_actual":${pd.ttfb||null},"recommendations":["<fix1>","<fix2>"]}}

Generate 8+ suggestions, 10+ metrics, 5+ competitor_gaps. Use real data. Return ONLY the JSON.`;

    // ── MODEL WATERFALL ────────────────────────────────────────
    // 8b is most reliable on CF Workers AI free tier.
    // 70b often hits rate limits & has larger context requirements.
    const MODELS = [
      '@cf/meta/llama-3.1-8b-instruct',
      '@cf/meta/llama-3.2-11b-vision-instruct',
      '@cf/mistral/mistral-7b-instruct-v0.1',
    ];

    let rawText = '';
    let lastErr = 'No models tried';

    for (const model of MODELS) {
      try {
        const res = await env.AI.run(model, {
          messages: [
            { role: 'system', content: 'You are an SEO expert. Output ONLY valid JSON. No markdown. No explanation. No code fences.' },
            { role: 'user',   content: prompt },
          ],
          max_tokens: 6000,
        });

        // Handle all known Cloudflare AI response shapes
        const candidate =
          (typeof res === 'string' && res) ||
          (res?.response  && typeof res.response  === 'string' && res.response)  ||
          (res?.choices?.[0]?.message?.content)                                  ||
          (res?.result?.response && typeof res.result.response === 'string' && res.result.response) ||
          '';

        if (candidate.trim()) { rawText = candidate; break; }
        lastErr = `${model}: empty/unexpected response shape (${JSON.stringify(res).slice(0,80)})`;
      } catch (e) {
        lastErr = `${model}: ${e.message}`;
      }
    }

    if (!rawText.trim()) {
      throw new Error(
        `All AI models returned empty responses. ${lastErr}. ` +
        `This usually means Workers AI is temporarily overloaded — please wait 30 seconds and try again.`
      );
    }

    // ── ROBUST JSON EXTRACTION + SANITIZATION ─────────────────
    // Root cause of "expected ',' or ']' at position 11761":
    // The AI writes unescaped double-quotes, newlines, or backticks
    // inside JSON string values (especially in "fix" and "description"
    // fields that contain code snippets). We sanitize these before parsing.
    let text = rawText.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();

    const start = text.indexOf('{');
    const end   = text.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON object in AI response. Raw: ' + text.slice(0, 200));

    let jsonStr = text.slice(start, end + 1);

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e1) {
      // ── SANITIZATION PASS ──────────────────────────────────
      // Fix the most common AI JSON corruption issues in order:
      try {
        let fixed = jsonStr
          // 1. Remove actual newlines/tabs inside string values
          //    (replace \r\n and \n that appear inside "..." with a space)
          .replace(/("(?:[^"\\]|\\.)*")|(\r?\n|\t)/g, (match, str, nl) => str ? str : ' ')
          // 2. Fix trailing commas before } or ]
          .replace(/,(\s*[}\]])/g, '$1')
          // 3. Fix unescaped backslashes (e.g. file paths like C:\Users)
          .replace(/(?<!\\)\\(?!["\\/bfnrtu])/g, '\\\\');

        parsed = JSON.parse(fixed);
      } catch (e2) {
        // ── AGGRESSIVE RECOVERY: line-by-line sanitizer ────────
        // Walk through each character, tracking whether we're inside a
        // JSON string, and escape any raw control chars we find.
        try {
          let out = '';
          let inStr = false;
          let escape = false;
          for (let i = 0; i < jsonStr.length; i++) {
            const ch = jsonStr[i];
            if (escape) { out += ch; escape = false; continue; }
            if (ch === '\\') { out += ch; escape = true; continue; }
            if (ch === '"') { inStr = !inStr; out += ch; continue; }
            if (inStr) {
              // Inside a string: escape raw control characters
              if (ch === '\n') { out += '\\n'; continue; }
              if (ch === '\r') { out += '\\r'; continue; }
              if (ch === '\t') { out += '\\t'; continue; }
            } else {
              // Outside a string: remove unexpected whitespace variants
              if (ch === '\n' || ch === '\r' || ch === '\t') { out += ' '; continue; }
            }
            out += ch;
          }
          // Also fix trailing commas after sanitizing
          out = out.replace(/,(\s*[}\]])/g, '$1');
          parsed = JSON.parse(out);
        } catch (e3) {
          throw new Error(`JSON parse failed after sanitization. Original error: ${e1.message}. Position hint: ${e1.message}`);
        }
      }
    }

    return new Response(JSON.stringify(parsed), { headers: CORS });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}
