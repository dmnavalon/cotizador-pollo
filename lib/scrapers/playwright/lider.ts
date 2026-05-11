import type { Product, ScrapeResult, PriceTier } from '../../types';
import { withBrowser, newPage, passCloudflare, scrollFully, isPechugaDeshuesada, parseWeightKg, clpToInt } from './_browser';

const SEARCH_URL = 'https://www.lider.cl/supermercado/search?search_query=';
const QUERIES = ['pechuga pollo', 'pechuga deshuesada'];

export async function scrapeLider(verbose = false): Promise<ScrapeResult> {
  const start = Date.now();
  try {
    const products = await withBrowser(async (browser) => {
      const all: Product[] = [];
      const seen = new Set<string>();

      for (const q of QUERIES) {
        const page = await newPage(browser);
        const url = `${SEARCH_URL}${encodeURIComponent(q)}`;
        if (verbose) console.log(`      [Lider] → ${url}`);
        try {
          await page.goto(url, { timeout: 45000, waitUntil: 'domcontentloaded' });
          await passCloudflare(page, 25000);
          // Lider tarda en hidratar — esperar a que aparezcan productos
          await page
            .waitForSelector('[data-testid*="product"], [data-cnstrc-item-id], a[href*="/supermercado/product/"]', {
              timeout: 25000,
              state: 'attached',
            })
            .catch(() => {});
          await scrollFully(page, 5);
          await page.waitForTimeout(2000);

          // Estrategia 1: leer __NEXT_DATA__ buscando productos
          const nextData = await page
            .locator('#__NEXT_DATA__')
            .first()
            .textContent({ timeout: 2000 })
            .catch(() => null);

          let extracted = 0;
          if (nextData) {
            try {
              const data = JSON.parse(nextData);
              const products = findVariantArrays(data);
              for (const p of products) {
                const name: string = p.displayName || p.title || p.productName || p.name || '';
                const price = pickPriceFromObj(p);
                const sku = p.gtin13 || p.sku || p.productId || p.id || '';
                const slug = p.urlSlug || p.url || p.slug || '';
                const inStock = p.isOutOfStock === false || p.available === true || p.availability === 'in-stock' ? true
                              : (p.isOutOfStock === true || p.availability === 'out-of-stock' || p.availability === false) ? false
                              : null;
                const weight = parseWeightKg(name);
                if (!weight || !price || !isPechugaDeshuesada(name)) continue;
                const pricePerKg = Math.round(price / weight);
                if (pricePerKg < 1000 || pricePerKg > 50000) continue;
                if (seen.has(sku || name)) continue;
                seen.add(sku || name);
                all.push({
                  store: 'Lider',
                  id: `lider-${sku || name.slice(0, 12).replace(/\W+/g, '-')}`,
                  name: name.slice(0, 200),
                  brand: p.brand?.name || p.brand || 'Sin marca',
                  format: weight >= 1 ? `${weight} kg` : `${Math.round(weight * 1000)} g`,
                  weightKg: weight,
                  url: slug
                    ? slug.startsWith('http')
                      ? slug
                      : `https://www.lider.cl${slug.startsWith('/') ? '' : '/'}${slug}`
                    : url,
                  image: p.images?.[0]?.url || p.image || null,
                  tiers: [{ minQty: 1, unitPrice: price, pricePerKg, label: 'regular' }] as PriceTier[],
                  bestPricePerKg: pricePerKg,
                  ean: p.gtin13 || null,
                  inStock,
                });
                extracted++;
              }
            } catch {}
          }

          // Estrategia 2: fallback DOM
          if (extracted === 0) {
            const cards = await page.evaluate(() => {
              const out: any[] = [];
              const seen = new Set<string>();
              const candidates = Array.from(document.querySelectorAll('[data-testid*="product"], li, article, div'));
              for (const el of candidates) {
                const txt = ((el as HTMLElement).innerText || '').trim();
                if (!/pechuga/i.test(txt) || !/\$\s?\d/.test(txt)) continue;
                if (txt.length > 600 || txt.length < 25) continue;
                const key = txt.slice(0, 100);
                if (seen.has(key)) continue;
                seen.add(key);
                const a = (el.querySelector('a[href]') || el.closest('a')) as HTMLAnchorElement | null;
                const cls = ((el as HTMLElement).className || '').toLowerCase();
                let stock: boolean | null = null;
                if (/out-of-stock|sin stock|agotado|sold out/i.test(cls + ' ' + txt)) stock = false;
                else if (/in-stock|en stock|disponible|agregar al carrito/i.test(txt)) stock = true;
                out.push({ text: txt.replace(/\s+/g, ' '), href: a?.href || '', stock });
                if (out.length >= 20) break;
              }
              return out;
            });
            for (const c of cards) {
              const m = (c.text as string).match(/(.+?)\s*\$\s*([\d.,]+)/);
              if (!m) continue;
              const name = m[1].trim();
              const price = clpToInt(m[2]);
              const weight = parseWeightKg(c.text);
              if (!weight || !isPechugaDeshuesada(name)) continue;
              const pricePerKg = Math.round(price / weight);
              if (pricePerKg < 1000 || pricePerKg > 50000) continue;
              if (seen.has(c.href || name)) continue;
              seen.add(c.href || name);
              all.push({
                store: 'Lider',
                id: `lider-${(c.href || name).slice(-40).replace(/\W+/g, '-')}`,
                name: name.slice(0, 200),
                brand: 'Sin marca',
                format: weight >= 1 ? `${weight} kg` : `${Math.round(weight * 1000)} g`,
                weightKg: weight,
                url: c.href || url,
                image: null,
                tiers: [{ minQty: 1, unitPrice: price, pricePerKg, label: 'regular' }],
                bestPricePerKg: pricePerKg,
                ean: null,
                inStock: c.stock,
              });
            }
          }
          if (verbose) console.log(`      [Lider] +${extracted} from NEXT_DATA, total ${all.length}`);
        } catch (e) {
          if (verbose) console.log(`      [Lider] error ${q}: ${(e as Error).message}`);
        } finally {
          await page.close();
        }
      }
      return all;
    });

    return {
      store: 'Lider',
      products,
      error: products.length === 0 ? 'Playwright sin productos válidos' : null,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return { store: 'Lider', products: [], error: (e as Error).message, durationMs: Date.now() - start };
  }
}

function findVariantArrays(obj: any, depth = 0): any[] {
  if (depth > 10 || !obj || typeof obj !== 'object') return [];
  if (Array.isArray(obj)) {
    if (
      obj.length &&
      typeof obj[0] === 'object' &&
      obj[0] &&
      (obj[0].displayName || obj[0].productName || obj[0].title)
    ) {
      return obj;
    }
    const out: any[] = [];
    for (const it of obj) {
      const found = findVariantArrays(it, depth + 1);
      if (found.length > out.length) out.length = 0, out.push(...found);
    }
    return out;
  }
  for (const k of Object.keys(obj)) {
    const found = findVariantArrays(obj[k], depth + 1);
    if (found.length) return found;
  }
  return [];
}

function pickPriceFromObj(p: any): number {
  const candidates = [
    p.price,
    p.salePrice,
    p.listPrice,
    p.prices?.price,
    p.prices?.salePrice,
    p.priceInfo?.salePrice,
    p.priceInfo?.linePrice,
    p.priceRange?.sellingPrice?.lowPrice,
  ].filter((n) => typeof n === 'number' && n > 0);
  return candidates[0] || 0;
}
