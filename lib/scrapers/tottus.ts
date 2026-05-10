import type { ScrapeResult } from '../types';

/**
 * Tottus (Falabella). Cloudflare challenge + SPA. Necesita Chromium para
 * pasar el challenge antes de leer __NEXT_DATA__.
 */
export async function scrapeTottus(): Promise<ScrapeResult> {
  return {
    store: 'Tottus',
    products: [],
    error: 'Requiere Chromium (Cloudflare challenge).',
    durationMs: 0,
  };
}
