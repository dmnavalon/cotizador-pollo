'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { SitesRegistry, SiteConfig, Product } from '@/lib/types';

interface DiscoveryResult {
  ok: boolean;
  name: string;
  baseUrl: string;
  searchUrlTemplate: string;
  strategy: string;
  needsChromium: boolean;
  sampleProducts: Product[];
  error: string | null;
  triedPatterns: { pattern: string; status: number; hasPechuga: boolean; productCount: number }[];
}

export default function SitesManager({ initial }: { initial: SitesRegistry }) {
  const [sites, setSites] = useState(initial.sites);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);

  function authHeaders(): HeadersInit {
    const secret = typeof window !== 'undefined' ? localStorage.getItem('refreshSecret') || '' : '';
    return secret
      ? { 'x-refresh-secret': secret, 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json' };
  }

  async function withAuth<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const m = (e as Error).message;
      if (m.includes('401') || m.includes('unauthorized')) {
        const s = window.prompt('Pega el CRON_SECRET:');
        if (s) {
          localStorage.setItem('refreshSecret', s);
          return await fn();
        }
      }
      throw e;
    }
  }

  async function discover() {
    if (!url.trim()) {
      setMsg('Pega una URL primero.');
      return;
    }
    setBusy(true);
    setMsg('🔍 Analizando el sitio…');
    setDiscovery(null);
    try {
      const data = await withAuth(async () => {
        const res = await fetch('/api/discover', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ url: url.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data as DiscoveryResult;
      });
      setDiscovery(data);
      if (data.ok) {
        setMsg(`✓ Sitio detectado: "${data.name}" · ${data.sampleProducts.length} productos vía ${data.strategy}.`);
      } else if (data.needsChromium) {
        setMsg(`⚠ "${data.name}" requiere Chromium (Cloudflare o SPA). No se podrá scrapear en Vercel Hobby.`);
      } else {
        setMsg(`⚠ ${data.error || 'No se pudo detectar productos.'}`);
      }
    } catch (e) {
      setMsg('✗ ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addDetected() {
    if (!discovery) return;
    const id = new URL(discovery.baseUrl).hostname.replace(/^www\./, '').replace(/\./g, '-');
    const newSite: SiteConfig = {
      id,
      name: discovery.name,
      baseUrl: discovery.baseUrl,
      searchUrlTemplate: discovery.searchUrlTemplate,
      queries: ['pechuga pollo', 'pechuga deshuesada'],
      strategy: discovery.strategy as any,
      needsChromium: discovery.needsChromium,
      enabled: !discovery.needsChromium && discovery.ok,
      notes: `Auto-detectado: ${discovery.strategy}, ${discovery.sampleProducts.length} productos preview`,
    };
    setBusy(true);
    try {
      await withAuth(async () => {
        const res = await fetch('/api/sites', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(newSite),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      });
      setSites([...sites.filter((s) => s.id !== newSite.id), newSite]);
      setUrl('');
      setDiscovery(null);
      setMsg(`✓ "${newSite.name}" agregado. El próximo cron lo incluye.`);
    } catch (e) {
      setMsg('✗ ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSite(id: string) {
    if (!confirm(`¿Eliminar "${id}"?`)) return;
    setBusy(true);
    try {
      await withAuth(async () => {
        const res = await fetch(`/api/sites?id=${id}`, { method: 'DELETE', headers: authHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      });
      setSites(sites.filter((s) => s.id !== id));
      setMsg(`✓ Eliminado.`);
    } catch (e) {
      setMsg('✗ ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleSite(id: string, enabled: boolean) {
    setBusy(true);
    try {
      await withAuth(async () => {
        const res = await fetch('/api/sites', {
          method: 'PATCH',
          headers: authHeaders(),
          body: JSON.stringify({ id, enabled }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      });
      setSites(sites.map((s) => (s.id === id ? { ...s, enabled } : s)));
    } catch (e) {
      setMsg('✗ ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wrap">
      <Link href="/" className="back">← Volver al cotizador</Link>
      <h1>Gestión de sitios</h1>
      <p className="sub">Pega cualquier URL y el bot detecta nombre, búsqueda y patrón solo.</p>

      <div className="adder">
        <div className="adder-input">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !busy && discover()}
            placeholder="alvi.cl  ·  https://www.donpollo.cl  ·  cugat.cl/..."
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <button onClick={discover} disabled={busy || !url.trim()} className="btn primary">
            {busy ? '⏳' : '🔍 Detectar'}
          </button>
        </div>
        {msg && (
          <div className={`msg ${msg.startsWith('✗') ? 'err' : msg.startsWith('⚠') ? 'warn' : 'ok'}`}>
            {msg}
          </div>
        )}

        {discovery && (
          <div className="discovery">
            <div className="d-row">
              <span className="d-lab">Nombre</span>
              <span className="d-val"><b>{discovery.name}</b></span>
            </div>
            <div className="d-row">
              <span className="d-lab">URL base</span>
              <span className="d-val mono">{discovery.baseUrl}</span>
            </div>
            <div className="d-row">
              <span className="d-lab">Búsqueda</span>
              <span className="d-val mono">{discovery.searchUrlTemplate.replace(discovery.baseUrl, '')}</span>
            </div>
            <div className="d-row">
              <span className="d-lab">Estrategia</span>
              <span className="d-val">
                <span className={`pill ${discovery.ok ? 'ok' : 'warn'}`}>{discovery.strategy}</span>
                {discovery.needsChromium && <span className="pill warn">needsChromium</span>}
              </span>
            </div>

            {discovery.sampleProducts.length > 0 && (
              <div className="preview">
                <div className="preview-title">Productos encontrados ({discovery.sampleProducts.length})</div>
                {discovery.sampleProducts.map((p, i) => (
                  <div key={i} className="preview-prod">
                    <div className="pn">{p.name}</div>
                    <div className="pp">
                      {p.brand} · {p.format} · <b>${p.bestPricePerKg.toLocaleString('es-CL')}/kg</b>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <details className="tries">
              <summary>Ver patrones probados ({discovery.triedPatterns.length})</summary>
              <div className="tries-list">
                {discovery.triedPatterns.map((t, i) => (
                  <div key={i} className={`try ${t.hasPechuga ? 'good' : 'meh'}`}>
                    <span className="mono">{t.pattern}</span>
                    <span className="muted">
                      {t.status || 'fail'}{t.hasPechuga ? ' · 🎯' : ''}{t.productCount ? ` · ${t.productCount} productos` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </details>

            <button onClick={addDetected} disabled={busy} className="btn primary big">
              + Agregar "{discovery.name}"
            </button>
          </div>
        )}
      </div>

      <h2>Sitios actuales ({sites.length})</h2>
      <div className="sites">
        {sites.map((s) => (
          <div key={s.id} className={`site ${s.enabled ? '' : 'disabled'}`}>
            <div className="site-head">
              <div>
                <div className="site-name">{s.name}</div>
                <div className="site-id">
                  {s.id} · <span className="pill small">{s.strategy}</span>
                </div>
              </div>
              <div className="site-actions">
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={(e) => toggleSite(s.id, e.target.checked)}
                    disabled={busy || s.needsChromium}
                  />
                  <span className="slider" />
                </label>
                <button onClick={() => deleteSite(s.id)} disabled={busy} className="btn-del">
                  ✕
                </button>
              </div>
            </div>
            <a href={s.searchUrlTemplate.replace('{q}', 'pechuga')} target="_blank" rel="noopener" className="site-url">
              {s.baseUrl}
            </a>
            {s.needsChromium && (
              <div className="warn-pill">⚠ Requiere Chromium (Vercel Pro)</div>
            )}
            {s.notes && <div className="site-notes">{s.notes}</div>}
          </div>
        ))}
      </div>

      <style>{styles}</style>
    </main>
  );
}

const styles = `
.wrap { max-width: 760px; margin: 0 auto; padding: 16px 14px calc(28px + env(safe-area-inset-bottom)); }
.back { font-size: 13px; color: var(--accent); display: inline-block; margin-bottom: 8px; }
h1 { font-size: 22px; margin: 8px 0 4px; letter-spacing: -0.02em; }
.sub { color: var(--muted); margin: 0 0 18px; font-size: 14px; }
h2 { font-size: 12px; margin: 24px 0 10px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }

.adder { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 14px; box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 12px; }
.adder-input { display: flex; gap: 8px; }
.adder-input input { flex: 1; padding: 12px 14px; font-size: 15px; }
.btn { padding: 12px 16px; border-radius: 8px; border: none; font-weight: 600; font-size: 14px; cursor: pointer; white-space: nowrap; }
.btn.primary { background: var(--good); color: #fff; }
.btn.primary:hover:not(:disabled) { background: #047857; }
.btn.primary.big { width: 100%; padding: 14px; font-size: 15px; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

.msg { font-size: 13px; padding: 10px 12px; border-radius: 6px; }
.msg.ok { background: var(--good-bg); color: var(--good); }
.msg.warn { background: var(--warn-bg); color: var(--warn); }
.msg.err { background: #fef2f2; color: var(--bad); }

.discovery { background: var(--card-hi); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.d-row { display: grid; grid-template-columns: 90px 1fr; gap: 8px; align-items: center; font-size: 13px; }
.d-lab { color: var(--muted); font-weight: 500; }
.d-val { word-break: break-all; }
.d-val .pill { margin-right: 4px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.pill { display: inline-block; background: var(--border); color: var(--text); padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.pill.ok { background: var(--good-bg); color: var(--good); }
.pill.warn { background: var(--warn-bg); color: var(--warn); }
.pill.small { font-size: 10px; padding: 1px 6px; }

.preview { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-top: 4px; }
.preview-title { font-size: 11px; color: var(--muted); font-weight: 600; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.04em; }
.preview-prod { padding: 6px 0; border-bottom: 1px solid var(--border); }
.preview-prod:last-child { border-bottom: none; }
.pn { font-size: 13px; font-weight: 600; }
.pp { font-size: 11px; color: var(--muted); margin-top: 2px; }

.tries summary { cursor: pointer; font-size: 12px; color: var(--muted); padding: 6px 0; }
.tries-list { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; background: var(--card); border-radius: 6px; }
.try { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; padding: 4px 0; }
.try.good { color: var(--good); font-weight: 600; }
.try.meh { color: var(--muted); }
.muted { color: var(--muted); }

.sites { display: flex; flex-direction: column; gap: 8px; }
.site { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 12px; box-shadow: var(--shadow); }
.site.disabled { opacity: 0.6; }
.site-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 6px; }
.site-name { font-weight: 600; font-size: 15px; }
.site-id { color: var(--muted); font-size: 11px; margin-top: 2px; }
.site-url { color: var(--accent); font-size: 12px; word-break: break-all; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; display: block; margin: 4px 0; }
.site-notes { color: var(--muted); font-size: 12px; margin-top: 6px; }
.warn-pill { display: inline-block; background: var(--warn-bg); color: var(--warn); padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-top: 6px; }
.site-actions { display: flex; align-items: center; gap: 8px; }
.btn-del { background: transparent; border: 1px solid var(--border); width: 32px; height: 32px; border-radius: 8px; cursor: pointer; color: var(--bad); }
.btn-del:hover { background: #fef2f2; }
.switch { position: relative; display: inline-block; width: 44px; height: 24px; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider { position: absolute; cursor: pointer; inset: 0; background: var(--border); border-radius: 24px; transition: 0.2s; }
.slider::before { content: ''; position: absolute; height: 18px; width: 18px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: 0.2s; }
.switch input:checked + .slider { background: var(--good); }
.switch input:checked + .slider::before { transform: translateX(20px); }
.switch input:disabled + .slider { opacity: 0.4; cursor: not-allowed; }

@media (min-width: 640px) {
  .wrap { padding: 28px 22px; }
  h1 { font-size: 28px; }
}
`;
