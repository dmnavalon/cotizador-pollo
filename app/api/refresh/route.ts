import { NextRequest, NextResponse } from 'next/server';
import { runScrape } from '@/lib/scrape';
import { commitSnapshot } from '@/lib/github';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    const xSecret = req.headers.get('x-refresh-secret') || '';
    const ok = auth === `Bearer ${secret}` || xSecret === secret;
    if (!ok) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

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
