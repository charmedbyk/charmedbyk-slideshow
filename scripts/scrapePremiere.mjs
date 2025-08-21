// scripts/scrapePremiere.mjs
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import urlMod from 'url';

const DEBUG = process.env.DEBUG_SCRAPER === '1';

// ------------- helpers
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }
function parseOrigin(u) { try { const uo = new URL(u); return `${uo.protocol}//${uo.host}`; } catch { return ''; } }
function abs(u, base) { try { return new URL(u, base || 'about:blank').toString(); } catch { return u; } }

async function saveDebug(page, outDir, label) {
  try {
    ensureDir(outDir);
    await page.screenshot({ path: path.join(outDir, `${label}.png`), fullPage: true });
    fs.writeFileSync(path.join(outDir, `${label}.html`), await page.content());
  } catch {}
}

// ------------- load categories (absolute URLs OK)
let categories = {};
try {
  categories = JSON.parse(fs.readFileSync('category_links.json', 'utf8'));
} catch (e) {
  console.error('❌ Missing category_links.json in repo root.');
  process.exit(1);
}
const categoryEntries = Object.entries(categories);
if (!categoryEntries.length) {
  console.error('❌ No categories found in category_links.json');
  process.exit(1);
}
const FIRST_URL = categoryEntries[0][1];
const ORIGIN = parseOrigin(FIRST_URL);

// ------------- scraping primitives
async function gotoReady(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Let client-side rendering & network settle
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
}

// Try to close cookie banners / popups that can hide grid
async function dismissOverlays(page) {
  const selectors = [
    ':light(button:has-text("Accept"))',
    ':light(button:has-text("I Agree"))',
    ':light(button:has-text("Got it"))',
    ':light([aria-label="close"]), :light(button[aria-label="close"])',
  ];
  for (const sel of selectors) {
    const btn = page.locator(sel);
    if (await btn.count()) {
      await btn.first().click({ trial: false }).catch(() => {});
      await page.waitForTimeout(200);
    }
  }
}

// Some sites lazy-load on scroll
async function autoScroll(page, maxSteps = 6) {
  for (let i = 0; i < maxSteps; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(700);
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
}

// Mine “product-ish” objects from arbitrary JSON
function mineProductsFromJSON(json) {
  const out = [];
  const walk = (v) => {
    if (!v) return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === 'object') {
      const name = v.name || v.title;
      const img = v.image || v.img || v.thumbnailUrl || v.thumb || v.mainImage;
      const price = v.price || v.priceValue || v.amount;
      const link = v.url || v.link || v.href;
      if (name && (img || price || link)) {
        out.push({
          id: v.id || v.sku || v.productId || link || name,
          title: String(name),
          price: price ? Number(String(price).replace(/[^0-9.]/g, '')) : null,
          url: link || '',
          image: Array.isArray(img) ? img[0] : img || '',
          available: v.available != null ? !!v.available : true,
        });
      }
      Object.values(v).forEach(walk);
    }
  };
  walk(json);
  return out;
}

async function extractFromNetwork(recordedJSON) {
  const items = [];
  for (const j of recordedJSON) items.push(...mineProductsFromJSON(j));
  const uniq = new Map();
  for (const p of items) {
    const key = p.id || `${p.title}|${p.url}`;
    if (!uniq.has(key)) uniq.set(key, p);
  }
  return Array.from(uniq.values());
}

async function extractFromLdJson(page) {
  const blocks = await page.$$eval('script[type="application/ld+json"]', nodes =>
    nodes.map(n => { try { return JSON.parse(n.textContent || '{}'); } catch { return null; } }).filter(Boolean)
  );
  return mineProductsFromJSON(blocks);
}

// Search a frame for product cards (Shadow DOM aware via :light())
async function scrapeGridInFrame(frame, currentUrl) {
  const selector = [
    ':light([data-product-id])',
    ':light(.product-card)',
    ':light(.product)',
    ':light(.grid .card)',
    ':light(ul.products li)',
    ':light(.collection .card)',
    ':light(.product-grid .grid__item)',
    ':light(.products .product-item)',
    ':light(li.product), :light(div.product-list-item)',
  ].join(',');
  const handles = await frame.locator(selector).elementHandles();
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

    const urlAbs = href ? abs(href, currentUrl) : currentUrl;
    const imgAbs = img ? abs(img, currentUrl) : '';
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

// Also check child iframes (some storefronts embed the product grid)
async function scrapeGridAllFrames(page, currentUrl) {
  const frames = page.frames();
  let all = [];
  for (const f of frames) {
    const part = await scrapeGridInFrame(f, currentUrl);
    all.push(...part);
  }
  return all;
}

async function scrapeCategory(page, name, url, recordedJSON) {
  const collected = [];
  let current = url;
  let pageNum = 1;

  while (true) {
    await gotoReady(page, current);
    await dismissOverlays(page);
    await autoScroll(page);

    // 1) Any product-like JSON responses?
    let items = await extractFromNetwork(recordedJSON);

    // 2) JSON-LD
    if (items.length < 1) items = await extractFromLdJson(page);

    // 3) DOM (all frames + Shadow DOM)
    if (items.length < 1) items = await scrapeGridAllFrames(page, current);

    if (DEBUG) console.log(`  ${name} p${pageNum}: ${items.length} items`);
    if (items.length === 0) await saveDebug(page, path.join('debug', slugify(name)), `page-${pageNum}`);

    items.forEach(p => p.category = name);
    collected.push(...items);

    // Next page?
    const next = page.locator(':light(a[rel="next"]), :light(.pagination .next a), :light(button:has-text("Next")), :light(a:has-text("Next"))');
    if (await next.count()) {
      const href = await next.first().getAttribute('href');
      if (href) {
        current = abs(href, current);
        pageNum++;
        // reset network buffer between pages
        recordedJSON.length = 0;
        await page.waitForTimeout(400);
        continue;
      }
    }
    break;
  }
  return collected;
}

// ------------- main
(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
    viewport: { width: 1280, height: 1800 },
  });
  const page = await context.newPage();

  // Capture JSON responses
  const recordedJSON = [];
  page.on('response', async (resp) => {
    try {
      const ct = resp.headers()['content-type'] || '';
      if (ct.includes('application/json')) {
        const data = await resp.json().catch(() => null);
        if (data) recordedJSON.push(data);
      }
    } catch {}
  });

  const all = [];
  for (const [name, url] of categoryEntries) {
    console.log(`Category: ${name} -> ${url}`);
    try {
      // reset buffer per category
      recordedJSON.length = 0;
      const items = await scrapeCategory(page, name, url, recordedJSON);
      console.log(`  ✓ ${items.length} items`);
      all.push(...items);
    } catch (e) {
      console.error(`  ✗ Category failed: ${name}:`, e?.message || e);
      await saveDebug(page, path.join('debug', slugify(name)), 'error');
    }
  }

  // De-dupe by id
  const byId = new Map();
  for (const p of all) if (!byId.has(p.id)) byId.set(p.id, p);

  const result = {
    source: ORIGIN || (new URL(FIRST_URL)).origin,
    generatedAt: new Date().toISOString(),
    count: byId.size,
    products: Array.from(byId.values()),
  };

  fs.writeFileSync('products.json', JSON.stringify(result, null, 2));
  console.log(`✅ Wrote products.json with ${result.products.length} products`);

  await browser.close();

  if (result.products.length === 0) {
    console.error("❌ No products found. See debug artifacts (debug/**) for HTML/screenshots.");
    process.exit(2);
  }
})().catch(err => {
  console.error("❌ Top-level error:", err);
  process.exit(1);
});
