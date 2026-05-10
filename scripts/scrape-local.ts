/**
 * Corre el scrape en local y guarda en data/products.json.
 * Útil para seed inicial antes del primer deploy.
 *
 * Uso: npm run scrape
 */
import { runScrape } from '../lib/scrape';
import { writeLocalSnapshot } from '../lib/data-snapshot';

(async () => {
  console.log('Corriendo scrape local…');
  const snap = await runScrape();
  writeLocalSnapshot(snap);
  console.log(`✓ ${snap.totalProducts} productos guardados`);
  console.log(`  Mejor: ${snap.best?.name} en ${snap.best?.store} a $${snap.best?.bestPricePerKg.toLocaleString('es-CL')}/kg`);
  for (const s of snap.scrapes) {
    console.log(`  ${s.store}: ${s.products.length} productos ${s.error ? `[err: ${s.error}]` : ''}`);
  }
})();
