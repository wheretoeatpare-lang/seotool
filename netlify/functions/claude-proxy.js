const https = require('https');
const http = require('http');

// ─── Fetch a single page ───────────────────────────────────────────────────────
function fetchPage(targetUrl, redirectCount = 0) {
  return new Promise((resolve) => {
    if (redirectCount > 3) return resolve({ html: '', headers: {}, status: 0, finalUrl: targetUrl });
    let parsed;
    try { parsed = new URL(targetUrl); } catch { return resolve({ html: '', headers: {}, status: 0, finalUrl: targetUrl }); }

    const lib = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      path: (parsed.pathname || '/') + (parsed.search || ''),
      method: 'GET',
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
      },
    };

    let data = '';
    const req = lib.request(options, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const loc = res.headers.location;
        const redirectUrl = loc.startsWith('http') ? loc : `${parsed.protocol}//${parsed.hostname}${loc}`;
        return fetchPage(redirectUrl, redirectCount + 1).then(resolve).catch(() => resolve({ html: '', headers: {}, status: 0, finalUrl: targetUrl }));
      }
      res.setEncoding('utf8');
      res.on('data', (chunk) => { if (data.length < 300000) data += chunk; });
      res.on('end', () => resolve({ html: data, headers: res.headers, status: res.statusCode, finalUrl: targetUrl }));
    });
    req.on('error', () => resolve({ html: '', headers: {}, status: 0, finalUrl: targetUrl }));
    req.on('timeout', () => { req.destroy(); resolve({ html: '', headers: {}, status: 0, finalUrl: targetUrl }); });
    req.end();
  });
}

// ─── Extract internal links from HTML ─────────────────────────────────────────
function extractInternalLinks(html, baseUrl) {
  const base = new URL(baseUrl);
  const links = new Set();
  const hrefRegex = /href=["']([^"'#?][^"']*?)["']/gi;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1].trim();
    try {
      const full = href.startsWith('http') ? new URL(href) : new URL(href, base.origin);
      if (full.hostname === base.hostname && !href.match(/\.(jpg|jpeg|png|gif|svg|webp|ico|pdf|zip|css|js|xml|json|txt|woff|woff2|ttf|eot)$/i)) {
        links.add(full.origin + full.pathname);
      }
    } catch {}
  }
  return [...links].slice(0, 30); // cap at 30 to avoid too many fetches
}

// ─── Sitemap parser ────────────────────────────────────────────────────────────
async function getSitemapUrls(baseUrl) {
  const base = new URL(baseUrl);
  const urls = [];
  for (const path of ['/sitemap.xml', '/sitemap_index.xml', '/sitemap.xml.gz']) {
    try {
      const res = await fetchPage(`${base.origin}${path}`);
      if (res.status === 200 && res.html.includes('<loc>')) {
        const locs = [...res.html.matchAll(/<loc>(.*?)<\/loc>/gi)].map(m => m[1].trim());
        urls.push(...locs.filter(u => {
          try { return new URL(u).hostname === base.hostname; } catch { return false; }
        }));
        if (urls.length > 0) break;
      }
    } catch {}
  }
  return urls.slice(0, 20);
}

// ─── Analyse a single page for SEO issues ─────────────────────────────────────
function analysePage(html, pageUrl) {
  const issues = {
    missingMetaTitle: false,
    missingMetaDescription: false,
    missingAltTags: [],        // array of img src values missing alt
    missingH1: false,
    multipleH1: false,
    lowWordCount: false,
    missingCanonical: false,
    brokenInternalLinks: [],
    noInternalLinks: false,
    largePage: false,
  };

  if (!html || html.length < 100) return issues;

  // Meta title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch || titleMatch[1].trim().length === 0) issues.missingMetaTitle = true;

  // Meta description
  if (!/<meta[^>]+name=["']description["'][^>]+content=["'][^"']{10,}/i.test(html) &&
      !/<meta[^>]+content=["'][^"']{10,}["'][^>]+name=["']description["']/i.test(html)) {
    issues.missingMetaDescription = true;
  }

  // Images missing alt
  const imgTags = [...html.matchAll(/<img([^>]*)>/gi)];
  for (const img of imgTags) {
    const attrs = img[1];
    const hasAlt = /alt=["'][^"']*["']/i.test(attrs);
    const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
    if (!hasAlt && srcMatch) {
      issues.missingAltTags.push(srcMatch[1].slice(0, 80));
    }
  }

  // H1 tags
  const h1Matches = [...html.matchAll(/<h1[^>]*>/gi)];
  if (h1Matches.length === 0) issues.missingH1 = true;
  if (h1Matches.length > 1) issues.multipleH1 = true;

  // Word count (strip tags)
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = text.split(' ').filter(w => w.length > 2).length;
  if (wordCount < 300) issues.lowWordCount = true;

  // Canonical
  if (!/<link[^>]+rel=["']canonical["']/i.test(html)) issues.missingCanonical = true;

  // Internal links count
  const internalLinkCount = (html.match(/<a[^>]+href=["'][^"'#][^"']*["']/gi) || []).length;
  if (internalLinkCount < 2) issues.noInternalLinks = true;

  // Page size
  if (html.length > 200000) issues.largePage = true;

  return issues;
}

// ─── CMS Detection ────────────────────────────────────────────────────────────
function detectCMS(html, headers) {
  const cookieHeader = Array.isArray(headers['set-cookie']) ? headers['set-cookie'].join(' ') : (headers['set-cookie'] || '');
  const xPoweredBy = (headers['x-powered-by'] || '').toLowerCase();
  const xGenerator = (headers['x-generator'] || '').toLowerCase();
  const serverHeader = (headers['server'] || '').toLowerCase();

  const cmsList = [
    { name: 'WordPress', tests: [/\/wp-content\/(themes|plugins|uploads)\//i.test(html), /\/wp-includes\//i.test(html), /<meta[^>]+generator[^>]*WordPress/i.test(html), /wp-json/i.test(html), /wpemoji|wp\.i18n/i.test(html), cookieHeader.toLowerCase().includes('wordpress') || cookieHeader.toLowerCase().includes('wp-settings'), xGenerator.includes('wordpress')], getVersion: () => { const m = html.match(/<meta[^>]+generator[^>]*WordPress\s*([\d.]+)/i); return m ? m[1] : null; } },
    { name: 'Shopify', tests: [/cdn\.shopify\.com/i.test(html), /shopify\.com\/s\/files/i.test(html), /<meta[^>]+generator[^>]*Shopify/i.test(html), /Shopify\.(theme|shop|locale)/i.test(html), cookieHeader.toLowerCase().includes('_shopify')], getVersion: () => null },
    { name: 'Wix', tests: [/static\.wixstatic\.com/i.test(html), /wixsite\.com|wix-code/i.test(html), /<meta[^>]+generator[^>]*Wix/i.test(html), /wixBiSession/i.test(html), xPoweredBy.includes('wix')], getVersion: () => null },
    { name: 'Squarespace', tests: [/static\.squarespace\.com/i.test(html), /<meta[^>]+generator[^>]*Squarespace/i.test(html), /Static\.SQUARESPACE_CONTEXT/i.test(html), cookieHeader.toLowerCase().includes('squarespace')], getVersion: () => null },
    { name: 'Webflow', tests: [/\.webflow\.io/i.test(html), /webflow\.com\/css|webflow\.js/i.test(html), /<meta[^>]+generator[^>]*Webflow/i.test(html), /data-wf-page/i.test(html), xGenerator.includes('webflow')], getVersion: () => null },
    { name: 'Joomla', tests: [/<meta[^>]+generator[^>]*Joomla/i.test(html), /\/components\/com_/i.test(html), /\/media\/jui\//i.test(html), cookieHeader.toLowerCase().includes('joomla')], getVersion: () => { const m = html.match(/<meta[^>]+generator[^>]*Joomla!\s*([\d.]+)/i); return m ? m[1] : null; } },
    { name: 'Drupal', tests: [/<meta[^>]+generator[^>]*Drupal/i.test(html), /\/sites\/default\/files\//i.test(html), /Drupal\.settings/i.test(html), xGenerator.includes('drupal')], getVersion: () => { const m = xGenerator.match(/drupal\s*([\d.]+)/i); return m ? m[1] : null; } },
    { name: 'Ghost', tests: [/<meta[^>]+generator[^>]*Ghost/i.test(html), /ghost\.io|ghost\/content/i.test(html), xGenerator.includes('ghost')], getVersion: () => null },
    { name: 'Next.js', tests: [/\/_next\/static\//i.test(html), /__NEXT_DATA__/i.test(html), xPoweredBy.includes('next.js')], getVersion: () => { const m = xPoweredBy.match(/next\.js\s*([\d.]+)/i); return m ? m[1] : null; } },
    { name: 'Nuxt.js', tests: [/\/_nuxt\//i.test(html), /window\.__NUXT__/i.test(html), xPoweredBy.includes('nuxt')], getVersion: () => null },
    { name: 'PrestaShop', tests: [/<meta[^>]+generator[^>]*PrestaShop/i.test(html), /\/modules\/ps_/i.test(html)], getVersion: () => null },
    { name: 'HubSpot CMS', tests: [/hs-scripts\.com|hs-analytics\.net/i.test(html), /hbspt\./i.test(html), /hub_generated/i.test(html)], getVersion: () => null },
    { name: 'Laravel', tests: [cookieHeader.toLowerCase().includes('laravel_session'), cookieHeader.toLowerCase().includes('xsrf-token') && xPoweredBy.includes('php')], getVersion: () => null },
  ];

  const results = [];
  for (const c of cmsList) {
    const hits = c.tests.filter(Boolean).length;
    if (hits >= 1) results.push({ name: c.name, hits, confidence: hits >= 3 ? 'High' : hits === 2 ? 'Medium' : 'Low', version: c.getVersion ? c.getVersion() : null });
  }
  results.sort((a, b) => b.hits - a.hits);

  if (results.length === 0) {
    const genMatch = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"'<>]+)["']/i) || html.match(/<meta[^>]+content=["']([^"'<>]+)["'][^>]+name=["']generator["']/i);
    if (genMatch) return { name: genMatch[1].split(' ').slice(0, 3).join(' ').trim(), confidence: 'Medium', version: null, notes: 'Detected via <meta name="generator"> tag' };
    return { name: 'Custom / Unknown', confidence: 'Low', version: null, notes: 'No known CMS fingerprints found' };
  }

  const top = results[0];
  return { name: top.name, confidence: top.confidence, version: top.version, notes: `Matched ${top.hits} fingerprint(s): HTML paths, meta tags, cookies, headers` };
}

// ─── POST helper ──────────────────────────────────────────────────────────────
function httpsPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = { hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
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
  if (!GROQ_API_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'GROQ_API_KEY is not set. Go to Netlify → Site configuration → Environment variables and add it.' }) };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

  const { url, options, prompt } = body;
  if (!url) return { statusCode: 400, body: JSON.stringify({ error: 'Missing url parameter' }) };

  const targetUrl = url.startsWith('http') ? url : `https://${url}`;

  // ── Step 1: Fetch homepage ──
  let homePage = { html: '', headers: {}, status: 0 };
  try { homePage = await fetchPage(targetUrl); } catch {}

  // ── Step 2: Detect CMS from real HTML ──
  let cmsData = { name: 'Unknown', confidence: 'Low', version: null, notes: 'Site could not be fetched' };
  if (homePage.html) cmsData = detectCMS(homePage.html, homePage.headers);

  // ── Step 3: Discover real pages (sitemap first, then crawl links) ──
  let pagesToCheck = [targetUrl];
  try {
    const sitemapUrls = await getSitemapUrls(targetUrl);
    if (sitemapUrls.length > 0) {
      pagesToCheck = [targetUrl, ...sitemapUrls.filter(u => u !== targetUrl)].slice(0, 12);
    } else {
      const crawled = extractInternalLinks(homePage.html, targetUrl);
      pagesToCheck = [targetUrl, ...crawled.filter(u => u !== targetUrl)].slice(0, 12);
    }
  } catch {}

  // ── Step 4: Fetch each discovered page and analyse for real SEO issues ──
  const pageReports = [];
  const fetchPromises = pagesToCheck.map(async (pageUrl) => {
    try {
      const page = pageUrl === targetUrl ? homePage : await fetchPage(pageUrl);
      if (page.html && page.html.length > 200) {
        const issues = analysePage(page.html, pageUrl);
        const titleMatch = page.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const pageTitle = titleMatch ? titleMatch[1].trim().slice(0, 60) : pageUrl;
        pageReports.push({ url: pageUrl, title: pageTitle, issues });
      }
    } catch {}
  });
  await Promise.all(fetchPromises);

  // ── Step 5: Build structured real findings ──
  const realFindings = {
    missingMetaTitlePages: pageReports.filter(p => p.issues.missingMetaTitle).map(p => ({ label: p.title || 'Page', url: p.url })),
    missingMetaDescPages: pageReports.filter(p => p.issues.missingMetaDescription).map(p => ({ label: p.title || 'Page', url: p.url })),
    missingAltPages: pageReports.filter(p => p.issues.missingAltTags.length > 0).map(p => ({ label: p.title || 'Page', url: p.url, count: p.issues.missingAltTags.length })),
    missingH1Pages: pageReports.filter(p => p.issues.missingH1).map(p => ({ label: p.title || 'Page', url: p.url })),
    multipleH1Pages: pageReports.filter(p => p.issues.multipleH1).map(p => ({ label: p.title || 'Page', url: p.url })),
    lowWordCountPages: pageReports.filter(p => p.issues.lowWordCount).map(p => ({ label: p.title || 'Page', url: p.url })),
    missingCanonicalPages: pageReports.filter(p => p.issues.missingCanonical).map(p => ({ label: p.title || 'Page', url: p.url })),
    noInternalLinksPages: pageReports.filter(p => p.issues.noInternalLinks).map(p => ({ label: p.title || 'Page', url: p.url })),
    totalPagesCrawled: pageReports.length,
    crawledUrls: pageReports.map(p => p.url),
  };

  // ── Step 6: Build the AI prompt with REAL findings injected ──
  const findingsContext = `
REAL CRAWL DATA (use these exact URLs for affected_pages in suggestions — do not invent URLs):
- Pages crawled (${realFindings.totalPagesCrawled}): ${realFindings.crawledUrls.join(', ')}
- Missing meta title (${realFindings.missingMetaTitlePages.length} pages): ${JSON.stringify(realFindings.missingMetaTitlePages)}
- Missing meta description (${realFindings.missingMetaDescPages.length} pages): ${JSON.stringify(realFindings.missingMetaDescPages)}
- Images missing alt text (${realFindings.missingAltPages.length} pages): ${JSON.stringify(realFindings.missingAltPages)}
- Missing H1 tag (${realFindings.missingH1Pages.length} pages): ${JSON.stringify(realFindings.missingH1Pages)}
- Multiple H1 tags (${realFindings.multipleH1Pages.length} pages): ${JSON.stringify(realFindings.multipleH1Pages)}
- Low word count <300 words (${realFindings.lowWordCountPages.length} pages): ${JSON.stringify(realFindings.lowWordCountPages)}
- Missing canonical tag (${realFindings.missingCanonicalPages.length} pages): ${JSON.stringify(realFindings.missingCanonicalPages)}
- No/few internal links (${realFindings.noInternalLinksPages.length} pages): ${JSON.stringify(realFindings.noInternalLinksPages)}

RULES FOR affected_pages:
1. ONLY use URLs from the crawled pages list above.
2. For "Optimize Images" suggestion → use ONLY pages from missingAltPages list above.
3. For "Meta Tags" / "Title Tag" suggestion → use ONLY pages from missingMetaTitlePages or missingMetaDescPages above.
4. For "Internal Linking" suggestion → use ONLY pages from noInternalLinksPages above.
5. For "Content Quality" / "High-Quality Content" suggestion → use ONLY pages from lowWordCountPages above.
6. If a finding has 0 affected pages, do NOT include that suggestion.
7. Never invent or guess URLs — only use URLs from the crawled list.`;

  const finalPrompt = (prompt || '') + '\n\n' + findingsContext;

  const requestBody = JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 3000,
    messages: [
      {
        role: 'system',
        content: `You are an expert SEO auditor. CMS has been fingerprinted as: "${cmsData.name}" (${cmsData.confidence} confidence). You have been given REAL crawl data with exact page URLs. You MUST use only those exact URLs in affected_pages — never fabricate or guess URLs.`,
      },
      { role: 'user', content: finalPrompt },
    ],
  });

  try {
    const response = await httpsPost(
      'https://api.groq.com/openai/v1/chat/completions',
      { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
      requestBody
    );

    if (response.status !== 200) return { statusCode: response.status, body: JSON.stringify({ error: `Groq API returned ${response.status}: ${response.body}` }) };

    const data = JSON.parse(response.body);
    const text = data.choices[0].message.content;
    const clean = text.replace(/```json|```/g, '').trim();

    let parsed;
    try { parsed = JSON.parse(clean); }
    catch {
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      else throw new Error('Could not parse AI response as JSON');
    }

    // ── Hard-override CMS and affected_pages with real data ──
    parsed.cms = { name: cmsData.name, confidence: cmsData.confidence, version: cmsData.version || null, notes: cmsData.notes };

    // Post-process suggestions: replace affected_pages with our real crawled data
    const issueMap = {
      'meta title': realFindings.missingMetaTitlePages,
      'title tag': realFindings.missingMetaTitlePages,
      'meta description': realFindings.missingMetaDescPages,
      'meta tag': [...realFindings.missingMetaTitlePages, ...realFindings.missingMetaDescPages],
      'image': realFindings.missingAltPages,
      'alt': realFindings.missingAltPages,
      'optimize image': realFindings.missingAltPages,
      'internal link': realFindings.noInternalLinksPages,
      'internal linking': realFindings.noInternalLinksPages,
      'content': realFindings.lowWordCountPages,
      'word count': realFindings.lowWordCountPages,
      'high-quality': realFindings.lowWordCountPages,
      'canonical': realFindings.missingCanonicalPages,
      'h1': [...realFindings.missingH1Pages, ...realFindings.multipleH1Pages],
      'heading': [...realFindings.missingH1Pages, ...realFindings.multipleH1Pages],
    };

    if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
      parsed.suggestions = parsed.suggestions.map(s => {
        const titleLower = (s.title || '').toLowerCase();
        const descLower = (s.description || '').toLowerCase();
        for (const [keyword, pages] of Object.entries(issueMap)) {
          if ((titleLower.includes(keyword) || descLower.includes(keyword)) && pages.length > 0) {
            s.affected_pages = pages.slice(0, 5).map(p => ({ label: p.label || p.url, url: p.url }));
            break;
          }
        }
        // If no match found but AI gave fake URLs, clear them if they're not in crawled list
        if (s.affected_pages && Array.isArray(s.affected_pages)) {
          const crawledSet = new Set(realFindings.crawledUrls);
          const validPages = s.affected_pages.filter(p => crawledSet.has(p.url));
          if (validPages.length > 0) s.affected_pages = validPages;
        }
        return s;
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
