import { NextRequest, NextResponse } from 'next/server';
import { autoDetectSite } from '@/lib/scrapers/generic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('x-refresh-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const body = (await req.json()) as {
      baseUrl: string;
      searchUrlTemplate: string;
      query?: string;
    };
    if (!body.baseUrl || !body.searchUrlTemplate) {
      return NextResponse.json({ error: 'baseUrl y searchUrlTemplate requeridos' }, { status: 400 });
    }
    const result = await autoDetectSite(
      body.baseUrl,
      body.searchUrlTemplate,
      body.query || 'pechuga pollo'
    );
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
