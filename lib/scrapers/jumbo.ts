import type { Product, ScrapeResult, PriceTier } from '../types';

const VTEX_API = 'https://jumbocl.myvtex.com/api/catalog_system/pub/products/search';
const PUBLIC_BASE = 'https://www.jumbo.cl';
const QUERIES = ['pechuga pollo', 'pechuga deshuesada'];
const UA = 'Mozilla/5.0 Chrome/124 Safari/537.36';

interface VtexSeller {
  sellerId: string;
  commertialOffer?: {
    Price: number;
    ListPrice: number;
    PriceWithoutDiscount?: number;
    AvailableQuantity: number;
    IsAvailable: boolean;
    Installments?: any[];
  };
}

interface VtexItem {
  itemId: string;
  name: string;
  ean: string;
  measurementUnit: string;
  unitMultiplier: number;
  images?: { imageUrl: string }[];
  sellers: VtexSeller[];
}

interface VtexProduct {
  productId: string;
  productName: string;
  brand: string;
  linkText: string;
  link: string;
  description?: string;
  items: VtexItem[];
}

function isPechugaDeshuesada(name: string): boolean {
  const n = name.toLowerCase();
  if (!n.includes('pechuga')) return false;
  if (!/(deshues|fil[eé]|sin hueso)/i.test(n)) return false;
  if (/(apan|cocid|hambur|nugget|breaded|empan)/i.test(n)) return false;
  return true;
}

function parseWeightKg(text: string): number | null {
  const tx = text.toLowerCase();
  const kg = tx.match(/(\d+(?:[.,]\d+)?)\s*kg\b/);
  if (kg) return parseFloat(kg[1].replace(',', '.'));
  const g = tx.match(/(\d+(?:[.,]\d+)?)\s*g(?:r|ramos?)?\b/);
  if (g) return parseFloat(g[1].replace(',', '.')) / 1000;
  return null;
}

export async function scrapeJumbo(verbose = false): Promise<ScrapeResult> {
  const start = Date.now();
  const seen = new Map<string, VtexProduct>();

  try {
    for (const q of QUERIES) {
      const url = `${VTEX_API}?ft=${encodeURIComponent(q)}&_from=0&_to=49`;
      if (verbose) console.log(`      [Jumbo] fetch ${url}`);
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        cache: 'no-store',
      });
      if (verbose) console.log(`      [Jumbo] HTTP ${res.status}`);
      if (!res.ok) continue;
      const list = (await res.json()) as VtexProduct[];
      if (verbose) console.log(`      [Jumbo] ${list.length} productos en VTEX API`);
      for (const p of list) if (!seen.has(p.productId)) seen.set(p.productId, p);
    }

    const products: Product[] = [];
    for (const p of seen.values()) {
      if (!isPechugaDeshuesada(p.productName)) continue;
      const item = p.items?.[0];
      const seller = item?.sellers?.[0];
      const offer = seller?.commertialOffer;
      if (!item || !offer) continue;
      const price = offer.Price || offer.ListPrice || 0;
      if (!price) continue;

      // Peso: VTEX expone unitMultiplier en kg si measurementUnit === 'kg'
      let weight: number | null = null;
      if (item.measurementUnit?.toLowerCase() === 'kg' && item.unitMultiplier) {
        weight = item.unitMultiplier;
      }
      if (!weight) weight = parseWeightKg(p.productName) || parseWeightKg(item.name);
      if (!weight) continue;

      const pricePerKg = Math.round(price / weight);
      if (pricePerKg < 1000 || pricePerKg > 50000) continue;

      const tier: PriceTier = {
        minQty: 1,
        unitPrice: price,
        pricePerKg,
        label: offer.PriceWithoutDiscount && offer.PriceWithoutDiscount > price ? 'oferta' : 'regular',
      };

      // URL pública en jumbo.cl
      const detailUrl = `${PUBLIC_BASE}/${p.linkText}/p`;

      products.push({
        store: 'Jumbo',
        id: `jumbo-${p.productId}`,
        name: p.productName,
        brand: p.brand || 'Sin marca',
        format: weight >= 1 ? `${weight} kg` : `${Math.round(weight * 1000)} g`,
        weightKg: weight,
        url: detailUrl,
        image: item.images?.[0]?.imageUrl || null,
        tiers: [tier],
        bestPricePerKg: pricePerKg,
        ean: item.ean || null,
        inStock: offer.IsAvailable === true && offer.AvailableQuantity > 0,
      });
    }

    return {
      store: 'Jumbo',
      products,
      error: products.length === 0 ? 'VTEX API sin productos válidos' : null,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      store: 'Jumbo',
      products: [],
      error: (e as Error).message,
      durationMs: Date.now() - start,
    };
  }
}
