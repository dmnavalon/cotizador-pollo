'use client';
import { useState } from 'react';

export default function RefreshButton() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onClick() {
    setLoading(true);
    setMsg('Disparando scrape…');
    try {
      const secret = typeof window !== 'undefined' ? localStorage.getItem('refreshSecret') || '' : '';
      const headers: HeadersInit = secret ? { 'x-refresh-secret': secret } : {};
      const res = await fetch('/api/refresh', { method: 'POST', headers, cache: 'no-store' });
      const data = await res.json();
      if (!data.ok) {
        if (res.status === 401) {
          const newSecret = window.prompt('Pega el CRON_SECRET para autorizar:');
          if (newSecret) {
            localStorage.setItem('refreshSecret', newSecret);
            setMsg('Secret guardado. Reintentando…');
            setTimeout(onClick, 500);
            return;
          }
          throw new Error('Autorización requerida.');
        }
        throw new Error(data.error || 'Error');
      }
      if (data.mode === 'github-actions') {
        setMsg(
          '✓ Scrape disparado en GitHub Actions. Tarda 1–3 minutos. La página se actualiza sola.'
        );
        // Polling: recargar la página cada 30s por 5 minutos para ver el resultado
        let polls = 0;
        const interval = setInterval(() => {
          polls++;
          if (polls > 10) {
            clearInterval(interval);
            return;
          }
          window.location.reload();
        }, 30000);
      } else {
        setMsg(
          `✓ ${data.totalProducts} productos · mejor: ${data.best?.store} a $${data.best?.pricePerKg.toLocaleString('es-CL')}/kg`
        );
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch (e) {
      setMsg('✗ ' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="refresh-wrap">
      <button onClick={onClick} disabled={loading} className="refresh-btn">
        {loading ? '⏳ Disparando…' : '🔄 Actualizar ahora'}
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
.refresh-msg { font-size: 13px; margin-top: 8px; padding: 8px 12px; border-radius: 6px; background: var(--card-hi); line-height: 1.4; }
.refresh-msg.err { background: #fef2f2; color: var(--bad); }
.refresh-msg.ok { background: var(--good-bg); color: var(--good); }
@media (min-width: 640px) {
  .refresh-btn { width: auto; min-width: 200px; }
}
`;
