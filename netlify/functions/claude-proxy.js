const https = require('https');
const http = require('http');

// ─── HTTP helpers ──────────────────────────────────────────────────────────────

function httpsPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
    };
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

function fetchPage(targetUrl, redirectCount = 0) {
  return new Promise((resolve) => {
    if (redirectCount > 3) return resolve({ html: '', headers: {}, status: 0 });
    let parsed;
    try { parsed = new URL(targetUrl); } catch { return resolve({ html: '', headers: {}, status: 0 }); }

    const lib = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      path: (parsed.pathname || '/') + (parsed.search || ''),
      method: 'GET',
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
      },
    };

    let data = '';
    const req = lib.request(options, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const loc = res.headers.location;
        const redirectUrl = loc.startsWith('http') ? loc : `${parsed.protocol}//${parsed.hostname}${loc}`;
        return fetchPage(redirectUrl, redirectCount + 1).then(resolve).catch(() => resolve({ html: '', headers: {}, status: 0 }));
      }
      res.setEncoding('utf8');
      res.on('data', (chunk) => { if (data.length < 200000) data += chunk; });
      res.on('end', () => resolve({ html: data, headers: res.headers, status: res.statusCode }));
    });
    req.on('error', () => resolve({ html: '', headers: {}, status: 0 }));
    req.on('timeout', () => { req.destroy(); resolve({ html: '', headers: {}, status: 0 }); });
    req.end();
  });
}

// ─── CMS Fingerprint Detection ─────────────────────────────────────────────────
// Mirrors the detection approach of cmsdetect.com / Wappalyzer:
// checks meta generator tags, file paths, JS globals, cookies, response headers

function detectCMS(html, headers) {
  const cookieHeader = Array.isArray(headers['set-cookie'])
    ? headers['set-cookie'].join(' ')
    : (headers['set-cookie'] || '');
  const xPoweredBy = (headers['x-powered-by'] || '').toLowerCase();
  const xGenerator = (headers['x-generator'] || '').toLowerCase();
  const serverHeader = (headers['server'] || '').toLowerCase();

  const results = [];

  const cms = [
    {
      name: 'WordPress',
      tests: [
        /\/wp-content\/(themes|plugins|uploads)\//i.test(html),
        /\/wp-includes\//i.test(html),
        /<meta[^>]+generator[^>]*WordPress/i.test(html),
        /wp-json/i.test(html),
        /wpemoji|wp\.i18n|wpforms/i.test(html),
        cookieHeader.toLowerCase().includes('wordpress') || cookieHeader.toLowerCase().includes('wp-settings'),
        xGenerator.includes('wordpress'),
      ],
      getVersion: () => {
        const m = html.match(/<meta[^>]+generator[^>]*WordPress\s*([\d.]+)/i)
          || html.match(/ver=([\d.]+).*wp-/i);
        return m ? m[1] : null;
      },
    },
    {
      name: 'Shopify',
      tests: [
        /cdn\.shopify\.com/i.test(html),
        /shopify\.com\/s\/files/i.test(html),
        /<meta[^>]+generator[^>]*Shopify/i.test(html),
        /Shopify\.(theme|shop|locale)/i.test(html),
        cookieHeader.toLowerCase().includes('_shopify'),
        /"shopify"/.test(html.toLowerCase()),
      ],
      getVersion: () => null,
    },
    {
      name: 'Wix',
      tests: [
        /static\.wixstatic\.com/i.test(html),
        /wix\.com\/lpvideo|wixsite\.com|wix-code/i.test(html),
        /<meta[^>]+generator[^>]*Wix/i.test(html),
        /wixBiSession|_wixCssPath/i.test(html),
        xPoweredBy.includes('wix'),
      ],
      getVersion: () => null,
    },
    {
      name: 'Squarespace',
      tests: [
        /static\.squarespace\.com/i.test(html),
        /squarespace\.com\/commerce/i.test(html),
        /<meta[^>]+generator[^>]*Squarespace/i.test(html),
        /Static\.SQUARESPACE_CONTEXT|squarespace-cdn/i.test(html),
        cookieHeader.toLowerCase().includes('squarespace'),
      ],
      getVersion: () => null,
    },
    {
      name: 'Webflow',
      tests: [
        /\.webflow\.io/i.test(html),
        /webflow\.com\/css|webflow\.js/i.test(html),
        /<meta[^>]+generator[^>]*Webflow/i.test(html),
        /data-wf-page|data-wf-site/i.test(html),
        xGenerator.includes('webflow'),
      ],
      getVersion: () => null,
    },
    {
      name: 'Joomla',
      tests: [
        /<meta[^>]+generator[^>]*Joomla/i.test(html),
        /\/components\/com_/i.test(html),
        /\/media\/jui\/|\/media\/system\//i.test(html),
        /Joomla!/i.test(html),
        cookieHeader.toLowerCase().includes('joomla'),
      ],
      getVersion: () => {
        const m = html.match(/<meta[^>]+generator[^>]*Joomla!\s*([\d.]+)/i);
        return m ? m[1] : null;
      },
    },
    {
      name: 'Drupal',
      tests: [
        /<meta[^>]+generator[^>]*Drupal/i.test(html),
        /\/sites\/default\/files\//i.test(html),
        /Drupal\.settings|drupal\.js/i.test(html),
        xGenerator.includes('drupal'),
        cookieHeader.toLowerCase().includes('ssess') || cookieHeader.toLowerCase().includes('drupal'),
      ],
      getVersion: () => {
        const m = html.match(/Drupal ([\d.]+)/i) || xGenerator.match(/drupal\s*([\d.]+)/i);
        return m ? m[1] : null;
      },
    },
    {
      name: 'Magento',
      tests: [
        /\/skin\/frontend\/|\/mage\//i.test(html),
        /Mage\.Cookies|mage\/cookies/i.test(html),
        /magento/i.test(html),
        cookieHeader.toLowerCase().includes('frontend_cid'),
      ],
      getVersion: () => null,
    },
    {
      name: 'Ghost',
      tests: [
        /<meta[^>]+generator[^>]*Ghost/i.test(html),
        /ghost\.io|ghost\/content/i.test(html),
        xGenerator.includes('ghost'),
      ],
      getVersion: () => {
        const m = html.match(/Ghost\s*([\d.]+)/i);
        return m ? m[1] : null;
      },
    },
    {
      name: 'Next.js',
      tests: [
        /\/_next\/static\//i.test(html),
        /__NEXT_DATA__/i.test(html),
        xPoweredBy.includes('next.js'),
        /next\/dist/i.test(html),
      ],
      getVersion: () => {
        const m = xPoweredBy.match(/next\.js\s*([\d.]+)/i);
        return m ? m[1] : null;
      },
    },
    {
      name: 'Nuxt.js',
      tests: [
        /\/_nuxt\//i.test(html),
        /window\.__NUXT__|__nuxt/i.test(html),
        xPoweredBy.includes('nuxt'),
      ],
      getVersion: () => null,
    },
    {
      name: 'PrestaShop',
      tests: [
        /<meta[^>]+generator[^>]*PrestaShop/i.test(html),
        /prestashop/i.test(html),
        /\/modules\/ps_/i.test(html),
      ],
      getVersion: () => null,
    },
    {
      name: 'HubSpot CMS',
      tests: [
        /hs-scripts\.com|hs-analytics\.net/i.test(html),
        /hbspt\.|hubspot\.com\/hs-fs/i.test(html),
        /hub_generated/i.test(html),
      ],
      getVersion: () => null,
    },
    {
      name: 'Laravel',
      tests: [
        cookieHeader.toLowerCase().includes('laravel_session'),
        cookieHeader.toLowerCase().includes('xsrf-token') && xPoweredBy.includes('php'),
        /laravel/i.test(html),
      ],
      getVersion: () => null,
    },
    {
      name: 'Django',
      tests: [
        cookieHeader.toLowerCase().includes('csrftoken') && xPoweredBy.includes('python'),
        /csrfmiddlewaretoken/i.test(html),
        serverHeader.includes('gunicorn') || serverHeader.includes('uwsgi'),
      ],
      getVersion: () => null,
    },
    {
      name: 'Ruby on Rails',
      tests: [
        xPoweredBy.includes('phusion passenger') && html.includes('rails'),
        /rails-ujs|data-remote="true"/i.test(html),
        serverHeader.includes('passenger'),
      ],
      getVersion: () => null,
    },
  ];

  for (const c of cms) {
    const hits = c.tests.filter(Boolean).length;
    if (hits >= 1) {
      results.push({
        name: c.name,
        hits,
        confidence: hits >= 3 ? 'High' : hits === 2 ? 'Medium' : 'Low',
        version: c.getVersion ? c.getVersion() : null,
      });
    }
  }

  results.sort((a, b) => b.hits - a.hits);

  if (results.length === 0) {
    // Fallback: check for generator meta tag
    const genMatch = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"'<>]+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"'<>]+)["'][^>]+name=["']generator["']/i);
    if (genMatch) {
      return {
        name: genMatch[1].split(' ').slice(0, 3).join(' ').trim(),
        confidence: 'Medium',
        version: null,
        notes: 'Detected via <meta name="generator"> tag',
      };
    }
    return {
      name: 'Custom / Unknown',
      confidence: 'Low',
      version: null,
      notes: 'No known CMS fingerprints found in HTML, headers, or cookies',
    };
  }

  const top = results[0];
  const signals = ['HTML path patterns', 'JS globals', 'meta tags', 'cookies', 'response headers'].slice(0, top.hits);
  return {
    name: top.name,
    confidence: top.confidence,
    version: top.version,
    notes: `Matched ${top.hits} fingerprint${top.hits > 1 ? 's' : ''}: ${signals.join(', ')}`,
  };
}

// ─── Main Handler ──────────────────────────────────────────────────────────────

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'GROQ_API_KEY is not set. Go to Netlify → Site configuration → Environment variables and add it.' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { url, options, prompt } = body;
  if (!url) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing url parameter' }) };
  }

  // ── Step 1: Fetch the target website and do real fingerprint CMS detection ──
  let cmsData = { name: 'Unknown', confidence: 'Low', version: null, notes: 'Site could not be fetched' };
  try {
    const targetUrl = url.startsWith('http') ? url : `https://${url}`;
    const page = await fetchPage(targetUrl);
    if (page.html && page.html.length > 100) {
      cmsData = detectCMS(page.html, page.headers);
    }
  } catch (e) {
    cmsData.notes = 'Fetch error: ' + e.message;
  }

  // ── Step 2: Call Groq with the real CMS injected as a system instruction ──
  const requestBody = JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 3000,
    messages: [
      {
        role: 'system',
        content: `You are an expert SEO auditor. The target website's CMS has been definitively identified by server-side fingerprinting (checking HTML paths, meta tags, cookies, headers). The result is: CMS="${cmsData.name}", confidence="${cmsData.confidence}", version=${cmsData.version ? '"' + cmsData.version + '"' : 'null'}. You MUST use this exact CMS data in your JSON response — never change or guess the CMS name.`,
      },
      {
        role: 'user',
        content: prompt || `You are an expert SEO auditor. Perform a comprehensive SEO audit for: ${url}. Respond with ONLY valid JSON.`,
      },
    ],
  });

  try {
    const response = await httpsPost(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      requestBody
    );

    if (response.status !== 200) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: `Groq API returned ${response.status}: ${response.body}` })
      };
    }

    const data = JSON.parse(response.body);
    const text = data.choices[0].message.content;
    const clean = text.replace(/```json[\s\S]*?```|```[\s\S]*?```/g, (m) => m.replace(/```json|```/g, '')).trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      else throw new Error('Could not parse AI response as JSON');
    }

    // ── Always hard-override CMS with our real fingerprinted result ──
    parsed.cms = {
      name: cmsData.name,
      confidence: cmsData.confidence,
      version: cmsData.version || null,
      notes: cmsData.notes,
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(parsed),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Function crashed: ' + err.message })
    };
  }
};
