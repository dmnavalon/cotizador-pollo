import { NextRequest, NextResponse } from 'next/server';
import { runScrape } from '@/lib/scrape';
import { commitSnapshot } from '@/lib/github';
import { Octokit } from '@octokit/rest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * El botón "Actualizar ahora" y el cron viejo de Vercel llegan acá.
 *
 * Estrategia: disparar el workflow de GitHub Actions "Scrape semanal", que
 * tiene Chromium completo y scrapea TODOS los sitios (incluso Cloudflare).
 *
 * Como fallback, si no hay GITHUB_TOKEN, corre un scrape "rápido" en la propia
 * función Vercel (solo Alvi y sitios fetch-only).
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    const xSecret = req.headers.get('x-refresh-secret') || '';
    if (auth !== `Bearer ${secret}` && xSecret !== secret) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';

  // Camino preferido: disparar el workflow en GitHub Actions
  if (token && owner && repo) {
    try {
      const octokit = new Octokit({ auth: token });
      await octokit.rest.actions.createWorkflowDispatch({
        owner,
        repo,
        workflow_id: 'scrape.yml',
        ref: branch,
        inputs: { reason: 'Botón Actualizar ahora desde la web' },
      });
      return NextResponse.json({
        ok: true,
        mode: 'github-actions',
        message:
          'Scrape disparado en GitHub Actions. Tarda 1–3 minutos en correr; la página se actualiza sola cuando termina (Vercel redeploya al detectar el commit del bot).',
        viewLogs: `https://github.com/${owner}/${repo}/actions/workflows/scrape.yml`,
      });
    } catch (e) {
      console.error('[refresh] workflow_dispatch failed, falling back to fast scrape', e);
      // continúa al fallback
    }
  }

  // Fallback: scrape rápido en Vercel (solo sitios fetch-only)
  try {
    const snapshot = await runScrape();
    let commit: { commitSha: string; url: string } | null = null;
    try {
      commit = await commitSnapshot(snapshot);
    } catch (e) {
      console.error('[refresh] commit failed', e);
    }
    return NextResponse.json({
      ok: true,
      mode: 'vercel-fast',
      updatedAt: snapshot.updatedAt,
      totalProducts: snapshot.totalProducts,
      best: snapshot.best
        ? {
            name: snapshot.best.name,
            store: snapshot.best.store,
            pricePerKg: snapshot.best.bestPricePerKg,
          }
        : null,
      stores: snapshot.scrapes.map((s) => ({
        store: s.store,
        count: s.products.length,
        error: s.error,
      })),
      committed: commit?.commitSha?.slice(0, 7) || null,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
