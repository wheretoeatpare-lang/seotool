const https = require('https');
const http = require('http');

// ─── Fetch a URL ───────────────────────────────────────────────────────────────
function fetchUrl(targetUrl, redirectCount = 0) {
  return new Promise((resolve) => {
    if (redirectCount > 4) return resolve({ html: '', headers: {}, status: 0 });
    let parsed;
    try { parsed = new URL(targetUrl); } catch { return resolve({ html: '', headers: {}, status: 0 }); }

    const lib = parsed.protocol === 'https:' ? https : http;
    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: (parsed.pathname || '/') + (parsed.search || ''),
      method: 'GET',
      timeout: 9000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Connection': 'close',
      },
    };

    let data = '';
    const req = lib.request(reqOptions, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const loc = res.headers.location;
        const next = loc.startsWith('http') ? loc : `${parsed.protocol}//${parsed.hostname}${loc}`;
        return fetchUrl(next, redirectCount + 1).then(resolve);
      }
      res.setEncoding('utf8');
      res.on('data', (chunk) => { if (data.length < 400000) data += chunk; });
      res.on('end', () => resolve({ html: data, headers: res.headers, status: res.statusCode }));
    });
    req.on('error', () => resolve({ html: '', headers: {}, status: 0 }));
    req.on('timeout', () => { req.destroy(); resolve({ html: '', headers: {}, status: 0 }); });
    req.end();
  });
}

// ─── Normalise URL ─────────────────────────────────────────────────────────────
function normaliseUrl(href, base) {
  try {
    const u = href.startsWith('http') ? new URL(href) : new URL(href, base);
    return u.origin + u.pathname.replace(/\/$/, '') || '/';
  } catch { return null; }
}

// ─── Sanitize text for safe JSON embedding ─────────────────────────────────────
function safeText(str) {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[\x00-\x1F\x7F]/g, '');
}

// ─── Extract internal page links ───────────────────────────────────────────────
function extractPageLinks(html, baseUrl) {
  const base = new URL(baseUrl);
  const seen = new Set();
  const links = [];
  const skipExt = /\.(jpg|jpeg|png|gif|svg|webp|ico|pdf|zip|css|js|xml|json|txt|woff|woff2|ttf|eot|mp4|mp3|avi)$/i;
  const skipPath = /\/(feed|rss|sitemap|xmlrpc|wp-json|api\/|wp-admin|wp-login)/i;

  const re = /href=["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1].trim();
    if (skipExt.test(href) || skipPath.test(href)) continue;
    const full = normaliseUrl(href, base.origin);
    if (!full) continue;
    try {
      const u = new URL(full);
      if (u.hostname !== base.hostname) continue;
      if (seen.has(full)) continue;
      seen.add(full);
      links.push(full);
    } catch {}
  }
  return links;
}

// ─── Parse sitemap ─────────────────────────────────────────────────────────────
async function getPageUrlsFromSitemap(baseUrl) {
  const base = new URL(baseUrl);
  const sitemapPaths = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap/sitemap.xml', '/page-sitemap.xml', '/post-sitemap.xml'];
  const htmlPageUrls = [];

  for (const path of sitemapPaths) {
    try {
      const res = await fetchUrl(`${base.origin}${path}`);
      if (res.status !== 200 || !res.html.includes('<loc>')) continue;

      const locs = [...res.html.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi)].map(m => m[1].trim());

      const isIndex = res.html.includes('<sitemapindex') || res.html.includes('<sitemap>');
      if (isIndex) {
        for (const sitemapUrl of locs.slice(0, 5)) {
          try {
            const child = await fetchUrl(sitemapUrl);
            if (child.status === 200 && child.html.includes('<loc>')) {
              const childLocs = [...child.html.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi)].map(m => m[1].trim());
              for (const loc of childLocs) {
                if (isHtmlPage(loc, base.hostname)) htmlPageUrls.push(loc);
              }
            }
          } catch {}
          if (htmlPageUrls.length >= 20) break;
        }
      } else {
        for (const loc of locs) {
          if (isHtmlPage(loc, base.hostname)) htmlPageUrls.push(loc);
        }
      }
      if (htmlPageUrls.length > 0) break;
    } catch {}
  }
  return htmlPageUrls.slice(0, 20);
}

// ─── Check if URL is an HTML page ─────────────────────────────────────────────
function isHtmlPage(url, hostname) {
  try {
    const u = new URL(url);
    if (u.hostname !== hostname) return false;
    if (/\.(xml|json|txt|pdf|jpg|jpeg|png|gif|svg|webp|ico|css|js|zip|mp4|mp3)$/i.test(u.pathname)) return false;
    if (/sitemap|feed|rss|xmlrpc/i.test(u.pathname)) return false;
    return true;
  } catch { return false; }
}

// ─── Get page title ─────────────────────────────────────────────────────────────
function getPageTitle(html, fallbackUrl) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m && m[1].trim()) return m[1].trim().replace(/[\r\n]/g, ' ').slice(0, 70);
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return h1[1].replace(/<[^>]+>/g, '').trim().slice(0, 70);
  try { return new URL(fallbackUrl).pathname || 'Homepage'; } catch { return fallbackUrl; }
}

// ─── Analyse a page for SEO issues ────────────────────────────────────────────
function analysePage(html, pageUrl) {
  const base = new URL(pageUrl);
  const result = {
    url: pageUrl,
    title: getPageTitle(html, pageUrl),
    issues: {
      missingTitle: false,
      shortTitle: false,
      missingMetaDescription: false,
      shortMetaDescription: false,
      imagesWithoutAlt: [],
      missingH1: false,
      multipleH1: false,
      lowWordCount: false,
      wordCount: 0,
      missingCanonical: false,
      noInternalLinks: false,
      internalLinkCount: 0,
    }
  };

  if (!html || html.length < 100) return result;

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch || !titleMatch[1].trim()) {
    result.issues.missingTitle = true;
  } else if (titleMatch[1].trim().length < 20) {
    result.issues.shortTitle = true;
  }

  const metaDescMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  if (!metaDescMatch) {
    result.issues.missingMetaDescription = true;
  } else if (metaDescMatch[1].trim().length < 50) {
    result.issues.shortMetaDescription = true;
  }

  const imgRegex = /<img([^>]*)>/gi;
  let imgMatch;
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    const attrs = imgMatch[1];
    const altMatch = attrs.match(/alt=["']([^"']*)["']/i);
    if (altMatch && altMatch[1].trim().length > 0) continue;
    const srcMatch = attrs.match(/src=["']([^"']+)["']/i) || attrs.match(/data-src=["']([^"']+)["']/i);
    if (!srcMatch) continue;
    const rawSrc = srcMatch[1].trim();
    if (rawSrc.startsWith('data:') || rawSrc.includes('pixel') || rawSrc.length < 5) continue;
    let fullSrc = rawSrc;
    try { fullSrc = rawSrc.startsWith('http') ? rawSrc : new URL(rawSrc, base.origin).href; } catch {}
    result.issues.imagesWithoutAlt.push({ src: rawSrc.slice(0, 120), fullSrc: fullSrc.slice(0, 200) });
  }

  const h1Count = (html.match(/<h1[^>]*>/gi) || []).length;
  if (h1Count === 0) result.issues.missingH1 = true;
  if (h1Count > 1) result.issues.multipleH1 = true;

  const textOnly = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = textOnly.split(' ').filter(w => w.length > 2);
  result.issues.wordCount = words.length;
  if (words.length < 300) result.issues.lowWordCount = true;

  if (!/<link[^>]+rel=["']canonical["']/i.test(html)) result.issues.missingCanonical = true;

  const internalLinks = (html.match(new RegExp(`href=["'][^"']*${base.hostname}[^"']*["']`, 'gi')) || []).length
    + (html.match(/href=["']\/[^"']*["']/gi) || []).length;
  result.issues.internalLinkCount = internalLinks;
  if (internalLinks < 2) result.issues.noInternalLinks = true;

  return result;
}

// ─── CMS Detection ─────────────────────────────────────────────────────────────
function detectCMS(html, headers) {
  const cookie = Array.isArray(headers['set-cookie']) ? headers['set-cookie'].join(' ') : (headers['set-cookie'] || '');
  const xpow = (headers['x-powered-by'] || '').toLowerCase();
  const xgen = (headers['x-generator'] || '').toLowerCase();

  const checks = [
    { name: 'WordPress', tests: [/\/wp-content\/(themes|plugins|uploads)\//i.test(html), /\/wp-includes\//i.test(html), /<meta[^>]+generator[^>]*WordPress/i.test(html), /wp-json/i.test(html), /wpemoji|wp\.i18n/i.test(html), cookie.toLowerCase().includes('wordpress') || cookie.toLowerCase().includes('wp-settings'), xgen.includes('wordpress')], ver: () => { const m = html.match(/<meta[^>]+generator[^>]*WordPress\s*([\d.]+)/i); return m ? m[1] : null; } },
    { name: 'Shopify', tests: [/cdn\.shopify\.com/i.test(html), /shopify\.com\/s\/files/i.test(html), /<meta[^>]+generator[^>]*Shopify/i.test(html), /Shopify\.(theme|shop)/i.test(html), cookie.toLowerCase().includes('_shopify')], ver: () => null },
    { name: 'Wix', tests: [/static\.wixstatic\.com/i.test(html), /wixsite\.com|wix-code/i.test(html), /<meta[^>]+generator[^>]*Wix/i.test(html), /wixBiSession/i.test(html)], ver: () => null },
    { name: 'Squarespace', tests: [/static\.squarespace\.com/i.test(html), /<meta[^>]+generator[^>]*Squarespace/i.test(html), /Static\.SQUARESPACE_CONTEXT/i.test(html), cookie.toLowerCase().includes('squarespace')], ver: () => null },
    { name: 'Webflow', tests: [/\.webflow\.io/i.test(html), /webflow\.com\/css|webflow\.js/i.test(html), /<meta[^>]+generator[^>]*Webflow/i.test(html), /data-wf-page/i.test(html)], ver: () => null },
    { name: 'Joomla', tests: [/<meta[^>]+generator[^>]*Joomla/i.test(html), /\/components\/com_/i.test(html), /\/media\/jui\//i.test(html), cookie.toLowerCase().includes('joomla')], ver: () => null },
    { name: 'Drupal', tests: [/<meta[^>]+generator[^>]*Drupal/i.test(html), /\/sites\/default\/files\//i.test(html), /Drupal\.settings/i.test(html), xgen.includes('drupal')], ver: () => null },
    { name: 'Ghost', tests: [/<meta[^>]+generator[^>]*Ghost/i.test(html), /ghost\.io|ghost\/content/i.test(html), xgen.includes('ghost')], ver: () => null },
    { name: 'Next.js', tests: [/\/_next\/static\//i.test(html), /__NEXT_DATA__/i.test(html), xpow.includes('next.js')], ver: () => null },
    { name: 'Nuxt.js', tests: [/\/_nuxt\//i.test(html), /window\.__NUXT__/i.test(html), xpow.includes('nuxt')], ver: () => null },
    { name: 'PrestaShop', tests: [/<meta[^>]+generator[^>]*PrestaShop/i.test(html), /\/modules\/ps_/i.test(html)], ver: () => null },
    { name: 'HubSpot CMS', tests: [/hs-scripts\.com/i.test(html), /hbspt\./i.test(html)], ver: () => null },
    { name: 'Laravel', tests: [cookie.toLowerCase().includes('laravel_session'), cookie.toLowerCase().includes('xsrf-token') && xpow.includes('php')], ver: () => null },
  ];

  const hits = checks.map(c => ({ ...c, count: c.tests.filter(Boolean).length })).filter(c => c.count > 0).sort((a, b) => b.count - a.count);
  if (!hits.length) {
    const gen = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"'<>]+)["']/i);
    if (gen) return { name: gen[1].trim().slice(0, 40), confidence: 'Medium', version: null, notes: 'Detected via generator meta tag' };
    return { name: 'Custom / Unknown', confidence: 'Low', version: null, notes: 'No known CMS fingerprints found' };
  }
  const top = hits[0];
  return { name: top.name, confidence: top.count >= 3 ? 'High' : top.count === 2 ? 'Medium' : 'Low', version: top.ver ? top.ver() : null, notes: `Matched ${top.count} fingerprint(s)` };
}

// ─── ✅ NEW: Compute deterministic on-page scores from crawl data ──────────────
function computeRealScores(pageAnalyses, homePage, targetUrl) {
  const total = pageAnalyses.length || 1;

  // Title tag score
  const missingTitleCount = pageAnalyses.filter(p => p.issues.missingTitle || p.issues.shortTitle).length;
  const titleScore = Math.round(100 - (missingTitleCount / total) * 100);

  // Meta description score
  const missingDescCount = pageAnalyses.filter(p => p.issues.missingMetaDescription || p.issues.shortMetaDescription).length;
  const metaDescScore = Math.round(100 - (missingDescCount / total) * 100);

  // Image alt score
  const totalImages = pageAnalyses.reduce((acc, p) => acc + (p.issues.imagesWithoutAlt.length + (p.issues.imagesWithoutAlt.length === 0 ? 1 : 0)), 0);
  const missingAltImages = pageAnalyses.reduce((acc, p) => acc + p.issues.imagesWithoutAlt.length, 0);
  const imageAltScore = totalImages > 0 ? Math.round(100 - (missingAltImages / totalImages) * 100) : 100;

  // H1 score
  const missingH1Count = pageAnalyses.filter(p => p.issues.missingH1 || p.issues.multipleH1).length;
  const h1Score = Math.round(100 - (missingH1Count / total) * 100);

  // Canonical score
  const missingCanonicalCount = pageAnalyses.filter(p => p.issues.missingCanonical).length;
  const canonicalScore = Math.round(100 - (missingCanonicalCount / total) * 100);

  // Content score
  const thinContentCount = pageAnalyses.filter(p => p.issues.lowWordCount).length;
  const contentScore = Math.round(100 - (thinContentCount / total) * 100);

  // Internal links score
  const noLinksCount = pageAnalyses.filter(p => p.issues.noInternalLinks).length;
  const internalLinksScore = Math.round(100 - (noLinksCount / total) * 100);

  // HTTPS check
  const isHttps = targetUrl.startsWith('https://') ? 100 : 0;

  // Has sitemap
  const hasSitemap = homePage.html && homePage.html.length > 100 ? null : null; // resolved separately

  // Has OG tags
  const hasOgTags = homePage.html && /<meta[^>]+property=["']og:/i.test(homePage.html) ? 100 : 0;

  // Has structured data
  const hasStructuredData = homePage.html && /application\/ld\+json/i.test(homePage.html) ? 100 : 0;

  // Page size (homepage)
  const pageSize = homePage.html ? Buffer.byteLength(homePage.html, 'utf8') : 0;
  const pageSizeKb = Math.round(pageSize / 1024);
  const pageSizeScore = pageSizeKb < 100 ? 100 : pageSizeKb < 300 ? 80 : pageSizeKb < 600 ? 60 : pageSizeKb < 1000 ? 40 : 20;

  // Overall technical score (weighted average of deterministic signals)
  const technicalScore = Math.round(
    (titleScore * 0.15) +
    (metaDescScore * 0.15) +
    (imageAltScore * 0.10) +
    (h1Score * 0.10) +
    (canonicalScore * 0.10) +
    (isHttps * 0.15) +
    (hasOgTags * 0.10) +
    (hasStructuredData * 0.10) +
    (internalLinksScore * 0.05)
  );

  return {
    scores: {
      titleScore, metaDescScore, imageAltScore, h1Score,
      canonicalScore, contentScore, internalLinksScore,
      isHttps, hasOgTags, hasStructuredData, pageSizeScore
    },
    pageSizeKb,
    technicalScore
  };
}

// ─── ✅ NEW: Fetch Google PageSpeed Insights API ───────────────────────────────
async function fetchPageSpeedData(url, apiKey) {
  if (!apiKey) return null;
  try {
    const psiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&key=${apiKey}`;
    const res = await fetchUrl(psiUrl);
    if (res.status !== 200 || !res.html) return null;

    let data;
    try { data = JSON.parse(res.html); } catch { return null; }

    const cats = data.lighthouseResult && data.lighthouseResult.categories;
    const audits = data.lighthouseResult && data.lighthouseResult.audits;

    if (!cats || !audits) return null;

    const perfScore = cats.performance ? Math.round(cats.performance.score * 100) : null;
    const lcp = audits['largest-contentful-paint'] ? audits['largest-contentful-paint'].displayValue : null;
    const fid = audits['total-blocking-time'] ? audits['total-blocking-time'].displayValue : null;
    const cls = audits['cumulative-layout-shift'] ? audits['cumulative-layout-shift'].displayValue : null;
    const fcp = audits['first-contentful-paint'] ? audits['first-contentful-paint'].displayValue : null;
    const ttfb = audits['server-response-time'] ? audits['server-response-time'].displayValue : null;
    const speedIndex = audits['speed-index'] ? audits['speed-index'].displayValue : null;
    const accessibilityScore = cats.accessibility ? Math.round(cats.accessibility.score * 100) : null;
    const seoScore = cats.seo ? Math.round(cats.seo.score * 100) : null;
    const bestPracticesScore = cats['best-practices'] ? Math.round(cats['best-practices'].score * 100) : null;

    return {
      perfScore, lcp, fid, cls, fcp, ttfb, speedIndex,
      accessibilityScore, seoScore, bestPracticesScore
    };
  } catch {
    return null;
  }
}

// ─── Groq POST ─────────────────────────────────────────────────────────────────
function groqPost(apiKey, messages, maxTokens = 3000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: maxTokens, messages });
    const urlObj = new URL('https://api.groq.com/openai/v1/chat/completions');
    const req = https.request({
      hostname: urlObj.hostname, path: urlObj.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'GROQ_API_KEY is not set.' }) };

  // Optional: set PAGESPEED_API_KEY in Netlify env for real Core Web Vitals
  const PAGESPEED_API_KEY = process.env.PAGESPEED_API_KEY || null;

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { url, options, prompt } = body;
  if (!url) return { statusCode: 400, body: JSON.stringify({ error: 'Missing url' }) }; 

  const targetUrl = url.startsWith('http') ? url : `https://${url}`;
  const base = new URL(targetUrl);

  // ── 1. Fetch homepage ──────────────────────────────────────────────────────
  let homePage = { html: '', headers: {}, status: 0 };
  try { homePage = await fetchUrl(targetUrl); } catch {}

  // ✅ FIX #12: Detect crawl failure early
  const crawlFailed = !homePage.html || homePage.status === 0 || homePage.html.length < 200;

  // ── 2. Detect CMS ──────────────────────────────────────────────────────────
  const cmsData = homePage.html
    ? detectCMS(homePage.html, homePage.headers)
    : { name: 'Unknown', confidence: 'Low', version: null, notes: 'Could not fetch site' };

  // ── 3. Collect real page URLs ──────────────────────────────────────────────
  let pageUrls = [targetUrl];
  if (!crawlFailed) {
    try {
      const sitemapPages = await getPageUrlsFromSitemap(targetUrl);
      if (sitemapPages.length >= 2) {
        const withHome = [targetUrl, ...sitemapPages.filter(u => normaliseUrl(u, base.origin) !== normaliseUrl(targetUrl, base.origin))];
        pageUrls = [...new Set(withHome)].slice(0, 12);
      } else if (homePage.html) {
        const crawled = extractPageLinks(homePage.html, targetUrl);
        pageUrls = [...new Set([targetUrl, ...crawled])].slice(0, 12);
      }
    } catch {}
  }

  // ── 4. Fetch & analyse each page in parallel ──────────────────────────────
  const pageAnalyses = [];
  if (!crawlFailed) {
    await Promise.all(pageUrls.map(async (pageUrl) => {
      try {
        const page = (normaliseUrl(pageUrl, base.origin) === normaliseUrl(targetUrl, base.origin))
          ? homePage
          : await fetchUrl(pageUrl);
        if (page.html && page.html.length > 200) {
          pageAnalyses.push(analysePage(page.html, pageUrl));
        }
      } catch {}
    }));
  }

  // ── 5. ✅ Compute REAL deterministic scores ────────────────────────────────
  const realScores = computeRealScores(pageAnalyses, homePage, targetUrl);

  // ── 6. ✅ Fetch real PageSpeed / Core Web Vitals ───────────────────────────
  const psiData = await fetchPageSpeedData(targetUrl, PAGESPEED_API_KEY);

  // ── 7. Check robots.txt and sitemap ───────────────────────────────────────
  let hasRobotsTxt = false;
  let hasSitemapXml = false;
  try {
    const robotsRes = await fetchUrl(`${base.origin}/robots.txt`);
    hasRobotsTxt = robotsRes.status === 200 && robotsRes.html && robotsRes.html.length > 5;
  } catch {}
  try {
    const sitemapRes = await fetchUrl(`${base.origin}/sitemap.xml`);
    hasSitemapXml = sitemapRes.status === 200 && sitemapRes.html && sitemapRes.html.includes('<loc>');
  } catch {}

  // ── 8. Build structured findings ──────────────────────────────────────────
  const findings = {
    crawledPages: pageAnalyses.map(p => ({ url: p.url, title: safeText(p.title) })),
    missingTitlePages: pageAnalyses.filter(p => p.issues.missingTitle || p.issues.shortTitle).map(p => ({ label: safeText(p.title), url: p.url })),
    missingDescPages: pageAnalyses.filter(p => p.issues.missingMetaDescription || p.issues.shortMetaDescription).map(p => ({ label: safeText(p.title), url: p.url })),
    imagesWithoutAlt: pageAnalyses.flatMap(p => p.issues.imagesWithoutAlt.map(img => ({ label: img.fullSrc.split('/').pop().slice(0, 60) || 'image', url: img.fullSrc, onPage: p.url }))).slice(0, 10),
    pagesWithMissingAlt: pageAnalyses.filter(p => p.issues.imagesWithoutAlt.length > 0).map(p => ({ label: `${safeText(p.title)} (${p.issues.imagesWithoutAlt.length} image${p.issues.imagesWithoutAlt.length > 1 ? 's' : ''})`, url: p.url, imageUrls: p.issues.imagesWithoutAlt.map(i => i.fullSrc) })),
    missingH1Pages: pageAnalyses.filter(p => p.issues.missingH1).map(p => ({ label: safeText(p.title), url: p.url })),
    multipleH1Pages: pageAnalyses.filter(p => p.issues.multipleH1).map(p => ({ label: safeText(p.title), url: p.url })),
    thinContentPages: pageAnalyses.filter(p => p.issues.lowWordCount).map(p => ({ label: `${safeText(p.title)} (${p.issues.wordCount} words)`, url: p.url })),
    missingCanonicalPages: pageAnalyses.filter(p => p.issues.missingCanonical).map(p => ({ label: safeText(p.title), url: p.url })),
    noInternalLinkPages: pageAnalyses.filter(p => p.issues.noInternalLinks).map(p => ({ label: safeText(p.title), url: p.url })),
  };

  // ── 9. Build AI prompt with REAL data injected ────────────────────────────
  const realDataSummary = `
=== REAL MEASURED DATA — USE THESE EXACT VALUES IN YOUR JSON ===

CRAWL STATUS: ${crawlFailed ? 'FAILED — site could not be crawled. Mark crawl_failed: true in your JSON and note metrics are estimated.' : `SUCCESS — ${pageAnalyses.length} pages crawled`}

HTTPS: ${targetUrl.startsWith('https') ? 'YES (100/100)' : 'NO (0/100)'}
Robots.txt: ${hasRobotsTxt ? 'Found' : 'Missing'}
Sitemap.xml: ${hasSitemapXml ? 'Found' : 'Missing'}
Open Graph tags: ${realScores.scores.hasOgTags === 100 ? 'Present' : 'Missing'}
Structured data (JSON-LD): ${realScores.scores.hasStructuredData === 100 ? 'Present' : 'Missing'}
Homepage size: ${realScores.pageSizeKb}KB

ON-PAGE SCORES (computed from real crawl — use in metrics array with real_data: true):
- Title tag coverage: ${realScores.scores.titleScore}/100
- Meta description coverage: ${realScores.scores.metaDescScore}/100
- Image alt text coverage: ${realScores.scores.imageAltScore}/100
- H1 tag coverage: ${realScores.scores.h1Score}/100
- Canonical tag coverage: ${realScores.scores.canonicalScore}/100
- Content quality (word count): ${realScores.scores.contentScore}/100
- Internal linking: ${realScores.scores.internalLinksScore}/100
- Page size score: ${realScores.scores.pageSizeScore}/100 (${realScores.pageSizeKb}KB)
- Overall technical score: ${realScores.technicalScore}/100

${psiData ? `REAL CORE WEB VITALS from Google PageSpeed API (real_data: true):
- Performance score: ${psiData.perfScore}/100
- LCP (Largest Contentful Paint): ${psiData.lcp || 'N/A'}
- TBT (Total Blocking Time, proxy for FID): ${psiData.fid || 'N/A'}
- CLS (Cumulative Layout Shift): ${psiData.cls || 'N/A'}
- FCP (First Contentful Paint): ${psiData.fcp || 'N/A'}
- TTFB (Time to First Byte): ${psiData.ttfb || 'N/A'}
- Speed Index: ${psiData.speedIndex || 'N/A'}
- Accessibility score: ${psiData.accessibilityScore !== null ? psiData.accessibilityScore + '/100' : 'N/A'}
- Google SEO score (Lighthouse): ${psiData.seoScore !== null ? psiData.seoScore + '/100' : 'N/A'}
` : 'CORE WEB VITALS: Not available (no PAGESPEED_API_KEY set). Mark performance metrics as real_data: false and label as estimated.'}

OVERALL SCORE GUIDANCE:
- Use technical score (${realScores.technicalScore}) as the primary driver
- Blend with performance score if available (${psiData ? psiData.perfScore : 'N/A'})
- Do NOT invent a score — compute it from the data above

=== CRAWL PAGE DATA — USE ONLY THESE EXACT URLS IN affected_pages ===
Pages audited (${findings.crawledPages.length}):
${findings.crawledPages.map(p => `  - ${p.url} ("${safeText(p.title)}")`).join('\n')}

ISSUE FINDINGS:
• Missing/short title tag (${findings.missingTitlePages.length} pages): ${JSON.stringify(findings.missingTitlePages)}
• Missing/short meta description (${findings.missingDescPages.length} pages): ${JSON.stringify(findings.missingDescPages)}
• Images without alt text — by PAGE (${findings.pagesWithMissingAlt.length} pages): ${JSON.stringify(findings.pagesWithMissingAlt.map(p => ({ label: p.label, url: p.url })))}
• Images without alt text — EXACT IMAGE URLS: ${JSON.stringify(findings.imagesWithoutAlt.map(i => ({ label: i.label, url: i.url })))}
• Missing H1 tag (${findings.missingH1Pages.length} pages): ${JSON.stringify(findings.missingH1Pages)}
• Multiple H1 tags (${findings.multipleH1Pages.length} pages): ${JSON.stringify(findings.multipleH1Pages)}
• Thin content <300 words (${findings.thinContentPages.length} pages): ${JSON.stringify(findings.thinContentPages)}
• Missing canonical tag (${findings.missingCanonicalPages.length} pages): ${JSON.stringify(findings.missingCanonicalPages)}
• No internal links (${findings.noInternalLinkPages.length} pages): ${JSON.stringify(findings.noInternalLinkPages)}

STRICT RULES:
1. Every URL in affected_pages must come from the crawl data above — NEVER invent URLs.
2. For image alt issues, use exact image file URLs as affected_pages.
3. If a finding list is empty, skip that suggestion — do NOT fabricate pages.
4. NEVER use sitemap.xml, robots.txt, or any .xml/.txt as an affected_pages URL.
5. Add real_data: true to metrics that use the values above; real_data: false for estimates.
6. Include crawl_failed: ${crawlFailed} as a top-level field in your JSON.
=== END REAL DATA ===`;

  const finalPrompt = (prompt || '') + '\n\n' + realDataSummary;

  // ── 10. Call Groq ─────────────────────────────────────────────────────────
  try {
    const groqRes = await groqPost(GROQ_API_KEY, [
      {
        role: 'system',
        content: `You are an expert SEO auditor. CMS fingerprinted as: "${cmsData.name}" (${cmsData.confidence} confidence${cmsData.version ? ', v' + cmsData.version : ''}). 
You have REAL measured data. Your job is ONLY to write narrative text (summary, descriptions) and structured suggestions — NOT to invent scores. 
All numeric scores in the metrics array MUST come from the real data provided.
Never make up URLs. Never invent Core Web Vitals numbers if not provided.`,
      },
      { role: 'user', content: finalPrompt },
    ]);

    if (groqRes.status !== 200) return { statusCode: groqRes.status, body: JSON.stringify({ error: `Groq error ${groqRes.status}: ${groqRes.body}` }) };

    const aiText = JSON.parse(groqRes.body).choices[0].message.content;
    const cleaned = aiText.replace(/```json|```/g, '').trim();

    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch { const m = cleaned.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); else throw new Error('JSON parse failed'); }

    // ── 11. Hard overrides — CMS and real scores ───────────────────────────
    parsed.cms = { name: cmsData.name, confidence: cmsData.confidence, version: cmsData.version || null, notes: cmsData.notes };
    parsed.crawl_failed = crawlFailed;

    // ✅ Hard-override the technical category score with our computed value
    if (parsed.categories && parsed.categories.technical) {
      parsed.categories.technical.score = realScores.technicalScore;
      parsed.categories.technical.grade =
        realScores.technicalScore >= 90 ? 'A' :
        realScores.technicalScore >= 80 ? 'B' :
        realScores.technicalScore >= 70 ? 'C' :
        realScores.technicalScore >= 60 ? 'D' : 'F';
    }

    // ✅ Hard-override performance score if we have real PageSpeed data
    if (psiData && parsed.categories && parsed.categories.performance) {
      parsed.categories.performance.score = psiData.perfScore;
      parsed.categories.performance.grade =
        psiData.perfScore >= 90 ? 'A' :
        psiData.perfScore >= 80 ? 'B' :
        psiData.perfScore >= 70 ? 'C' :
        psiData.perfScore >= 60 ? 'D' : 'F';
    }

    // ✅ Recompute overall score from category scores
    if (parsed.categories) {
      const catScores = Object.values(parsed.categories).map(c => c.score);
      const weights = [0.30, 0.25, 0.20, 0.15, 0.10]; // technical, performance, content, ux, backlinks
      parsed.score = Math.round(catScores.reduce((acc, s, i) => acc + s * (weights[i] || 0.15), 0));
      parsed.grade =
        parsed.score >= 90 ? 'A' :
        parsed.score >= 80 ? 'B' :
        parsed.score >= 70 ? 'C' :
        parsed.score >= 60 ? 'D' : 'F';
    }

    // ✅ Inject real metrics that LLM cannot fake
    const realMetrics = [
      { name: 'HTTPS Enabled', value: targetUrl.startsWith('https') ? 'Yes' : 'No', score: realScores.scores.isHttps, status: realScores.scores.isHttps === 100 ? 'pass' : 'fail', real_data: true },
      { name: 'Title Tag Coverage', value: `${realScores.scores.titleScore}%`, score: realScores.scores.titleScore, status: realScores.scores.titleScore >= 80 ? 'pass' : realScores.scores.titleScore >= 50 ? 'warn' : 'fail', real_data: true },
      { name: 'Meta Description Coverage', value: `${realScores.scores.metaDescScore}%`, score: realScores.scores.metaDescScore, status: realScores.scores.metaDescScore >= 80 ? 'pass' : realScores.scores.metaDescScore >= 50 ? 'warn' : 'fail', real_data: true },
      { name: 'Image Alt Text Coverage', value: `${realScores.scores.imageAltScore}%`, score: realScores.scores.imageAltScore, status: realScores.scores.imageAltScore >= 80 ? 'pass' : realScores.scores.imageAltScore >= 50 ? 'warn' : 'fail', real_data: true },
      { name: 'H1 Tag Coverage', value: `${realScores.scores.h1Score}%`, score: realScores.scores.h1Score, status: realScores.scores.h1Score >= 80 ? 'pass' : realScores.scores.h1Score >= 50 ? 'warn' : 'fail', real_data: true },
      { name: 'Canonical Tag Coverage', value: `${realScores.scores.canonicalScore}%`, score: realScores.scores.canonicalScore, status: realScores.scores.canonicalScore >= 80 ? 'pass' : realScores.scores.canonicalScore >= 50 ? 'warn' : 'fail', real_data: true },
      { name: 'Open Graph Tags', value: realScores.scores.hasOgTags === 100 ? 'Present' : 'Missing', score: realScores.scores.hasOgTags, status: realScores.scores.hasOgTags === 100 ? 'pass' : 'fail', real_data: true },
      { name: 'Structured Data (JSON-LD)', value: realScores.scores.hasStructuredData === 100 ? 'Present' : 'Missing', score: realScores.scores.hasStructuredData, status: realScores.scores.hasStructuredData === 100 ? 'pass' : 'fail', real_data: true },
      { name: 'Robots.txt', value: hasRobotsTxt ? 'Found' : 'Missing', score: hasRobotsTxt ? 100 : 0, status: hasRobotsTxt ? 'pass' : 'fail', real_data: true },
      { name: 'Sitemap.xml', value: hasSitemapXml ? 'Found' : 'Missing', score: hasSitemapXml ? 100 : 0, status: hasSitemapXml ? 'pass' : 'fail', real_data: true },
      { name: 'Page Size (Homepage)', value: `${realScores.pageSizeKb}KB`, score: realScores.scores.pageSizeScore, status: realScores.scores.pageSizeScore >= 80 ? 'pass' : realScores.scores.pageSizeScore >= 60 ? 'warn' : 'fail', real_data: true },
      { name: 'Pages Crawled', value: `${pageAnalyses.length}`, score: pageAnalyses.length > 0 ? 100 : 0, status: pageAnalyses.length > 0 ? 'pass' : 'warn', real_data: true },
    ];

    // Add PageSpeed metrics if available
    if (psiData) {
      if (psiData.perfScore !== null) realMetrics.push({ name: 'Performance Score (PSI)', value: `${psiData.perfScore}/100`, score: psiData.perfScore, status: psiData.perfScore >= 90 ? 'pass' : psiData.perfScore >= 50 ? 'warn' : 'fail', real_data: true });
      if (psiData.lcp) realMetrics.push({ name: 'LCP (Largest Contentful Paint)', value: psiData.lcp, score: psiData.lcp.includes('Good') || parseFloat(psiData.lcp) < 2.5 ? 90 : parseFloat(psiData.lcp) < 4 ? 60 : 30, status: parseFloat(psiData.lcp) < 2.5 ? 'pass' : parseFloat(psiData.lcp) < 4 ? 'warn' : 'fail', real_data: true });
      if (psiData.cls) realMetrics.push({ name: 'CLS (Cumulative Layout Shift)', value: psiData.cls, score: parseFloat(psiData.cls) < 0.1 ? 90 : parseFloat(psiData.cls) < 0.25 ? 60 : 30, status: parseFloat(psiData.cls) < 0.1 ? 'pass' : parseFloat(psiData.cls) < 0.25 ? 'warn' : 'fail', real_data: true });
      if (psiData.fcp) realMetrics.push({ name: 'FCP (First Contentful Paint)', value: psiData.fcp, score: parseFloat(psiData.fcp) < 1.8 ? 90 : parseFloat(psiData.fcp) < 3 ? 60 : 30, status: parseFloat(psiData.fcp) < 1.8 ? 'pass' : parseFloat(psiData.fcp) < 3 ? 'warn' : 'fail', real_data: true });
      if (psiData.accessibilityScore !== null) realMetrics.push({ name: 'Accessibility (Lighthouse)', value: `${psiData.accessibilityScore}/100`, score: psiData.accessibilityScore, status: psiData.accessibilityScore >= 90 ? 'pass' : psiData.accessibilityScore >= 70 ? 'warn' : 'fail', real_data: true });
    }

    // Merge: keep LLM-generated metrics that aren't already covered by real ones, mark them estimated
    const realMetricNames = new Set(realMetrics.map(m => m.name.toLowerCase()));
    const aiMetrics = (parsed.metrics || [])
      .filter(m => !realMetricNames.has(m.name.toLowerCase()))
      .map(m => ({ ...m, real_data: false }));

    parsed.metrics = [...realMetrics, ...aiMetrics];

    // ── 12. Hard-override affected_pages with real crawled data ──────────────
    const allCrawledUrls = new Set(findings.crawledPages.map(p => p.url));
    const issueKeywordMap = [
      { keywords: ['optimize image', 'image alt', 'alt text', 'missing alt', 'alt tag'], pages: findings.imagesWithoutAlt.length > 0 ? findings.imagesWithoutAlt.map(i => ({ label: i.label, url: i.url })) : findings.pagesWithMissingAlt.map(p => ({ label: p.label, url: p.url })) },
      { keywords: ['meta title', 'title tag', 'page title', 'missing title'], pages: findings.missingTitlePages },
      { keywords: ['meta description', 'missing description', 'meta tag', 'complete meta'], pages: findings.missingDescPages.length > 0 ? findings.missingDescPages : findings.missingTitlePages },
      { keywords: ['internal link', 'internal linking'], pages: findings.noInternalLinkPages },
      { keywords: ['content quality', 'high-quality content', 'thin content', 'word count', 'create content'], pages: findings.thinContentPages },
      { keywords: ['h1', 'heading tag', 'heading structure', 'missing h1', 'multiple h1'], pages: [...findings.missingH1Pages, ...findings.multipleH1Pages] },
      { keywords: ['canonical', 'duplicate url', 'canonical tag'], pages: findings.missingCanonicalPages },
    ];

    if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
      parsed.suggestions = parsed.suggestions
        .map(s => {
          const key = ((s.title || '') + ' ' + (s.description || '')).toLowerCase();
          for (const { keywords, pages } of issueKeywordMap) {
            if (keywords.some(kw => key.includes(kw)) && pages.length > 0) {
              s.affected_pages = pages.slice(0, 6);
              return s;
            }
          }
          if (s.affected_pages && Array.isArray(s.affected_pages)) {
            const valid = s.affected_pages.filter(p => {
              if (/\.(jpg|jpeg|png|gif|svg|webp|ico|bmp|tiff|avif)($|\?)/i.test(p.url)) return true;
              return allCrawledUrls.has(p.url);
            });
            s.affected_pages = valid.length > 0 ? valid : s.affected_pages.slice(0, 3);
          }
          return s;
        })
        .filter(s => {
          if (!s.affected_pages || s.affected_pages.length === 0) return true;
          const allBad = s.affected_pages.every(p => /\.(xml|txt|json|csv|gz)$/i.test(p.url));
          return !allBad;
        });
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(parsed),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Function crashed: ' + err.message }) };
  }
};
