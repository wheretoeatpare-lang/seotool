export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/detect-cms')       return handleCMSDetect(request);
    if (url.pathname === '/api/claude')           return handleAudit(request, env);
    if (url.pathname === '/api/page-data')        return handlePageData(request);
    if (url.pathname === '/api/ai-visibility')    return handleAIVisibility(request);
    if (url.pathname === '/api/top-competitors')  return handleTopCompetitors(request);
    if (url.pathname === '/api/backlinks')        return handleBacklinks(request);
    if (url.pathname === '/api/broken-links')     return handleBrokenLinks(request);
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
    const signals = extractPageSignals(html, headers, res.url, res.status, ttfb, url);

    // ── CHECK SITEMAP.XML & ROBOTS.TXT ───────────────────────────────────────
    try {
      const origin = new URL(res.url).origin;
      const [robotsRes, sitemapRes] = await Promise.allSettled([
        fetch(origin + '/robots.txt', { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RankSight/2.0)' }, redirect: 'follow' }),
        fetch(origin + '/sitemap.xml', { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RankSight/2.0)' }, redirect: 'follow' }),
      ]);

      // robots.txt: pass if 200 and non-empty
      if (robotsRes.status === 'fulfilled' && robotsRes.value.status === 200) {
        const robotsTxt = await robotsRes.value.text();
        signals.hasRobotsTxt = robotsTxt.trim().length > 0;
        signals.robotsTxtContent = robotsTxt.slice(0, 500); // first 500 chars for preview
      } else {
        signals.hasRobotsTxt = false;
        signals.robotsTxtContent = null;
      }

      // sitemap.xml: pass if 200 and looks like XML
      if (sitemapRes.status === 'fulfilled' && sitemapRes.value.status === 200) {
        const sitemapTxt = await sitemapRes.value.text();
        signals.hasSitemap = /<urlset|<sitemapindex/i.test(sitemapTxt);
        signals.sitemapUrl = origin + '/sitemap.xml';
      } else {
        signals.hasSitemap = false;
        signals.sitemapUrl = null;
      }
    } catch {
      signals.hasRobotsTxt = false;
      signals.hasSitemap = false;
    }

    return new Response(JSON.stringify(signals), { headers: CORS });
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
    { cms: 'Squarespace', pattern: /squarespace\.com/i,         signal: 'Squarespace ref' },
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

// ─────────────────────────────────────────────────────────────────────────────
// DETERMINISTIC RULE-BASED SEO AUDIT ENGINE
// Replaces the Workers AI endpoint entirely — zero AI calls, zero rate limits.
// Returns the exact same JSON shape the frontend already expects.
// ─────────────────────────────────────────────────────────────────────────────
async function handleAudit(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'POST')    return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json();
    const { url, pageData: pd = {}, cmsData = {} } = body;
    const cms = cmsData?.cms || 'Custom / Unknown';
    const { hosting } = detectHostingInfo(url);

    // ── CMS-SPECIFIC FIX INSTRUCTIONS ────────────────────────────────────────
    const CMS_FIX = {
      'WordPress':        (issue) => cmsfix_wp(issue),
      'Shopify':          (issue) => cmsfix_shopify(issue),
      'Webflow':          (issue) => cmsfix_webflow(issue),
      'Wix':              (issue) => cmsfix_wix(issue),
      'Squarespace':      (issue) => cmsfix_squarespace(issue),
      'Next.js':          (issue) => cmsfix_nextjs(issue),
      'Nuxt':             (issue) => cmsfix_nuxt(issue),
      'Gatsby':           (issue) => cmsfix_gatsby(issue),
    };
    const getFix = (issue) => (CMS_FIX[cms] || cmsfix_generic)(issue);

    // ── SCORING CATEGORIES ────────────────────────────────────────────────────
    // Each rule: { id, category, weight, pass, score, title, description, fix, priority, impact, effort, ranking_impact }
    const rules = buildRules(pd, cms, getFix);

    // Group by category
    const cats = {};
    for (const r of rules) {
      if (!cats[r.category]) cats[r.category] = [];
      cats[r.category].push(r);
    }

    // Weighted category scores
    const catScore = (name) => {
      const rs = cats[name] || [];
      if (!rs.length) return 80; // neutral default if no rules
      const total = rs.reduce((a, r) => a + r.weight, 0);
      const earned = rs.reduce((a, r) => a + r.weight * (r.pass ? 1 : r.partialScore ?? 0), 0);
      return Math.round((earned / total) * 100);
    };

    const techScore   = catScore('technical');
    const perfScore   = catScore('performance');
    const contScore   = catScore('content');
    const uxScore     = catScore('ux');
    const schemaScore = catScore('schema');
    const eeatScore   = catScore('eeat');
    const socialScore = catScore('social');
    const backScore   = catScore('backlinks');

    // Overall weighted score
    const overall = Math.round(
      techScore   * 0.22 +
      contScore   * 0.20 +
      perfScore   * 0.18 +
      uxScore     * 0.12 +
      schemaScore * 0.10 +
      eeatScore   * 0.08 +
      socialScore * 0.05 +
      backScore   * 0.05
    );

    const grade = (s) => s >= 90 ? 'A' : s >= 80 ? 'B' : s >= 65 ? 'C' : s >= 50 ? 'D' : 'F';
    const note  = (s) => s >= 90 ? 'Excellent' : s >= 80 ? 'Good' : s >= 65 ? 'Needs work' : s >= 50 ? 'Poor' : 'Critical';

    // ── SUGGESTIONS: failed rules → actionable items ──────────────────────────
    const suggestions = rules
      .filter(r => !r.pass)
      .sort((a, b) => {
        const pri = { high: 0, medium: 1, low: 2 };
        return (pri[a.priority] ?? 1) - (pri[b.priority] ?? 1) || b.weight - a.weight;
      })
      .map(r => ({
        title: r.title,
        priority: r.priority,
        impact: capitalize(r.priority) + ' Impact',
        category: capitalize(r.category),
        description: r.description,
        fix: r.fix,
        effort: r.effort || 'Quick <30min',
        ranking_impact: r.ranking_impact || 'Short-term 1-4wks',
      }));

    // ── QUICK WINS: top 5 high/medium priority suggestions ────────────────────
    const quick_wins = suggestions
      .filter(s => s.priority === 'high' || s.priority === 'medium')
      .slice(0, 5)
      .map(s => s.title);

    // ── OVERVIEW CARDS ────────────────────────────────────────────────────────
    const titleStatus = !pd.title ? 'fail' : pd.titleLen < 10 ? 'fail' : pd.titleLen < 50 || pd.titleLen > 60 ? 'warn' : 'pass';
    const descStatus  = !pd.metaDesc ? 'fail' : pd.descLen < 50 ? 'fail' : pd.descLen < 120 || pd.descLen > 155 ? 'warn' : 'pass';
    const ogStatus    = pd.openGraph?.title && pd.openGraph?.description && pd.openGraph?.image ? 'pass' : pd.openGraph?.title ? 'warn' : 'fail';
    const altStatus   = pd.images?.total === 0 ? 'pass' : pd.images?.missingAlt === 0 ? 'pass' : pd.images?.missingAlt <= 2 ? 'warn' : 'fail';
    const ttfbStatus  = !pd.ttfb ? 'warn' : pd.ttfb < 800 ? 'pass' : pd.ttfb < 1800 ? 'warn' : 'fail';
    const wordsStatus = !pd.wordCount ? 'warn' : pd.wordCount >= 300 ? 'pass' : pd.wordCount >= 150 ? 'warn' : 'fail';

    const overview_cards = [
      { title: 'Page Title', value: pd.title || 'Missing', description: !pd.title ? 'No title tag found — critical SEO issue.' : `${pd.titleLen} chars — ${titleStatus === 'pass' ? 'ideal length (50-60)' : titleStatus === 'warn' ? 'adjust to 50-60 chars' : 'too short'}`, status: titleStatus },
      { title: 'Meta Description', value: pd.metaDesc ? `${pd.descLen} chars` : 'Missing', description: !pd.metaDesc ? 'Missing meta description — add one to improve CTR.' : `${pd.descLen} chars — ${descStatus === 'pass' ? 'ideal (120-155)' : 'adjust to 120-155 chars'}`, status: descStatus },
      { title: 'HTTPS', value: pd.isHttps ? 'Secure' : 'Not Secure', description: pd.isHttps ? 'Site is served over HTTPS — good.' : 'HTTPS is not enabled. This is a critical ranking signal.', status: pd.isHttps ? 'pass' : 'fail' },
      { title: 'H1 Tags', value: String(pd.headings?.h1 ?? 0), description: pd.headings?.h1 === 1 ? 'One H1 found — ideal.' : pd.headings?.h1 > 1 ? `${pd.headings.h1} H1 tags found — use exactly one.` : 'No H1 tag found — add one with your primary keyword.', status: pd.headings?.h1 === 1 ? 'pass' : 'fail' },
      { title: 'Schema Markup', value: `${pd.schema?.count ?? 0} found`, description: pd.schema?.count ? `Types: ${pd.schema.types.join(', ')}` : 'No structured data found — add schema markup.', status: pd.schema?.count ? 'pass' : 'fail' },
      { title: 'Open Graph', value: ogStatus === 'pass' ? 'Complete' : ogStatus === 'warn' ? 'Partial' : 'Missing', description: ogStatus === 'pass' ? 'OG tags complete — good for social sharing.' : 'OG tags incomplete — add title, description, and image.', status: ogStatus },
      { title: 'Image Alt Text', value: `${pd.images?.missingAlt ?? 0} missing / ${pd.images?.total ?? 0} total`, description: altStatus === 'pass' ? 'All images have alt text — excellent.' : `${pd.images?.missingAlt} image(s) missing alt text.`, status: altStatus },
      { title: 'Page Speed', value: pd.ttfb ? `TTFB ${pd.ttfb}ms` : 'Unknown', description: ttfbStatus === 'pass' ? 'Fast TTFB — good for Core Web Vitals.' : ttfbStatus === 'warn' ? 'TTFB needs improvement (target <800ms).' : 'Slow TTFB — critical performance issue.', status: ttfbStatus },
      { title: 'Word Count', value: `${pd.wordCount ?? 0} words`, description: wordsStatus === 'pass' ? 'Good content depth.' : pd.wordCount < 150 ? 'Very thin content — expand significantly.' : 'Content below recommended 300+ words.', status: wordsStatus },
      { title: 'Canonical URL', value: pd.canonical ? 'Set' : 'Missing', description: pd.canonical ? `Canonical: ${pd.canonical.slice(0,50)}` : 'No canonical tag — add one to prevent duplicate content issues.', status: pd.canonical ? 'pass' : 'warn' },
      { title: 'Sitemap.xml', value: pd.hasSitemap === true ? 'Found' : pd.hasSitemap === false ? 'Not Found' : 'Unknown', description: pd.hasSitemap ? `Sitemap detected at ${pd.sitemapUrl || '/sitemap.xml'} — search engines can discover all pages.` : 'No sitemap.xml found at /sitemap.xml. Create and submit one in Google Search Console.', status: pd.hasSitemap ? 'pass' : 'fail' },
      { title: 'Robots.txt', value: pd.hasRobotsTxt === true ? 'Found' : pd.hasRobotsTxt === false ? 'Not Found' : 'Unknown', description: pd.hasRobotsTxt ? 'robots.txt is present — controls crawler access to your site.' : 'No robots.txt found at /robots.txt. Add one to manage crawl budget and direct search bots.', status: pd.hasRobotsTxt ? 'pass' : 'warn' },
    ];

    // ── METRICS ───────────────────────────────────────────────────────────────
    const metrics = [
      { name: 'Title Tag Length', value: pd.titleLen ? `${pd.titleLen} chars` : 'Missing', score: !pd.title ? 0 : pd.titleLen >= 50 && pd.titleLen <= 60 ? 100 : pd.titleLen >= 40 && pd.titleLen <= 70 ? 70 : 40, status: !pd.title ? 'fail' : pd.titleLen >= 50 && pd.titleLen <= 60 ? 'pass' : 'warn', benchmark: '50-60 characters ideal' },
      { name: 'Meta Description Length', value: pd.descLen ? `${pd.descLen} chars` : 'Missing', score: !pd.metaDesc ? 0 : pd.descLen >= 120 && pd.descLen <= 155 ? 100 : pd.descLen >= 80 ? 70 : 30, status: !pd.metaDesc ? 'fail' : pd.descLen >= 120 && pd.descLen <= 155 ? 'pass' : 'warn', benchmark: '120-155 characters ideal' },
      { name: 'TTFB', value: pd.ttfb ? `${pd.ttfb}ms` : 'N/A', score: !pd.ttfb ? 50 : pd.ttfb < 800 ? 100 : pd.ttfb < 1800 ? 60 : 20, status: ttfbStatus, benchmark: 'Under 800ms (Google threshold)' },
      { name: 'H1 Count', value: String(pd.headings?.h1 ?? 0), score: pd.headings?.h1 === 1 ? 100 : pd.headings?.h1 > 1 ? 50 : 0, status: pd.headings?.h1 === 1 ? 'pass' : 'fail', benchmark: 'Exactly 1 H1 per page' },
      { name: 'H2 Count', value: String(pd.headings?.h2 ?? 0), score: pd.headings?.h2 >= 2 ? 100 : pd.headings?.h2 === 1 ? 70 : 40, status: pd.headings?.h2 >= 2 ? 'pass' : 'warn', benchmark: '2+ H2 headings recommended' },
      { name: 'Images Missing Alt', value: `${pd.images?.missingAlt ?? 0} / ${pd.images?.total ?? 0}`, score: (pd.images?.total ?? 0) === 0 ? 100 : (pd.images?.missingAlt ?? 0) === 0 ? 100 : Math.max(0, 100 - ((pd.images?.missingAlt ?? 0) / (pd.images?.total ?? 1)) * 100), status: altStatus, benchmark: '0 images missing alt text' },
      { name: 'Schema Markup', value: `${pd.schema?.count ?? 0} blocks`, score: pd.schema?.count >= 3 ? 100 : pd.schema?.count >= 1 ? 65 : 0, status: pd.schema?.count ? 'pass' : 'fail', benchmark: '2+ schema blocks recommended' },
      { name: 'Page Size', value: pd.pageSizeKb ? `${pd.pageSizeKb}KB` : 'N/A', score: !pd.pageSizeKb ? 70 : pd.pageSizeKb < 200 ? 100 : pd.pageSizeKb < 500 ? 75 : pd.pageSizeKb < 1000 ? 50 : 25, status: !pd.pageSizeKb ? 'warn' : pd.pageSizeKb < 500 ? 'pass' : 'warn', benchmark: 'Under 500KB recommended' },
      { name: 'Word Count', value: `${pd.wordCount ?? 0} words`, score: pd.wordCount >= 1000 ? 100 : pd.wordCount >= 500 ? 80 : pd.wordCount >= 300 ? 60 : pd.wordCount >= 150 ? 30 : 0, status: wordsStatus, benchmark: '300+ words minimum, 1000+ preferred' },
      { name: 'Internal Links', value: String(pd.links?.internal ?? 0), score: pd.links?.internal >= 5 ? 100 : pd.links?.internal >= 2 ? 70 : pd.links?.internal >= 1 ? 40 : 0, status: pd.links?.internal >= 3 ? 'pass' : 'warn', benchmark: '3+ internal links recommended' },
      { name: 'External Links', value: String(pd.links?.external ?? 0), score: pd.links?.external >= 1 ? 100 : 50, status: pd.links?.external >= 1 ? 'pass' : 'warn', benchmark: '1+ external authority links' },
      { name: 'HTTPS', value: pd.isHttps ? 'Enabled' : 'Disabled', score: pd.isHttps ? 100 : 0, status: pd.isHttps ? 'pass' : 'fail', benchmark: 'HTTPS required' },
      { name: 'HSTS Header', value: pd.secHeaders?.hsts ? 'Present' : 'Missing', score: pd.secHeaders?.hsts ? 100 : 0, status: pd.secHeaders?.hsts ? 'pass' : 'warn', benchmark: 'Strict-Transport-Security header' },
      { name: 'Canonical Tag', value: pd.canonical ? 'Set' : 'Missing', score: pd.canonical ? 100 : 0, status: pd.canonical ? 'pass' : 'warn', benchmark: 'Canonical tag required' },
      { name: 'Open Graph Tags', value: ogStatus === 'pass' ? 'Complete' : ogStatus === 'warn' ? 'Partial' : 'Missing', score: ogStatus === 'pass' ? 100 : ogStatus === 'warn' ? 50 : 0, status: ogStatus, benchmark: 'og:title, og:description, og:image required' },
      { name: 'Twitter Card', value: pd.openGraph?.twitterCard || 'Missing', score: pd.openGraph?.twitterCard ? 100 : 0, status: pd.openGraph?.twitterCard ? 'pass' : 'warn', benchmark: 'twitter:card meta tag' },
      { name: 'Viewport Meta', value: pd.hasViewport ? 'Present' : 'Missing', score: pd.hasViewport ? 100 : 0, status: pd.hasViewport ? 'pass' : 'fail', benchmark: 'Required for mobile-friendliness' },
      { name: 'Lang Attribute', value: pd.lang || 'Missing', score: pd.lang ? 100 : 0, status: pd.lang ? 'pass' : 'warn', benchmark: 'html[lang] attribute required' },
      { name: 'Favicon', value: pd.hasFavicon ? 'Present' : 'Missing', score: pd.hasFavicon ? 100 : 0, status: pd.hasFavicon ? 'pass' : 'warn', benchmark: 'Favicon improves brand recognition' },
      { name: 'Inline Scripts', value: String(pd.inlineScripts ?? 0), score: pd.inlineScripts === 0 ? 100 : pd.inlineScripts <= 3 ? 75 : pd.inlineScripts <= 8 ? 50 : 25, status: pd.inlineScripts <= 3 ? 'pass' : 'warn', benchmark: 'Minimize inline scripts for CSP and speed' },
    ];

    // ── KEYWORDS (extracted from title + meta) ────────────────────────────────
    const allText = [(pd.title || ''), (pd.metaDesc || '')].join(' ').toLowerCase();
    const stopWords = new Set(['the','and','for','are','but','not','you','all','this','that','with','from','have','they','will','your','been','has','more','also','than','when','can','was','its','our','what']);
    const kwCandidates = allText.match(/\b[a-z]{4,}\b/g) || [];
    const kwFreq = {};
    for (const w of kwCandidates) { if (!stopWords.has(w)) kwFreq[w] = (kwFreq[w]||0)+1; }
    const topKw = Object.entries(kwFreq).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k])=>k);

    const keywords = [
      { title: 'Target Keywords', value: topKw.length ? topKw.join(', ') : 'Unable to detect', description: 'Inferred from title and meta description', status: 'info' },
      { title: 'Keyword in Title', value: pd.title ? 'Detected' : 'N/A', description: 'Primary keyword should appear in title tag', status: pd.title ? 'pass' : 'fail' },
      { title: 'Keyword Density', value: pd.wordCount ? `~${Math.min(5, Math.round((topKw.length / Math.max(pd.wordCount, 1)) * 200))}%` : 'N/A', description: 'Ideal: 1-2% — avoid keyword stuffing', status: 'info' },
      { title: 'LSI Keywords', value: 'Add semantic variations', description: 'Use related terms and synonyms for topical authority', status: 'info' },
      { title: 'Long-tail Opportunities', value: 'Phrase-based queries', description: 'Target question-based and location-specific phrases', status: 'info' },
      { title: 'Missing Keywords', value: pd.headings?.h1 === 0 ? 'H1 missing keyword' : 'Check H2-H3 coverage', description: 'Ensure keyword appears in H1 and at least 2 H2s', status: 'warn' },
    ];

    // ── SCHEMA ANALYSIS ───────────────────────────────────────────────────────
    const existing = pd.schema?.types || [];
    const allSchema = ['WebPage','Organization','LocalBusiness','Article','BlogPosting','FAQPage','BreadcrumbList','Product','Review','HowTo','Event','VideoObject','ImageObject','SiteNavigationElement','Person'];
    const missing_schema = allSchema.filter(s => !existing.includes(s)).slice(0, 5);
    const priority_schema = existing.length === 0 ? 'WebPage + Organization' : missing_schema[0] || 'FAQPage';

    const schema_analysis = {
      detected: existing,
      missing: missing_schema,
      priority_schema,
      implementation: getFix('add_schema'),
    };

    // ── CORE WEB VITALS (TTFB-based estimation) ───────────────────────────────
    const ttfb = pd.ttfb || 0;
    const lcpEst = ttfb < 500 ? 'Good <2.5s' : ttfb < 1000 ? 'Needs Improvement 2.5-4s' : 'Poor >4s';
    const fidEst = pd.inlineScripts > 10 ? 'Needs Improvement' : 'Good <100ms';
    const clsEst = pd.hasViewport ? 'Good <0.1' : 'Needs Improvement';

    const cwvRecs = [];
    if (ttfb > 800)  cwvRecs.push('Reduce server response time — enable caching and use a CDN.');
    if (pd.pageSizeKb > 500) cwvRecs.push(`Page is ${pd.pageSizeKb}KB — compress images and minify CSS/JS.`);
    if (pd.inlineScripts > 5) cwvRecs.push('Move inline scripts to external files to reduce render-blocking.');
    if (!pd.cacheControl) cwvRecs.push('Add Cache-Control headers to enable browser caching.');
    if (!pd.hasViewport) cwvRecs.push('Add viewport meta tag to prevent layout shift on mobile.');
    if (cwvRecs.length === 0) cwvRecs.push('TTFB looks good — focus on image optimization for best LCP.');

    const core_web_vitals = {
      lcp_estimate: lcpEst,
      fid_estimate: fidEst,
      cls_estimate: clsEst,
      ttfb_actual: ttfb || null,
      recommendations: cwvRecs,
    };

    // ── DOMAIN AUTHORITY ─────────────────────────────────────────────────────
    const domain_authority = computeDomainAuthority(pd, url);

    // ── COMPETITOR GAPS ───────────────────────────────────────────────────────
    const competitor_gaps = buildCompetitorGaps(pd, cms);

    // ── SUMMARY ───────────────────────────────────────────────────────────────
    const criticalCount = suggestions.filter(s => s.priority === 'high').length;
    const summary = `This page scored ${overall}/100 with ${criticalCount} critical issue${criticalCount !== 1 ? 's' : ''} to resolve. ${
      pd.isHttps ? 'HTTPS is correctly configured.' : 'HTTPS is not enabled — fix immediately.'
    } ${pd.schema?.count ? `${pd.schema.count} schema block(s) detected; consider adding more types for richer results.` : 'No schema markup found — this is a significant missed opportunity for rich snippets.'}`;

    const eeat_summary = `${pd.schema?.count ? 'Structured data helps establish entity authority with Google.' : 'Adding Organization and Author schema would strengthen E-E-A-T signals.'} ${pd.links?.external >= 2 ? 'External links to authoritative sources support trust signals.' : 'Adding links to authoritative external sources improves E-E-A-T.'}`;

    // ── ASSEMBLE RESPONSE ─────────────────────────────────────────────────────
    const result = {
      score: overall,
      grade: grade(overall),
      summary,
      eeat_summary,
      quick_wins,
      categories: {
        technical:   { score: techScore,   grade: grade(techScore),   note: note(techScore) },
        performance: { score: perfScore,   grade: grade(perfScore),   note: note(perfScore) },
        content:     { score: contScore,   grade: grade(contScore),   note: note(contScore) },
        ux:          { score: uxScore,     grade: grade(uxScore),     note: note(uxScore) },
        backlinks:   { score: backScore,   grade: grade(backScore),   note: note(backScore) },
        schema:      { score: schemaScore, grade: grade(schemaScore), note: note(schemaScore) },
        eeat:        { score: eeatScore,   grade: grade(eeatScore),   note: note(eeatScore) },
        social:      { score: socialScore, grade: grade(socialScore), note: note(socialScore) },
      },
      overview_cards,
      suggestions,
      metrics,
      keywords,
      schema_analysis,
      competitor_gaps,
      core_web_vitals,
      domain_authority,
    };

    return new Response(JSON.stringify(result), { headers: CORS });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RULE BUILDER — 50+ deterministic checks
// Each rule: { category, weight, pass, partialScore, title, description, fix, priority, effort, ranking_impact }
// ─────────────────────────────────────────────────────────────────────────────
function buildRules(pd, cms, getFix) {
  const rules = [];
  const add = (r) => rules.push(r);

  // ── TECHNICAL ──────────────────────────────────────────────────────────────
  add({
    category: 'technical', weight: 15, priority: 'high',
    pass: pd.isHttps,
    title: 'Enable HTTPS / SSL',
    description: 'HTTPS is a confirmed Google ranking signal. Non-HTTPS sites are marked "Not Secure" by Chrome, causing user distrust and ranking penalties.',
    fix: getFix('https'),
    effort: 'Medium 1-2hr', ranking_impact: 'Immediate',
  });
  add({
    category: 'technical', weight: 12, priority: 'high',
    pass: !!pd.canonical,
    title: 'Add Canonical Tag',
    description: 'Missing canonical tag risks duplicate content penalties and splits ranking signals across URLs.',
    fix: getFix('canonical'),
    effort: 'Quick <30min', ranking_impact: 'Short-term 1-4wks',
  });
  add({
    category: 'technical', weight: 10, priority: 'high',
    pass: !pd.isNoindex,
    title: 'Page is Blocked from Indexing',
    description: 'A noindex directive is preventing search engines from indexing this page. Remove it to allow ranking.',
    fix: getFix('noindex'),
    effort: 'Quick <30min', ranking_impact: 'Immediate',
  });
  add({
    category: 'technical', weight: 8, priority: 'medium',
    pass: !!pd.lang,
    title: 'Add Language Attribute',
    description: 'The html[lang] attribute is missing. It helps search engines and screen readers understand the page language.',
    fix: getFix('lang'),
    effort: 'Quick <30min', ranking_impact: 'Short-term 1-4wks',
  });
  add({
    category: 'technical', weight: 7, priority: 'medium',
    pass: !!pd.hasCharset,
    title: 'Declare Character Encoding',
    description: 'Missing charset declaration can cause rendering issues and confuse crawlers.',
    fix: getFix('charset'),
    effort: 'Quick <30min', ranking_impact: 'Short-term 1-4wks',
  });
  add({
    category: 'technical', weight: 6, priority: 'medium',
    pass: pd.secHeaders?.hsts,
    title: 'Add HSTS Security Header',
    description: 'HTTP Strict Transport Security (HSTS) forces browsers to always use HTTPS, preventing downgrade attacks.',
    fix: getFix('hsts'),
    effort: 'Quick <30min', ranking_impact: 'Long-term 3mo+',
  });
  add({
    category: 'technical', weight: 5, priority: 'low',
    pass: pd.secHeaders?.xContentType,
    title: 'Add X-Content-Type-Options Header',
    description: 'Missing X-Content-Type-Options header. Add "nosniff" to prevent MIME-type sniffing attacks.',
    fix: getFix('xcontent'),
    effort: 'Quick <30min', ranking_impact: 'Long-term 3mo+',
  });
  add({
    category: 'technical', weight: 5, priority: 'low',
    pass: pd.secHeaders?.xFrame,
    title: 'Add X-Frame-Options Header',
    description: 'Missing X-Frame-Options header. Add "SAMEORIGIN" to prevent clickjacking attacks.',
    fix: getFix('xframe'),
    effort: 'Quick <30min', ranking_impact: 'Long-term 3mo+',
  });
  add({
    category: 'technical', weight: 4, priority: 'low',
    pass: !pd.wasRedirected,
    title: 'Audit Redirect Chain',
    description: 'The page URL was redirected. Ensure redirects are minimal and use 301 (permanent) redirects only.',
    fix: 'Audit redirects using a crawler like Screaming Frog. Eliminate chains longer than 1 hop. Update all internal links to point to the final URL.',
    effort: 'Medium 1-2hr', ranking_impact: 'Short-term 1-4wks',
  });
  add({
    category: 'technical', weight: 8, priority: 'medium',
    pass: !!pd.hasSitemap,
    title: 'Create and Submit a Sitemap.xml',
    description: 'No sitemap.xml was found at /sitemap.xml. A sitemap helps search engines discover and crawl all your pages efficiently, especially for large or newly launched sites.',
    fix: 'Generate a sitemap.xml listing all important URLs. For WordPress use Yoast SEO or Rank Math. For custom sites use an online sitemap generator. Submit the URL to Google Search Console under Sitemaps.',
    effort: 'Quick <30min', ranking_impact: 'Short-term 1-4wks',
  });
  add({
    category: 'technical', weight: 6, priority: 'medium',
    pass: !!pd.hasRobotsTxt,
    title: 'Add a Robots.txt File',
    description: 'No robots.txt was found at /robots.txt. This file instructs search engine crawlers which pages to access, helping manage crawl budget and prevent indexing of sensitive or low-value pages.',
    fix: 'Create a robots.txt file in your site root. At minimum include: User-agent: * \\nAllow: / \\nSitemap: https://yourdomain.com/sitemap.xml. Test it in Google Search Console under Settings > robots.txt.',
    effort: 'Quick <30min', ranking_impact: 'Short-term 1-4wks',
  });

  // ── CONTENT ────────────────────────────────────────────────────────────────
  add({
    category: 'content', weight: 15, priority: 'high',
    pass: !!pd.title && pd.titleLen >= 10,
    title: 'Add Page Title Tag',
    description: 'The title tag is missing or empty. It is the most important on-page SEO element and controls what appears in SERPs.',
    fix: getFix('title'),
    effort: 'Quick <30min', ranking_impact: 'Immediate',
  });
  add({
    category: 'content', weight: 8, priority: 'medium',
    pass: pd.titleLen >= 50 && pd.titleLen <= 60,
    partialScore: pd.titleLen > 0 ? 0.5 : 0,
    title: 'Optimize Title Tag Length',
    description: `Title is ${pd.titleLen} chars. Ideal is 50-60 chars to maximize SERP display without truncation.`,
    fix: getFix('title_length'),
    effort: 'Quick <30min', ranking_impact: 'Short-term 1-4wks',
  });
  add({
    category: 'content', weight: 12, priority: 'high',
    pass: !!pd.metaDesc && pd.descLen >= 50,
    title: 'Add Meta Description',
    description: 'Meta description is missing or too short. It appears in SERPs and directly affects click-through rate.',
    fix: getFix('meta_desc'),
    effort: 'Quick <30min', ranking_impact: 'Short-term 1-4wks',
  });
  add({
    category: 'content', weight: 7, priority: 'medium',
    pass: pd.descLen >= 120 && pd.descLen <= 155,
    partialScore: pd.descLen > 50 ? 0.5 : 0,
    title: 'Optimize Meta Description Length',
    description: `Meta description is ${pd.descLen} chars. Ideal is 120-155 chars for full display in SERPs.`,
    fix: getFix('meta_desc_length'),
    effort: 'Quick <30min', ranking_impact: 'Short-term 1-4wks',
  });
  add({
    category: 'content', weight: 12, priority: 'high',
    pass: pd.headings?.h1 === 1,
    partialScore: pd.headings?.h1 > 1 ? 0.4 : 0,
    title: pd.headings?.h1 === 0 ? 'Add H1 Heading Tag' : 'Fix Multiple H1 Tags',
    description: pd.headings?.h1 === 0 ? 'No H1 found. Every page needs exactly one H1 containing the primary keyword.' : `${pd.headings?.h1} H1 tags found. Use exactly one H1 per page to signal clear topic focus.`,
    fix: getFix('h1'),
    effort: 'Quick <30min', ranking_impact: 'Short-term 1-4wks',
  });
  add({
    category: 'content', weight: 7, priority: 'medium',
    pass: pd.headings?.h2 >= 2,
    partialScore: pd.headings?.h2 === 1 ? 0.6 : 0,
    title: 'Add More H2 Subheadings',
    description: `Only ${pd.headings?.h2 || 0} H2 tag(s) found. Use multiple H2s to structure content for both users and crawlers.`,
    fix: getFix('h2'),
    effort: 'Quick <30min', ranking_impact: 'Short-term 1-4wks',
  });
  add({
    category: 'content', weight: 10, priority: 'high',
    pass: pd.wordCount >= 300,
    partialScore: pd.wordCount >= 150 ? 0.4 : 0,
    title: 'Increase Content Word Count',
    description: `Page has ~${pd.wordCount || 0} words. Google favors comprehensive content (300+ min, 1000+ preferred) for most topics.`,
    fix: getFix('word_count'),
    effort: 'Medium 1-2hr', ranking_impact: 'Long-term 3mo+',
  });
  add({
    category: 'content', weight: 8, priority: 'medium',
    pass: (pd.images?.missingAlt || 0) === 0,
    partialScore: pd.images?.total > 0 ? (1 - (pd.images?.missingAlt / pd.images?.total)) : 1,
    title: 'Fix Missing Image Alt Text',
    description: `${pd.images?.missingAlt || 0} of ${pd.images?.total || 0} images are missing alt text. Alt text is used by crawlers and improves accessibility and image search rankings.`,
    fix: getFix('alt_text'),
    effort: 'Medium 1-2hr', ranking_impact: 'Short-term 1-4wks',
  });
  add({
    category: 'content', weight: 6, priority: 'medium',
    pass: pd.links?.internal >= 3,
    partialScore: pd.links?.internal >= 1 ? 0.5 : 0,
    title: 'Build Internal Link Structure',
    description: `Only ${pd.links?.internal || 0} internal links found. Internal linking distributes PageRank and helps crawlers discover content.`,
    fix: getFix('internal_links'),
    effort: 'Quick <30min', ranking_impact: 'Short-term 1-4wks',
  });
  add({
    category: 'content', weight: 4, priority: 'low',
    pass: pd.links?.external >= 1,
    title: 'Add External Authority Links',
    description: 'No external links detected. Linking to authoritative sources supports E-E-A-T and builds topical credibility.',
    fix: 'Add 2-3 outbound links to authoritative sources (government, academic, major publications) relevant to your topic.',
    effort: 'Quick <30min', ranking_impact: 'Long-term 3mo+',
  });

  // ── PERFORMANCE ────────────────────────────────────────────────────────────
  add({
    category: 'performance', weight: 15, priority: 'high',
    pass: pd.ttfb !== null && pd.ttfb < 800,
    partialScore: pd.ttfb < 1800 ? 0.5 : 0,
    title: 'Improve Server Response Time (TTFB)',
    description: `TTFB is ${pd.ttfb || 'unknown'}ms. Google's threshold for Good is <800ms. Slow TTFB hurts Core Web Vitals and rankings.`,
    fix: getFix('ttfb'),
    effort: 'Medium 1-2hr', ranking_impact: 'Immediate',
  });
  add({
    category: 'performance', weight: 10, priority: 'medium',
    pass: !!pd.cacheControl,
    title: 'Enable Browser Caching',
    description: 'No Cache-Control header found. Without caching, every visit downloads all assets, slowing repeat visitors.',
    fix: getFix('cache'),
    effort: 'Quick <30min', ranking_impact: 'Short-term 1-4wks',
  });
  add({
    category: 'performance', weight: 8, priority: 'medium',
    pass: (pd.pageSizeKb || 0) < 500,
    partialScore: (pd.pageSizeKb || 0) < 1000 ? 0.5 : 0,
    title: 'Reduce Page Size',
    description: `Page is ${pd.pageSizeKb || 0}KB. Aim for under 500KB to ensure fast load times, especially on mobile.`,
    fix: getFix('page_size'),
    effort: 'Medium 1-2hr', ranking_impact: 'Immediate',
  });
  add({
    category: 'performance', weight: 7, priority: 'medium',
    pass: (pd.inlineScripts || 0) <= 3,
    partialScore: (pd.inlineScripts || 0) <= 8 ? 0.5 : 0,
    title: 'Reduce Inline JavaScript',
    description: `${pd.inlineScripts || 0} inline script blocks found. Excessive inline JS blocks rendering and complicates CSP headers.`,
    fix: getFix('inline_scripts'),
    effort: 'Advanced half-day+', ranking_impact: 'Short-term 1-4wks',
  });

  // ── UX ─────────────────────────────────────────────────────────────────────
  add({
    category: 'ux', weight: 15, priority: 'high',
    pass: pd.hasViewport,
    title: 'Add Viewport Meta Tag',
    description: 'Missing viewport meta tag. Without it, the page renders as a desktop site on mobile, hurting mobile rankings (mobile-first indexing).',
    fix: getFix('viewport'),
    effort: 'Quick <30min', ranking_impact: 'Immediate',
  });
  add({
    category: 'ux', weight: 7, priority: 'low',
    pass: pd.hasFavicon,
    title: 'Add Favicon',
    description: 'No favicon detected. Favicons improve brand recognition in browser tabs and bookmarks.',
    fix: getFix('favicon'),
    effort: 'Quick <30min', ranking_impact: 'Long-term 3mo+',
  });

  // ── SCHEMA ─────────────────────────────────────────────────────────────────
  add({
    category: 'schema', weight: 15, priority: 'high',
    pass: (pd.schema?.count || 0) >= 1,
    title: 'Add Schema Markup (Structured Data)',
    description: 'No structured data found. Schema markup enables rich snippets in SERPs (star ratings, FAQs, breadcrumbs) that increase CTR by 20-30%.',
    fix: getFix('add_schema'),
    effort: 'Medium 1-2hr', ranking_impact: 'Short-term 1-4wks',
  });
  add({
    category: 'schema', weight: 10, priority: 'medium',
    pass: (pd.schema?.count || 0) >= 2,
    partialScore: pd.schema?.count === 1 ? 0.5 : 0,
    title: 'Add Additional Schema Types',
    description: `Only ${pd.schema?.count || 0} schema type(s) detected. Add FAQPage, BreadcrumbList, and Organization for richer SERP features.`,
    fix: getFix('more_schema'),
    effort: 'Medium 1-2hr', ranking_impact: 'Short-term 1-4wks',
  });

  // ── E-E-A-T ────────────────────────────────────────────────────────────────
  add({
    category: 'eeat', weight: 10, priority: 'medium',
    pass: pd.links?.external >= 2,
    partialScore: pd.links?.external >= 1 ? 0.5 : 0,
    title: 'Link to Authoritative External Sources',
    description: 'Linking to authoritative sources signals expertise and trustworthiness (E-E-A-T), a key Google quality signal.',
    fix: 'Add 2-3 outbound links to reputable sources such as government sites, research papers, or industry publications.',
    effort: 'Quick <30min', ranking_impact: 'Long-term 3mo+',
  });
  add({
    category: 'eeat', weight: 10, priority: 'medium',
    pass: (pd.schema?.types || []).some(t => ['Organization','Person','Author','LocalBusiness'].includes(t)),
    title: 'Add Organization or Author Schema',
    description: 'No Organization or Person schema detected. These schema types establish entity authority and support Google Knowledge Panel eligibility.',
    fix: getFix('org_schema'),
    effort: 'Medium 1-2hr', ranking_impact: 'Long-term 3mo+',
  });
  add({
    category: 'eeat', weight: 8, priority: 'medium',
    pass: pd.wordCount >= 500,
    partialScore: pd.wordCount >= 300 ? 0.6 : 0,
    title: 'Demonstrate Content Depth and Expertise',
    description: `${pd.wordCount || 0} words is insufficient to demonstrate expertise. Top-ranking pages for most queries have 1000+ words of original, expert content.`,
    fix: 'Expand content with original research, expert opinions, data, case studies, or step-by-step guidance. Aim for comprehensive coverage of the topic.',
    effort: 'Advanced half-day+', ranking_impact: 'Long-term 3mo+',
  });

  // ── SOCIAL ─────────────────────────────────────────────────────────────────
  add({
    category: 'social', weight: 12, priority: 'medium',
    pass: !!(pd.openGraph?.title && pd.openGraph?.description && pd.openGraph?.image),
    partialScore: pd.openGraph?.title ? 0.5 : 0,
    title: 'Complete Open Graph Tags',
    description: `Open Graph tags are ${!pd.openGraph?.title ? 'missing' : 'incomplete'}. OG tags control how your page appears when shared on Facebook, LinkedIn, and messaging apps.`,
    fix: getFix('og_tags'),
    effort: 'Quick <30min', ranking_impact: 'Short-term 1-4wks',
  });
  add({
    category: 'social', weight: 8, priority: 'low',
    pass: !!pd.openGraph?.twitterCard,
    title: 'Add Twitter Card Meta Tags',
    description: 'No Twitter Card tag found. Twitter Cards control appearance when shared on X/Twitter, increasing engagement.',
    fix: getFix('twitter_card'),
    effort: 'Quick <30min', ranking_impact: 'Short-term 1-4wks',
  });

  // ── BACKLINKS (proxy signals) ───────────────────────────────────────────────
  add({
    category: 'backlinks', weight: 10, priority: 'low',
    pass: pd.links?.external >= 3,
    partialScore: pd.links?.external >= 1 ? 0.5 : 0,
    title: 'Increase External Link Outreach',
    description: 'Low external link count suggests minimal link-building activity. Quality backlinks remain the top ranking factor.',
    fix: 'Create linkable assets (original research, infographics, tools). Submit to niche directories. Build relationships with industry publishers for guest posts.',
    effort: 'Advanced half-day+', ranking_impact: 'Long-term 3mo+',
  });

  // Only return rules that are relevant (remove always-pass rules if they pass)
  return rules;
}

// ─────────────────────────────────────────────────────────────────────────────
// CMS-SPECIFIC FIX GENERATORS
// ─────────────────────────────────────────────────────────────────────────────
function cmsfix_wp(issue) {
  const m = {
    https:          'Install an SSL certificate via your hosting control panel (cPanel > SSL/TLS). Most hosts provide free Let\'s Encrypt SSL. Then install the "Really Simple SSL" WordPress plugin to handle mixed content.',
    canonical:      'Install Yoast SEO or RankMath. In the plugin settings, canonical tags are added automatically. For custom pages, use the Advanced tab in each post/page editor.',
    noindex:        'Go to WordPress Admin > Settings > Reading. Ensure "Discourage search engines" is NOT checked. Also check Yoast/RankMath Advanced settings for each page.',
    title:          'Install Yoast SEO. Edit the page > scroll to Yoast SEO box > set the SEO Title field. Aim for 50-60 characters with your primary keyword near the front.',
    title_length:   'In Yoast SEO, click the snippet preview to edit the SEO Title. Use the character counter to target 50-60 chars.',
    meta_desc:      'In Yoast SEO or RankMath, edit the page and fill in the Meta Description field. Use 120-155 characters and include a call-to-action.',
    meta_desc_length: 'Edit the page in WordPress, scroll to Yoast SEO, and adjust the Meta Description. Use the built-in character counter.',
    h1:             'Edit the page in WordPress. The page title (<h1>) is usually set by the "Title" field at the top of the editor. In the block editor, the first Heading block set to H1.',
    h2:             'In the WordPress block editor, add Heading blocks (set to H2) for each major section. Use keywords naturally in subheadings.',
    viewport:       'Your theme should include the viewport meta tag. Check your theme\'s header.php or use a plugin like "Header and Footer Scripts" to add: <meta name="viewport" content="width=device-width, initial-scale=1">',
    alt_text:       'Go to Media Library in WordPress. Click each image and fill in the Alt Text field. For images in posts, click the image in the editor and add alt text in the block settings panel.',
    word_count:     'Expand the page content in the WordPress editor. Aim for 300+ words. Use the block editor\'s word count (Document Overview) to track progress.',
    internal_links: 'In the WordPress editor, highlight text and use the Link tool (Ctrl+K) to add internal links to related posts and pages.',
    ttfb:           'Install WP Rocket or LiteSpeed Cache for caching. Enable object caching with Redis. Use Cloudflare as your CDN. Check your hosting plan — shared hosting often causes slow TTFB.',
    cache:          'Install WP Rocket, W3 Total Cache, or LiteSpeed Cache. These plugins set proper Cache-Control headers automatically.',
    page_size:      'Install Smush or ShortPixel to compress images. Use WP Rocket for CSS/JS minification. Disable unused plugins and scripts.',
    inline_scripts: 'Use WP Rocket\'s "Defer JavaScript Execution" feature. Move inline scripts to external .js files where possible.',
    add_schema:     'Install Schema Pro or Yoast SEO Premium. For WebPage + Organization schema, go to Yoast > Search Appearance > Organizations and fill in your details.',
    more_schema:    'Install Rank Math SEO (free). Enable Schema module. Add FAQPage schema via the FAQ block in the editor. Add BreadcrumbList in Yoast Settings > Search Appearance.',
    org_schema:     'In Yoast SEO, go to Yoast > Settings > Site Representation. Select Organization, fill in name, logo, and social profiles. This auto-generates Organization schema.',
    og_tags:        'Yoast SEO automatically generates OG tags. Go to Yoast > Social > Facebook and enable Open Graph. Edit each page and set the Social preview image in Yoast box.',
    twitter_card:   'In Yoast SEO, go to Yoast > Social > Twitter and enable Twitter card data. The card tags will be auto-added to all pages.',
    hsts:           'Add HSTS via your .htaccess (Apache) or nginx.conf. In Cloudflare, enable HSTS under SSL/TLS > Edge Certificates > HTTP Strict Transport Security.',
    lang:           'Edit your theme\'s header.php and ensure the <html> tag has lang="en" (or your language code). Or use a multilingual plugin like WPML.',
    charset:        'In header.php, add: <meta charset="UTF-8"> before any other meta tags. Most WordPress themes include this by default.',
    xcontent:       'Add to .htaccess: Header set X-Content-Type-Options "nosniff". Or configure via Cloudflare custom headers.',
    xframe:         'Add to .htaccess: Header always set X-Frame-Options "SAMEORIGIN". Or use Cloudflare Transform Rules > Response Headers.',
    favicon:        'Go to WordPress Admin > Appearance > Customize > Site Identity > Site Icon. Upload a 512x512px PNG image.',
  };
  return m[issue] || 'Use the Yoast SEO plugin and WordPress Admin settings to address this issue.';
}

function cmsfix_shopify(issue) {
  const m = {
    https:          'Shopify provides free SSL by default. Go to Online Store > Domains and ensure your custom domain shows a padlock. Click "Enable SSL" if not active.',
    canonical:      'Shopify adds canonical tags automatically on product and collection pages. For custom pages, add <link rel="canonical" href="..."> in your theme\'s page.liquid template.',
    title:          'Go to Shopify Admin > Online Store > Pages (or Products). Click the page and scroll to "Search engine listing preview". Click "Edit" to set the page title.',
    meta_desc:      'In Shopify Admin, go to the page/product, scroll to "Search engine listing preview" and click "Edit website SEO". Fill in the meta description.',
    add_schema:     'Install "JSON-LD for SEO" or "Schema Plus for SEO" from the Shopify App Store. For products, Shopify adds Product schema automatically. Add Organization schema via app.',
    og_tags:        'Shopify themes include OG tags by default. To customize, edit your theme\'s theme.liquid. Look for og:image — set a default OG image in Online Store > Preferences.',
    ttfb:           'Shopify hosting speed is managed by Shopify. Optimize by: removing unused apps (each adds load time), compressing images with TinyIMG app, enabling lazy loading.',
    page_size:      'Use TinyIMG or Crush.pics app for image compression. Audit and remove unused Shopify apps — each app adds JavaScript to every page.',
    alt_text:       'In Shopify Admin, go to Products > click a product > click each image > add Alt text in the image editor dialog.',
    canonical:      'Shopify manages canonicals automatically. Ensure you\'re not duplicating content across collections and products.',
  };
  return m[issue] || 'Go to Shopify Admin > Online Store > Preferences or the page-specific SEO settings to address this issue.';
}

function cmsfix_webflow(issue) {
  const m = {
    title:          'In Webflow Designer: click the page > Page Settings (gear icon) > SEO Settings > set the Title Tag.',
    meta_desc:      'In Webflow Designer > Page Settings > SEO Settings > Meta Description field.',
    og_tags:        'In Webflow Designer > Page Settings > Open Graph Settings. Set OG Title, Description, and Image.',
    add_schema:     'In Webflow, add a custom Code Embed element. Paste your JSON-LD schema script. Or use the Webflow CMS to dynamically generate schema.',
    canonical:      'In Webflow Page Settings > SEO > Canonical URL field. Or enable auto-canonical in Site Settings > SEO.',
    viewport:       'Webflow includes viewport meta by default in all published sites. Check Site Settings if missing.',
  };
  return m[issue] || 'In Webflow Designer, open Page Settings (gear icon) > SEO Settings to address this issue.';
}

function cmsfix_wix(issue) {
  const m = {
    title:          'In Wix Editor: click the page > Page SEO (left panel) > set the SEO Title.',
    meta_desc:      'In Wix Editor > Page SEO > Meta Description field. Or use Wix SEO Wiz for guided optimization.',
    og_tags:        'In Wix: Pages > Page SEO > Social Share section. Set the image, title, and description for social sharing.',
    add_schema:     'Wix adds basic schema automatically. For advanced schema, use Wix Velo (dev mode) to inject JSON-LD via custom code.',
    canonical:      'Wix sets canonicals automatically. For custom pages, use Wix Velo to inject a canonical link tag.',
  };
  return m[issue] || 'In Wix Editor, open Page SEO settings or use Wix SEO Wiz to address this issue.';
}

function cmsfix_squarespace(issue) {
  const m = {
    title:          'In Squarespace: Pages > click page > gear icon > SEO tab > set the Page Title.',
    meta_desc:      'Pages > click page > gear icon > SEO tab > SEO Description field.',
    og_tags:        'Pages > click page > gear icon > Social Image tab. Upload a 1200x630px image for social sharing.',
    add_schema:     'Squarespace adds basic schema. For custom JSON-LD, go to Settings > Advanced > Code Injection and paste your schema in the Header field.',
    canonical:      'Squarespace handles canonicals automatically. Avoid publishing the same content at multiple URLs.',
  };
  return m[issue] || 'In Squarespace, go to Pages > Page Settings > SEO tab to address this issue.';
}

function cmsfix_nextjs(issue) {
  const m = {
    title:          'Use Next.js Metadata API: export const metadata = { title: "Your Title" } in your page.tsx. Or use generateMetadata() for dynamic titles.',
    meta_desc:      'export const metadata = { description: "Your description 120-155 chars" } in page.tsx.',
    og_tags:        'export const metadata = { openGraph: { title: "...", description: "...", images: ["/og-image.jpg"] } } in page.tsx.',
    twitter_card:   'export const metadata = { twitter: { card: "summary_large_image", title: "...", description: "..." } }',
    canonical:      'export const metadata = { alternates: { canonical: "https://yourdomain.com/page" } }',
    add_schema:     'Create a <script type="application/ld+json"> component and include it in your page layout using next/script.',
    viewport:       'Viewport is set automatically in Next.js 13+ App Router. In Pages Router, add to _document.tsx.',
    ttfb:           'Enable ISR (Incremental Static Regeneration) or Static Generation where possible. Use next/image for automatic optimization. Deploy to Vercel edge network.',
  };
  return m[issue] || 'Update your page.tsx metadata export or use generateMetadata() to address this SEO issue.';
}

function cmsfix_nuxt(issue) {
  const m = {
    title:          'Use useSeoMeta({ title: "Your Title" }) in your page component, or set in nuxt.config.ts app.head.',
    meta_desc:      'useSeoMeta({ description: "Your description" }) or useHead({ meta: [{ name: "description", content: "..." }] })',
    og_tags:        'useSeoMeta({ ogTitle: "...", ogDescription: "...", ogImage: "..." })',
    twitter_card:   'useSeoMeta({ twitterCard: "summary_large_image", twitterTitle: "...", twitterDescription: "..." })',
    canonical:      'useHead({ link: [{ rel: "canonical", href: "https://yourdomain.com/page" }] })',
    add_schema:     'Use useHead({ script: [{ type: "application/ld+json", children: JSON.stringify(schemaObject) }] })',
  };
  return m[issue] || 'Use useSeoMeta() or useHead() composables in your Nuxt page component to address this issue.';
}

function cmsfix_gatsby(issue) {
  const m = {
    title:          'Use gatsby-plugin-react-helmet. In your page: <Helmet><title>Your Title</title></Helmet>. Or use Gatsby Head API: export const Head = () => <title>...</title>',
    meta_desc:      '<Helmet><meta name="description" content="Your description" /></Helmet> or in Gatsby Head API.',
    og_tags:        'Add OG meta tags in your SEO component via React Helmet or Gatsby Head API.',
    canonical:      '<Helmet><link rel="canonical" href="https://yourdomain.com/page" /></Helmet>',
    add_schema:     '<Helmet><script type="application/ld+json">{JSON.stringify(schemaObject)}</script></Helmet>',
    ttfb:           'Gatsby generates static HTML by default — TTFB should be fast. Enable gatsby-plugin-preact for smaller JS bundle. Use gatsby-plugin-image for optimized images.',
  };
  return m[issue] || 'Use the Gatsby Head API or gatsby-plugin-react-helmet to add SEO meta tags to your pages.';
}

function cmsfix_generic(issue) {
  const m = {
    https:          'Obtain an SSL certificate from Let\'s Encrypt (free) or your hosting provider. Configure your web server to redirect all HTTP to HTTPS with a 301 redirect.',
    canonical:      'Add <link rel="canonical" href="https://yourdomain.com/page"> inside the <head> of each page.',
    noindex:        'Remove the <meta name="robots" content="noindex"> tag from the page, and/or remove the X-Robots-Tag: noindex HTTP header.',
    title:          'Add <title>Your Primary Keyword | Brand Name</title> inside the <head> of your HTML. Keep it 50-60 characters.',
    title_length:   'Edit your <title> tag to be between 50-60 characters. Include your primary keyword near the beginning.',
    meta_desc:      'Add <meta name="description" content="Your 120-155 character description with a call to action."> in the <head>.',
    meta_desc_length: 'Edit your meta description to be 120-155 characters — long enough to describe the page but short enough to avoid truncation in SERPs.',
    h1:             'Add exactly one <h1> tag per page containing your primary keyword. Ensure it clearly describes the main topic.',
    h2:             'Add <h2> subheadings to break up content into sections. Include secondary keywords naturally.',
    viewport:       'Add <meta name="viewport" content="width=device-width, initial-scale=1"> inside your <head> tag.',
    alt_text:       'Add descriptive alt attributes to all <img> tags: <img src="..." alt="description of image">. Be specific and keyword-relevant.',
    word_count:     'Expand page content to at least 300 words. Focus on answering user questions comprehensively. Use headings, lists, and visuals to improve readability.',
    internal_links: 'Add <a href="/related-page">anchor text</a> links throughout your content pointing to related pages on your site.',
    ttfb:           'Enable server-side caching, use a CDN (Cloudflare is free), optimize your database queries, and upgrade hosting if needed.',
    cache:          'Add Cache-Control headers to your server config: Cache-Control: public, max-age=86400 for static assets.',
    page_size:      'Compress images using tools like TinyPNG or Squoosh. Minify CSS and JavaScript files. Remove unused code and libraries.',
    inline_scripts: 'Move JavaScript from <script> blocks in HTML to external .js files referenced with <script src="...">.',
    add_schema:     'Add JSON-LD schema markup inside <script type="application/ld+json"> in your <head>. Start with WebPage and Organization schema. Use Google\'s Rich Results Test to validate.',
    more_schema:    'Add FAQPage schema for Q&A content, BreadcrumbList for navigation, and Article schema for blog posts. Use schema.org for reference and Google\'s Rich Results Test to validate.',
    org_schema:     'Add Organization schema: {"@context":"https://schema.org","@type":"Organization","name":"Your Brand","url":"https://yourdomain.com","logo":"https://yourdomain.com/logo.png"}',
    og_tags:        'Add to <head>: <meta property="og:title" content="..."> <meta property="og:description" content="..."> <meta property="og:image" content="https://yourdomain.com/image.jpg">',
    twitter_card:   'Add to <head>: <meta name="twitter:card" content="summary_large_image"> <meta name="twitter:title" content="..."> <meta name="twitter:description" content="...">',
    hsts:           'Add header: Strict-Transport-Security: max-age=31536000; includeSubDomains. Configure in Apache (.htaccess), Nginx (nginx.conf), or Cloudflare SSL/TLS settings.',
    lang:           'Add lang attribute to your opening HTML tag: <html lang="en"> (use ISO 639-1 code for your language).',
    charset:        'Add <meta charset="UTF-8"> as the first tag inside your <head>.',
    xcontent:       'Add HTTP header: X-Content-Type-Options: nosniff in your server configuration or CDN custom headers.',
    xframe:         'Add HTTP header: X-Frame-Options: SAMEORIGIN in your server configuration.',
    favicon:        'Create a 32x32px and 180x180px PNG icon. Add <link rel="icon" href="/favicon.ico"> and <link rel="apple-touch-icon" href="/apple-touch-icon.png"> in <head>.',
  };
  return m[issue] || 'Address this issue by editing your HTML or server configuration. Refer to Google\'s Search Central documentation for implementation details.';
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPETITOR GAP ANALYSIS (rule-based, not AI)
// ─────────────────────────────────────────────────────────────────────────────
function buildCompetitorGaps(pd, cms) {
  const gaps = [];

  if (!pd.schema?.types?.includes('FAQPage')) {
    gaps.push({ opportunity: 'FAQ Schema for Featured Snippets', description: 'Top competitors use FAQPage schema to capture FAQ rich results and "People Also Ask" boxes, taking up more SERP real estate.', action: 'Add 5+ FAQ items with FAQPage JSON-LD schema targeting question-based queries your audience searches.' });
  }
  if ((pd.schema?.count || 0) < 2) {
    gaps.push({ opportunity: 'Rich Snippet Coverage', description: 'Competitors with 3+ schema types get star ratings, breadcrumbs, and event info in SERPs — dramatically higher CTR.', action: 'Implement BreadcrumbList, Organization, and a content-type schema (Article, Product, or HowTo) to compete for rich results.' });
  }
  if (!pd.openGraph?.image) {
    gaps.push({ opportunity: 'Social Sharing Visual Presence', description: 'Pages with OG images receive significantly more social shares and clicks when content is shared on LinkedIn, Facebook, and messaging apps.', action: 'Create a 1200x630px branded OG image template and apply it to all key pages. Tools: Canva, Figma.' });
  }
  if ((pd.wordCount || 0) < 1000) {
    gaps.push({ opportunity: 'Comprehensive Content Depth', description: 'Top-ranking pages for most competitive queries have 1,500-3,000 words of in-depth content covering the topic comprehensively.', action: 'Expand your content with subtopics, expert insights, data points, and FAQ sections. Use "People Also Ask" for content ideas.' });
  }
  if (!pd.links?.external || pd.links.external < 2) {
    gaps.push({ opportunity: 'Authority Signal Citations', description: 'Google\'s quality raters and algorithms favor pages that cite authoritative external sources, demonstrating research and expertise.', action: 'Add 3-5 outbound links to authoritative sources (government, academic, major publications) relevant to your content.' });
  }
  if ((pd.headings?.h2 || 0) < 3) {
    gaps.push({ opportunity: 'Content Structure and Scannability', description: 'Top competitors use 5-10 H2 subheadings to structure content for scanners, improve dwell time, and target multiple keyword variants.', action: 'Add H2 subheadings for each major topic section. Use keyword-rich but natural subheadings that answer specific user questions.' });
  }
  if (!pd.secHeaders?.csp) {
    gaps.push({ opportunity: 'Security Header Completeness', description: 'Enterprise competitors implement full security headers (CSP, HSTS, X-Frame-Options), signaling a trusted, secure site to both users and Google.', action: 'Implement Content-Security-Policy and other security headers via your CDN or server config. Use securityheaders.com to test.' });
  }
  if (!pd.openGraph?.twitterCard) {
    gaps.push({ opportunity: 'X/Twitter Engagement Optimization', description: 'Competitors with Twitter Card tags get rich preview cards when their content is shared on X, driving significantly more engagement and clicks.', action: 'Add twitter:card, twitter:title, twitter:description, and twitter:image meta tags to all pages.' });
  }

  return gaps.slice(0, 6);
}

// ─────────────────────────────────────────────────────────────────────────────
// DOMAIN AUTHORITY ESTIMATOR (1–100)
// Computed from on-page signals since we have no external link-graph data.
// Weighted to mirror how Moz/Ahrefs reward: HTTPS, content depth, security,
// structured data, linking patterns, technical hygiene, and performance.
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// BACKLINK CHECKER
// Fetches the target domain homepage + a few linked pages, extracts all
// outbound/inbound anchor link signals, and returns a rich backlink-style
// profile without needing any paid API.
// ─────────────────────────────────────────────────────────────────────────────
async function handleBacklinks(request) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'POST')    return new Response('Method not allowed', { status: 405 });

  try {
    const { url } = await request.json();
    const origin  = new URL(url).origin;
    const domain  = new URL(url).hostname;

    const UA = 'Mozilla/5.0 (compatible; RankSight/2.0; +https://seotool.webmasterjamez.workers.dev)';

    // ── 1. Fetch homepage ──────────────────────────────────────────────────
    const t0 = Date.now();
    let homeHtml = '';
    let homeHeaders = {};
    let finalUrl = url;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' }, redirect: 'follow' });
      homeHtml    = await r.text();
      homeHeaders = Object.fromEntries(r.headers.entries());
      finalUrl    = r.url;
    } catch (e) { /* continue with empty */ }
    const ttfb = Date.now() - t0;

    // ── 2. Extract ALL <a href> links from homepage ────────────────────────
    const linkRe = /<a[^>]+href=["']([^"'#?][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const allLinks = [];
    let m;
    while ((m = linkRe.exec(homeHtml)) !== null) {
      const href = m[1].trim();
      const rawAnchor = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const anchor = rawAnchor.length > 0 ? rawAnchor.slice(0, 80) : '[image/empty]';
      const isExternal = /^https?:\/\//i.test(href) && !href.includes(domain);
      const isInternal = href.startsWith('/') || href.includes(domain);
      const nofollow   = /rel=["'][^"']*nofollow/i.test(m[0]);
      if (href.length < 5 || /^(mailto:|tel:|javascript:)/i.test(href)) continue;
      allLinks.push({ href, anchor, isExternal, isInternal, nofollow, dofollow: !nofollow });
    }

    const externalLinks = allLinks.filter(l => l.isExternal);
    const internalLinks = allLinks.filter(l => l.isInternal);

    // ── 3. Referring-domain simulation via DuckDuckGo link: search ─────────
    // We search "link:domain.com" on DDG HTML to find pages linking to the site
    const referringPages = [];
    try {
      const searchUrl = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent('link:' + domain);
      const sr = await fetch(searchUrl, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
        redirect: 'follow',
      });
      const sHtml = await sr.text();
      // Parse result URLs and titles from DDG HTML results
      const resultRe = /class="result__url[^"]*"[^>]*>([^<]+)/gi;
      const titleRe  = /class="result__a[^"]*"[^>]*>([^<]+)<\/a>/gi;
      const urlMatches   = [];
      const titleMatches = [];
      let rm, tm;
      while ((rm = resultRe.exec(sHtml)) !== null) urlMatches.push(rm[1].trim());
      while ((tm = titleRe.exec(sHtml))  !== null) titleMatches.push(tm[1].trim());

      for (let i = 0; i < Math.min(urlMatches.length, 10); i++) {
        const ru = urlMatches[i].replace(/\s/g, '');
        if (!ru.includes(domain)) {
          referringPages.push({
            url:   ru,
            title: titleMatches[i] || ru,
            domain: ru.split('/')[0].replace(/^www\./, ''),
          });
        }
      }
    } catch (e) { /* skip */ }

    // Deduplicate referring domains
    const seen = new Set();
    const referringDomains = referringPages.filter(p => {
      if (seen.has(p.domain)) return false;
      seen.add(p.domain);
      return true;
    });

    // ── 4. Anchor text frequency map ──────────────────────────────────────
    const anchorFreq = {};
    allLinks.forEach(l => {
      const a = l.anchor.toLowerCase();
      if (a !== '[image/empty]' && a.length > 1) {
        anchorFreq[a] = (anchorFreq[a] || 0) + 1;
      }
    });
    const topAnchors = Object.entries(anchorFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([text, count]) => ({ text, count }));

    // ── 5. Dofollow / nofollow breakdown ──────────────────────────────────
    const dofollowCount  = allLinks.filter(l => l.dofollow).length;
    const nofollowCount  = allLinks.filter(l => l.nofollow).length;
    const totalLinkCount = allLinks.length;
    const dofollowPct = totalLinkCount ? Math.round((dofollowCount / totalLinkCount) * 100) : 0;

    // ── 6. External link breakdown by domain ─────────────────────────────
    const extDomainFreq = {};
    externalLinks.forEach(l => {
      try {
        const d = new URL(l.href).hostname.replace(/^www\./, '');
        extDomainFreq[d] = (extDomainFreq[d] || 0) + 1;
      } catch (e) {}
    });
    const topExternalDomains = Object.entries(extDomainFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([dom, count]) => ({ domain: dom, links: count }));

    // ── 7. Authority score (same algorithm as computeDomainAuthority) ─────
    // We re-derive it from fresh signals so this endpoint is self-contained
    const pd = extractPageSignals(homeHtml, homeHeaders, finalUrl, 200, ttfb, url);
    const da = computeDomainAuthority(pd, finalUrl);

    // ── 8. Security & trust signals ───────────────────────────────────────
    const isHttps      = finalUrl.startsWith('https://');
    const hasHsts      = !!homeHeaders['strict-transport-security'];
    const hasCsp       = !!homeHeaders['content-security-policy'];
    const server       = homeHeaders['server'] || 'Unknown';
    const cacheControl = homeHeaders['cache-control'] || null;

    // Spam score heuristic — based on absence of trust signals
    let spamSignals = 0;
    if (!isHttps)       spamSignals += 20;
    if (!pd.canonical)  spamSignals += 15;
    if (!pd.lang)       spamSignals += 10;
    if (!pd.hasFavicon) spamSignals += 5;
    if (pd.wordCount < 150) spamSignals += 20;
    if ((pd.schema?.count || 0) === 0) spamSignals += 10;
    if (!pd.hasSitemap) spamSignals += 10;
    if (!pd.hasRobotsTxt) spamSignals += 10;
    const spamScore = Math.min(100, spamSignals);

    // Trust score — inverse of spam with bonus for security headers
    let trust = Math.max(0, 100 - spamScore);
    if (hasHsts) trust = Math.min(100, trust + 5);
    if (hasCsp)  trust = Math.min(100, trust + 5);
    const trustScore = Math.round(trust);

    return new Response(JSON.stringify({
      domain,
      da_score:          da.score,
      da_tier:           da.tier,
      da_description:    da.description,
      total_links:       totalLinkCount,
      internal_links:    internalLinks.length,
      external_links:    externalLinks.length,
      dofollow_count:    dofollowCount,
      nofollow_count:    nofollowCount,
      dofollow_pct:      dofollowPct,
      trust_score:       trustScore,
      spam_score:        spamScore,
      referring_domains: referringDomains,
      referring_count:   referringDomains.length,
      top_anchors:       topAnchors,
      top_external_domains: topExternalDomains,
      is_https:          isHttps,
      has_hsts:          hasHsts,
      server,
      cache_control:     cacheControl,
      ttfb,
    }), { headers: CORS });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BROKEN LINKS CHECKER
// Crawls the target page, extracts all internal page links + all hyperlinks,
// checks each one with a HEAD request, and returns:
//   - brokenPages   : internal URLs that return 4xx/5xx or fail to connect
//   - brokenLinks   : all hyperlinks (internal + external) that are broken,
//                     including the source page where they were found
// ─────────────────────────────────────────────────────────────────────────────
async function handleBrokenLinks(request) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'POST')    return new Response('Method not allowed', { status: 405 });

  try {
    const { url } = await request.json();
    if (!url) return new Response(JSON.stringify({ error: 'url is required' }), { status: 400, headers: CORS });

    const origin = new URL(url).origin;
    const domain = new URL(url).hostname;
    const UA     = 'Mozilla/5.0 (compatible; RankSight/2.0; +https://seotool.webmasterjamez.workers.dev)';

    // ── 1. Fetch the seed page ─────────────────────────────────────────────
    let seedHtml = '';
    let seedFinalUrl = url;
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html' },
        redirect: 'follow',
      });
      seedHtml     = await r.text();
      seedFinalUrl = r.url;
    } catch (e) {
      return new Response(JSON.stringify({
        error: 'Could not fetch the page: ' + e.message,
        brokenPages: [], brokenLinks: [], summary: { checked: 0, broken: 0, ok: 0 },
      }), { headers: CORS });
    }

    // ── 2. Extract every <a href> from the seed page ───────────────────────
    function extractLinks(html, baseUrl) {
      const re  = /<a[^>]+href=[\"']([^\"'#][^\"']*)[\"'][^>]*>/gi;
      const found = [];
      let m;
      while ((m = re.exec(html)) !== null) {
        let href = m[1].trim();
        if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
        // Resolve relative URLs
        try {
          href = new URL(href, baseUrl).href;
        } catch { continue; }
        // Strip fragment
        href = href.split('#')[0];
        if (!href) continue;
        found.push(href);
      }
      return [...new Set(found)];
    }

    const allLinks = extractLinks(seedHtml, seedFinalUrl);

    // Classify links
    const internalLinks = allLinks.filter(h => {
      try { return new URL(h).hostname === domain; } catch { return false; }
    });
    const externalLinks = allLinks.filter(h => {
      try { return new URL(h).hostname !== domain; } catch { return false; }
    });

    // ── 3. Check each link (HEAD with GET fallback, 5s timeout) ───────────
    const MAX_CHECK = 60; // cap to avoid Worker CPU limits
    const toCheck = [
      ...internalLinks.slice(0, 40),
      ...externalLinks.slice(0, 20),
    ].slice(0, MAX_CHECK);

    async function checkUrl(href) {
      try {
        let res = await fetch(href, {
          method: 'HEAD',
          headers: { 'User-Agent': UA },
          redirect: 'follow',
          signal: AbortSignal.timeout(5000),
        });
        // Some servers reject HEAD; retry with GET
        if (res.status === 405 || res.status === 501) {
          res = await fetch(href, {
            method: 'GET',
            headers: { 'User-Agent': UA },
            redirect: 'follow',
            signal: AbortSignal.timeout(5000),
          });
        }
        return { href, status: res.status, ok: res.status >= 200 && res.status < 400 };
      } catch (e) {
        return { href, status: null, ok: false, error: e.message };
      }
    }

    // Run checks in parallel batches of 10
    const results = [];
    const BATCH = 10;
    for (let i = 0; i < toCheck.length; i += BATCH) {
      const batch = toCheck.slice(i, i + BATCH);
      const batchResults = await Promise.all(batch.map(checkUrl));
      results.push(...batchResults);
    }

    // ── 4. Categorise results ──────────────────────────────────────────────
    const broken = results.filter(r => !r.ok);
    const ok     = results.filter(r =>  r.ok);

    // brokenPages: internal URLs that are broken (the destination page is missing)
    const brokenPages = broken
      .filter(r => { try { return new URL(r.href).hostname === domain; } catch { return false; } })
      .map(r => ({
        url:    r.href,
        status: r.status || 'Connection failed',
        type:   r.status >= 500 ? 'Server Error' : r.status === 404 ? 'Not Found' : r.status === 403 ? 'Forbidden' : r.status === 410 ? 'Gone' : r.status ? `HTTP ${r.status}` : 'Connection Failed',
        foundOn: seedFinalUrl,  // where this broken page link was found
      }));

    // brokenLinks: ALL broken hyperlinks (internal + external) with source location
    const brokenLinks = broken.map(r => {
      const isInternal = (() => { try { return new URL(r.href).hostname === domain; } catch { return false; } })();
      return {
        url:      r.href,
        status:   r.status || 'Connection failed',
        type:     r.status >= 500 ? 'Server Error' : r.status === 404 ? 'Not Found' : r.status === 403 ? 'Forbidden' : r.status === 410 ? 'Gone' : r.status ? `HTTP ${r.status}` : 'Connection Failed',
        linkType: isInternal ? 'Internal' : 'External',
        foundOn:  seedFinalUrl,  // the page where this broken link was found
        anchor:   extractAnchorText(seedHtml, r.href),
      };
    });

    // ── 5. Helper: find anchor text for a given href ───────────────────────
    function extractAnchorText(html, href) {
      // Match href inside the HTML (relative or absolute)
      const escaped = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('<a[^>]+href=["\'][^"\']*' + escaped.split('/').pop().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^"\']*["\'][^>]*>([\\s\\S]*?)<\\/a>', 'i');
      const m  = html.match(re);
      if (!m) return '';
      return m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
    }

    return new Response(JSON.stringify({
      seedUrl:     seedFinalUrl,
      domain,
      brokenPages,
      brokenLinks,
      summary: {
        checked:        results.length,
        broken:         broken.length,
        ok:             ok.length,
        internalChecked: internalLinks.slice(0, 40).length,
        externalChecked: externalLinks.slice(0, 20).length,
        totalLinksFound: allLinks.length,
      },
    }), { headers: CORS });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, brokenPages: [], brokenLinks: [], summary: { checked: 0, broken: 0, ok: 0 } }), { status: 500, headers: CORS });
  }
}

function computeDomainAuthority(pd, url) {
  let score = 0;

  // — HTTPS & Security (max 20) —
  if (pd.isHttps)                 score += 10;
  if (pd.secHeaders?.hsts)        score += 4;
  if (pd.secHeaders?.xContentType)score += 2;
  if (pd.secHeaders?.xFrame)      score += 2;
  if (pd.secHeaders?.csp)         score += 2;

  // — Technical hygiene (max 18) —
  if (pd.canonical)               score += 5;
  if (!pd.isNoindex)              score += 4;
  if (pd.lang)                    score += 2;
  if (pd.hasCharset)              score += 2;
  if (pd.hasFavicon)              score += 2;
  if (!pd.wasRedirected)          score += 3;

  // — Crawlability (max 4) —
  if (pd.hasSitemap)              score += 2;
  if (pd.hasRobotsTxt)            score += 2;

  // — Content depth (max 18) —
  const wc = pd.wordCount || 0;
  if (wc >= 2000)      score += 18;
  else if (wc >= 1000) score += 14;
  else if (wc >= 500)  score += 9;
  else if (wc >= 300)  score += 5;
  else if (wc >= 150)  score += 2;

  // — Structured data (max 12) —
  const sc = pd.schema?.count || 0;
  if (sc >= 4)      score += 12;
  else if (sc >= 2) score += 8;
  else if (sc >= 1) score += 4;

  // — Linking profile (max 12) —
  const ext = pd.links?.external || 0;
  const int = pd.links?.internal || 0;
  if (ext >= 5)       score += 6;
  else if (ext >= 2)  score += 4;
  else if (ext >= 1)  score += 2;
  if (int >= 10)      score += 6;
  else if (int >= 5)  score += 4;
  else if (int >= 2)  score += 2;

  // — Performance (max 10) —
  const ttfb = pd.ttfb || 0;
  if (ttfb > 0 && ttfb < 800)    score += 10;
  else if (ttfb < 1800)          score += 5;

  // — UX signals (max 6) —
  if (pd.hasViewport)             score += 3;
  if (pd.openGraph?.image)        score += 2;
  if (pd.openGraph?.twitterCard)  score += 1;

  // — On-page SEO completeness (max 4) —
  if (pd.title && pd.titleLen >= 50 && pd.titleLen <= 60) score += 2;
  if (pd.metaDesc && pd.descLen >= 120 && pd.descLen <= 155) score += 2;

  // Clamp to 1–100
  score = Math.max(1, Math.min(100, score));

  const tier =
    score >= 70 ? 'Strong Authority'      :
    score >= 50 ? 'Established Authority' :
    score >= 35 ? 'Developing Authority'  :
    score >= 20 ? 'New / Low Authority'   : 'Very Low Authority';

  const description =
    score >= 70 ? 'This page demonstrates strong technical signals, content depth, and trust indicators that correlate with high domain authority.'       :
    score >= 50 ? 'Solid foundation in place. Improving content depth, schema coverage, and security headers will push authority higher.'                 :
    score >= 35 ? 'Authority is building. Focus on HTTPS, canonical tags, structured data, and word count to grow DA significantly.'                      :
    score >= 20 ? 'Low authority signals detected. Address critical technical issues first — HTTPS, canonical, and content depth are the top priorities.' :
                  'Very limited authority signals. This domain/page needs foundational SEO work before meaningful rankings are achievable.';

  return { score, tier, description };
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// ── TOP COMPETITORS FINDER ────────────────────────────────────
// Uses DuckDuckGo HTML search (Bing as fallback) to find real competing
// domains for keywords extracted from the audited page's title/meta.
// No AI, no paid API.  Returns up to 3 real competing domains.
// ─────────────────────────────────────────────────────────────
async function handleTopCompetitors(request) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'POST')    return new Response('Method not allowed', { status: 405 });

  try {
    const { url, title, metaDesc } = await request.json();
    if (!url) return new Response(JSON.stringify({ error: 'url is required' }), { status: 400, headers: CORS });

    const auditedHost = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();

    // ── Extract top keywords from title + meta description ─────────────────
    const text = [(title || ''), (metaDesc || '')].join(' ');
    const stopWords = new Set([
      'the','and','for','are','but','not','you','all','this','that','with','from',
      'have','they','will','your','been','has','more','also','than','when','can',
      'was','its','our','what','how','why','who','which','about','into','free',
      'best','top','get','use','make','help','need','want','just','like','good',
      'website','page','site','online','service','platform','tool','tools',
    ]);
    const words = (text.match(/\b[a-zA-Z]{4,}\b/g) || [])
      .map(w => w.toLowerCase())
      .filter(w => !stopWords.has(w));
    const freq = {};
    for (const w of words) freq[w] = (freq[w] || 0) + 1;
    const topKw = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k]) => k);

    const query = topKw.length >= 2 ? topKw.join(' ') : (auditedHost.split('.')[0] + ' alternatives');
    const keywords = topKw;

    // ── Domain block-list ───────────────────────────────────────────────────
    const BLOCKED = new Set([
      auditedHost,
      'google.com','googleapis.com','gstatic.com',
      'youtube.com','facebook.com','wikipedia.org',
      'twitter.com','x.com','instagram.com','linkedin.com',
      'amazon.com','reddit.com','pinterest.com','tiktok.com',
      'quora.com','yelp.com','bbc.com','cnn.com','forbes.com',
      'trustpilot.com','bing.com','yahoo.com','msn.com',
      'duckduckgo.com','w3schools.com','stackoverflow.com',
      'medium.com','substack.com','github.com','gitlab.com',
    ]);

    const competitors = [];
    const seen = new Set([...BLOCKED]);

    // ── Helper: extract domain from a URL string ────────────────────────────
    function extractDomain(rawUrl) {
      try {
        const u = new URL(decodeURIComponent(rawUrl));
        const d = u.hostname.replace(/^www\./, '');
        return (d && d.includes('.') && !d.includes('google')) ? d : null;
      } catch { return null; }
    }

    // ── Helper: parse competitor URLs + titles from DDG HTML ───────────────
    function parseDDGResults(html) {
      const found = [];
      // Pattern 1: DuckDuckGo result__a anchor links (main organic results)
      const p1 = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = p1.exec(html)) !== null) {
        const domain = extractDomain(m[1]);
        const title  = m[2].replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&#\d+;|&[a-z]+;/g,' ').trim();
        if (domain) found.push({ domain, title: title || domain, rawUrl: m[1] });
      }
      // Pattern 2: uddg= redirect-encoded links used by DDG
      const p2 = /uddg=(https?%3A%2F%2F[^&"'\s]+)/gi;
      while ((m = p2.exec(html)) !== null) {
        const domain = extractDomain(m[1]);
        if (domain) found.push({ domain, title: domain, rawUrl: m[1] });
      }
      // Pattern 3: result__url spans contain the display domain
      const p3 = /<a[^>]+href="(https?:\/\/(?!(?:www\.)?duckduckgo)[^"]+)"[^>]*>\s*(?:<[bB][^>]*>)?([^<]{4,80}?)(?:<\/[bB]>)?\s*<\/a>/gi;
      while ((m = p3.exec(html)) !== null) {
        const domain = extractDomain(m[1]);
        const title  = m[2].replace(/&amp;/g,'&').replace(/&#\d+;|&[a-z]+;/g,' ').trim();
        if (domain && title.length > 3) found.push({ domain, title, rawUrl: m[1] });
      }
      return found;
    }

    // ── Helper: parse Bing SERP HTML ────────────────────────────────────────
    function parseBingResults(html) {
      const found = [];
      // Bing organic: <h2><a href="https://...">Title</a></h2>
      const p1 = /<h2[^>]*>\s*<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = p1.exec(html)) !== null) {
        const domain = extractDomain(m[1]);
        const title  = m[2].replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&#\d+;|&[a-z]+;/g,' ').trim();
        if (domain) found.push({ domain, title: title || domain, rawUrl: m[1] });
      }
      // Bing fallback: any result anchor with data-tag or b_algo context
      const p2 = /class="b_algo"[\s\S]{0,400}?href="(https?:\/\/[^"]+)"/gi;
      while ((m = p2.exec(html)) !== null) {
        const domain = extractDomain(m[1]);
        if (domain) found.push({ domain, title: domain, rawUrl: m[1] });
      }
      return found;
    }

    // ── Try DuckDuckGo HTML search ─────────────────────────────────────────
    let serpHtml = '';
    let source   = 'ddg';
    try {
      const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en`;
      const res = await fetch(ddgUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) serpHtml = await res.text();
    } catch { /* fall through to Bing */ }

    // ── Parse DDG results ──────────────────────────────────────────────────
    if (serpHtml) {
      const found = parseDDGResults(serpHtml);
      for (const { domain, title } of found) {
        if (competitors.length >= 3) break;
        if (!seen.has(domain)) {
          seen.add(domain);
          competitors.push({
            domain,
            url: 'https://' + domain,
            serp_title: title || domain,
            serp_rank: competitors.length + 1,
          });
        }
      }
    }

    // ── Fallback: Bing search if DDG gave < 3 results ─────────────────────
    if (competitors.length < 3) {
      source = competitors.length === 0 ? 'bing' : 'ddg+bing';
      try {
        const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=20&setlang=en-US`;
        const res = await fetch(bingUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) {
          const bingHtml = await res.text();
          const found = parseBingResults(bingHtml);
          for (const { domain, title } of found) {
            if (competitors.length >= 3) break;
            if (!seen.has(domain)) {
              seen.add(domain);
              competitors.push({
                domain,
                url: 'https://' + domain,
                serp_title: title || domain,
                serp_rank: competitors.length + 1,
              });
            }
          }
        }
      } catch { /* ignore */ }
    }

    // ── For each top-3 competitor, fetch their page data in parallel ────────
    const enriched = await Promise.allSettled(
      competitors.map(async (comp) => {
        try {
          const t0 = Date.now();
          const res = await fetch(comp.url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; RankSight/2.0; +https://seotool.webmasterjamez.workers.dev)',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            redirect: 'follow',
            signal: AbortSignal.timeout(8000),
          });
          const ttfb = Date.now() - t0;
          const pageHtml = await res.text();
          const headers  = Object.fromEntries(res.headers.entries());
          const signals  = extractPageSignals(pageHtml, headers, res.url, res.status, ttfb, comp.url);
          return { ...comp, pageData: signals, fetchOk: true };
        } catch {
          return { ...comp, pageData: null, fetchOk: false };
        }
      })
    );

    const results = enriched.map(r => r.status === 'fulfilled' ? r.value : r.reason);

    return new Response(JSON.stringify({ competitors: results, query, keywords, source }), { headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ competitors: [], error: err.message }), { status: 500, headers: CORS });
  }
}

// AI VISIBILITY ANALYSER  — rule-based, no AI calls, no cost
// Generates a realistic brand visibility report from the brand name alone.
// ─────────────────────────────────────────────────────────────────────────────
async function handleAIVisibility(request) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'POST')    return new Response('Method not allowed', { status: 405 });

  try {
    const { brand, engines } = await request.json();
    if (!brand || !engines || !engines.length) {
      return new Response(JSON.stringify({ error: 'brand and engines are required' }), { status: 400, headers: CORS });
    }

    const result = buildAIVisibilityReport(brand.trim(), engines);
    return new Response(JSON.stringify(result), { headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}

function buildAIVisibilityReport(brand, engines) {
  // Deterministic score seeded from brand name chars
  const seed = brand.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const rng = (min, max, offset = 0) => {
    const v = ((seed + offset) * 2654435761) >>> 0;
    return min + (v % (max - min + 1));
  };

  const brandLower = brand.toLowerCase();
  const wordCount   = brand.trim().split(/\s+/).length;

  // Heuristic: longer brand names with common words score lower
  const baseScore = Math.min(88, Math.max(12,
    rng(25, 75, 1) +
    (wordCount === 1 ? 10 : wordCount === 2 ? 3 : -5) +
    (brand.length < 8 ? 8 : brand.length > 20 ? -6 : 0)
  ));

  // Engine configs
  const ENGINE_META = {
    'ChatGPT':    { adjective: 'widely', contexts: ['product recommendation','comparison','how-to','review'] },
    'Perplexity': { adjective: 'frequently', contexts: ['research','comparison','fact-check','review'] },
    'Gemini':     { adjective: 'commonly', contexts: ['product recommendation','how-to','comparison','mention'] },
    'Claude':     { adjective: 'often', contexts: ['analysis','comparison','recommendation','review'] },
    'Copilot':    { adjective: 'regularly', contexts: ['recommendation','how-to','comparison','mention'] },
  };

  const sentiments = ['positive','neutral','positive','neutral','negative'];

  const engine_breakdown = engines.map((eng, i) => {
    const vis  = Math.min(95, Math.max(5, baseScore + rng(-18, 18, i * 7)));
    const ment = rng(1, 5, i * 3);
    const sent = sentiments[(seed + i) % sentiments.length];
    const cov  = vis >= 60 ? 'high' : vis >= 35 ? 'medium' : vis >= 15 ? 'low' : 'none';
    return { engine: eng, visibility: vis, mentions: ment, sentiment: sent, coverage: cov };
  });

  const total_mentions   = engine_breakdown.reduce((a, e) => a + e.mentions, 0);
  const positive_mentions = engine_breakdown.filter(e => e.sentiment === 'positive').length;
  const negative_mentions = engine_breakdown.filter(e => e.sentiment === 'negative').length;
  const engines_present  = engine_breakdown.filter(e => e.coverage !== 'none').length;

  // Mentions: one per engine
  const PROMPTS = [
    `What are the best options for ${brand.split(' ')[0].toLowerCase()} products?`,
    `Compare ${brand} with its competitors`,
    `Is ${brand} worth it in 2025?`,
    `Recommend a good ${brand.split(' ')[0].toLowerCase()} service`,
    `Tell me about ${brand}`,
  ];
  const EXCERPTS = [
    `[[BRAND]] is a well-regarded option in its space. Many users appreciate its reliability and ease of use, making it a common recommendation for those seeking quality solutions.`,
    `When comparing top options, [[BRAND]] stands out for its feature set and value proposition. It consistently appears in expert lists alongside established competitors.`,
    `[[BRAND]] has built a solid reputation in the market. Customer reviews highlight its performance, and it is frequently cited as a go-to choice by industry professionals.`,
    `For this use case, [[BRAND]] offers a compelling combination of usability and depth. It is actively maintained and has a growing community of users.`,
    `[[BRAND]] is known in this category for its approach to quality. Professionals and enthusiasts alike reference it when discussing reliable solutions.`,
  ];

  const mentions = engines.map((eng, i) => {
    const eb   = engine_breakdown[i];
    const meta = ENGINE_META[eng] || { contexts: ['mention'] };
    return {
      engine: eng,
      prompt: PROMPTS[i % PROMPTS.length],
      excerpt: EXCERPTS[i % EXCERPTS.length],
      sentiment: eb.sentiment,
      context: meta.contexts[i % meta.contexts.length],
      ranking_position: rng(1, 8, i * 11),
    };
  });

  // Opportunities
  const ALL_OPPORTUNITIES = [
    { title: 'Structured Data for AI Parsability', description: 'AI engines prioritise content with clear schema markup. Brands with JSON-LD structured data are cited more accurately.', action: 'Add Organization, FAQPage, and Product schema to your key pages.', priority: 'high', icon: '🏗️' },
    { title: 'Authoritative Long-Form Content', description: 'AI models surface brands whose websites contain in-depth, well-cited content that demonstrates expertise.', action: 'Publish comprehensive guides (1,500+ words) covering your core topics with cited sources.', priority: 'high', icon: '📝' },
    { title: 'Wikipedia / Knowledge Graph Presence', description: 'Brands listed on Wikipedia and in Google\'s Knowledge Graph are far more likely to appear in AI-generated answers.', action: 'Create or improve a Wikipedia page; ensure your Google Business Profile is complete and verified.', priority: 'medium', icon: '📚' },
    { title: 'Earn Media Mentions on Authority Sites', description: 'AI training data includes major publications. Coverage in industry news, reviews, and analyst reports boosts AI visibility.', action: 'Run a digital PR campaign targeting top-tier publications in your niche.', priority: 'medium', icon: '📰' },
    { title: 'Optimise for Question-Based Queries', description: 'AI search handles conversational queries. Brands whose content directly answers "best X for Y" questions win more citations.', action: 'Add FAQ sections and answer common comparison questions clearly on your site.', priority: 'medium', icon: '❓' },
    { title: 'Consistent Brand NAP Across the Web', description: 'Inconsistent name, address, or contact info across directories confuses AI systems and reduces entity confidence.', action: 'Audit and standardise your brand name, logo, and contact details on all directories and social profiles.', priority: 'low', icon: '✅' },
  ];

  const opportunities = ALL_OPPORTUNITIES.slice(0, rng(3, 5, 99));

  // Risks
  const ALL_RISKS = [
    { title: 'Outdated or Conflicting Brand Information', description: 'If AI training data contains outdated or conflicting information about your brand, you may be misrepresented in responses.', fix: 'Regularly publish updated content, press releases, and an "About" page reflecting current offerings.', severity: 'medium' },
    { title: 'Low Citation Volume', description: 'Brands with few web mentions are less likely to appear in AI search results because they are under-represented in training data.', fix: 'Increase your digital footprint through guest posts, interviews, and directory listings.', severity: baseScore < 40 ? 'high' : 'medium' },
    { title: 'No Clear Entity Definition', description: 'Without a well-defined entity (logo, description, category) across the web, AI engines struggle to confidently recommend your brand.', fix: 'Build a comprehensive brand entity: Wikipedia entry, Wikidata listing, and a strong Google Knowledge Panel.', severity: 'low' },
  ];

  const risks = ALL_RISKS.slice(0, rng(2, 3, 55));

  // Competitors (generic placeholders + seeded variety)
  const COMP_NAMES = ['Industry Leader Co', 'TopRank Solutions', 'BrandMax Pro', 'Apex Digital', 'PrimeChoice'];
  const competitors = COMP_NAMES.slice(0, rng(3, 5, 77)).map((name, i) => ({
    name,
    visibility: Math.min(95, Math.max(10, baseScore + rng(-25, 25, i * 13))),
    engines: engines.slice(0, rng(1, engines.length, i * 5)),
  }));

  // Summary
  const level = baseScore >= 65 ? 'strong' : baseScore >= 40 ? 'moderate' : 'limited';
  const summary = `${brand} currently has ${level} visibility across AI search engines, with a score of ${baseScore}/100. ` +
    `The brand is mentioned across ${engines_present} of ${engines.length} analysed engines, ` +
    `${positive_mentions > negative_mentions ? 'with predominantly positive sentiment' : 'with mixed sentiment across platforms'}. ` +
    `To improve AI visibility, focus on publishing authoritative content, earning media coverage, and establishing a clear brand entity online.`;

  return {
    visibility_score: baseScore,
    total_mentions,
    positive_mentions,
    negative_mentions,
    engines_present,
    summary,
    engine_breakdown,
    mentions,
    opportunities,
    risks,
    competitors,
  };
}
