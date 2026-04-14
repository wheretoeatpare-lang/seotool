// ─────────────────────────────────────────────────────────────────────────────
// ScrapeKit Worker v2.0
// Inspired by scrape.do — single-request web data extraction API
// Supports GET and POST. Returns structured JSON from any URL.
//
// GET  /api/extract?url=https://...&fields=emails,phones,social&token=KEY
// POST /api/extract  { "url": "...", "fields": [...], "token": "..." }
// POST /api/scrape   (legacy endpoint — contact extractor, no auth)
// ─────────────────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── CORS preflight
    if (request.method === 'OPTIONS') return corsOk();

    // ── Routes
    if (url.pathname === '/api/extract')    return handleExtract(request, env);
    if (url.pathname === '/api/scrape')     return handleScrape(request, env);
    if (url.pathname === '/api/detect-cms') return handleCMSDetect(request);
    if (url.pathname === '/api/page-data')  return handlePageData(request);
    if (url.pathname === '/api/claude')     return handleAudit(request, env);

    return env.ASSETS.fetch(request);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// CORS & RESPONSE HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Api-Key',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
function err(msg, status = 400) {
  return json({ success: false, error: msg, code: status }, status);
}
function corsOk() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// ─────────────────────────────────────────────────────────────────────────────
// USER-AGENTS POOL
// ─────────────────────────────────────────────────────────────────────────────
const USER_AGENTS = {
  chrome:     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  googlebot:  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  mobile:     'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  firefox:    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  safari:     'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXTRACT HANDLER — scrape.do-style API
// GET  /api/extract?url=https://...&fields=emails,phones,social
// POST /api/extract  { url, fields, ua, timeout, follow_redirects }
// ─────────────────────────────────────────────────────────────────────────────
async function handleExtract(request, env) {
  let params = {};

  if (request.method === 'GET') {
    const u = new URL(request.url);
    params.url              = u.searchParams.get('url');
    params.fields           = (u.searchParams.get('fields') || '').split(',').map(s => s.trim()).filter(Boolean);
    params.ua               = u.searchParams.get('ua') || 'chrome';
    params.timeout          = parseInt(u.searchParams.get('timeout') || '20', 10);
    params.follow_redirects = u.searchParams.get('follow_redirects') !== 'false';
    params.token            = u.searchParams.get('token') || (request.headers.get('Authorization') || '').replace('Bearer ', '');
  } else if (request.method === 'POST') {
    try { params = await request.json(); }
    catch { return err('Invalid JSON body'); }
    params.token = params.token || (request.headers.get('Authorization') || '').replace('Bearer ', '') || (request.headers.get('X-Api-Key') || '');
  } else {
    return err('Method not allowed', 405);
  }

  if (!params.url) return err('Missing required parameter: url');

  // Normalise URL
  let targetUrl = params.url.trim();
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;
  try { new URL(targetUrl); } catch { return err('Invalid URL: ' + params.url); }

  // Fields — default to everything
  const ALL_FIELDS = ['phones', 'emails', 'social', 'addresses', 'messaging', 'business', 'meta', 'links', 'schema', 'technology'];
  const fields = params.fields?.length ? params.fields : ALL_FIELDS;

  const ua = USER_AGENTS[params.ua] || USER_AGENTS.chrome;
  const timeout = Math.min(Math.max(params.timeout || 20, 5), 30) * 1000;

  // ── Fetch page
  let html, finalUrl, statusCode, ttfb, responseHeaders;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const t0 = Date.now();
    const res = await fetch(targetUrl, {
      signal: controller.signal,
      redirect: params.follow_redirects !== false ? 'follow' : 'manual',
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
      },
    });
    clearTimeout(timer);
    ttfb = Date.now() - t0;
    statusCode = res.status;
    finalUrl = res.url || targetUrl;
    responseHeaders = Object.fromEntries(res.headers.entries());
    html = await res.text();
  } catch (e) {
    if (e.name === 'AbortError') return err('Request timed out after ' + (timeout/1000) + 's', 504);
    return err('Failed to fetch URL: ' + e.message, 502);
  }

  // ── Extract data
  const cleanHtml = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  const text = cleanHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  const result = {
    success: true,
    request: { url: targetUrl, fields, ua: params.ua || 'chrome' },
    response: { status_code: statusCode, final_url: finalUrl, ttfb_ms: ttfb, was_redirected: finalUrl !== targetUrl },
    data: {},
    scraped_at: new Date().toISOString(),
  };

  // ── Populate requested fields
  if (fields.includes('business')) {
    result.data.business = {
      name:        extractBusinessName(html, text, finalUrl),
      description: extractDescription(html),
      category:    extractCategory(html, text),
      hours:       extractHours(html, text),
      website:     (() => { try { return new URL(finalUrl).origin; } catch { return finalUrl; } })(),
      founded:     extractFounded(html, text),
    };
  }
  if (fields.includes('phones')) {
    result.data.phones = extractPhones(html, text);
  }
  if (fields.includes('emails')) {
    result.data.emails = extractEmails(html, text);
  }
  if (fields.includes('addresses') || fields.includes('address')) {
    const addr = extractAddresses(html, text);
    result.data.addresses = addr.addresses;
    result.data.map_link  = addr.mapLink;
  }
  if (fields.includes('social')) {
    result.data.social = extractSocial(html);
  }
  if (fields.includes('messaging') || fields.includes('whatsapp')) {
    result.data.messaging = extractMessaging(html, text, result.data.phones || []);
  }
  if (fields.includes('meta')) {
    result.data.meta = extractMeta(html, responseHeaders, finalUrl, statusCode, ttfb, targetUrl);
  }
  if (fields.includes('links')) {
    result.data.links = extractLinks(html, finalUrl);
  }
  if (fields.includes('schema')) {
    result.data.schema = extractSchemaOrg(html);
  }
  if (fields.includes('technology')) {
    result.data.technology = detectTechStack(html, responseHeaders);
  }

  // ── Totals summary
  result.totals = {
    phones:    (result.data.phones    || []).length,
    emails:    (result.data.emails    || []).length,
    social:    (result.data.social    || []).length,
    addresses: (result.data.addresses || []).length,
    messaging: (result.data.messaging || []).length,
  };

  return json(result);
}

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY SCRAPE HANDLER (contact-only, POST, no auth)
// ─────────────────────────────────────────────────────────────────────────────
async function handleScrape(request, env) {
  if (request.method !== 'POST') return err('Method not allowed', 405);
  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON'); }

  const { url, mode, types } = body;
  if (!url) return err('URL is required');

  let targetUrl = url.trim();
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;

  let html, finalUrl, statusCode;
  try {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': USER_AGENTS.chrome,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
    statusCode = res.status;
    finalUrl = res.url || targetUrl;
    html = await res.text();
  } catch (e) {
    return err(e.message || 'Failed to fetch page', 502);
  }

  const cleanHtml = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  const text = cleanHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  const phones   = extractPhones(html, text);
  const emails   = extractEmails(html, text);
  const { addresses, mapLink } = extractAddresses(html, text);
  const social   = extractSocial(html);
  const messaging = extractMessaging(html, text, phones);

  return json({
    statusCode,
    businessName: extractBusinessName(html, text, finalUrl),
    description:  extractDescription(html),
    category:     extractCategory(html, text),
    hours:        extractHours(html, text),
    website:      (() => { try { return new URL(finalUrl).origin; } catch { return finalUrl; } })(),
    phones, emails, addresses, mapLink, social, messaging,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTRACTOR FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function extractBusinessName(html, text, url) {
  const schemaMatch =
    html.match(/"@type"\s*:\s*"(?:LocalBusiness|Organization|Store|Restaurant|Hotel|Corporation|NGO)"[\s\S]{0,200}?"name"\s*:\s*"([^"]{2,80})"/i) ||
    html.match(/"name"\s*:\s*"([^"]{2,80})"[\s\S]{0,300}"@type"\s*:\s*"(?:LocalBusiness|Organization)/i);
  if (schemaMatch) return schemaMatch[1];

  const og = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{2,80})["']/i) ||
             html.match(/<meta[^>]+content=["']([^"']{2,80})["'][^>]+property=["']og:site_name["']/i);
  if (og) return og[1];

  const title = html.match(/<title[^>]*>([^<]{2,120})<\/title>/i);
  if (title) {
    return title[1]
      .replace(/\s*[\|\-–—]\s*.+$/, '')
      .replace(/\s*[-–]\s*(?:Home|Welcome|Official)\s*$/i, '')
      .trim().slice(0, 80) || null;
  }
  try { return new URL(url).hostname.replace(/^www\./, '').split('.')[0].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
  catch { return null; }
}

function extractDescription(html) {
  return (
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{10,300})["']/i)?.[1] ||
    html.match(/<meta[^>]+content=["']([^"']{10,300})["'][^>]+name=["']description["']/i)?.[1] ||
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{10,300})["']/i)?.[1] ||
    null
  );
}

function extractCategory(html, text) {
  const ld = html.match(/"@type"\s*:\s*"([^"]{3,60})"/g);
  if (ld) {
    const skip = new Set(['WebPage','WebSite','SearchAction','ListItem','BreadcrumbList','SiteNavigationElement','ImageObject','VideoObject','EntryPoint']);
    for (const m of ld) {
      const t = m.match(/"@type"\s*:\s*"([^"]+)"/)?.[1];
      if (t && !skip.has(t)) return t.replace(/([A-Z])/g, ' $1').trim();
    }
  }
  const kwMap = [
    [/\b(?:restaurant|cafe|bistro|diner|eatery)\b/i, 'Restaurant'],
    [/\b(?:hotel|resort|motel|inn|accommodation)\b/i, 'Hotel & Accommodation'],
    [/\b(?:dental|dentist|teeth)\b/i, 'Dental Practice'],
    [/\b(?:clinic|hospital|health|medical|doctor|physician)\b/i, 'Healthcare'],
    [/\b(?:law firm|attorney|lawyer|legal services)\b/i, 'Legal Services'],
    [/\b(?:real estate|property|realty|realtor)\b/i, 'Real Estate'],
    [/\b(?:e-?commerce|online store|shop|products)\b/i, 'E-Commerce'],
    [/\b(?:agency|marketing|advertising|digital agency)\b/i, 'Marketing Agency'],
    [/\b(?:software|saas|technology|tech|app)\b/i, 'Technology'],
  ];
  for (const [re, label] of kwMap) {
    if (re.test(text)) return label;
  }
  return null;
}

function extractHours(html, text) {
  const ld = html.match(/"openingHours"\s*:\s*"([^"]+)"/)?.[1] ||
    html.match(/"openingHoursSpecification"/i) ? 'See schema data' : null;
  if (ld) return ld;
  const m = text.match(/(?:hours?|open(?:ing)?|business hours?)[\s:–—]*([^\n<]{10,80})/i);
  return m ? m[1].trim().slice(0, 120) : null;
}

function extractFounded(html, text) {
  return (
    html.match(/"foundingDate"\s*:\s*"([^"]{4,20})"/i)?.[1] ||
    text.match(/(?:founded|established|since)\s+(?:in\s+)?(\d{4})/i)?.[1] ||
    null
  );
}

function extractPhones(html, text) {
  const found = new Set();
  const telRe = /href=["']tel:([+\d\s\-().]{6,20})["']/gi;
  let m;
  while ((m = telRe.exec(html)) !== null) found.add(m[1].trim());

  const schemaPhone = html.match(/"telephone"\s*:\s*"([^"]+)"/gi);
  if (schemaPhone) schemaPhone.forEach(p => {
    const v = p.match(/"telephone"\s*:\s*"([^"]+)"/)?.[1];
    if (v) found.add(v);
  });

  const patterns = [
    /\+63[\s\-]?(?:9\d{2}[\s\-]?\d{3}[\s\-]?\d{4}|\d{2}[\s\-]?\d{3}[\s\-]?\d{4,5})/g,
    /\+[\d][\d\s\-()]{8,18}\d/g,
    /\(?\d{3}\)?[\s\-\.]\d{3}[\s\-\.]\d{4}/g,
    /\d{4}[\s\-]\d{4}/g,
  ];
  for (const re of patterns) {
    const matches = text.match(re) || [];
    matches.forEach(p => {
      const d = p.replace(/\D/g, '');
      if (d.length >= 7 && d.length <= 15) found.add(p.trim());
    });
  }
  return [...found].slice(0, 10);
}

function extractEmails(html, text) {
  const found = new Set();
  const mailtoRe = /href=["']mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,10})["']/gi;
  let m;
  while ((m = mailtoRe.exec(html)) !== null) found.add(m[1].toLowerCase());
  const emailRe = /[a-zA-Z0-9._%+\-]{1,64}@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,10}/g;
  (text.match(emailRe) || []).forEach(e => {
    if (!/@(?:sentry|example|test|domain|email|site|yoursite|yourdomain|wixpress|wordpress|squarespace)\./.test(e))
      found.add(e.toLowerCase());
  });
  return [...found].slice(0, 10);
}

function extractAddresses(html, text) {
  const addresses = [];
  let mapLink = null;

  const street = html.match(/"streetAddress"\s*:\s*"([^"]+)"/i);
  if (street) {
    const locality = html.match(/"addressLocality"\s*:\s*"([^"]+)"/i)?.[1] || '';
    const region   = html.match(/"addressRegion"\s*:\s*"([^"]+)"/i)?.[1] || '';
    const postal   = html.match(/"postalCode"\s*:\s*"([^"]+)"/i)?.[1] || '';
    const country  = html.match(/"addressCountry"\s*:\s*"([^"]+)"/i)?.[1] || '';
    const full = [street[1], locality, region, postal, country].filter(Boolean).join(', ');
    if (full) addresses.push(full);
  }

  const mapsRe = /https:\/\/(?:www\.)?(?:maps\.google\.com|google\.com\/maps)[^\s"'<>]{10,200}/gi;
  const mapsMatch = html.match(mapsRe);
  if (mapsMatch) mapLink = mapsMatch[0].replace(/&amp;/g, '&').split('"')[0];

  const iframe = html.match(/src=["'](https:\/\/www\.google\.com\/maps\/embed[^"']+)["']/i);
  if (iframe && !mapLink) mapLink = iframe[1].replace(/&amp;/g, '&');

  if (addresses.length === 0) {
    const pats = [
      /\d+\s+[A-Z][a-zA-Z\s]{2,30}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Place|Pl|Court|Ct)[,.]?\s*[A-Z][a-zA-Z\s]{2,30}/g,
      /(?:Address|Location|Our\s+(?:office|store|branch))\s*:?\s*([^\n<]{15,120})/gi,
    ];
    for (const re of pats) {
      (text.match(re) || []).forEach(a => addresses.push(a.trim().slice(0, 150)));
      if (addresses.length) break;
    }
  }
  return { addresses: [...new Set(addresses)].slice(0, 5), mapLink };
}

function extractSocial(html) {
  const social = [];
  const seen = new Set();
  const platforms = [
    { name: 'Facebook',  re: /https?:\/\/(?:www\.)?facebook\.com\/(?!sharer|share|dialog|plugins|login|tr\?)([A-Za-z0-9._\-]{3,80})\/?(?!\?)/gi },
    { name: 'Instagram', re: /https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]{2,60})\/?(?!\?)/gi },
    { name: 'X',         re: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(?!share|intent|home|search|hashtag|login)([A-Za-z0-9_]{1,50})\/?(?!\?)/gi },
    { name: 'LinkedIn',  re: /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in|school)\/([A-Za-z0-9._\-]{2,100})\/?/gi },
    { name: 'YouTube',   re: /https?:\/\/(?:www\.)?youtube\.com\/(?:channel|c|user|@)\/([A-Za-z0-9._\-@]{2,100})\/?/gi },
    { name: 'TikTok',    re: /https?:\/\/(?:www\.)?tiktok\.com\/@([A-Za-z0-9._]{2,60})\/?/gi },
    { name: 'Pinterest', re: /https?:\/\/(?:www\.)?pinterest\.com\/([A-Za-z0-9._]{2,60})\/?/gi },
    { name: 'Snapchat',  re: /https?:\/\/(?:www\.)?snapchat\.com\/add\/([A-Za-z0-9._\-]{2,60})\/?/gi },
    { name: 'WhatsApp',  re: /https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send)[^\s"'<>]{1,80}/gi },
    { name: 'Telegram',  re: /https?:\/\/(?:t\.me|telegram\.me)\/([A-Za-z0-9._]{3,60})\/?/gi },
    { name: 'Viber',     re: /https?:\/\/(?:www\.)?viber\.com\/[^\s"'<>]{3,60}/gi },
    { name: 'Threads',   re: /https?:\/\/(?:www\.)?threads\.net\/@([A-Za-z0-9._]{2,60})\/?/gi },
  ];
  for (const { name, re } of platforms) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const url = m[0].split('"')[0].split("'")[0].split('>')[0].replace(/&amp;/g, '&');
      if (/\/(share|sharer|dialog|plugins|login|logout|tr\?|embed|feed|ads|business|policies|about|help|legal|terms|privacy|developers)/i.test(url)) continue;
      if (!seen.has(url)) { seen.add(url); social.push({ platform: name, url, handle: m[1] || null }); }
    }
  }
  return social;
}

function extractMessaging(html, text, phones) {
  const messaging = [];
  const seen = new Set();

  const waRe = /https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send[?][^\s"'<>]*)([^\s"'<>]*)/gi;
  let m;
  while ((m = waRe.exec(html)) !== null) {
    const url = m[0].split('"')[0].split("'")[0].replace(/&amp;/g, '&');
    const numMatch = url.match(/(?:wa\.me\/|phone=)(\d{7,15})/);
    const num = numMatch ? '+' + numMatch[1] : url;
    if (!seen.has(url)) { seen.add(url); messaging.push({ type: 'WhatsApp', value: num, link: url }); }
  }

  const tgRe = /https?:\/\/(?:t\.me|telegram\.me)\/([A-Za-z0-9._]{3,60})/gi;
  while ((m = tgRe.exec(html)) !== null) {
    const url = m[0];
    if (!seen.has(url)) { seen.add(url); messaging.push({ type: 'Telegram', value: '@' + m[1], link: url }); }
  }

  const viberRe = /viber:\/\/chat\?number=([%0-9+]+)/gi;
  while ((m = viberRe.exec(html)) !== null) {
    const num = decodeURIComponent(m[1]);
    if (!seen.has(num)) { seen.add(num); messaging.push({ type: 'Viber', value: num, link: m[0] }); }
  }

  const waTextRe = /(?:whatsapp|viber|message\s+us\s+on)[^\d+]{0,20}([+0-9()\s\-]{7,20})/gi;
  while ((m = waTextRe.exec(text)) !== null) {
    const num = m[1].trim();
    if (!seen.has(num) && num.replace(/\D/g, '').length >= 7) {
      seen.add(num);
      messaging.push({ type: 'WhatsApp', value: num, link: 'https://wa.me/' + num.replace(/[^\d+]/g, '') });
    }
  }
  return messaging;
}

// ─────────────────────────────────────────────────────────────────────────────
// NEW EXTRACTORS (v2 fields: meta, links, schema, technology)
// ─────────────────────────────────────────────────────────────────────────────

function extractMeta(html, headers, finalUrl, statusCode, ttfb, originalUrl) {
  const g = (re) => html.match(re)?.[1] || null;
  return {
    title:       g(/<title[^>]*>([^<]+)<\/title>/i)?.trim(),
    description: g(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i),
    canonical:   g(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i),
    lang:        g(/<html[^>]+lang=["']([^"']+)["']/i),
    viewport:    /<meta[^>]+name=["']viewport["']/i.test(html),
    charset:     /charset=/i.test(html.slice(0, 1000)) ? 'UTF-8' : null,
    is_https:    finalUrl.startsWith('https://'),
    was_redirected: originalUrl !== finalUrl,
    status_code: statusCode,
    ttfb_ms:     ttfb,
    page_size_kb: Math.round(html.length / 1024),
    word_count:  html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(w => w.length > 2).length,
    headings: {
      h1: (html.match(/<h1[^>]*>/gi) || []).length,
      h2: (html.match(/<h2[^>]*>/gi) || []).length,
      h3: (html.match(/<h3[^>]*>/gi) || []).length,
    },
    images: {
      total:       (html.match(/<img[^>]*>/gi) || []).length,
      missing_alt: (html.match(/<img[^>]*>/gi) || []).filter(i => !/alt=["'][^"']+["']/i.test(i)).length,
    },
    open_graph: {
      title:        g(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i),
      description:  g(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i),
      image:        g(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i),
      twitter_card: g(/<meta[^>]+name=["']twitter:card["'][^>]+content=["']([^"']+)["']/i),
    },
    server:       headers['server'] || null,
    cache_control: headers['cache-control'] || null,
    powered_by:   headers['x-powered-by'] || null,
    security: {
      hsts:          !!headers['strict-transport-security'],
      x_content_type: !!headers['x-content-type-options'],
      x_frame:        !!headers['x-frame-options'],
      csp:            !!headers['content-security-policy'],
    },
  };
}

function extractLinks(html, baseUrl) {
  const internal = [];
  const external = [];
  const seen = new Set();
  let base;
  try { base = new URL(baseUrl); } catch { return { internal, external }; }

  const linkRe = /href=["']([^"'#?]+)/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('javascript:')) continue;
    try {
      const abs = new URL(raw, baseUrl).href;
      if (seen.has(abs)) continue;
      seen.add(abs);
      const parsed = new URL(abs);
      if (parsed.hostname === base.hostname) internal.push(abs);
      else external.push(abs);
    } catch {}
    if (internal.length + external.length >= 200) break;
  }
  return { internal_count: internal.length, external_count: external.length, internal: internal.slice(0, 50), external: external.slice(0, 50) };
}

function extractSchemaOrg(html) {
  const blocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  const schemas = [];
  for (const block of blocks) {
    try {
      const content = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
      const parsed = JSON.parse(content);
      schemas.push(parsed);
    } catch {}
  }
  return { count: schemas.length, types: schemas.map(s => s['@type']).filter(Boolean), raw: schemas };
}

function detectTechStack(html, headers) {
  const checks = [
    { name: 'WordPress',   pattern: /wp-content\//i },
    { name: 'Shopify',     pattern: /cdn\.shopify\.com/i },
    { name: 'Wix',         pattern: /static\.wixstatic\.com/i },
    { name: 'Squarespace', pattern: /squarespace\.com/i },
    { name: 'Webflow',     pattern: /data-wf-page/i },
    { name: 'Next.js',     pattern: /_next\/static/i },
    { name: 'Nuxt',        pattern: /_nuxt\//i },
    { name: 'Gatsby',      pattern: /___gatsby/i },
    { name: 'React',       pattern: /__reactFiber|data-reactroot/i },
    { name: 'Vue.js',      pattern: /__vue__|data-v-[a-f0-9]{7}/i },
    { name: 'Angular',     pattern: /ng-version=/i },
    { name: 'Tailwind',    pattern: /tailwindcss/i },
    { name: 'Bootstrap',   pattern: /bootstrap\.min\.css/i },
    { name: 'GA4',         pattern: /gtag\('config',\s*'G-/i },
    { name: 'GTM',         pattern: /googletagmanager\.com\/gtm/i },
    { name: 'Cloudflare',  header: 'cf-ray' },
    { name: 'Vercel',      header: 'x-vercel-id' },
    { name: 'Netlify',     header: 'x-nf-request-id' },
  ];

  const detected = [];
  for (const c of checks) {
    if (c.header ? !!headers[c.header] : c.pattern.test(html)) detected.push(c.name);
  }
  return detected;
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE DATA HANDLER (legacy SEO tool endpoint)
// ─────────────────────────────────────────────────────────────────────────────
async function handlePageData(request) {
  if (request.method !== 'POST') return err('Method not allowed', 405);
  try {
    const { url } = await request.json();
    const t0 = Date.now();
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENTS.chrome, 'Accept': 'text/html' },
      redirect: 'follow',
    });
    const ttfb = Date.now() - t0;
    const html = await res.text();
    const headers = Object.fromEntries(res.headers.entries());
    return json(extractPageSignals(html, headers, res.url, res.status, ttfb, url));
  } catch (e) {
    return err(e.message);
  }
}

function extractPageSignals(html, headers, finalUrl, statusCode, ttfb, originalUrl) {
  const g = (re, src = html) => src.match(re)?.[1] || null;
  const title = g(/<title[^>]*>([^<]+)<\/title>/i);
  const metaDesc = g(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) || g(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  const canonical = g(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) || g(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  const h1s = (html.match(/<h1[^>]*>/gi) || []).length;
  const h2s = (html.match(/<h2[^>]*>/gi) || []).length;
  const h3s = (html.match(/<h3[^>]*>/gi) || []).length;
  const allImgs = html.match(/<img[^>]*>/gi) || [];
  const imgsNoAlt = allImgs.filter(i => !/alt=["'][^"']+["']/i.test(i)).length;
  const ogTitle = g(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const ogDesc = g(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const ogImage = g(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  const twitterCard = g(/<meta[^>]+name=["']twitter:card["'][^>]+content=["']([^"']+)["']/i);
  const schemaBlocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  const schemaTypes = schemaBlocks.map(s => s.match(/"@type"\s*:\s*"([^"]+)"/)?.[1] || 'Unknown');
  const robotsMeta = g(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["']/i);
  const robotsHeader = headers['x-robots-tag'] || null;
  const isNoindex = /noindex/i.test(robotsMeta || '') || /noindex/i.test(robotsHeader || '');
  const pageSizeKb = Math.round(html.length / 1024);
  const wordCount = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(w => w.length > 2).length;
  return {
    url: finalUrl, statusCode, ttfb,
    title: title?.trim(), titleLen: title?.trim().length || 0,
    metaDesc: metaDesc?.trim(), descLen: metaDesc?.trim().length || 0, canonical,
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

// ─────────────────────────────────────────────────────────────────────────────
// CMS DETECTION (legacy)
// ─────────────────────────────────────────────────────────────────────────────
async function handleCMSDetect(request) {
  if (request.method !== 'POST') return err('Method not allowed', 405);
  try {
    const { url } = await request.json();
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENTS.chrome, 'Accept': 'text/html' }, redirect: 'follow' });
    const html = await res.text();
    const headers = Object.fromEntries(res.headers.entries());
    return json(detectCMSFull(html, headers, res.url));
  } catch (e) {
    return json({ cms: 'Unknown', confidence: 0, signals: [], tech_stack: [], error: e.message });
  }
}

function detectCMSFull(html, headers, finalUrl) {
  const checks = [
    { cms: 'WordPress',   pattern: /wp-content\//i,             signal: 'wp-content path' },
    { cms: 'WordPress',   pattern: /wp-includes\//i,            signal: 'wp-includes path' },
    { cms: 'Shopify',     pattern: /cdn\.shopify\.com/i,        signal: 'Shopify CDN' },
    { cms: 'Wix',         pattern: /static\.wixstatic\.com/i,   signal: 'Wix static CDN' },
    { cms: 'Squarespace', pattern: /squarespace\.com/i,         signal: 'Squarespace ref' },
    { cms: 'Webflow',     pattern: /data-wf-page/i,             signal: 'Webflow attr' },
    { cms: 'Next.js',     pattern: /_next\/static/i,            signal: 'Next.js static' },
    { cms: 'Nuxt',        pattern: /_nuxt\//i,                  signal: 'Nuxt path' },
    { cms: 'Gatsby',      pattern: /___gatsby/i,                signal: 'Gatsby root' },
    { cms: 'Joomla',      pattern: /generator.*joomla/i,        signal: 'Joomla generator' },
    { cms: 'Drupal',      pattern: /drupal\.settings/i,         signal: 'Drupal.settings' },
    { cms: 'Ghost',       pattern: /generator.*ghost/i,         signal: 'Ghost generator' },
  ];
  const scores = {};
  for (const c of checks) {
    if (c.pattern.test(html)) {
      scores[c.cms] = scores[c.cms] || [];
      scores[c.cms].push(c.signal);
    }
  }
  let topCMS = 'Custom / Unknown', topCount = 0, topSignals = [];
  for (const [cms, sigs] of Object.entries(scores)) {
    if (sigs.length > topCount) { topCount = sigs.length; topCMS = cms; topSignals = sigs; }
  }
  const techStack = Object.entries(scores).map(([name, sigs]) => ({ name, signals: sigs, confidence: Math.min(100, sigs.length * 25) }));
  return { cms: topCMS, confidence: Math.min(100, topCount * 25), signals: topSignals, server: headers['server'] || 'Unknown', tech_stack: techStack };
}

// ─────────────────────────────────────────────────────────────────────────────
// SEO AUDIT (legacy — stubbed, insert full implementation from original worker)
// ─────────────────────────────────────────────────────────────────────────────
async function handleAudit(request, env) {
  return err('SEO Audit endpoint — see original worker for full implementation.', 501);
}
