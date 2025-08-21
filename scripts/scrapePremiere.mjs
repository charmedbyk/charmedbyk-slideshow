import { chromium } from '@playwright/test';
import fs from 'fs';

const BASE = process.env.PREMIERE_STORE_BASE?.trim();
if (!BASE) {
  console.error("❌ Missing env PREMIERE_STORE_BASE");
  process.exit(1);
}
const DEBUG = process.env.DEBUG_SCRAPER === '1';

// Load categories if present; otherwise scrape the base page
let categories = {};
try {
  categories = JSON.parse(fs.readFileSync('category_links.json', 'utf8'));
} catch {
  categories = { "All": BASE };
}

function abs(u) {
  try { return new URL(u, BASE).toString(); } catch { return u; }
}

async function goto(page, url) {
  if (DEBUG) console.log(`→ goto ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  // Some storefronts hydrate client-side; give it a moment
  await page.waitForTimeout(800);
}

async function scrapeCategory(page, name, url) {
  const items = [];
  let current = url;
  let pageNum = 1;

  while (true) {
    await goto(page, current);

    // Heuristic: wait for any product grid to appear, but don’t hang forever
    await Promise.race([
      page.locator('.product-card, .product, .grid .card, [data-product-id], ul.products li, .collection .card, .product-grid .grid__item').first().waitFor({ timeout: 6_000 }),
      page.waitForTimeout(2000) // continue anyway if nothing matched
    ]).catch(() => {});

    const cards = await page.locator(
      '.product-card, .product, .grid .card, [data-product-id], ul.products li, .collection .card, .product-grid .grid__item'
    ).elementHandles();

    if (DEBUG) console.log(`  Page ${pageNum}: found ${cards.length} candidate cards`);

    for (const card of cards) {
      const title = await card.evaluate(el =>
        el.querySelector('.product-title')?.textContent?.trim() ||
        el.querySelector('h3,h2')?.textContent?.trim() || ""
      );

      const priceTxt = await card.evaluate(el =>
        el.querySelector('.price,.product-price')?.textContent?.trim() || ""
      );
      const priceMatch = priceTxt.match(/[\d.,]+/);
      const price = priceMatch ? parseFloat(priceMatch[0].replace(/,/g, '')) : null;

      const href = await card.evaluate(el => el.querySelector('a')?.getAttribute('href') || "");
      const img = await card.evaluate(el =>
        el.querySelector('img')?.getAttribute('src') ||
        el.querySelector('img')?.getAttribute('data-src') || ""
      );

      const urlAbs = href ? abs(href) : current;
      const imgAbs = img ? abs(img) : "";
      const raw = (await card.evaluate(el => el.textContent || "")).toLowerCase();
      const outOfStock = raw.includes("sold out") || raw.includes("out of stock");

      const dataId = await card.evaluate(el => el.getAttribute('data-product-id'));
      let id = dataId || (() => {
        try {
          const segs = new URL(urlAbs).pathname.split('/').filter(Boolean);
          return segs[segs.length - 1];
        } catch { return title; }
      })();

      if (title) {
        items.push({ id, title, price, url: urlAbs, image: imgAbs, available: !outOfStock, category: name });
      }
    }

    // Find "next" pagination
    const next = page.locator('a[rel="next"], .pagination .next a, button:has-text("Next")');
    let hasNext = false;
    if (await next.count()) {
      const href = await next.first().getAttribute('href');
      if (href) {
        current = abs(href);
        hasNext = true;
        pageNum += 1;
        await page.waitForTimeout(400);
      }
    }
    if (!hasNext) break;
  }

  return items;
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36'
  });
  const page = await context.newPage();

  const all = [];
  for (const [name, url] of Object.entries(categories)) {
    console.log(`Category: ${name} -> ${url}`);
    try {
      const items = await scrapeCategory(page, name, url);
      console.log(`  ✓ ${items.length} items`);
      all.push(...items);
    } catch (err) {
      console.error(`  ✗ Failed category "${name}":`, err?.message || err);
    }
  }

  // Deduplicate by id
  const byId = new Map();
  for (const p of all) if (!byId.has(p.id)) byId.set(p.id, p);

  const out = {
    source: BASE,
    generatedAt: new Date().toISOString(),
    count: byId.size,
    products: Array.from(byId.values())
  };

  fs.writeFileSync('products.json', JSON.stringify(out, null, 2));
  console.log(`✅ Wrote products.json with ${out.products.length} products`);

  await browser.close();
})().catch(err => {
  console.error("❌ Top-level error:", err);
  process.exit(1);
});
