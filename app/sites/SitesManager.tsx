'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { SitesRegistry, SiteConfig, Product } from '@/lib/types';

interface DetectResult {
  strategy: string;
  needsChromium: boolean;
  sampleProducts: Product[];
  rawCandidates: number;
  error: string | null;
}

export default function SitesManager({ initial }: { initial: SitesRegistry }) {
  const [sites, setSites] = useState(initial.sites);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Form para nuevo sitio
  const [form, setForm] = useState({
    id: '',
    name: '',
    baseUrl: '',
    searchUrlTemplate: '',
    queries: 'pechuga pollo, pechuga deshuesada',
  });
  const [detect, setDetect] = useState<DetectResult | null>(null);

  function authHeaders(): HeadersInit {
    const secret = typeof window !== 'undefined' ? localStorage.getItem('refreshSecret') || '' : '';
    return secret ? { 'x-refresh-secret': secret, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
  }

  async function withAuth<T>(fn: () => Promise<T>): Promise<T | null> {
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

  async function testScrape() {
    if (!form.baseUrl || !form.searchUrlTemplate) {
      setMsg('Completa baseUrl y searchUrlTemplate primero.');
      return;
    }
    setBusy(true);
    setMsg('🔍 Probando scraping…');
    setDetect(null);
    try {
      const res = await fetch('/api/test-scrape', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          baseUrl: form.baseUrl,
          searchUrlTemplate: form.searchUrlTemplate,
          query: form.queries.split(',')[0]?.trim() || 'pechuga pollo',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      setDetect(data);
      if (data.sampleProducts.length > 0) {
        setMsg(`✓ Detectados ${data.sampleProducts.length} productos vía estrategia "${data.strategy}".`);
      } else if (data.needsChromium) {
        setMsg(`⚠ Sitio requiere Chromium (Cloudflare o SPA). No funcionará en Vercel Hobby.`);
      } else {
        setMsg(`⚠ No se detectaron productos. Estrategia inferida: ${data.strategy}. Puede que el sitio no exponga datos vía HTML.`);
      }
    } catch (e) {
      setMsg('✗ ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addSite() {
    if (!form.id || !form.name) {
      setMsg('id y name requeridos');
      return;
    }
    const newSite: SiteConfig = {
      id: form.id.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      name: form.name,
      baseUrl: form.baseUrl,
      searchUrlTemplate: form.searchUrlTemplate,
      queries: form.queries.split(',').map((q) => q.trim()).filter(Boolean),
      strategy: (detect?.strategy as any) || 'unknown',
      needsChromium: !!detect?.needsChromium,
      enabled: !detect?.needsChromium,
      notes: detect ? `Auto-detectado: ${detect.strategy}, ${detect.rawCandidates} candidatos` : 'Agregado manualmente',
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
      setForm({ id: '', name: '', baseUrl: '', searchUrlTemplate: '', queries: 'pechuga pollo' });
      setDetect(null);
      setMsg(`✓ Sitio "${newSite.name}" agregado. Commit en GitHub disparará redeploy.`);
    } catch (e) {
      setMsg('✗ ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSite(id: string) {
    if (!confirm(`¿Eliminar sitio "${id}"?`)) return;
    setBusy(true);
    try {
      await withAuth(async () => {
        const res = await fetch(`/api/sites?id=${id}`, { method: 'DELETE', headers: authHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      });
      setSites(sites.filter((s) => s.id !== id));
      setMsg(`✓ Sitio eliminado.`);
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
      <p className="sub">Agrega o elimina tiendas online. El bot intenta aprender el patrón de scraping automáticamente.</p>

      <h2>Agregar nuevo sitio</h2>
      <div className="form">
        <label>
          <span className="lab">ID (slug único)</span>
          <input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="ej: donpollo" />
        </label>
        <label>
          <span className="lab">Nombre legible</span>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ej: Don Pollo" />
        </label>
        <label>
          <span className="lab">URL base</span>
          <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://www.donpollo.cl" />
        </label>
        <label>
          <span className="lab">URL de búsqueda (usa {'{q}'} como placeholder)</span>
          <input value={form.searchUrlTemplate} onChange={(e) => setForm({ ...form, searchUrlTemplate: e.target.value })} placeholder="https://www.donpollo.cl/?s={q}" />
        </label>
        <label>
          <span className="lab">Términos de búsqueda (coma separados)</span>
          <input value={form.queries} onChange={(e) => setForm({ ...form, queries: e.target.value })} />
        </label>
        <div className="btns">
          <button onClick={testScrape} disabled={busy} className="btn outline">🔍 Probar scraping</button>
          <button onClick={addSite} disabled={busy || !form.id} className="btn primary">+ Agregar sitio</button>
        </div>
        {msg && <div className={`msg ${msg.startsWith('✗') ? 'err' : msg.startsWith('⚠') ? 'warn' : 'ok'}`}>{msg}</div>}

        {detect && detect.sampleProducts.length > 0 && (
          <div className="preview">
            <div className="preview-title">Productos detectados (preview):</div>
            {detect.sampleProducts.map((p, i) => (
              <div key={i} className="preview-prod">
                <div className="pn">{p.name}</div>
                <div className="pp">{p.brand} · {p.format} · <b>${p.bestPricePerKg.toLocaleString('es-CL')}/kg</b></div>
              </div>
            ))}
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
                <div className="site-id">{s.id} · estrategia: {s.strategy}</div>
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
                <button onClick={() => deleteSite(s.id)} disabled={busy} className="btn-del">✕</button>
              </div>
            </div>
            <div className="site-url">{s.searchUrlTemplate}</div>
            {s.needsChromium && <div className="warn-pill">⚠ Requiere Chromium (no soportado en Hobby)</div>}
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

.form { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 16px; box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 12px; }
.form label { display: flex; flex-direction: column; gap: 4px; }
.form .lab { font-size: 12px; color: var(--muted); font-weight: 500; }
.btns { display: flex; gap: 8px; flex-wrap: wrap; }
.btn { padding: 11px 16px; border-radius: 8px; border: none; font-weight: 600; font-size: 14px; cursor: pointer; flex: 1; }
.btn.primary { background: var(--good); color: #fff; }
.btn.primary:hover:not(:disabled) { background: #047857; }
.btn.outline { background: transparent; border: 1px solid var(--accent); color: var(--accent); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.msg { font-size: 13px; padding: 10px 12px; border-radius: 6px; }
.msg.ok { background: var(--good-bg); color: var(--good); }
.msg.warn { background: var(--warn-bg); color: var(--warn); }
.msg.err { background: #fef2f2; color: var(--bad); }

.preview { background: var(--card-hi); border-radius: 8px; padding: 12px; }
.preview-title { font-size: 12px; color: var(--muted); font-weight: 600; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.04em; }
.preview-prod { padding: 8px 0; border-bottom: 1px solid var(--border); }
.preview-prod:last-child { border-bottom: none; }
.pn { font-size: 14px; font-weight: 600; }
.pp { font-size: 12px; color: var(--muted); margin-top: 2px; }

.sites { display: flex; flex-direction: column; gap: 8px; }
.site { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 12px; box-shadow: var(--shadow); }
.site.disabled { opacity: 0.6; }
.site-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 6px; }
.site-name { font-weight: 600; font-size: 15px; }
.site-id { color: var(--muted); font-size: 12px; margin-top: 2px; }
.site-url { color: var(--muted); font-size: 12px; word-break: break-all; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
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
  .btn { flex: 0 0 auto; }
}
`;
