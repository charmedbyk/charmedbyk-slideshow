import { chromium } from '@playwright/test';
import fs from 'fs';

const BASE = process.env.PREMIERE_STORE_BASE;
if (!BASE) {
  console.error("Missing env PREMIERE_STORE_BASE");
  process.exit(1);
}

// Load category links if present
let categories = {};
try {
  categories = JSON.parse(fs.readFileSync('category_links.json', 'utf8'));
} catch {
  categories = { "All": BASE };
}

function abs(u) {
  try { return new URL(u, BASE).toString(); } catch { return u; }
}

async function scrapeCategory(page, name, url) {
  const items = [];
  let current = url;
  while (true) {
    await page.goto(current, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    const cards = await page.locator(
      '.product-card, .product, .grid .card, [data-product-id], ul.products li, .collection .card, .product-grid .grid__item'
    ).elementHandles();

    for (const card of cards) {
      const title = await card.evaluate(el => el.querySelector('.product-title,h3,h2')?.textContent?.trim() || "");
      const priceTxt = await card.evaluate(el => el.querySelector('.price,.product-price')?.textContent?.trim() || "");
      const priceMatch = priceTxt.match(/[\d.,]+/);
      const price = priceMatch ? parseFloat(priceMatch[0].replace(/,/g, '')) : null;

      const href = await card.evaluate(el => el.querySelector('a')?.getAttribute('href') || "");
      const img = await card.evaluate(el => el.querySelector('img')?.getAttribute('src') || el.querySelector('img')?.getAttribute('data-src') || "");

      const urlAbs = href ? abs(href) : current;
      const imgAbs = img ? abs(img) : "";
      const raw = (await card.evaluate(el => el.textContent || "")).toLowerCase();
      const outOfStock = raw.includes("sold out") || raw.includes("out of stock");

      const dataId = await card.evaluate(el => el.getAttribute('data-product-id'));
      const id = dataId || urlAbs.split("/").filter(Boolean).pop() || title;

      if (title) items.push({ id, title, price, url: urlAbs, image: imgAbs, available: !outOfStock, category: name });
    }

    const nextBtn = page.locator('a[rel="next"], .pagination .next a, button:has-text("Next")');
    if (await nextBtn.count()) {
      const href = await nextBtn.first().getAttribute('href');
      if (href) { current = abs(href); continue; }
    }
    break;
  }
  return items;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const all = [];
  for (const [name, url] of Object.entries(categories)) {
    console.log(`Category: ${name}`);
    const items = await scrapeCategory(page, name, url);
    all.push(...items);
  }

  const out = {
    source: BASE,
    generatedAt: new Date().toISOString(),
    count: all.length,
    products: all
  };
  fs.writeFileSync('products.json', JSON.stringify(out, null, 2));
  console.log(`✅ Wrote products.json with ${out.products.length} products`);

  await browser.close();
})();
