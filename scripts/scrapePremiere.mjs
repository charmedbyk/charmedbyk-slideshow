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
function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }

// Load categories
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
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

function mineProductsFromJSON(json) {
  const out = [];
  const walk = (v) => {
    if (!v) return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === 'object') {
      // very loose heuristics for product-like nodes
      const name = v.name || v.title;
      const img = v.image || v.img || v.thumbnailUrl || v.thumb || v.mainImage;
      const price = v.price || v.priceValue || v.amount;
      const url = v.url || v.link || v.href;
      if (name && (img || price || url)) {
        out.push({
          id: v.id || v.sku || v.productId || url || name,
          title: String(name),
          price: price ? Number(String(price).replace(/[^0-9.]/g, '')) : null,
          url: url || '',
          image: Array.isArray(img) ? img[0] : img || '',
          available: v.available != null ? !!v.available : true
        });
      }
      Object.values(v).forEach(walk);
    }
  };
  walk(json);
  return out;
}

async function extractFromNetwork(recordedJSON) {
  // De-dupe and return “product‑ish” objects from all captured JSON responses
  const items = [];
  for (const j of recordedJSON) items.push(...mineProductsFromJSON(j));
  // Basic dedupe by (id|title|url)
  const uniq = new Map();
  for (const p of items) {
    const key = p.id || `${p.title}|${p.url}`;
    if (!uniq.has(key)) uniq.set(key, p);
  }
  return Array.from(uniq.values());
}

async function extractFromLdJson(page) {
  const ldjson = await page.$$eval('script[type="application/ld+json"]', nodes =>
    nodes.map(n => {
      try { return JSON.parse(n.textContent || '{}'); } catch { return null; }
    }).filter(Boolean)
  );
  return mineProductsFromJSON(ldjson);
}

async function scrapeGridCards(page, current) {
  // :light() pierces shadow DOM
  const selector = [
    ':light([data-product-id])',
    ':light(.product-card)',
    ':light(.product)',
    ':light(.grid .card)',
    ':light(ul.products li)',
    ':light(.collection .card)',
    ':light(.product-grid .grid__item)',
    ':light(.products .product-item)',
    ':light(li.product), :light(div.product-list-item)'
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

async function scrapeCategory(page, name, url, debugBase, recordedJSON) {
  const out = [];
  let current = url;
  let pageNum = 1;

  while (true) {
    await gotoReady(page, current);
    const title = await page.title().catch(() => '');
    const bodyLen = await page.evaluate(() => document.body?.innerText?.length || 0);
    if (DEBUG) console.log(`  ${name} p${pageNum} title="${title}" bodyLen=${bodyLen}`);

    // 1) Network‑captured JSON
    let items = await extractFromNetwork(recordedJSON);

    // 2) JSON‑LD
    if (items.length < 1) {
      const ld = await extractFromLdJson(page);
      items = ld;
    }

    // 3) DOM grid (with :light() through shadow DOM)
    if (items.length < 1) {
      // small extra wait for client rendering
      await page.waitForTimeout(1200);
      items = await scrapeGridCards(page, current);
    }

    if (items.length === 0) {
      await saveDebug(page, path.join('debug', slugify(name)), `page-${pageNum}`);
    }

    items.forEach(p => p.category = name);
    out.push(...items);

    // Next page?
    const next = page.locator(':light(a[rel="next"]), :light(.pagination .next a), :light(button:has-text("Next")), :light(a:has-text("Next"))');
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
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
    viewport: { width: 1280, height: 1600 }
  });
  const page = await context.newPage();

  // Capture JSON/XHR responses for mining
  const recordedJSON = [];
  page.on('response', async (resp) => {
    try {
      const ct = resp.headers()['content-type'] || '';
      if (ct.includes('application/json')) {
        const data = await resp.json().catch(() => null);
        if (data) recordedJSON.push(data);
      }
    } catch { /* ignore */ }
  });

  const all = [];
  for (const [name, url] of Object.entries(categories)) {
    console.log(`Category: ${name} -> ${url}`);
    try {
      // reset network buffer per category
      recordedJSON.length = 0;
      const items = await scrapeCategory(page, name, url, 'debug', recordedJSON);
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

  if (result.products.length === 0) {
    console.error("❌ No products found. See debug artifacts for HTML/screenshots.");
    process.exit(2);
  }
})().catch(err => {
  console.error("❌ Top-level error:", err);
  process.exit(1);
});
