import type { Product, ScrapeResult, PriceTier } from '../types';

const ALVI_BASE = 'https://www.alvi.cl';
const QUERIES = ['pechuga pollo', 'pechuga deshuesada', 'filete pechuga pollo'];

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

interface AlviPriceStep {
  promotionalPrice: number;
  minQuantity: number;
  percentualDiscount: number;
  ppum: string; // "$4.731 x Kg"
}

interface AlviSeller {
  price: number;
  listPrice: number;
  priceWithoutDiscount: number;
  ppum: string;
}

interface AlviProduct {
  productId: string;
  name: string;
  nameComplete: string;
  format: string;
  brand: string;
  ean: string;
  detailUrl: string;
  images: string[];
  unitMultiplierUn: number;
  measurementUnitUn: string;
  sellers: AlviSeller[];
  priceSteps: AlviPriceStep[];
}

function parsePpum(ppum: string): number {
  // "$4.731 x Kg" -> 4731
  const m = ppum.match(/\$?([\d.,]+)/);
  if (!m) return 0;
  return parseInt(m[1].replace(/\./g, '').replace(/,/g, ''), 10) || 0;
}

function isPechugaDeshuesada(name: string): boolean {
  const n = name.toLowerCase();
  if (!n.includes('pechuga')) return false;
  if (!/(deshues|fil[eé]|sin hueso)/i.test(n)) return false;
  // Excluir productos procesados / no aptos
  if (/(apan|cocid|hambur|nugget|breaded|empan)/i.test(n)) return false;
  return true;
}

function toProduct(p: AlviProduct): Product | null {
  if (!isPechugaDeshuesada(p.nameComplete || p.name)) return null;
  if (!p.unitMultiplierUn || p.unitMultiplierUn <= 0) return null;
  if (p.measurementUnitUn?.toLowerCase() !== 'kg') return null;

  const tiers: PriceTier[] = [];

  // Precio regular del seller
  const seller = p.sellers?.[0];
  if (seller) {
    tiers.push({
      minQty: 1,
      unitPrice: seller.price,
      pricePerKg: parsePpum(seller.ppum) || Math.round(seller.price / p.unitMultiplierUn),
      label: 'regular',
    });
  }

  // Precios escalonados (socio Alvi)
  for (const step of p.priceSteps || []) {
    tiers.push({
      minQty: step.minQuantity,
      unitPrice: step.promotionalPrice,
      pricePerKg: parsePpum(step.ppum) || Math.round(step.promotionalPrice / p.unitMultiplierUn),
      label: step.minQuantity > 1 ? `socio ${step.minQuantity}+` : 'socio',
    });
  }

  if (tiers.length === 0) return null;

  const bestPricePerKg = Math.min(...tiers.map((t) => t.pricePerKg).filter((n) => n > 0));

  return {
    store: 'Alvi',
    id: `alvi-${p.productId}`,
    name: p.name,
    brand: p.brand || 'Sin marca',
    format: p.format,
    weightKg: p.unitMultiplierUn,
    url: `${ALVI_BASE}${p.detailUrl.replace(/\/p$/, '')}`,
    image: p.images?.[0] || null,
    tiers,
    bestPricePerKg,
    ean: p.ean || null,
  };
}

async function fetchQuery(query: string): Promise<AlviProduct[]> {
  const url = `${ALVI_BASE}/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-CL,es;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
    },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Alvi ${query}: HTTP ${res.status}`);
  const html = await res.text();

  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
  if (!match) throw new Error('Alvi: no __NEXT_DATA__ found');

  const json = JSON.parse(match[1]);
  const products =
    json?.props?.pageProps?.intelliSearchData?.availableProducts ||
    json?.props?.pageProps?.dehydratedState?.queries?.[0]?.state?.data?.availableProducts ||
    [];
  return products as AlviProduct[];
}

export async function scrapeAlvi(): Promise<ScrapeResult> {
  const start = Date.now();
  try {
    const all = await Promise.all(QUERIES.map((q) => fetchQuery(q).catch(() => [])));
    const seen = new Map<string, AlviProduct>();
    for (const list of all) {
      for (const p of list) {
        if (!seen.has(p.productId)) seen.set(p.productId, p);
      }
    }

    const products: Product[] = [];
    for (const raw of seen.values()) {
      const prod = toProduct(raw);
      if (prod) products.push(prod);
    }

    return {
      store: 'Alvi',
      products,
      error: null,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      store: 'Alvi',
      products: [],
      error: (e as Error).message,
      durationMs: Date.now() - start,
    };
  }
}
