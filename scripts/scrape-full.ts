/**
 * Scrape COMPLETO que corre en GitHub Actions.
 * Cada tienda tiene su scraper dedicado en lib/scrapers/. El fallback genérico
 * Playwright cubre las que aún no tienen módulo propio.
 */
import fs from 'fs';
import path from 'path';
import { scrapeAlvi } from '../lib/scrapers/alvi';
import { scrapeJumbo } from '../lib/scrapers/jumbo';
import { scrapePollosRo } from '../lib/scrapers/pollos-ro';
import { scrapeLider } from '../lib/scrapers/playwright/lider';
import { scrapeTottus } from '../lib/scrapers/playwright/tottus';
import { scrapeAgrosuper } from '../lib/scrapers/playwright/agrosuper';
import { scrapeSite as scrapeSiteFetch } from '../lib/scrapers/generic';
import { scrapeSiteWithPlaywright } from '../lib/scrapers/playwright-engine';
import { sortByStockThenPrice } from '../lib/scrape';
import type { DataSnapshot, Product, SitesRegistry, ScrapeResult } from '../lib/types';

const SITES_FILE = path.join(process.cwd(), 'data', 'sites.json');
const DATA_FILE = path.join(process.cwd(), 'data', 'products.json');

// Registro de scrapers dedicados por id de sitio
type ScraperFn = (verbose?: boolean) => Promise<ScrapeResult>;
const DEDICATED: Record<string, ScraperFn | undefined> = {
  alvi: scrapeAlvi,
  jumbo: scrapeJumbo,
  'pollosro-cl': scrapePollosRo,
  lider: scrapeLider,
  tottus: scrapeTottus,
  'agrosuperventas-com': scrapeAgrosuper,
};

async function main() {
  const reg: SitesRegistry = JSON.parse(fs.readFileSync(SITES_FILE, 'utf8'));
  const active = reg.sites.filter((s) => s.enabled);
  console.log(`▶ Scrapeando ${active.length} sitios activos…\n`);

  const scrapes: ScrapeResult[] = [];

  for (const site of active) {
    const dedicated: ((verbose?: boolean) => Promise<ScrapeResult>) | undefined = DEDICATED[site.id];
    const tag = dedicated ? 'dedicado' : site.needsChromium ? 'playwright-genérico' : 'fetch-genérico';
    console.log(`  → ${site.name} (${tag})`);

    let res: ScrapeResult;
    try {
      if (typeof dedicated === 'function') {
        res = await dedicated(true);
      } else if (site.needsChromium) {
        res = await scrapeSiteWithPlaywright(site);
      } else {
        res = await scrapeSiteFetch(site);
        if (res.products.length === 0) {
          console.log(`    fetch sin resultados, fallback a Playwright…`);
          res = await scrapeSiteWithPlaywright(site);
        }
      }
    } catch (e) {
      res = { store: site.name, products: [], error: (e as Error).message, durationMs: 0 };
    }

    const inStockCount = res.products.filter((p) => p.inStock === true).length;
    const unknownCount = res.products.filter((p) => p.inStock == null).length;
    console.log(
      `    ✓ ${res.products.length} productos (${inStockCount} con stock, ${unknownCount} desconocido)${res.error ? ` [${res.error}]` : ''}\n`
    );
    scrapes.push(res);
  }

  const allProducts: Product[] = [];
  for (const s of scrapes) allProducts.push(...s.products);
  const sorted = sortByStockThenPrice(allProducts);

  const snapshot: DataSnapshot = {
    updatedAt: new Date().toISOString(),
    scrapes,
    allProducts: sorted,
    best: sorted[0] || null,
    totalProducts: sorted.length,
  };

  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(snapshot, null, 2));
  console.log(`\n═══════════════════════════════════════`);
  console.log(`✓ ${sorted.length} productos guardados`);
  if (snapshot.best) {
    const stockTag =
      snapshot.best.inStock === true ? '✅ con stock' : snapshot.best.inStock === false ? '⛔ sin stock' : '❓ stock desconocido';
    console.log(`  Mejor: ${snapshot.best.name}`);
    console.log(`         ${snapshot.best.store} a $${snapshot.best.bestPricePerKg.toLocaleString('es-CL')}/kg ${stockTag}`);
  }
  console.log(`═══════════════════════════════════════`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
