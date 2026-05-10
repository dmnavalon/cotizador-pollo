import type { DataSnapshot, Product } from './types';
import { scrapeSite } from './scrapers/generic';
import { scrapeAlvi } from './scrapers/alvi';
import { readRegistry } from './sites-config';

export async function runScrape(): Promise<DataSnapshot> {
  const reg = await readRegistry();
  const active = reg.sites.filter((s) => s.enabled);

  // Caso especial: Alvi usa scraper dedicado (tipado mejor que el genérico).
  const scrapes = await Promise.all(
    active.map((site) => {
      if (site.id === 'alvi') return scrapeAlvi();
      return scrapeSite(site);
    })
  );

  const allProducts: Product[] = [];
  for (const s of scrapes) allProducts.push(...s.products);
  allProducts.sort((a, b) => a.bestPricePerKg - b.bestPricePerKg);

  return {
    updatedAt: new Date().toISOString(),
    scrapes,
    allProducts,
    best: allProducts[0] || null,
    totalProducts: allProducts.length,
  };
}
