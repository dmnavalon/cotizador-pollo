/**
 * Scrape COMPLETO que corre en GitHub Actions con Playwright disponible.
 *
 * Lee data/sites.json y para cada sitio activo:
 *  - Si tiene scraper dedicado (Alvi) lo usa
 *  - Si es "fetch-only" (strategy=next_data y sin needsChromium) usa el scraper genérico fetch
 *  - Si requiere Chromium, usa Playwright
 *
 * Escribe data/products.json con el snapshot.
 */
import fs from 'fs';
import path from 'path';
import { scrapeAlvi } from '../lib/scrapers/alvi';
import { scrapeSite as scrapeSiteFetch } from '../lib/scrapers/generic';
import { scrapeSiteWithPlaywright } from '../lib/scrapers/playwright-engine';
import type { DataSnapshot, Product, SitesRegistry, ScrapeResult } from '../lib/types';

const SITES_FILE = path.join(process.cwd(), 'data', 'sites.json');
const DATA_FILE = path.join(process.cwd(), 'data', 'products.json');

async function main() {
  const reg: SitesRegistry = JSON.parse(fs.readFileSync(SITES_FILE, 'utf8'));
  const active = reg.sites.filter((s) => s.enabled);
  console.log(`▶ Scrapeando ${active.length} sitios activos…`);

  const scrapes: ScrapeResult[] = [];

  for (const site of active) {
    console.log(`  → ${site.name} (${site.needsChromium ? 'playwright' : 'fetch'})…`);
    let res: ScrapeResult;
    try {
      if (site.id === 'alvi') {
        res = await scrapeAlvi();
      } else if (site.needsChromium) {
        res = await scrapeSiteWithPlaywright(site);
      } else {
        res = await scrapeSiteFetch(site);
        // Si fetch no devolvió nada y el sitio quizás necesita JS, intentar Playwright
        if (res.products.length === 0 && !res.error?.includes('no se encontraron')) {
          console.log(`    fetch sin resultados, probando con Playwright…`);
          res = await scrapeSiteWithPlaywright(site);
        }
      }
    } catch (e) {
      res = { store: site.name, products: [], error: (e as Error).message, durationMs: 0 };
    }
    console.log(`    ${res.products.length} productos${res.error ? ` [err: ${res.error}]` : ''}`);
    scrapes.push(res);
  }

  const allProducts: Product[] = [];
  for (const s of scrapes) allProducts.push(...s.products);
  allProducts.sort((a, b) => a.bestPricePerKg - b.bestPricePerKg);

  const snapshot: DataSnapshot = {
    updatedAt: new Date().toISOString(),
    scrapes,
    allProducts,
    best: allProducts[0] || null,
    totalProducts: allProducts.length,
  };

  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(snapshot, null, 2));
  console.log(`\n✓ ${allProducts.length} productos guardados en ${DATA_FILE}`);
  if (snapshot.best) {
    console.log(
      `  Mejor: ${snapshot.best.name} (${snapshot.best.store}) a $${snapshot.best.bestPricePerKg.toLocaleString('es-CL')}/kg`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
