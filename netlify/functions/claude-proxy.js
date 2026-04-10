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

// ─── Normalise URL (remove trailing slash, fragments) ─────────────────────────
function normaliseUrl(href, base) {
  try {
    const u = href.startsWith('http') ? new URL(href) : new URL(href, base);
    return u.origin + u.pathname.replace(/\/$/, '') || '/';
  } catch { return null; }
}

// ─── Extract internal page links from HTML (skip assets, feeds, sitemaps) ─────
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

// ─── Parse sitemap and return only HTML page URLs (not sub-sitemap URLs) ──────
async function getPageUrlsFromSitemap(baseUrl) {
  const base = new URL(baseUrl);
  const sitemapPaths = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap/sitemap.xml', '/page-sitemap.xml', '/post-sitemap.xml'];
  const htmlPageUrls = [];

  for (const path of sitemapPaths) {
    try {
      const res = await fetchUrl(`${base.origin}${path}`);
      if (res.status !== 200 || !res.html.includes('<loc>')) continue;

      const locs = [...res.html.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi)].map(m => m[1].trim());

      // If it's a sitemap INDEX (contains other sitemaps), fetch each child sitemap
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
        // Regular sitemap — filter to only real HTML pages
        for (const loc of locs) {
          if (isHtmlPage(loc, base.hostname)) htmlPageUrls.push(loc);
        }
      }

      if (htmlPageUrls.length > 0) break; // found pages, stop trying other sitemap paths
    } catch {}
  }

  return htmlPageUrls.slice(0, 20);
}

// ─── Check if a URL is likely an HTML page (not a sitemap, image, feed etc) ───
function isHtmlPage(url, hostname) {
  try {
    const u = new URL(url);
    if (u.hostname !== hostname) return false;
    if (/\.(xml|json|txt|pdf|jpg|jpeg|png|gif|svg|webp|ico|css|js|zip|mp4|mp3)$/i.test(u.pathname)) return false;
    if (/sitemap|feed|rss|xmlrpc/i.test(u.pathname)) return false;
    return true;
  } catch { return false; }
}

// ─── Get page title from HTML ──────────────────────────────────────────────────
function getPageTitle(html, fallbackUrl) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m && m[1].trim()) return m[1].trim().slice(0, 70);
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
      imagesWithoutAlt: [],   // will hold { src, fullSrc } objects
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

  // ── Title ──
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch || !titleMatch[1].trim()) {
    result.issues.missingTitle = true;
  } else if (titleMatch[1].trim().length < 20) {
    result.issues.shortTitle = true;
  }

  // ── Meta description ──
  const metaDescMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  if (!metaDescMatch) {
    result.issues.missingMetaDescription = true;
  } else if (metaDescMatch[1].trim().length < 50) {
    result.issues.shortMetaDescription = true;
  }

  // ── Images without alt ──
  const imgRegex = /<img([^>]*)>/gi;
  let imgMatch;
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    const attrs = imgMatch[1];
    // Skip if alt attribute exists and is non-empty
    const altMatch = attrs.match(/alt=["']([^"']*)["']/i);
    if (altMatch && altMatch[1].trim().length > 0) continue;

    // Get the src
    const srcMatch = attrs.match(/src=["']([^"']+)["']/i)
      || attrs.match(/data-src=["']([^"']+)["']/i);
    if (!srcMatch) continue;

    const rawSrc = srcMatch[1].trim();
    // Skip tracking pixels and data URIs
    if (rawSrc.startsWith('data:') || rawSrc.includes('pixel') || rawSrc.length < 5) continue;

    // Build full image URL
    let fullSrc = rawSrc;
    try {
      fullSrc = rawSrc.startsWith('http') ? rawSrc : new URL(rawSrc, base.origin).href;
    } catch {}

    result.issues.imagesWithoutAlt.push({ src: rawSrc.slice(0, 120), fullSrc: fullSrc.slice(0, 200) });
  }

  // ── H1 tags ──
  const h1Count = (html.match(/<h1[^>]*>/gi) || []).length;
  if (h1Count === 0) result.issues.missingH1 = true;
  if (h1Count > 1) result.issues.multipleH1 = true;

  // ── Word count (strip all tags and scripts) ──
  const textOnly = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = textOnly.split(' ').filter(w => w.length > 2);
  result.issues.wordCount = words.length;
  if (words.length < 300) result.issues.lowWordCount = true;

  // ── Canonical ──
  if (!/<link[^>]+rel=["']canonical["']/i.test(html)) result.issues.missingCanonical = true;

  // ── Internal links ──
  const internalLinks = (html.match(new RegExp(`href=["'][^"']*${base.hostname}[^"']*["']`, 'gi')) || []).length
    + (html.match(/href=["']\/[^"']*["']/gi) || []).length;
  result.issues.internalLinkCount = internalLinks;
  if (internalLinks < 2) result.issues.noInternalLinks = true;

  return result;
}

// ─── CMS Detection ────────────────────────────────────────────────────────────
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

// ─── Groq POST ────────────────────────────────────────────────────────────────
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

// ─── Main handler ─────────────────────────────────────────────────────────────
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'GROQ_API_KEY is not set.' }) };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { url, options, prompt } = body;
  if (!url) return { statusCode: 400, body: JSON.stringify({ error: 'Missing url' }) };

  const targetUrl = url.startsWith('http') ? url : `https://${url}`;
  const base = new URL(targetUrl);

  // ── 1. Fetch homepage ──────────────────────────────────────────────────────
  let homePage = { html: '', headers: {}, status: 0 };
  try { homePage = await fetchUrl(targetUrl); } catch {}

  // ── 2. Detect CMS ──────────────────────────────────────────────────────────
  const cmsData = homePage.html
    ? detectCMS(homePage.html, homePage.headers)
    : { name: 'Unknown', confidence: 'Low', version: null, notes: 'Could not fetch site' };

  // ── 3. Collect real page URLs to audit ────────────────────────────────────
  // Try sitemap first (filtered to HTML pages only), then crawl homepage links
  let pageUrls = [targetUrl];
  try {
    const sitemapPages = await getPageUrlsFromSitemap(targetUrl);
    if (sitemapPages.length >= 2) {
      // Use sitemap pages but always include homepage
      const withHome = [targetUrl, ...sitemapPages.filter(u => normaliseUrl(u, base.origin) !== normaliseUrl(targetUrl, base.origin))];
      pageUrls = [...new Set(withHome)].slice(0, 12);
    } else if (homePage.html) {
      // Fall back to crawling links from homepage
      const crawled = extractPageLinks(homePage.html, targetUrl);
      pageUrls = [...new Set([targetUrl, ...crawled])].slice(0, 12);
    }
  } catch {}

  // ── 4. Fetch & analyse each page in parallel ──────────────────────────────
  const pageAnalyses = [];
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

  // ── 5. Build structured findings with EXACT URLs ──────────────────────────
  const findings = {
    crawledPages: pageAnalyses.map(p => ({ url: p.url, title: p.title })),

    // Meta title issues → exact page URLs
    missingTitlePages: pageAnalyses
      .filter(p => p.issues.missingTitle || p.issues.shortTitle)
      .map(p => ({ label: p.title, url: p.url })),

    // Meta description issues → exact page URLs
    missingDescPages: pageAnalyses
      .filter(p => p.issues.missingMetaDescription || p.issues.shortMetaDescription)
      .map(p => ({ label: p.title, url: p.url })),

    // Images without alt → exact image URLs (not page URLs)
    imagesWithoutAlt: pageAnalyses.flatMap(p =>
      p.issues.imagesWithoutAlt.map(img => ({
        label: img.fullSrc.split('/').pop().slice(0, 60) || 'image',
        url: img.fullSrc,
        onPage: p.url,
      }))
    ).slice(0, 10),

    // Also group by page for image suggestions
    pagesWithMissingAlt: pageAnalyses
      .filter(p => p.issues.imagesWithoutAlt.length > 0)
      .map(p => ({
        label: `${p.title} (${p.issues.imagesWithoutAlt.length} image${p.issues.imagesWithoutAlt.length > 1 ? 's' : ''})`,
        url: p.url,
        imageUrls: p.issues.imagesWithoutAlt.map(i => i.fullSrc),
      })),

    // H1 issues → exact page URLs
    missingH1Pages: pageAnalyses
      .filter(p => p.issues.missingH1)
      .map(p => ({ label: p.title, url: p.url })),

    multipleH1Pages: pageAnalyses
      .filter(p => p.issues.multipleH1)
      .map(p => ({ label: p.title, url: p.url })),

    // Thin content → exact page URLs
    thinContentPages: pageAnalyses
      .filter(p => p.issues.lowWordCount)
      .map(p => ({ label: `${p.title} (${p.issues.wordCount} words)`, url: p.url })),

    // Missing canonical → exact page URLs
    missingCanonicalPages: pageAnalyses
      .filter(p => p.issues.missingCanonical)
      .map(p => ({ label: p.title, url: p.url })),

    // No internal links → exact page URLs
    noInternalLinkPages: pageAnalyses
      .filter(p => p.issues.noInternalLinks)
      .map(p => ({ label: p.title, url: p.url })),
  };

  // ── 6. Build AI prompt with real data ─────────────────────────────────────
  const crawlSummary = `
=== REAL CRAWL DATA — USE ONLY THESE EXACT URLS IN affected_pages ===
Pages audited (${findings.crawledPages.length}):
${findings.crawledPages.map(p => `  - ${p.url} ("${p.title}")`).join('\n')}

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

STRICT RULES for affected_pages in your JSON:
1. "Optimize Images" suggestion → affected_pages = EXACT IMAGE URLS (the image file URLs, not the page URLs)
2. "Meta Tags" / "Title" suggestion → affected_pages = pages from missingTitlePages or missingDescPages
3. "Internal Linking" suggestion → affected_pages = pages from noInternalLinkPages
4. "Content Quality" / "High-Quality Content" suggestion → affected_pages = pages from thinContentPages
5. "H1" / "Heading" suggestion → affected_pages = pages from missingH1Pages or multipleH1Pages
6. "Canonical" suggestion → affected_pages = pages from missingCanonicalPages
7. If a finding list is empty (0 pages), skip that suggestion entirely — do NOT fabricate URLs.
8. NEVER use sitemap.xml, robots.txt, or any .xml/.txt file as an affected page URL.
9. NEVER invent URLs — every URL in affected_pages must come from the crawl data above.
=== END CRAWL DATA ===`;

  const finalPrompt = (prompt || '') + '\n\n' + crawlSummary;

  // ── 7. Call Groq ──────────────────────────────────────────────────────────
  try {
    const groqRes = await groqPost(GROQ_API_KEY, [
      {
        role: 'system',
        content: `You are an expert SEO auditor. CMS has been fingerprinted as: "${cmsData.name}" (${cmsData.confidence} confidence${cmsData.version ? ', v' + cmsData.version : ''}). You have been given REAL crawl data. Every URL in affected_pages MUST come from the provided crawl data — never guess or invent URLs.`,
      },
      { role: 'user', content: finalPrompt },
    ]);

    if (groqRes.status !== 200) return { statusCode: groqRes.status, body: JSON.stringify({ error: `Groq error ${groqRes.status}: ${groqRes.body}` }) };

    const aiText = JSON.parse(groqRes.body).choices[0].message.content;
    const cleaned = aiText.replace(/```json|```/g, '').trim();

    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch { const m = cleaned.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); else throw new Error('JSON parse failed'); }

    // ── 8. Hard-override CMS with fingerprinted result ──────────────────────
    parsed.cms = { name: cmsData.name, confidence: cmsData.confidence, version: cmsData.version || null, notes: cmsData.notes };

    // ── 9. Hard-override affected_pages with real crawled data ──────────────
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
          // Validate any remaining AI-given URLs — remove ones not in crawled set
          if (s.affected_pages && Array.isArray(s.affected_pages)) {
            const valid = s.affected_pages.filter(p => {
              // Allow image URLs (they won't be in crawledPages but are real)
              if (/\.(jpg|jpeg|png|gif|svg|webp|ico|bmp|tiff|avif|webp)($|\?)/i.test(p.url)) return true;
              return allCrawledUrls.has(p.url);
            });
            s.affected_pages = valid.length > 0 ? valid : s.affected_pages.slice(0, 3);
          }
          return s;
        })
        // Remove suggestions where affected_pages only contain .xml/.txt/.json files
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
