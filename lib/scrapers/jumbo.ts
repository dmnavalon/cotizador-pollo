import type { ScrapeResult, Product, PriceTier } from '../types';

/**
 * Jumbo (VTEX). Su HTML es SSR pero los productos se hidratan client-side y
 * Cloudflare bloquea las APIs de catálogo directas. Para scrapear Jumbo se
 * necesita Chromium (puppeteer / playwright), que no cabe en el límite de 10s
 * de Vercel Hobby. Cuando estés en Vercel Pro, reemplazar este scraper por
 * uno basado en `@sparticuz/chromium` + `puppeteer-core`.
 */
export async function scrapeJumbo(): Promise<ScrapeResult> {
  return {
    store: 'Jumbo',
    products: [],
    error: 'Requiere Chromium (Cloudflare + SPA). Pendiente de upgrade a Vercel Pro.',
    durationMs: 0,
  };
}
