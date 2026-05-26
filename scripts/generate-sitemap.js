/**
 * RankSorcery — Auto Sitemap Generator
 * Run with: node scripts/generate-sitemap.js
 * GitHub Actions runs this automatically on every push + daily at midnight.
 */

const fs   = require('fs');
const path = require('path');

// ── Your domain ──────────────────────────────────────────────────────────────
const BASE_URL = 'https://ranksorcery.com';

// ── Pages to skip (won't appear in sitemap) ──────────────────────────────────
const SKIP = [
  '404.html',
  '500.html',
  'node_modules',
  '.github',
  'scripts',
  'assets',
];

// ── Priority rules (first match wins) ────────────────────────────────────────
const RULES = [
  // Homepage (must come after blog/index.html to avoid matching blog/index.html as 1.0)
  // Blog index page
  { match: 'blog/index.html',               priority: '0.9', freq: 'daily'   },

  // Homepage
  { match: 'index.html',                    priority: '1.0', freq: 'daily'   },

  // All blog posts inside /blog/ folder — published daily so crawl frequently
  { match: 'blog/',                          priority: '0.8', freq: 'hourly'  },

  // About
  { match: 'about.html',                    priority: '0.9', freq: 'monthly' },

  // Core SEO tools (highest traffic)
  { match: 'competitor.html',               priority: '0.9', freq: 'weekly'  },
  { match: 'keyword-volume.html',           priority: '0.9', freq: 'weekly'  },
  { match: 'ai-search.html',               priority: '0.9', freq: 'weekly'  },
  { match: 'core-web-vitals-checker.html',  priority: '0.9', freq: 'weekly'  },
  { match: 'page-speed-analyzer.html',      priority: '0.9', freq: 'weekly'  },
  { match: 'serp-rank-tracker.html',        priority: '0.9', freq: 'weekly'  },

  // SEO tools (secondary)
  { match: 'broken-link-checker.html',      priority: '0.8', freq: 'weekly'  },
  { match: 'canonical-tag-checker.html',    priority: '0.8', freq: 'weekly'  },
  { match: 'hreflang-tag-generator.html',   priority: '0.8', freq: 'weekly'  },
  { match: 'internal-link-analyzer.html',   priority: '0.8', freq: 'weekly'  },
  { match: 'redirect-chain-checker.html',   priority: '0.8', freq: 'weekly'  },
  { match: 'robots-txt-generator.html',     priority: '0.8', freq: 'weekly'  },
  { match: 'schema-markup-writer.html',     priority: '0.8', freq: 'weekly'  },
  { match: 'serp-snippet-previewer.html',   priority: '0.8', freq: 'weekly'  },
  { match: 'xml-sitemap-generator.html',    priority: '0.8', freq: 'weekly'  },
  { match: 'document-checker.html',         priority: '0.8', freq: 'weekly'  },

  // AI writing tools
  { match: 'ai-writer-tools.html',          priority: '0.8', freq: 'weekly'  },
  { match: 'ai-writer.html',               priority: '0.8', freq: 'weekly'  },
  { match: 'ai-blog-writer.html',           priority: '0.8', freq: 'weekly'  },
  { match: 'ai-faq-generator.html',         priority: '0.8', freq: 'weekly'  },
  { match: 'ai-humanizer.html',             priority: '0.8', freq: 'weekly'  },
  { match: 'ai-meta-description-generator.html', priority: '0.8', freq: 'weekly' },
  { match: 'ai-write-anything.html',        priority: '0.8', freq: 'weekly'  },
  { match: 'ai-alt-text-generator.html',    priority: '0.7', freq: 'monthly' },
  { match: 'social-media-post-generator.html', priority: '0.7', freq: 'monthly' },
  { match: 'plagiarism-checker.html',       priority: '0.7', freq: 'monthly' },
  { match: 'word-counter.html',             priority: '0.7', freq: 'monthly' },
  { match: 'reading-time-calculator.html',  priority: '0.6', freq: 'monthly' },

  // Media tools
  { match: 'background-remover.html',       priority: '0.7', freq: 'monthly' },
  { match: 'favicon-generator.html',        priority: '0.7', freq: 'monthly' },
  { match: 'image-compressor.html',         priority: '0.7', freq: 'monthly' },
  { match: 'image-converter.html',          priority: '0.7', freq: 'monthly' },
  { match: 'image-resizer.html',            priority: '0.7', freq: 'monthly' },
  { match: 'og-image-generator.html',       priority: '0.7', freq: 'monthly' },
];

const DEFAULT = { priority: '0.6', freq: 'monthly' };

// ── Helpers ───────────────────────────────────────────────────────────────────

function findHtml(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel  = path.relative(process.cwd(), full).replace(/\\/g, '/');
    if (SKIP.some(s => rel.includes(s))) continue;
    if (entry.isDirectory())                          findHtml(full, found);
    else if (entry.name.endsWith('.html'))            found.push(rel);
  }
  return found;
}

function toUrl(rel) {
  if (rel === 'index.html')               return BASE_URL + '/';
  if (rel.endsWith('/index.html'))        return BASE_URL + '/' + rel.replace('/index.html', '/');
  return BASE_URL + '/' + rel;
}

function getMeta(rel) {
  return RULES.find(r => rel.includes(r.match)) || DEFAULT;
}

function today() {
  return new Date().toISOString().split('T')[0];
}

// ── Build sitemap ─────────────────────────────────────────────────────────────

const files   = findHtml(process.cwd()).sort((a, b) => {
  if (a === 'index.html') return -1;
  if (b === 'index.html') return  1;
  return a.localeCompare(b);
});

const lastmod = today();

console.log(`\n🗺️  Generating sitemap — ${files.length} pages found\n`);

const entries = files.map(f => {
  const url  = toUrl(f).replace(/&/g, '&amp;');
  const meta = getMeta(f);
  console.log(`  ✓  ${f.padEnd(45)} priority ${meta.priority}`);
  return `
  <url>
    <loc>${url}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${meta.freq}</changefreq>
    <priority>${meta.priority}</priority>
  </url>`;
}).join('');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Auto-generated by RankSorcery · ${lastmod} · ${files.length} URLs -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;

fs.writeFileSync(path.join(process.cwd(), 'sitemap.xml'), xml, 'utf8');
console.log(`\n✅  sitemap.xml saved — ${files.length} URLs — ${lastmod}\n`);
