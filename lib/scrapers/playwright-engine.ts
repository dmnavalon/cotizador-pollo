/**
 * Scraper basado en Playwright para sitios que requieren JS rendering
 * (Cloudflare challenge, SPAs). Solo se usa desde scripts/scrape-full.ts
 * que corre en GitHub Actions — NUNCA importar desde la app Next.js.
 */
import type { Product, ScrapeResult, PriceTier, SiteConfig } from '../types';

type Browser = any;
type Page = any;

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function clpToInt(s: string): number {
  const m = s.match(/(\d{1,3}(?:[.,]\d{3})*|\d+)/);
  if (!m) return 0;
  return parseInt(m[1].replace(/[.,]/g, ''), 10) || 0;
}

function parseWeightKg(text: string): number | null {
  const tx = text.toLowerCase();
  const kg = tx.match(/(\d+(?:[.,]\d+)?)\s*kg\b/);
  if (kg) return parseFloat(kg[1].replace(',', '.'));
  const g = tx.match(/(\d+(?:[.,]\d+)?)\s*g(?:r|ramos?)?\b/);
  if (g) return parseFloat(g[1].replace(',', '.')) / 1000;
  return null;
}

function isPechugaDeshuesada(name: string): boolean {
  const n = name.toLowerCase();
  if (!n.includes('pechuga')) return false;
  if (!/(deshues|fil[eé]|sin hueso|despres|trozado)/i.test(n)) return false;
  if (/(apan|cocid|hambur|nugget|breaded|empan|mariposa)/i.test(n)) return false;
  return true;
}

interface RawCandidate {
  name: string;
  url: string;
  price: number;
  weight: number;
  image?: string;
  brand?: string;
  ean?: string;
  productId?: string;
  inStock?: boolean | null;
}

function candidateToProduct(c: RawCandidate, store: string, baseUrl: string): Product | null {
  if (!isPechugaDeshuesada(c.name)) return null;
  if (!c.price || !c.weight || c.weight <= 0) return null;
  const pricePerKg = Math.round(c.price / c.weight);
  if (pricePerKg < 1000 || pricePerKg > 50000) return null;

  const tier: PriceTier = { minQty: 1, unitPrice: c.price, pricePerKg, label: 'regular' };
  let url = c.url;
  if (url.startsWith('/')) url = baseUrl.replace(/\/$/, '') + url;
  if (!url.startsWith('http')) url = baseUrl;

  return {
    store,
    id: `${store.toLowerCase().replace(/\s+/g, '-')}-${c.productId || c.url.split('/').pop() || Math.random().toString(36).slice(2)}`,
    name: c.name.trim().slice(0, 200),
    brand: c.brand || 'Sin marca',
    format: c.weight >= 1 ? `${c.weight} kg` : `${Math.round(c.weight * 1000)} g`,
    weightKg: c.weight,
    url,
    image: c.image || null,
    tiers: [tier],
    bestPricePerKg: pricePerKg,
    ean: c.ean || null,
    inStock: c.inStock ?? null,
  };
}

function deepFindProducts(obj: any, depth = 0): any[] {
  if (depth > 10 || !obj || typeof obj !== 'object') return [];
  if (Array.isArray(obj)) {
    if (obj.length > 0 && typeof obj[0] === 'object' && obj[0]) {
      const first = obj[0];
      const hasName = first.name || first.productName || first.displayName || first.nameComplete;
      const hasPrice =
        first.price !== undefined || first.sellers || first.priceSteps || first.prices || first.offers;
      if (hasName && hasPrice && obj.length < 300) return obj;
    }
    const out: any[] = [];
    for (const item of obj) {
      const found = deepFindProducts(item, depth + 1);
      if (found.length > out.length) {
        out.length = 0;
        out.push(...found);
      }
    }
    return out;
  }
  for (const k of Object.keys(obj)) {
    const found = deepFindProducts(obj[k], depth + 1);
    if (found.length > 0) return found;
  }
  return [];
}

function normalizeNextProduct(raw: any): RawCandidate | null {
  const name = raw.nameComplete || raw.name || raw.productName || raw.displayName;
  if (!name) return null;
  let price = 0;
  const steps = raw.priceSteps || raw.tieredPrices || [];
  for (const s of steps) {
    const p = s.promotionalPrice || s.price;
    if (p && (!price || p < price)) price = p;
  }
  if (!price) {
    const seller = raw.sellers?.[0];
    price = seller?.price || raw.price || raw.salePrice || raw.listPrice || 0;
  }
  if (raw.priceRange?.sellingPrice?.lowPrice && (!price || raw.priceRange.sellingPrice.lowPrice < price)) {
    price = raw.priceRange.sellingPrice.lowPrice;
  }
  let weight: number | null = raw.unitMultiplierUn;
  if (!weight) weight = parseWeightKg(`${raw.format || ''} ${name}`);
  if (!weight) return null;
  let url = raw.detailUrl || raw.url || raw.link || raw.linkText || '';
  if (url.endsWith('/p')) url = url.slice(0, -2);
  // Stock: VTEX / muchos JSON exponen availableQuantity en sellers
  let inStock: boolean | null = null;
  const seller0 = raw.sellers?.[0];
  if (seller0 && typeof seller0.availableQuantity === 'number') {
    inStock = seller0.availableQuantity > 0;
  } else if (typeof raw.availability === 'string') {
    inStock = /in.?stock|available|disponible/i.test(raw.availability);
  } else if (typeof raw.inStock === 'boolean') {
    inStock = raw.inStock;
  }
  return {
    name,
    url,
    price,
    weight,
    image: raw.images?.[0] || raw.image,
    brand: raw.brand,
    ean: raw.ean,
    productId: raw.productId || raw.itemId || raw.sku,
    inStock,
  };
}

async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

async function newPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({
    userAgent: UA,
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: {
      'Accept-Language': 'es-CL,es;q=0.9',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  // Anti-detección básica
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['es-CL', 'es', 'en'] });
  });
  return ctx.newPage();
}

async function waitForHydration(page: Page, timeoutMs = 25000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const hasContent = await page.evaluate(() => {
        const txt = document.body?.innerText || '';
        // Requiere precio + nombre de producto en el mismo body
        return /pechuga/i.test(txt) && /\$\s?\d{2,}/.test(txt);
      });
      if (hasContent) return;
    } catch {}
    await page.waitForTimeout(800);
  }
}

/** Espera a que la página pase el challenge de Cloudflare y muestre contenido real. */
async function passCloudflare(page: Page, maxWaitMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const title = await page.title().catch(() => '');
    const url = page.url();
    if (!/just a moment|cloudflare|attention required|verificando/i.test(title) && !/__cf_chl_/.test(url)) {
      return true;
    }
    await page.waitForTimeout(2000);
  }
  return false;
}

async function tryExtractFromWindowGlobals(page: Page, allCandidates: RawCandidate[], seen: Set<string>): Promise<number> {
  // Algunos sitios (VTEX, Apollo, Magento) exponen el state en window.*
  const data = await page
    .evaluate(() => {
      const w = window as any;
      const candidates = [
        w.__INITIAL_STATE__,
        w.__APOLLO_STATE__,
        w.__PRELOADED_STATE__,
        w.__INITIAL_DATA__,
        w.__REDUX_STATE__,
        w.dataLayer,
      ].filter(Boolean);
      try {
        return JSON.parse(JSON.stringify(candidates));
      } catch {
        return [];
      }
    })
    .catch(() => []);

  let added = 0;
  for (const blob of data) {
    const arr = deepFindProducts(blob);
    for (const r of arr) {
      const c = normalizeNextProduct(r);
      if (c && !seen.has(c.url || c.name)) {
        seen.add(c.url || c.name);
        allCandidates.push(c);
        added++;
      }
    }
  }
  return added;
}

async function tryExtractFromNextData(page: Page, allCandidates: RawCandidate[], seen: Set<string>): Promise<number> {
  const nextDataStr: string | null = await page
    .locator('#__NEXT_DATA__')
    .first()
    .textContent({ timeout: 2000 })
    .catch(() => null);
  if (!nextDataStr) return 0;
  try {
    const parsed = JSON.parse(nextDataStr);
    const arr = deepFindProducts(parsed);
    let added = 0;
    for (const r of arr) {
      const c = normalizeNextProduct(r);
      if (c && !seen.has(c.url || c.name)) {
        seen.add(c.url || c.name);
        allCandidates.push(c);
        added++;
      }
    }
    return added;
  } catch {
    return 0;
  }
}

async function tryExtractFromDom(page: Page, allCandidates: RawCandidate[], seen: Set<string>): Promise<number> {
  const cards = await page.evaluate(() => {
    const out: any[] = [];
    const seenT = new Set<string>();
    const els = Array.from(document.querySelectorAll('a, article, li, div'));
    for (const el of els) {
      const txt = ((el as HTMLElement).innerText || '').trim();
      if (!txt || txt.length > 500 || txt.length < 15) continue;
      if (!/pechuga/i.test(txt)) continue;
      if (!/\$\s?\d/.test(txt)) continue;
      const key = txt.slice(0, 120);
      if (seenT.has(key)) continue;
      seenT.add(key);
      const link =
        (el as HTMLElement).closest('a')?.getAttribute('href') ||
        el.querySelector('a')?.getAttribute('href') ||
        '';
      // Detección de stock: clases comunes + texto
      const cls = ((el as HTMLElement).className || '') + ' ' + (el.querySelector('[class*="stock"], [class*="availab"]')?.className || '');
      let stockHint: string | null = null;
      if (/\bout[-_ ]?of[-_ ]?stock\b/i.test(cls) || /sold[-_ ]?out/i.test(cls)) stockHint = 'out';
      else if (/\bin[-_ ]?stock\b/i.test(cls) || /availability[-_ ]?in/i.test(cls)) stockHint = 'in';
      if (!stockHint) {
        if (/(agotado|sin stock|no disponible|out of stock|sold out)/i.test(txt)) stockHint = 'out';
        else if (/(hay stock|en stock|disponible|in stock|agregar al carrito|add to cart)/i.test(txt)) stockHint = 'in';
      }
      out.push({
        text: txt.replace(/\s+/g, ' ').slice(0, 400),
        href: link,
        stockHint,
      });
      if (out.length >= 25) break;
    }
    return out;
  });
  let added = 0;
  for (const card of cards) {
    const m = (card.text as string).match(/(.+?)\s*\$\s*([\d.,]+)/);
    if (!m) continue;
    const name = m[1].trim();
    const price = clpToInt(m[2]);
    const weight = parseWeightKg(card.text);
    if (!weight) continue;
    if (!seen.has(card.href || name)) {
      seen.add(card.href || name);
      let inStock: boolean | null = null;
      if (card.stockHint === 'in') inStock = true;
      else if (card.stockHint === 'out') inStock = false;
      allCandidates.push({ name, url: card.href, price, weight, inStock });
      added++;
    }
  }
  return added;
}

export async function scrapeSiteWithPlaywright(site: SiteConfig, verbose = true): Promise<ScrapeResult> {
  const start = Date.now();
  try {
    const result = await withBrowser(async (browser) => {
      const allCandidates: RawCandidate[] = [];
      const seen = new Set<string>();

      for (const query of site.queries.length ? site.queries : ['pechuga pollo']) {
        const page = await newPage(browser);
        const url = site.searchUrlTemplate.replace('{q}', encodeURIComponent(query));
        if (verbose) console.log(`      [${site.name}] → ${url}`);
        try {
          await page.goto(url, { timeout: 45000, waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(3000);

          // Pasar Cloudflare con paciencia
          const passed = await passCloudflare(page, 30000);
          if (verbose && !passed) console.log(`      [${site.name}] ⚠ Cloudflare no pasó tras 30s`);

          await waitForHydration(page, 25000);

          // Scroll repetido para lazy loading
          for (let i = 0; i < 5; i++) {
            try { await page.mouse.wheel(0, 1800); } catch {}
            await page.waitForTimeout(1200);
          }

          // Esperar a que aparezca CUALQUIER patrón común de tarjeta de producto
          await page
            .waitForSelector(
              [
                '[class*="ProductSummary"]',
                '[class*="product-summary"]',
                '[class*="product-card"]',
                '[class*="ProductCard"]',
                '[data-tag="product-summary"]',
                'a[href*="/p/"]',
                'article.product',
                'li.product',
              ].join(','),
              { timeout: 8000, state: 'attached' }
            )
            .catch(() => {});

          const nextAdded = await tryExtractFromNextData(page, allCandidates, seen);
          if (verbose) console.log(`      [${site.name}] __NEXT_DATA__: +${nextAdded} candidatos`);

          // Probar también ventanas globales (__INITIAL_STATE__, __APOLLO_STATE__, etc)
          if (nextAdded === 0) {
            const globalsAdded = await tryExtractFromWindowGlobals(page, allCandidates, seen);
            if (verbose) console.log(`      [${site.name}] window globals: +${globalsAdded} candidatos`);
          }

          const domAdded = await tryExtractFromDom(page, allCandidates, seen);
          if (verbose) console.log(`      [${site.name}] DOM scan: +${domAdded} candidatos`);
        } catch (e) {
          if (verbose) console.log(`      [${site.name}] error en ${url}: ${(e as Error).message}`);
        } finally {
          await page.close();
        }
      }

      const products: Product[] = [];
      for (const c of allCandidates) {
        const p = candidateToProduct(c, site.name, site.baseUrl);
        if (p) products.push(p);
      }
      if (verbose) {
        console.log(`      [${site.name}] candidatos: ${allCandidates.length}, productos válidos: ${products.length}`);
        if (allCandidates.length > 0 && products.length === 0) {
          console.log(`      [${site.name}] ejemplos descartados:`);
          allCandidates.slice(0, 3).forEach((c) => {
            console.log(`        - "${c.name.slice(0, 80)}" $${c.price} ${c.weight}kg`);
          });
        }
      }
      return products;
    });

    return {
      store: site.name,
      products: result,
      error: result.length === 0 ? 'Playwright corrió pero no encontró productos válidos' : null,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      store: site.name,
      products: [],
      error: (e as Error).message,
      durationMs: Date.now() - start,
    };
  }
}
