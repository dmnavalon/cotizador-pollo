import type { ScrapeResult } from '../types';

/**
 * Lider (Walmart Chile). Protegido por Cloudflare y SPA pura. Las APIs
 * documentadas devuelven "no healthy upstream". Requiere Chromium para
 * scrapear de manera confiable.
 */
export async function scrapeLider(): Promise<ScrapeResult> {
  return {
    store: 'Lider',
    products: [],
    error: 'Requiere Chromium (Cloudflare + SPA).',
    durationMs: 0,
  };
}
