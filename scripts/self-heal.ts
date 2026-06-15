/**
 * Self-healing: detecta tiendas que cayeron a 0 productos cuando antes daban
 * resultados y abre un issue automático en GitHub con diagnóstico para iterar.
 *
 * Corre después de scrape-full.ts en el mismo workflow. Si encuentra
 * regresiones, abre/actualiza un issue por tienda con label "scraper-broken".
 */
import fs from 'fs';
import path from 'path';
import { Octokit } from '@octokit/rest';
import type { DataSnapshot } from '../lib/types';

const DATA_FILE = path.join(process.cwd(), 'data', 'products.json');
const HISTORY_FILE = path.join(process.cwd(), 'data', 'history.json');

interface StoreHealth {
  store: string;
  lastSuccessAt: string | null;
  lastSuccessCount: number;
  consecutiveZeros: number;
  lastError: string | null;
}

interface History {
  health: Record<string, StoreHealth>;
}

function readHistory(): History {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch {
    return { health: {} };
  }
}

function writeHistory(h: History) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(h, null, 2));
}

async function ensureIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  store: string,
  health: StoreHealth
) {
  const title = `[Scraper roto] ${store} sin productos hace ${health.consecutiveZeros} corridas`;

  // Buscar issue abierto con mismo título
  const issues = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    state: 'open',
    labels: 'scraper-broken',
    per_page: 100,
  });
  const existing = issues.data.find((i) => i.title.startsWith(`[Scraper roto] ${store}`));

  const body = `
**Sitio:** ${store}
**Último scrape exitoso:** ${health.lastSuccessAt || 'nunca'}
**Productos en último éxito:** ${health.lastSuccessCount}
**Corridas seguidas en 0:** ${health.consecutiveZeros}
**Último error reportado:** \`${health.lastError || 'sin error'}\`

### Diagnóstico sugerido al agente

1. Revisar si el sitio cambió su layout/estructura. Visitar la URL de búsqueda manualmente.
2. Probar correr el scraper aislado con \`npm run scrape:store -- ${store.toLowerCase()}\` localmente.
3. Si el sitio cambió, ajustar selectores en \`lib/scrapers/playwright/${store.toLowerCase()}.ts\` o el scraper dedicado correspondiente.
4. Validar con \`npm run scrape:full\` que devuelva productos. Pushear el fix.

### Tareas para Claude Code

- Si este issue lleva más de 3 corridas seguidas en 0, asignar prioridad alta.
- Verificar si la causa es Cloudflare, anti-bot, o un cambio de DOM.
- Si Cloudflare bloqueó al runner, agregar un \`waitForTimeout\` más largo o cambiar la estrategia.

_Generado automáticamente por scripts/self-heal.ts el ${new Date().toISOString()}._
`.trim();

  if (existing) {
    // Actualizar el issue existente con el último estado
    await octokit.rest.issues.update({
      owner,
      repo,
      issue_number: existing.number,
      title,
      body,
    });
    console.log(`  ✓ Issue #${existing.number} actualizado: ${store}`);
  } else {
    const created = await octokit.rest.issues.create({
      owner,
      repo,
      title,
      body,
      labels: ['scraper-broken', 'automated'],
    });
    console.log(`  ✓ Issue #${created.data.number} creado: ${store}`);
  }
}

async function closeFixedIssues(octokit: Octokit, owner: string, repo: string, healthyStores: string[]) {
  const issues = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    state: 'open',
    labels: 'scraper-broken',
    per_page: 100,
  });
  for (const i of issues.data) {
    const storeMatch = i.title.match(/\[Scraper roto\] (.+?) sin/);
    if (!storeMatch) continue;
    const store = storeMatch[1];
    if (healthyStores.includes(store)) {
      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: i.number,
        state: 'closed',
      });
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: i.number,
        body: `✅ Auto-cerrado: ${store} volvió a entregar productos.`,
      });
      console.log(`  ✓ Issue #${i.number} cerrado: ${store} recuperado`);
    }
  }
}

async function main() {
  const snapshot: DataSnapshot = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const history = readHistory();

  const owner = process.env.GITHUB_REPOSITORY_OWNER || 'dmnavalon';
  const repoName = (process.env.GITHUB_REPOSITORY || '').split('/')[1] || 'cotizador-pollo';
  const token = process.env.GITHUB_TOKEN;

  const broken: { store: string; health: StoreHealth }[] = [];
  const healthy: string[] = [];

  for (const s of snapshot.scrapes) {
    const prev = history.health[s.store] || {
      store: s.store,
      lastSuccessAt: null,
      lastSuccessCount: 0,
      consecutiveZeros: 0,
      lastError: null,
    };

    if (s.products.length > 0) {
      prev.lastSuccessAt = snapshot.updatedAt;
      prev.lastSuccessCount = s.products.length;
      prev.consecutiveZeros = 0;
      prev.lastError = null;
      healthy.push(s.store);
    } else {
      prev.consecutiveZeros++;
      prev.lastError = s.error;
      // Solo abrir issue si antes hubo éxito y lleva 2+ corridas en 0
      if (prev.lastSuccessAt && prev.consecutiveZeros >= 2) {
        broken.push({ store: s.store, health: prev });
      }
    }

    history.health[s.store] = prev;
  }

  writeHistory(history);
  console.log(`▶ Sanos: ${healthy.length} · Rotos (con historial): ${broken.length}`);

  if (!token) {
    console.log('Sin GITHUB_TOKEN, no se gestionan issues.');
    return;
  }

  const octokit = new Octokit({ auth: token });

  for (const b of broken) {
    try {
      await ensureIssue(octokit, owner, repoName, b.store, b.health);
    } catch (e) {
      console.log(`  ✗ ${b.store}: ${(e as Error).message}`);
    }
  }

  try {
    await closeFixedIssues(octokit, owner, repoName, healthy);
  } catch (e) {
    console.log(`Error cerrando issues: ${(e as Error).message}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(0); // No queremos romper el workflow si self-heal falla
});
