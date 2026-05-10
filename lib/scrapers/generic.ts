import type { Product, ScrapeResult, PriceTier, SiteConfig } from '../types';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DEFAULT_HEADERS: HeadersInit = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'es-CL,es;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
};

function clpToInt(s: string): number {
  // "$4.731" / "4.731" / "4731" -> 4731
  const m = s.match(/(\d{1,3}(?:[.,]\d{3})*|\d+)/);
  if (!m) return 0;
  return parseInt(m[1].replace(/[.,]/g, ''), 10) || 0;
}

function parseWeightKg(text: string): number | null {
  // "4.5 Kg", "800 g", "1 kg", "750 gr"
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
  if (pricePerKg < 1000 || pricePerKg > 50000) return null; // outliers absurdos

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

// ============================================================================
// Strategy: Next.js __NEXT_DATA__ (Alvi, otros sitios Next.js con SSR)
// ============================================================================
function extractNextData(html: string): any | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function deepFindProducts(obj: any, depth = 0): any[] {
  if (depth > 8 || !obj || typeof obj !== 'object') return [];
  // Buscar arrays con elementos que tengan "name" o "productName" y un precio
  if (Array.isArray(obj)) {
    if (obj.length > 0 && typeof obj[0] === 'object' && obj[0]) {
      const first = obj[0];
      const hasName = first.name || first.productName || first.displayName || first.nameComplete;
      const hasPrice =
        first.price !== undefined ||
        first.sellers ||
        first.priceSteps ||
        first.prices ||
        first.offers;
      if (hasName && hasPrice && obj.length < 200) return obj;
    }
    const out: any[] = [];
    for (const item of obj) {
      const found = deepFindProducts(item, depth + 1);
      if (found.length > out.length) out.length = 0, out.push(...found);
    }
    return out;
  }
  for (const k of Object.keys(obj)) {
    const found = deepFindProducts(obj[k], depth + 1);
    if (found.length > 0) return found;
  }
  return [];
}

function normalizeNextProduct(raw: any, baseUrl: string): RawCandidate | null {
  const name = raw.nameComplete || raw.name || raw.productName || raw.displayName;
  if (!name) return null;

  // Precio: priorizar precio más bajo dentro del producto (steps, sellers)
  let price = 0;
  const steps = raw.priceSteps || raw.tieredPrices || [];
  for (const s of steps) {
    const p = s.promotionalPrice || s.price || s.unitPrice;
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

// ============================================================================
// Strategy: JSON-LD (Schema.org Product)
// ============================================================================
function extractJsonLd(html: string): any[] {
  const blocks: any[] = [];
  const re = /<script[^>]+type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs;
  let m;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (Array.isArray(parsed)) blocks.push(...parsed);
      else blocks.push(parsed);
    } catch {}
  }
  return blocks;
}

function findProductsInJsonLd(blocks: any[]): any[] {
  const out: any[] = [];
  for (const b of blocks) {
    const items = Array.isArray(b['@graph']) ? b['@graph'] : [b];
    for (const it of items) {
      const types = Array.isArray(it['@type']) ? it['@type'] : [it['@type']];
      if (types.includes('Product') || types.includes('ItemList')) {
        if (types.includes('ItemList') && Array.isArray(it.itemListElement)) {
          for (const el of it.itemListElement) {
            const item = el.item || el;
            if (item['@type'] === 'Product') out.push(item);
          }
        } else if (types.includes('Product')) {
          out.push(it);
        }
      }
    }
  }
  return out;
}

function normalizeJsonLdProduct(p: any): RawCandidate | null {
  const name = p.name;
  if (!name) return null;
  const offer = Array.isArray(p.offers) ? p.offers[0] : p.offers;
  const price = parseFloat(offer?.price || offer?.lowPrice || 0);
  if (!price) return null;
  const weight = parseWeightKg(`${p.weight || ''} ${name}`);
  if (!weight) return null;
  return {
    name,
    url: p.url || p['@id'] || '',
    price,
    weight,
    image: typeof p.image === 'string' ? p.image : p.image?.[0],
    brand: typeof p.brand === 'string' ? p.brand : p.brand?.name,
    ean: p.gtin13 || p.gtin || p.sku,
  };
}

// ============================================================================
// Strategy: Microdata (itemprop="name" + itemprop="price")
// ============================================================================
function extractMicrodata(html: string): RawCandidate[] {
  const out: RawCandidate[] = [];
  // Muy heurístico: buscar bloques con itemtype="Product"
  const re =
    /<[^>]+itemtype="https?:\/\/schema\.org\/Product"[^>]*>([\s\S]*?)<\/(?:div|article|li|section)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const block = m[1];
    const nameM = block.match(/itemprop="name"[^>]*>([^<]+)</);
    const priceM = block.match(/itemprop="price"[^>]*(?:content="([^"]+)"|>([^<]+)<)/);
    const urlM = block.match(/itemprop="url"[^>]*(?:content="([^"]+)"|href="([^"]+)")/);
    if (!nameM || !priceM) continue;
    const name = nameM[1].trim();
    const price = clpToInt(priceM[1] || priceM[2] || '');
    const weight = parseWeightKg(name);
    if (!weight) continue;
    out.push({ name, price, weight, url: urlM?.[1] || urlM?.[2] || '' });
  }
  return out;
}

// ============================================================================
// Main entry point: scrape a site with auto-detection
// ============================================================================
export async function scrapeSite(site: SiteConfig): Promise<ScrapeResult> {
  const start = Date.now();
  if (site.needsChromium) {
    return {
      store: site.name,
      products: [],
      error: 'needsChromium: este sitio requiere navegador (no soportado en Vercel Hobby)',
      durationMs: 0,
    };
  }
  try {
    const allCandidates: RawCandidate[] = [];
    const seenUrls = new Set<string>();

    for (const q of site.queries.length ? site.queries : ['pechuga pollo']) {
      const url = site.searchUrlTemplate.replace('{q}', encodeURIComponent(q));
      let html: string;
      try {
        const res = await fetch(url, { headers: DEFAULT_HEADERS, cache: 'no-store' });
        if (!res.ok) continue;
        html = await res.text();
      } catch {
        continue;
      }

      // Strategy 1: __NEXT_DATA__
      const nextData = extractNextData(html);
      if (nextData) {
        const arr = deepFindProducts(nextData);
        for (const r of arr) {
          const c = normalizeNextProduct(r, site.baseUrl);
          if (c && !seenUrls.has(c.url || c.name)) {
            seenUrls.add(c.url || c.name);
            allCandidates.push(c);
          }
        }
      }

      // Strategy 2: JSON-LD Product
      const jsonLd = extractJsonLd(html);
      const ldProducts = findProductsInJsonLd(jsonLd);
      for (const p of ldProducts) {
        const c = normalizeJsonLdProduct(p);
        if (c && !seenUrls.has(c.url || c.name)) {
          seenUrls.add(c.url || c.name);
          allCandidates.push(c);
        }
      }

      // Strategy 3: Microdata
      if (allCandidates.length === 0) {
        const micro = extractMicrodata(html);
        for (const c of micro) {
          if (!seenUrls.has(c.url || c.name)) {
            seenUrls.add(c.url || c.name);
            allCandidates.push(c);
          }
        }
      }
    }

    const products: Product[] = [];
    for (const c of allCandidates) {
      const p = candidateToProduct(c, site.name, site.baseUrl);
      if (p) products.push(p);
    }

    return {
      store: site.name,
      products,
      error: products.length === 0 ? 'No se encontraron productos válidos de pechuga deshuesada' : null,
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

/**
 * "Aprender" un sitio nuevo: intenta scrapearlo con todas las estrategias
 * y devuelve productos detectados + la estrategia que funcionó. Si nada
 * funciona, marca needsChromium o pide configuración manual.
 */
export async function autoDetectSite(
  baseUrl: string,
  searchUrlTemplate: string,
  query = 'pechuga pollo'
): Promise<{
  strategy: SiteConfig['strategy'];
  needsChromium: boolean;
  sampleProducts: Product[];
  rawCandidates: number;
  error: string | null;
}> {
  const fakeSite: SiteConfig = {
    id: 'tmp',
    name: 'Test',
    baseUrl,
    searchUrlTemplate,
    queries: [query],
    strategy: 'unknown',
    enabled: false,
    needsChromium: false,
  };
  const result = await scrapeSite(fakeSite);

  // Inferir estrategia por contenido del HTML
  let strategy: SiteConfig['strategy'] = 'unknown';
  let needsChromium = false;

  try {
    const url = searchUrlTemplate.replace('{q}', encodeURIComponent(query));
    const res = await fetch(url, { headers: DEFAULT_HEADERS, cache: 'no-store' });
    const html = await res.text();
    if (html.includes('__cf_chl_tk') || html.includes('challenge-platform')) {
      needsChromium = true;
      strategy = 'unknown';
    } else if (extractNextData(html)) {
      strategy = 'next_data';
    } else if (/application\/ld\+json/.test(html)) {
      strategy = 'jsonld';
    } else if (/itemtype="https?:\/\/schema\.org\/Product"/.test(html)) {
      strategy = 'microdata';
    }
  } catch {}

  return {
    strategy,
    needsChromium: needsChromium || (result.products.length === 0 && strategy === 'unknown'),
    sampleProducts: result.products.slice(0, 6),
    rawCandidates: result.products.length,
    error: result.error,
  };
}
