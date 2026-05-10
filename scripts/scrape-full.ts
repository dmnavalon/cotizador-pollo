/**
 * Scrape COMPLETO que corre en GitHub Actions con Playwright disponible.
 *
 * Estrategia por sitio:
 *  - Alvi: fetch primero (rápido). Si vuelve vacío, fallback a Playwright.
 *  - Genérico fetch-only: usa scraper fetch.
 *  - needsChromium: directo a Playwright.
 *  - Si fetch genérico vuelve vacío, también prueba Playwright.
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
  console.log(`▶ Scrapeando ${active.length} sitios activos…\n`);

  const scrapes: ScrapeResult[] = [];

  for (const site of active) {
    const tag = site.id === 'alvi'
      ? 'fetch-dedicado'
      : site.needsChromium
        ? 'playwright'
        : 'fetch-genérico+fallback';
    console.log(`  → ${site.name} (${tag})`);

    let res: ScrapeResult;
    try {
      if (site.id === 'alvi') {
        res = await scrapeAlvi(true);
        if (res.products.length === 0) {
          console.log(`    fetch sin resultados, fallback a Playwright…`);
          res = await scrapeSiteWithPlaywright(site);
        }
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
    console.log(`    ✓ ${res.products.length} productos${res.error ? ` [${res.error}]` : ''}\n`);
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
  console.log(`\n═══════════════════════════════════════`);
  console.log(`✓ ${allProducts.length} productos guardados`);
  if (snapshot.best) {
    console.log(
      `  Mejor: ${snapshot.best.name}`
    );
    console.log(`         ${snapshot.best.store} a $${snapshot.best.bestPricePerKg.toLocaleString('es-CL')}/kg`);
  }
  console.log(`═══════════════════════════════════════`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
