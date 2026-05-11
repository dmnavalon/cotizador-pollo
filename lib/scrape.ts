import type { DataSnapshot, Product } from './types';
import { scrapeSite } from './scrapers/generic';
import { scrapeAlvi } from './scrapers/alvi';
import { readRegistry } from './sites-config';

function stockRank(s: boolean | null | undefined): number {
  // 0 = en stock (prioridad), 1 = desconocido, 2 = sin stock
  if (s === true) return 0;
  if (s === false) return 2;
  return 1;
}

export function sortByStockThenPrice(products: Product[]): Product[] {
  return [...products].sort((a, b) => {
    const sa = stockRank(a.inStock);
    const sb = stockRank(b.inStock);
    if (sa !== sb) return sa - sb;
    return a.bestPricePerKg - b.bestPricePerKg;
  });
}

export async function runScrape(): Promise<DataSnapshot> {
  const reg = await readRegistry();
  const active = reg.sites.filter((s) => s.enabled);
  const scrapes = await Promise.all(
    active.map((site) => {
      if (site.id === 'alvi') return scrapeAlvi();
      return scrapeSite(site);
    })
  );

  const allProducts: Product[] = [];
  for (const s of scrapes) allProducts.push(...s.products);
  const sorted = sortByStockThenPrice(allProducts);

  return {
    updatedAt: new Date().toISOString(),
    scrapes,
    allProducts: sorted,
    best: sorted[0] || null,
    totalProducts: sorted.length,
  };
}
