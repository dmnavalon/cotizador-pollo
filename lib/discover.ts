import type { Product, SiteConfig } from './types';
import { autoDetectSite } from './scrapers/generic';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DEFAULT_HEADERS: HeadersInit = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'es-CL,es;q=0.9',
};

/**
 * Acepta cualquier formato razonable y devuelve una URL absoluta válida.
 * Ejemplos:
 *  - "alvi.cl" → "https://www.alvi.cl"
 *  - "www.alvi.cl/" → "https://www.alvi.cl"
 *  - "https://alvi.cl/search?q=foo" → "https://www.alvi.cl"
 */
export function normalizeUrl(raw: string): { baseUrl: string; origin: string; hostname: string } {
  let s = raw.trim();
  if (!s) throw new Error('URL vacía');
  // Quitar fragment y query (queremos base)
  s = s.replace(/^https?:\/\//, '');
  s = s.replace(/^\/\//, '');
  // Tomar solo el host
  s = s.split('/')[0];
  // Agregar www si no tiene (la mayoría de Chilean retail lo requiere)
  if (!/^www\./i.test(s) && s.split('.').length === 2) {
    s = 'www.' + s;
  }
  const origin = `https://${s}`;
  return { baseUrl: origin, origin, hostname: s };
}

/**
 * Plantillas comunes de URL de búsqueda en sitios chilenos.
 * El orden importa: prueba primero las más probables.
 */
const SEARCH_PATTERNS = [
  '/search?q={q}',
  '/search?s={q}',
  '/?s={q}', // WordPress
  '/?ft={q}', // VTEX raíz
  '/buscapagina?ft={q}', // VTEX (Jumbo, Alvi viejos, etc.)
  '/buscar?q={q}',
  '/buscar?s={q}',
  '/busqueda?q={q}',
  '/catalogsearch/result/?q={q}', // Magento
  '/search?Ntt={q}', // Endeca / Falabella
  '/products?q={q}', // Shopify
  '/collections/all?q={q}', // Shopify alt
];

interface DiscoveryResult {
  ok: boolean;
  name: string;
  baseUrl: string;
  searchUrlTemplate: string;
  strategy: SiteConfig['strategy'];
  needsChromium: boolean;
  sampleProducts: Product[];
  error: string | null;
  triedPatterns: { pattern: string; status: number; hasPechuga: boolean; productCount: number }[];
}

/**
 * Descubre todo lo necesario para scrapear un sitio a partir solo de una URL.
 * Intenta múltiples patrones de búsqueda comunes hasta encontrar uno que
 * devuelva productos relevantes.
 */
export async function discoverSite(rawUrl: string, query = 'pechuga pollo'): Promise<DiscoveryResult> {
  const { baseUrl, hostname } = normalizeUrl(rawUrl);

  // 1) Sacar nombre del sitio
  let name = hostname.replace(/^www\./, '').split('.')[0];
  try {
    const res = await fetch(baseUrl, { headers: DEFAULT_HEADERS, signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const html = await res.text();
      const og =
        html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i)?.[1];
      const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
      const candidate = og || title || name;
      // Limpiar nombres como "Inicio | Tienda X" → "Tienda X"
      name = candidate
        .replace(/^(inicio|home|bienvenidos?)\s*[\|\-–»]\s*/i, '')
        .replace(/\s*[\|\-–»]\s*(inicio|home|tienda online|supermercado).*$/i, '')
        .trim()
        .slice(0, 50);
      if (!name) name = hostname.replace(/^www\./, '').split('.')[0];
    }
  } catch {}

  // 2) Probar patrones de búsqueda en paralelo (timeout corto por patrón)
  const tries = await Promise.all(
    SEARCH_PATTERNS.map(async (pattern) => {
      const tmpl = `${baseUrl}${pattern}`;
      const url = tmpl.replace('{q}', encodeURIComponent(query));
      try {
        const res = await fetch(url, {
          headers: DEFAULT_HEADERS,
          signal: AbortSignal.timeout(7000),
          redirect: 'follow',
        });
        const html = res.ok ? await res.text() : '';
        const pechugaMatches = (html.match(/pechuga/gi) || []).length;
        const hasPrice = /\$\s?\d{2,}/.test(html);
        return {
          pattern,
          tmpl,
          status: res.status,
          hasPechuga: pechugaMatches > 0,
          score: pechugaMatches * (hasPrice ? 3 : 1),
          html: pechugaMatches > 0 ? html : '',
        };
      } catch (e) {
        return { pattern, tmpl, status: 0, hasPechuga: false, score: 0, html: '' };
      }
    })
  );

  // Ordenar por score y probar el mejor con autoDetectSite
  const ranked = tries.filter((t) => t.score > 0).sort((a, b) => b.score - a.score);
  const summary = tries.map((t) => ({
    pattern: t.pattern,
    status: t.status,
    hasPechuga: t.hasPechuga,
    productCount: 0,
  }));

  if (ranked.length === 0) {
    return {
      ok: false,
      name,
      baseUrl,
      searchUrlTemplate: `${baseUrl}/search?q={q}`,
      strategy: 'unknown',
      needsChromium: false,
      sampleProducts: [],
      error: 'No se encontró ningún patrón de búsqueda que devuelva productos con "pechuga". Puede que el sitio use SPA pura o esté tras Cloudflare.',
      triedPatterns: summary,
    };
  }

  // Intentar parsear con cada patrón rankeado hasta que uno devuelva productos válidos
  for (const winner of ranked.slice(0, 3)) {
    const detection = await autoDetectSite(baseUrl, winner.tmpl, query);
    const idx = summary.findIndex((s) => s.pattern === winner.pattern);
    if (idx >= 0) summary[idx].productCount = detection.sampleProducts.length;
    if (detection.sampleProducts.length > 0 || detection.strategy !== 'unknown') {
      return {
        ok: detection.sampleProducts.length > 0,
        name,
        baseUrl,
        searchUrlTemplate: winner.tmpl,
        strategy: detection.strategy,
        needsChromium: detection.needsChromium,
        sampleProducts: detection.sampleProducts,
        error:
          detection.sampleProducts.length === 0
            ? `Patrón encontrado pero no se pudieron extraer productos (estrategia: ${detection.strategy}). ${detection.needsChromium ? 'Probable Cloudflare / SPA.' : ''}`
            : null,
        triedPatterns: summary,
      };
    }
  }

  return {
    ok: false,
    name,
    baseUrl,
    searchUrlTemplate: ranked[0].tmpl,
    strategy: 'unknown',
    needsChromium: true,
    sampleProducts: [],
    error: 'Se encontraron patrones con resultados pero no se pudieron parsear (probable SPA). Necesita Chromium.',
    triedPatterns: summary,
  };
}
