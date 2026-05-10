'use client';
import { useState } from 'react';

export default function RefreshButton() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onClick() {
    setLoading(true);
    setMsg('Scrapeando tiendas…');
    try {
      // El secret se obtiene de localStorage (set vía /sites o prompt)
      const secret = typeof window !== 'undefined' ? localStorage.getItem('refreshSecret') || '' : '';
      const headers: HeadersInit = secret ? { 'x-refresh-secret': secret } : {};
      const res = await fetch('/api/refresh', { method: 'POST', headers, cache: 'no-store' });
      const data = await res.json();
      if (!data.ok) {
        if (res.status === 401) {
          const newSecret = window.prompt('Pega el CRON_SECRET para autorizar actualizaciones:');
          if (newSecret) {
            localStorage.setItem('refreshSecret', newSecret);
            setMsg('Secret guardado. Volviendo a intentar…');
            setTimeout(onClick, 500);
            return;
          }
          throw new Error('Autorización requerida.');
        }
        throw new Error(data.error || 'Error en el scrape');
      }
      setMsg(`✓ ${data.totalProducts} productos · mejor: ${data.best?.store} a $${data.best?.pricePerKg.toLocaleString('es-CL')}/kg`);
      // Forzar reload tras 1.5s para ver el snapshot nuevo (Vercel ya redeployó si hubo commit)
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      setMsg('✗ ' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="refresh-wrap">
      <button onClick={onClick} disabled={loading} className="refresh-btn">
        {loading ? '⏳ Actualizando…' : '🔄 Actualizar ahora'}
      </button>
      {msg && <div className={`refresh-msg ${msg.startsWith('✗') ? 'err' : 'ok'}`}>{msg}</div>}
      <style>{css}</style>
    </div>
  );
}

const css = `
.refresh-wrap { width: 100%; }
.refresh-btn {
  width: 100%;
  background: var(--text);
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 12px 16px;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
}
.refresh-btn:hover { background: #000; }
.refresh-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.refresh-msg { font-size: 13px; margin-top: 8px; padding: 8px 12px; border-radius: 6px; background: var(--card-hi); }
.refresh-msg.err { background: #fef2f2; color: var(--bad); }
.refresh-msg.ok { background: var(--good-bg); color: var(--good); }
@media (min-width: 640px) {
  .refresh-btn { width: auto; min-width: 200px; }
}
`;
