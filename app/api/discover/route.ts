import { NextRequest, NextResponse } from 'next/server';
import { discoverSite } from '@/lib/discover';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('x-refresh-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const body = (await req.json()) as { url: string; query?: string };
    if (!body.url) return NextResponse.json({ error: 'url requerida' }, { status: 400 });
    const result = await discoverSite(body.url, body.query || 'pechuga pollo');
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
