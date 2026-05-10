import { NextRequest, NextResponse } from 'next/server';
import { readRegistry, addSite, removeSite, toggleSite } from '@/lib/sites-config';
import type { SiteConfig } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function checkAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // dev sin secret
  return req.headers.get('x-refresh-secret') === secret;
}

export async function GET() {
  const reg = await readRegistry();
  return NextResponse.json(reg);
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const body = (await req.json()) as SiteConfig;
    if (!body.id || !body.name || !body.searchUrlTemplate) {
      return NextResponse.json({ error: 'id, name y searchUrlTemplate requeridos' }, { status: 400 });
    }
    await addSite(body);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await removeSite(id);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json()) as { id: string; enabled: boolean };
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await toggleSite(body.id, body.enabled);
  return NextResponse.json({ ok: true });
}
