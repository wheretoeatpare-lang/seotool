// ─────────────────────────────────────────────────────────────────────────────
// ADD THIS TO YOUR worker.js
//
// 1. In the fetch() router, add:
//    if (url.pathname === '/api/maps-scrape') return handleMapsScrape(request, env);
//
// 2. Paste the handler + helpers below into worker.js
// ─────────────────────────────────────────────────────────────────────────────

// ─── ROUTE (add to your existing fetch router) ───────────────────────────────
// if (url.pathname === '/api/maps-scrape') return handleMapsScrape(request, env);


// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE MAPS BUSINESS SCRAPER
// POST /api/maps-scrape
// Body: { businessType, country, city, maxResults, fields, lang }
// Returns: { listings: [...], total, query }
// ─────────────────────────────────────────────────────────────────────────────
async function handleMapsScrape(request, env) {
  if (request.method !== 'POST') return err('Method not allowed', 405);
  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON body'); }

  const {
    businessType,
    country,
    city,
    maxResults = 20,
    fields     = ['phones','emails','website','address','social','rating','messaging'],
    lang       = 'en',
  } = body;

  if (!businessType) return err('businessType is required');
  if (!country)      return err('country is required');
  if (!city)         return err('city is required');

  // Build Google Maps search URL
  const searchQuery  = encodeURIComponent(`${businessType} in ${city} ${country}`);
  const mapsSearchUrl = `https://www.google.com/maps/search/${searchQuery}/?hl=${lang}`;

  // Fetch the Maps search page
  let html;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    const res = await fetch(mapsSearchUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': `${lang}-${lang.toUpperCase()},${lang};q=0.9,en;q=0.8`,
        'Cache-Control':   'no-cache',
      },
      redirect: 'follow',
    });
    clearTimeout(timer);
    html = await res.text();
  } catch (e) {
    if (e.name === 'AbortError') return err('Maps search timed out', 504);
    return err('Failed to fetch Google Maps: ' + e.message, 502);
  }

  // Parse listings from Maps HTML
  const listings = parseMapsListings(html, {
    businessType,
    country,
    city,
    maxResults: Math.min(maxResults, 100),
    fields,
  });

  return json({
    success: true,
    query: { businessType, country, city, maxResults, lang },
    total: listings.length,
    listings,
    scraped_at: new Date().toISOString(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MAPS LISTING PARSER
// Extracts structured business data from Google Maps HTML responses.
// Google Maps embeds listing data as JSON fragments inside the page HTML.
// ─────────────────────────────────────────────────────────────────────────────
function parseMapsListings(html, { businessType, country, city, maxResults, fields }) {
  const listings = [];
  const seen     = new Set();

  // ── Strategy 1: Extract from embedded JSON data arrays in Maps HTML
  // Google Maps embeds data in JS arrays that look like:
  //   ["Business Name", null, ["address"], [lat, lng], ...]
  const jsonBlocks = html.match(/\[\s*"[^"]{2,100}"\s*,\s*null\s*,\s*\[/g) || [];

  // ── Strategy 2: Extract named blocks from Maps page source patterns
  // Pattern: business name near address/phone/rating data
  const namePatterns = [
    // Schema.org JSON-LD (most reliable)
    /"name"\s*:\s*"([^"]{2,100})"/g,
  ];

  // ── Strategy 3: Parse structured data from within Maps HTML
  // Each Maps listing block has predictable patterns we can extract from.

  // Extract all schema.org LocalBusiness blocks
  const schemaBlocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of schemaBlocks) {
    try {
      const raw = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (listings.length >= maxResults) break;
        const biz = extractFromSchema(item, { businessType, country, city, fields });
        if (biz) {
          const key = biz.name.toLowerCase().replace(/\s+/g, '');
          if (!seen.has(key)) { seen.add(key); listings.push(biz); }
        }
      }
    } catch {}
  }

  // ── Strategy 4: Extract from Maps' internal data format
  // Google Maps encodes listings in an obfuscated but consistent JS format
  // Look for patterns like: ["Business Name","address",phone,rating]
  if (listings.length < maxResults) {
    const mapsDataRe = /\["([^"]{2,100})","([^"]{5,200}(?:Street|St|Ave|Blvd|Rd|Dr|Lane|Ln|City|Town|District|Barangay|Brgy|Floor|Unit|Building|Bldg)[^"]{0,150})"/gi;
    let m;
    while ((m = mapsDataRe.exec(html)) !== null && listings.length < maxResults) {
      const name = m[1];
      const addr = m[2];
      const key  = name.toLowerCase().replace(/\s+/g,'');
      if (!seen.has(key) && name.length > 2 && !isJunk(name)) {
        seen.add(key);
        const biz = { name, address: addr, city, country, bizType: businessType };
        if (fields.includes('phones'))  biz.phones  = [];
        if (fields.includes('emails'))  biz.emails  = [];
        if (fields.includes('social'))  biz.social  = [];
        if (fields.includes('messaging')) biz.messaging = [];
        listings.push(biz);
      }
    }
  }

  // ── Strategy 5: Extract from Maps search result name snippets
  if (listings.length < maxResults) {
    // Maps embeds listing names in aria-label or data-result-index patterns
    const ariaRe = /aria-label=["']([^"']{3,100})["'][^>]*>/gi;
    let m;
    while ((m = ariaRe.exec(html)) !== null && listings.length < maxResults) {
      const name = m[1].trim();
      if (name.length < 3 || name.length > 100) continue;
      if (isJunk(name)) continue;
      const key = name.toLowerCase().replace(/\s+/g,'');
      if (!seen.has(key)) {
        seen.add(key);
        const biz = { name, city, country, bizType: businessType };
        if (fields.includes('phones'))  biz.phones  = [];
        if (fields.includes('emails'))  biz.emails  = [];
        if (fields.includes('social'))  biz.social  = [];
        if (fields.includes('messaging')) biz.messaging = [];
        listings.push(biz);
      }
    }
  }

  // ── Enrich each listing by scraping their Maps detail page URLs
  // (URLs are embedded in Maps HTML as /maps/place/... paths)
  const placeUrls = extractPlaceUrls(html);
  for (let i = 0; i < Math.min(listings.length, placeUrls.length); i++) {
    if (!listings[i].mapsUrl) listings[i].mapsUrl = placeUrls[i];
  }

  return listings.slice(0, maxResults);
}

// ─── EXTRACT FROM SCHEMA.ORG ─────────────────────────────────────────────────
function extractFromSchema(item, { businessType, country, city, fields }) {
  if (!item || typeof item !== 'object') return null;

  const type = item['@type'] || '';
  const validTypes = ['LocalBusiness','Restaurant','FoodEstablishment','MedicalBusiness',
    'HealthAndBeautyBusiness','ProfessionalService','LodgingBusiness','Store',
    'Dentist','Physician','LegalService','RealEstateAgent','AutoDealer','Hotel',
    'Pharmacy','GroceryStore','ClothingStore','ElectronicsStore','BarOrPub','Bakery',
    'CafeOrCoffeeShop','FastFoodRestaurant','NightClub','School','CollegeOrUniversity'];

  const isValidType = validTypes.some(t => type.includes(t)) || !!item.name;
  if (!isValidType || !item.name) return null;

  const biz = {
    name:     item.name,
    category: item['@type'] ? String(item['@type']).replace(/([A-Z])/g, ' $1').trim() : businessType,
    bizType:  businessType,
    city,
    country,
  };

  if (fields.includes('address') && item.address) {
    const a = item.address;
    if (typeof a === 'string') {
      biz.address = a;
    } else {
      biz.address = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry]
        .filter(Boolean).join(', ');
    }
  }

  if (fields.includes('phones')) {
    biz.phones = [];
    if (item.telephone) biz.phones = Array.isArray(item.telephone) ? item.telephone : [item.telephone];
  }

  if (fields.includes('emails')) {
    biz.emails = [];
    if (item.email) biz.emails = Array.isArray(item.email) ? item.email : [item.email];
  }

  if (fields.includes('website')) {
    biz.website = item.url || item.sameAs?.[0] || null;
  }

  if (fields.includes('rating') && item.aggregateRating) {
    biz.rating      = item.aggregateRating.ratingValue || null;
    biz.reviewCount = item.aggregateRating.reviewCount || null;
  }

  if (fields.includes('hours') && item.openingHours) {
    biz.hours = Array.isArray(item.openingHours) ? item.openingHours.join(', ') : item.openingHours;
  }

  if (fields.includes('social')) {
    biz.social = [];
    const sameAs = item.sameAs || [];
    const platforms = ['facebook','instagram','twitter','linkedin','youtube','tiktok','pinterest'];
    for (const url of sameAs) {
      const platform = platforms.find(p => url.toLowerCase().includes(p));
      if (platform) biz.social.push({ platform: platform.charAt(0).toUpperCase()+platform.slice(1), url });
    }
  }

  if (fields.includes('messaging')) {
    biz.messaging = [];
  }

  if (item.hasMap) biz.mapsUrl = item.hasMap;
  if (item.geo) biz.geo = { lat: item.geo.latitude, lng: item.geo.longitude };

  return biz;
}

// ─── EXTRACT PLACE URLS ───────────────────────────────────────────────────────
function extractPlaceUrls(html) {
  const urls  = [];
  const seen  = new Set();
  const re    = /https?:\/\/(?:www\.)?google\.com\/maps\/place\/[^\s"'<>]{10,200}/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = m[0].split('"')[0].split("'")[0].replace(/\\u003d/g,'=').replace(/&amp;/g,'&');
    if (!seen.has(url)) { seen.add(url); urls.push(url); }
  }
  return urls;
}

// ─── JUNK FILTER ─────────────────────────────────────────────────────────────
function isJunk(name) {
  const junk = /^(Google|Maps|Search|menu|close|back|share|directions|save|website|call|photos|reviews|nearby|overview|about|more|less|open|closed|hours|edit|suggest|report|flag|help|settings|sign|log|account|privacy|terms|send|feedback|data|loading|error)$/i;
  return junk.test(name.trim()) || name.length < 2 || /^\d+$/.test(name);
}
