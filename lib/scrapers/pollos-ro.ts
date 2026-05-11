import type { Product, ScrapeResult, PriceTier } from '../types';

const BASE = 'https://www.pollosro.cl';
const QUERIES = ['pechuga'];
const UA = 'Mozilla/5.0 Chrome/124 Safari/537.36';

interface WooProduct {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  sku: string;
  is_in_stock: boolean;
  prices: { price: string; regular_price: string; sale_price: string; currency_minor_unit: number };
  images?: { src: string }[];
}

function isPechugaDeshuesada(name: string): boolean {
  const n = name.toLowerCase();
  if (!n.includes('pechuga')) return false;
  if (!/(deshues|fil[eé]|sin hueso|orga|trozad|porcion)/i.test(n)) return false;
  if (/(apan|cocid|hambur|nugget|breaded|empan)/i.test(n)) return false;
  return true;
}

function parseWeightKg(name: string): number | null {
  // "6 kg Pechuga", "15 kg Pechuga"
  const kg = name.match(/(\d+(?:[.,]\d+)?)\s*kg/i);
  if (kg) return parseFloat(kg[1].replace(',', '.'));
  const g = name.match(/(\d+(?:[.,]\d+)?)\s*g(?:r|ramos?)?/i);
  if (g) return parseFloat(g[1].replace(',', '.')) / 1000;
  return null;
}

export async function scrapePollosRo(verbose = false): Promise<ScrapeResult> {
  const start = Date.now();
  const seen = new Map<number, WooProduct>();
  try {
    for (const q of QUERIES) {
      const url = `${BASE}/wp-json/wc/store/products?search=${encodeURIComponent(q)}&per_page=50`;
      if (verbose) console.log(`      [Pollos RO] fetch ${url}`);
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        cache: 'no-store',
      });
      if (verbose) console.log(`      [Pollos RO] HTTP ${res.status}`);
      if (!res.ok) continue;
      const list = (await res.json()) as WooProduct[];
      if (verbose) console.log(`      [Pollos RO] ${list.length} productos en API`);
      for (const p of list) if (!seen.has(p.id)) seen.set(p.id, p);
    }

    const products: Product[] = [];
    for (const raw of seen.values()) {
      const name = raw.name.replace(/&#8211;/g, '–').replace(/<[^>]+>/g, '').trim();
      if (!isPechugaDeshuesada(name)) continue;
      const weight = parseWeightKg(name);
      if (!weight) continue;
      // currency_minor_unit: 0 means integer prices in CLP
      const minor = raw.prices.currency_minor_unit ?? 0;
      const price = parseInt(raw.prices.price, 10) / Math.pow(10, minor);
      if (!price) continue;
      const pricePerKg = Math.round(price / weight);
      if (pricePerKg < 1000 || pricePerKg > 50000) continue;

      const tier: PriceTier = { minQty: 1, unitPrice: price, pricePerKg, label: 'regular' };
      products.push({
        store: 'Pollos RO',
        id: `pollos-ro-${raw.id}`,
        name: name.slice(0, 180),
        brand: 'Pollos RO',
        format: weight >= 1 ? `${weight} kg` : `${Math.round(weight * 1000)} g`,
        weightKg: weight,
        url: raw.permalink,
        image: raw.images?.[0]?.src || null,
        tiers: [tier],
        bestPricePerKg: pricePerKg,
        ean: raw.sku || null,
        inStock: raw.is_in_stock === true,
      });
    }

    return {
      store: 'Pollos RO',
      products,
      error: products.length === 0 ? 'WooCommerce API sin productos válidos' : null,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      store: 'Pollos RO',
      products: [],
      error: (e as Error).message,
      durationMs: Date.now() - start,
    };
  }
}
