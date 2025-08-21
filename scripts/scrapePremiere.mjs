import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE = process.env.PREMIERE_STORE_BASE?.trim();
if (!BASE) {
  console.error("❌ Missing env PREMIERE_STORE_BASE");
  process.exit(1);
}
const DEBUG = process.env.DEBUG_SCRAPER === '1';

function abs(u) { try { return new URL(u, BASE).toString(); } catch { return u; } }

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Load categories if present; otherwise scrape the base page
let categories = {};
try {
  categories = JSON.parse(fs.readFileSync('category_links.json', 'utf8'));
} catch {
  categories = { "All": BASE };
}

async function saveDebug(page, outDir, label) {
  try {
    ensureDir(outDir);
    await page.screenshot({ path: path.join(outDir, `${label}.png`), fullPage: true });
    const html = await page.content();
    fs.writeFileSync(path.join(outDir, `${label}.html`), html);
  } catch (e) {
    console.warn("Could not write debug artifacts:", e?.message || e);
  }
}

async function gotoReady(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Give the app time to hydrate / fetch products
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
}

async function extractFromLdJson(page) {
  // Try schema.org JSON-LD: Product or ItemList of Products
  const ldjson = await page.$$eval('script[type="application/ld+json"]', nodes =>
    nodes.map(n => {
      try { return JSON.parse(n.textContent || '{}'); } catch { return null; }
    }).filter(Boolean)
  );

  const items = [];
  for (const block of ldjson) {
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node['@type'] === 'Product' && node.name) {
        items.push({
          id: node.sku || node.productID || node.url || node.name,
          title: node.name,
          price: node.offers?.price ? Number(node.offers.price) : null,
          url: node.url || '',
          image: Array.isArray(node.image) ? node.image[0] : node.image || '',
          available: node.offers?.availability ? !/OutOfStock/i.test(node.offers.availability) : true
        });
      }
      for (const v of Object.values(node)) {
        if (Array.isArray(v)) v.forEach(walk); else if (typeof v === 'object') walk(v);
      }
    };
    walk(block);
  }
  return items;
}

async function scrapeGridCards(page, current) {
  const selector = [
    '[data-product-id]',
    '.product-card',
    '.product',
    '.grid .card',
    'ul.products li',
    '.collection .card',
    '.product-grid .grid__item',
    '.products .product-item',
    'li.product, div.product-list-item'
  ].join(',');

  const handles = await page.locator(selector).elementHandles();
  const items = [];
  for (const h of handles) {
    const title = (await h.evaluate(el =>
      el.querySelector('.product-title,h3,h2,[itemprop="name"]')?.textContent?.trim() || ''
    )) || '';

    const priceTxt = (await h.evaluate(el =>
      el.querySelector('.price,.product-price,[itemprop="price"]')?.textContent?.trim() || ''
    )) || '';
    const priceMatch = priceTxt.match(/[\d.,]+/);
    const price = priceMatch ? parseFloat(priceMatch[0].replace(/,/g, '')) : null;

    const href = await h.evaluate(el => el.querySelector('a')?.getAttribute('href') || '');
    const img = await h.evaluate(el =>
      el.querySelector('img')?.getAttribute('src') ||
      el.querySelector('img')?.getAttribute('data-src') || ''
    );

    const urlAbs = href ? abs(href) : current;
    const imgAbs = img ? abs(img) : '';
    const raw = (await h.evaluate(el => el.textContent || '')).toLowerCase();
    const outOfStock = raw.includes('sold out') || raw.includes('out of stock');

    const dataId = await h.evaluate(el => el.getAttribute('data-product-id'));
    let id = dataId || (() => {
      try { const segs = new URL(urlAbs).pathname.split('/').filter(Boolean); return segs[segs.length - 1]; }
      catch { return title; }
    })();

    if (title) items.push({ id, title, price, url: urlAbs, image: imgAbs, available: !outOfStock });
  }
  return items;
}

async function scrapeCategory(page, name, url, debugBase) {
  const out = [];
  let current = url;
  let pageNum = 1;

  while (true) {
    await gotoReady(page, current);

    // Try JSON-LD first (fast path)
    let items = await extractFromLdJson(page);

    // Fall back to grid scraping if ld+json sparse/empty
    if (items.length < 1) {
      items = await scrapeGridCards(page, current);
    }

    if (DEBUG) console.log(`  ${name} p${pageNum}: ${items.length} items`);
    if (items.length === 0) {
      // Save artifacts to help debug
      await saveDebug(page, path.join('debug', slugify(name)), `page-${pageNum}`);
    }

    // Attach category
    items.forEach(p => p.category = name);
    out.push(...items);

    // Pagination: next link/button
    const next = page.locator('a[rel="next"], .pagination .next a, button:has-text("Next"), a:has-text("Next")');
    if (await next.count()) {
      const href = await next.first().getAttribute('href');
      if (href) {
        current = abs(href);
        pageNum++;
        await page.waitForTimeout(400);
        continue;
      }
    }
    break;
  }
  return out;
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
  });
  const page = await context.newPage();

  const all = [];
  for (const [name, url] of Object.entries(categories)) {
    console.log(`Category: ${name} -> ${url}`);
    try {
      const items = await scrapeCategory(page, name, url, 'debug');
      console.log(`  ✓ ${items.length} items`);
      all.push(...items);
    } catch (e) {
      console.error(`  ✗ Category failed: ${name}:`, e?.message || e);
      await saveDebug(page, path.join('debug', slugify(name)), 'error');
    }
  }

  // Deduplicate by id
  const byId = new Map();
  for (const p of all) if (!byId.has(p.id)) byId.set(p.id, p);

  const result = {
    source: BASE,
    generatedAt: new Date().toISOString(),
    count: byId.size,
    products: Array.from(byId.values())
  };

  fs.writeFileSync('products.json', JSON.stringify(result, null, 2));
  console.log(`✅ Wrote products.json with ${result.products.length} products`);

  await browser.close();

  // If nothing was found, make it an error so we notice AND keep artifacts
  if (result.products.length === 0) {
    console.error("❌ No products found. See debug artifacts for page HTML/screenshots.");
    process.exit(2);
  }
})().catch(err => {
  console.error("❌ Top-level error:", err);
  process.exit(1);
});
