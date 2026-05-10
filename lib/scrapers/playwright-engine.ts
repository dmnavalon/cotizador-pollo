/**
 * Scraper basado en Playwright para sitios que requieren JS rendering
 * (Cloudflare challenge, SPAs). Solo se usa desde scripts/scrape-full.ts
 * que corre en GitHub Actions — NUNCA importar desde la app Next.js,
 * Playwright no cabe en una serverless function.
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
}

function candidateToProduct(c: RawCandidate, store: string, baseUrl: string): Product | null {
  if (!isPechugaDeshuesada(c.name)) return null;
  if (!c.price || !c.weight || c.weight <= 0) return null;
  const pricePerKg = Math.round(c.price / c.weight);
  if (pricePerKg < 1000 || pricePerKg > 50000) return null;

  const tier: PriceTier = {
    minQty: 1,
    unitPrice: c.price,
    pricePerKg,
    label: 'regular',
  };
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
  };
}

function deepFindProducts(obj: any, depth = 0): any[] {
  if (depth > 8 || !obj || typeof obj !== 'object') return [];
  if (Array.isArray(obj)) {
    if (obj.length > 0 && typeof obj[0] === 'object' && obj[0]) {
      const first = obj[0];
      const hasName = first.name || first.productName || first.displayName || first.nameComplete;
      const hasPrice =
        first.price !== undefined || first.sellers || first.priceSteps || first.prices || first.offers;
      if (hasName && hasPrice && obj.length < 200) return obj;
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
  let weight: number | null = raw.unitMultiplierUn;
  if (!weight) weight = parseWeightKg(`${raw.format || ''} ${name}`);
  if (!weight) return null;
  let url = raw.detailUrl || raw.url || raw.link || '';
  if (url.endsWith('/p')) url = url.slice(0, -2);
  return {
    name,
    url,
    price,
    weight,
    image: raw.images?.[0] || raw.image,
    brand: raw.brand,
    ean: raw.ean,
    productId: raw.productId || raw.itemId || raw.sku,
  };
}

async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
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
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: { 'Accept-Language': 'es-CL,es;q=0.9' },
  });
  return ctx.newPage();
}

/**
 * Scraper genérico Playwright: navega, espera hidratación, intenta extraer
 * por múltiples estrategias.
 */
export async function scrapeSiteWithPlaywright(site: SiteConfig): Promise<ScrapeResult> {
  const start = Date.now();
  try {
    const result = await withBrowser(async (browser) => {
      const allCandidates: RawCandidate[] = [];
      const seen = new Set<string>();

      for (const query of site.queries.length ? site.queries : ['pechuga pollo']) {
        const page = await newPage(browser);
        const url = site.searchUrlTemplate.replace('{q}', encodeURIComponent(query));
        try {
          await page.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });
          // Esperar a que cargue / pase challenge
          await page.waitForTimeout(4000);
          try { await page.mouse.wheel(0, 1500); await page.waitForTimeout(1500); } catch {}
          try { await page.mouse.wheel(0, 1500); await page.waitForTimeout(1500); } catch {}

          // Estrategia 1: __NEXT_DATA__
          const nextDataStr: string | null = await page
            .locator('#__NEXT_DATA__')
            .first()
            .textContent({ timeout: 2000 })
            .catch(() => null);
          if (nextDataStr) {
            try {
              const parsed = JSON.parse(nextDataStr);
              const arr = deepFindProducts(parsed);
              for (const r of arr) {
                const c = normalizeNextProduct(r);
                if (c && !seen.has(c.url || c.name)) {
                  seen.add(c.url || c.name);
                  allCandidates.push(c);
                }
              }
            } catch {}
          }

          // Estrategia 2: extraer del DOM cards visibles
          if (allCandidates.length === 0) {
            const cards = await page.evaluate(() => {
              const out: any[] = [];
              const seenT = new Set<string>();
              const all = Array.from(document.querySelectorAll('a, article, li, div'));
              for (const el of all) {
                const txt = ((el as HTMLElement).innerText || '').trim();
                if (!txt || txt.length > 400 || txt.length < 20) continue;
                if (!/pechuga/i.test(txt)) continue;
                if (!/\$\s?\d/.test(txt)) continue;
                const key = txt.slice(0, 120);
                if (seenT.has(key)) continue;
                seenT.add(key);
                const link = (el as HTMLElement).closest('a')?.getAttribute('href') ||
                             el.querySelector('a')?.getAttribute('href') || '';
                out.push({ text: txt.replace(/\s+/g, ' ').slice(0, 300), href: link });
                if (out.length >= 15) break;
              }
              return out;
            });
            for (const card of cards) {
              // parsear: nombre antes del primer $; precio en el $ que mejor pegue al nombre
              const m = (card.text as string).match(/(.+?)\s*\$\s*([\d.,]+)/);
              if (!m) continue;
              const name = m[1].trim();
              const price = clpToInt(m[2]);
              const weight = parseWeightKg(card.text);
              if (!weight) continue;
              if (!seen.has(card.href || name)) {
                seen.add(card.href || name);
                allCandidates.push({ name, url: card.href, price, weight });
              }
            }
          }
        } catch (e) {
          // página específica falló, seguir con la siguiente query
        } finally {
          await page.close();
        }
      }

      const products: Product[] = [];
      for (const c of allCandidates) {
        const p = candidateToProduct(c, site.name, site.baseUrl);
        if (p) products.push(p);
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
