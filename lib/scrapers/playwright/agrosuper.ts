import type { Product, ScrapeResult, PriceTier } from '../../types';
import { withBrowser, newPage, scrollFully, isPechugaDeshuesada, parseWeightKg, clpToInt } from './_browser';

const SEARCH_URL = 'https://www.agrosuperventas.com/search?q=';
const QUERIES = ['pechuga', 'pechuga+deshuesada'];

export async function scrapeAgrosuper(verbose = false): Promise<ScrapeResult> {
  const start = Date.now();
  try {
    const products = await withBrowser(async (browser) => {
      const all: Product[] = [];
      const seen = new Set<string>();

      for (const q of QUERIES) {
        const page = await newPage(browser);
        const url = `${SEARCH_URL}${q}`;
        if (verbose) console.log(`      [Agrosuper] → ${url}`);
        try {
          await page.goto(url, { timeout: 45000, waitUntil: 'domcontentloaded' });
          // SAP commerce usa <div class="product-agx"> y similares
          await page.waitForTimeout(4000);
          await page
            .waitForSelector('.product-agx, [data-product-id], .product-listing__item, .js-pickup-product-info', {
              timeout: 20000,
              state: 'attached',
            })
            .catch(() => {});
          await scrollFully(page, 5);

          const cards = await page.evaluate(() => {
            const out: any[] = [];
            const sels = ['.product-agx', '.product-listing__item', '[data-product-id]'];
            const els = new Set<Element>();
            for (const s of sels) {
              for (const el of document.querySelectorAll(s)) els.add(el);
            }
            for (const el of els) {
              const txt = ((el as HTMLElement).innerText || '').trim();
              if (!txt || !/pechuga/i.test(txt)) continue;
              const nameEl = el.querySelector('.name, .product-name, h2, h3, h4, [class*="name"]');
              const name = nameEl ? (nameEl as HTMLElement).innerText.trim() : txt.split('\n')[0];
              const priceEl =
                el.querySelector('.js-pickup-product-price, .price, [class*="price"], .product-price') as HTMLElement | null;
              const priceTxt = priceEl?.innerText || '';
              const a = (el.querySelector('a[href]') || el.closest('a')) as HTMLAnchorElement | null;
              const cls = ((el as HTMLElement).className || '').toLowerCase() + ' ' + txt.toLowerCase();
              let stock: boolean | null = null;
              if (/sin stock|agotado|no disponible|out.of.stock/.test(cls)) stock = false;
              else if (/agregar|añadir|comprar|in.stock|disponible/.test(cls)) stock = true;
              out.push({ name, priceTxt, href: a?.href || '', stock, cardTxt: txt });
              if (out.length >= 30) break;
            }
            return out;
          });

          if (verbose) console.log(`      [Agrosuper] ${cards.length} cards detectadas`);

          for (const c of cards) {
            if (!isPechugaDeshuesada(c.name)) continue;
            const price = clpToInt(c.priceTxt) || clpToInt(c.cardTxt);
            const weight = parseWeightKg(c.name) || parseWeightKg(c.cardTxt);
            if (!weight || !price) continue;
            const pricePerKg = Math.round(price / weight);
            if (pricePerKg < 1000 || pricePerKg > 50000) continue;
            const key = c.href || c.name;
            if (seen.has(key)) continue;
            seen.add(key);
            all.push({
              store: 'Agrosuper Ventas Online',
              id: `agrosuper-${(c.href || c.name).slice(-40).replace(/\W+/g, '-')}`,
              name: c.name.slice(0, 200),
              brand: 'Agrosuper',
              format: weight >= 1 ? `${weight} kg` : `${Math.round(weight * 1000)} g`,
              weightKg: weight,
              url: c.href || url,
              image: null,
              tiers: [{ minQty: 1, unitPrice: price, pricePerKg, label: 'regular' }] as PriceTier[],
              bestPricePerKg: pricePerKg,
              ean: null,
              inStock: c.stock,
            });
          }
        } catch (e) {
          if (verbose) console.log(`      [Agrosuper] error ${q}: ${(e as Error).message}`);
        } finally {
          await page.close();
        }
      }
      return all;
    });

    return {
      store: 'Agrosuper Ventas Online',
      products,
      error: products.length === 0 ? 'Playwright sin productos válidos' : null,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      store: 'Agrosuper Ventas Online',
      products: [],
      error: (e as Error).message,
      durationMs: Date.now() - start,
    };
  }
}
