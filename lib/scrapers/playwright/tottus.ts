import type { Product, ScrapeResult, PriceTier } from '../../types';
import { withBrowser, newPage, passCloudflare, scrollFully, isPechugaDeshuesada, parseWeightKg } from './_browser';

const SEARCH_URL = 'https://tottus.falabella.com/tottus-cl/search?Ntt=';
const QUERIES = ['pechuga pollo', 'pechuga deshuesada'];

export async function scrapeTottus(verbose = false): Promise<ScrapeResult> {
  const start = Date.now();
  try {
    const products = await withBrowser(async (browser) => {
      const all: Product[] = [];
      const seen = new Set<string>();

      for (const q of QUERIES) {
        const page = await newPage(browser);
        const url = `${SEARCH_URL}${encodeURIComponent(q)}`;
        if (verbose) console.log(`      [Tottus] → ${url}`);
        try {
          await page.goto(url, { timeout: 45000, waitUntil: 'domcontentloaded' });
          await passCloudflare(page, 30000);
          await page.waitForTimeout(3000);
          await page
            .waitForSelector('[data-pod="catalyst-pod"], [data-testid="pod-link"], a[href*="/product/"]', {
              timeout: 20000,
              state: 'attached',
            })
            .catch(() => {});
          await scrollFully(page, 3);

          // Tottus / Falabella inyecta los productos en __NEXT_DATA__.props.pageProps.results
          const nextData = await page
            .locator('#__NEXT_DATA__')
            .first()
            .textContent({ timeout: 3000 })
            .catch(() => null);

          if (!nextData) {
            if (verbose) console.log(`      [Tottus] no __NEXT_DATA__ tras hidratación`);
            continue;
          }

          const data = JSON.parse(nextData);
          const results = pickResults(data);
          if (verbose) console.log(`      [Tottus] ${results.length} candidatos en __NEXT_DATA__`);

          for (const p of results) {
            const name: string = p.displayName || p.title || p.name || '';
            if (!isPechugaDeshuesada(name)) continue;

            // Falabella usa "prices": [{price: "...", type: "..."}]
            let price = 0;
            const arr: any[] = p.prices || [];
            for (const pr of arr) {
              const v = typeof pr.price === 'string' ? parseInt(pr.price.replace(/\D/g, ''), 10) : pr.price;
              if (typeof v === 'number' && v > 0 && (!price || v < price)) price = v;
            }
            if (!price) price = p.salePrice || p.price || p.currentPrice || 0;
            if (!price) continue;

            const weight = parseWeightKg(name) || parseWeightKg(p.attributes?.measurement || '');
            if (!weight) continue;

            const pricePerKg = Math.round(price / weight);
            if (pricePerKg < 1000 || pricePerKg > 50000) continue;

            const sku = p.skuId || p.id || p.productId || '';
            if (seen.has(sku || name)) continue;
            seen.add(sku || name);

            const slug = p.url || p.productUrl || '';
            const detailUrl = slug
              ? slug.startsWith('http')
                ? slug
                : `https://tottus.falabella.com${slug.startsWith('/') ? '' : '/'}${slug}`
              : url;

            // Stock: si availability dice 'available' o si el card tiene un botón de agregar
            const inStock = p.availability === 'available' || p.isAvailable === true ? true
                          : p.availability === 'unavailable' || p.isAvailable === false ? false
                          : null;

            all.push({
              store: 'Tottus',
              id: `tottus-${sku || name.slice(0, 12).replace(/\W+/g, '-')}`,
              name: name.slice(0, 200),
              brand: p.brand || p.topSpecifications?.[0]?.value || 'Sin marca',
              format: weight >= 1 ? `${weight} kg` : `${Math.round(weight * 1000)} g`,
              weightKg: weight,
              url: detailUrl,
              image: p.mediaUrls?.[0] || p.image || null,
              tiers: [{ minQty: 1, unitPrice: price, pricePerKg, label: 'regular' }] as PriceTier[],
              bestPricePerKg: pricePerKg,
              ean: p.gtin || null,
              inStock,
            });
          }
        } catch (e) {
          if (verbose) console.log(`      [Tottus] error ${q}: ${(e as Error).message}`);
        } finally {
          await page.close();
        }
      }
      return all;
    });

    return {
      store: 'Tottus',
      products,
      error: products.length === 0 ? 'Playwright sin productos válidos' : null,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return { store: 'Tottus', products: [], error: (e as Error).message, durationMs: Date.now() - start };
  }
}

function pickResults(data: any): any[] {
  // Falabella estructura: props.pageProps.results
  const pp = data?.props?.pageProps;
  if (pp?.results && Array.isArray(pp.results)) return pp.results;
  if (pp?.searchResults?.results) return pp.searchResults.results;
  // Búsqueda profunda
  const out: any[] = [];
  function dive(o: any, depth = 0) {
    if (depth > 8 || !o) return;
    if (Array.isArray(o) && o.length && typeof o[0] === 'object' && o[0]?.displayName) {
      if (o.length > out.length) {
        out.length = 0;
        out.push(...o);
      }
      return;
    }
    if (typeof o === 'object') {
      for (const k of Object.keys(o)) dive(o[k], depth + 1);
    }
  }
  dive(data);
  return out;
}
