import { readSnapshot } from '@/lib/data-snapshot';
import { sortByStockThenPrice } from '@/lib/scrape';
import RefreshButton from './RefreshButton';
import Link from 'next/link';

export const dynamic = 'force-static';
export const revalidate = 60;

function clp(n: number): string {
  return '$' + n.toLocaleString('es-CL');
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `hace ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `hace ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr} h`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `hace ${days}d`;
  return date.toLocaleDateString('es-CL');
}

function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Santiago',
  });
}

function StockBadge({ inStock }: { inStock: boolean | null }) {
  if (inStock === true) return <span className="stock-badge stock-ok">✓ Stock</span>;
  if (inStock === false) return <span className="stock-badge stock-no">⛔ Sin stock</span>;
  return <span className="stock-badge stock-unk">? Stock</span>;
}

export default function Home() {
  const snapshot = readSnapshot();

  if (!snapshot) {
    return (
      <main className="wrap">
        <h1>Cotizador Pechuga de Pollo</h1>
        <p className="sub">Aún no hay datos. Aprieta "Actualizar ahora".</p>
        <RefreshButton />
      </main>
    );
  }

  const sorted = sortByStockThenPrice(snapshot.allProducts);
  const best = sorted[0] || snapshot.best;
  const underBudget = sorted.filter((p) => p.bestPricePerKg < 5500);
  const overBudget = sorted.filter((p) => p.bestPricePerKg >= 5500);

  return (
    <main className="wrap">
      <header className="topbar">
        <div className="topbar-meta">
          <div className="updated">
            <span className="dot" />
            Actualizado <b>{formatRelative(snapshot.updatedAt)}</b>
            <span className="abs">{formatAbsolute(snapshot.updatedAt)}</span>
          </div>
          <Link href="/sites" className="manage-link">
            ⚙ Sitios
          </Link>
        </div>
        <RefreshButton />
      </header>

      <h1>Pechuga de pollo deshuesada</h1>
      <p className="sub">
        Menor precio/kg <b>con stock</b> entre {snapshot.scrapes.length} tiendas · {snapshot.totalProducts} productos
      </p>

      {best && (
        <section className="hero">
          <div className="tag">★ MEJOR PRECIO {best.inStock === true ? 'CON STOCK' : ''}</div>
          <div className="hero-name">{best.name}</div>
          <div className="hero-brand">
            {best.brand} · {best.format} · <span className="store">{best.store}</span>
            <span style={{ marginLeft: 8 }}>
              <StockBadge inStock={best.inStock} />
            </span>
          </div>
          <div className="hero-price">
            {clp(best.bestPricePerKg)} <span className="unit">/ kg</span>
          </div>
          <a href={best.url} target="_blank" rel="noopener" className="hero-cta">
            Ver en {best.store} →
          </a>
        </section>
      )}

      <h2>Bajo $5.500/kg ({underBudget.length})</h2>
      <div className="prod-list">
        {underBudget.map((p) => (
          <ProductCard key={p.id} p={p} />
        ))}
        {underBudget.length === 0 && <div className="empty">Nada bajo $5.500/kg ahora mismo.</div>}
      </div>

      {overBudget.length > 0 && (
        <>
          <h2>Sobre $5.500/kg ({overBudget.length})</h2>
          <div className="prod-list">
            {overBudget.slice(0, 8).map((p) => (
              <ProductCard key={p.id} p={p} faded />
            ))}
          </div>
        </>
      )}

      <h2>Estado por tienda</h2>
      <div className="stores">
        {snapshot.scrapes.map((s) => {
          const inStock = s.products.filter((p) => p.inStock === true).length;
          return (
            <div key={s.store} className={`store-row ${s.error ? 'err' : 'ok'}`}>
              <div className="store-name">{s.store}</div>
              <div className="store-stat">
                {s.error ? (
                  <span className="err-text">{s.error.slice(0, 50)}</span>
                ) : (
                  <>
                    <b>{s.products.length}</b> productos
                    {inStock > 0 && <span className="muted"> · {inStock} con stock</span>}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <footer className="footer">
        Bot actualiza cada domingo 22:00 hora Chile vía GitHub Actions.
      </footer>

      <style>{styles}</style>
    </main>
  );
}

function ProductCard({ p, faded }: { p: any; faded?: boolean }) {
  const tiers = p.tiers as { minQty: number; unitPrice: number; pricePerKg: number; label: string }[];
  const outOfStock = p.inStock === false;
  return (
    <article className={`prod ${faded || outOfStock ? 'faded' : ''}`}>
      <div className="prod-head">
        <div className="prod-title">
          {p.name}
          <div className="prod-brand">
            {p.brand} · {p.format} · <span className="store-pill">{p.store}</span>
            <span style={{ marginLeft: 6 }}>
              <StockBadge inStock={p.inStock} />
            </span>
          </div>
        </div>
        <div className={`prod-kg ${p.bestPricePerKg < 5500 ? 'ok' : 'no'}`}>
          {clp(p.bestPricePerKg)}<small>/ kg</small>
        </div>
      </div>
      <div className="tiers">
        {tiers.map((t, i) => (
          <div key={i} className="tier">
            <span className="tier-label">{t.label}{t.minQty > 1 ? ` ${t.minQty}+` : ''}</span>
            <span className="tier-price">{clp(t.unitPrice)}</span>
            <span className="tier-kg">{clp(t.pricePerKg)}/kg</span>
          </div>
        ))}
      </div>
      <a href={p.url} target="_blank" rel="noopener" className="prod-link">
        Ver en {p.store}
      </a>
    </article>
  );
}

const styles = `
.wrap { max-width: 760px; margin: 0 auto; padding: 16px 14px calc(28px + env(safe-area-inset-bottom)); }
.topbar { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px solid var(--border); }
.topbar-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.updated { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); flex-wrap: wrap; }
.updated b { color: var(--text); font-weight: 600; }
.updated .abs { color: var(--muted); font-size: 12px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--good); display: inline-block; }
.manage-link { font-size: 13px; color: var(--accent); white-space: nowrap; }
h1 { font-size: 22px; margin: 12px 0 4px; letter-spacing: -0.02em; line-height: 1.25; }
.sub { color: var(--muted); margin: 0 0 18px; font-size: 14px; }
h2 { font-size: 12px; margin: 24px 0 10px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
.hero { background: var(--good-bg); border: 1px solid var(--good-border); border-radius: 14px; padding: 18px; margin-bottom: 18px; }
.tag { display: inline-block; background: var(--good); color: #fff; font-size: 10px; font-weight: 700; padding: 4px 9px; border-radius: 999px; letter-spacing: 0.06em; margin-bottom: 10px; }
.hero-name { font-size: 17px; font-weight: 600; color: #064e3b; line-height: 1.3; }
.hero-brand { font-size: 13px; color: #047857; margin-top: 4px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.hero-brand .store { background: rgba(5,150,105,0.15); padding: 2px 7px; border-radius: 4px; font-weight: 600; }
.hero-price { font-size: 32px; font-weight: 800; color: var(--good); letter-spacing: -0.02em; margin: 10px 0 4px; }
.hero-price .unit { font-size: 14px; color: #064e3b; font-weight: 500; }
.hero-cta { display: block; background: var(--good); color: #fff; padding: 12px 16px; border-radius: 10px; font-weight: 700; font-size: 15px; text-align: center; margin-top: 10px; }
.hero-cta:hover { text-decoration: none; background: #047857; }
.prod-list { display: flex; flex-direction: column; gap: 10px; }
.prod { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 14px; box-shadow: var(--shadow); }
.prod.faded { opacity: 0.55; }
.prod-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
.prod-title { font-weight: 600; font-size: 15px; line-height: 1.3; flex: 1; min-width: 0; }
.prod-brand { color: var(--muted); font-size: 12px; font-weight: 500; margin-top: 4px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.store-pill { background: var(--card-hi); padding: 1px 6px; border-radius: 4px; font-weight: 600; color: var(--text); }
.stock-badge { display: inline-block; padding: 1px 7px; border-radius: 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.02em; }
.stock-ok { background: #d1fae5; color: #065f46; }
.stock-no { background: #fee2e2; color: #991b1b; }
.stock-unk { background: #f3f4f6; color: #6b7280; }
.prod-kg { font-size: 18px; font-weight: 800; letter-spacing: -0.02em; white-space: nowrap; }
.prod-kg.ok { color: var(--good); }
.prod-kg.no { color: var(--bad); }
.prod-kg small { font-size: 11px; color: var(--muted); font-weight: 500; display: block; text-align: right; margin-top: -2px; }
.tiers { display: flex; flex-direction: column; gap: 4px; font-size: 13px; padding: 8px 10px; background: var(--card-hi); border-radius: 8px; margin-bottom: 10px; }
.tier { display: grid; grid-template-columns: 1fr auto auto; gap: 10px; align-items: center; }
.tier-label { color: var(--muted); }
.tier-price { font-variant-numeric: tabular-nums; }
.tier-kg { font-variant-numeric: tabular-nums; font-weight: 600; }
.prod-link { display: block; background: var(--accent); color: #fff; padding: 10px 12px; border-radius: 8px; font-size: 14px; font-weight: 600; text-align: center; }
.prod-link:hover { text-decoration: none; background: #1d4ed8; }
.empty { background: var(--card); border: 1px dashed var(--border); border-radius: 12px; padding: 24px; text-align: center; color: var(--muted); font-size: 14px; }
.stores { background: var(--card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.store-row { display: flex; justify-content: space-between; align-items: center; padding: 11px 14px; border-bottom: 1px solid var(--border); font-size: 13px; gap: 8px; }
.store-row:last-child { border-bottom: none; }
.store-row.err .err-text { color: var(--warn); font-size: 12px; }
.store-name { font-weight: 600; }
.muted { color: var(--muted); }
.footer { color: var(--muted); font-size: 11px; margin-top: 28px; padding-top: 14px; border-top: 1px solid var(--border); text-align: center; line-height: 1.5; }
@media (min-width: 640px) {
  .wrap { padding: 28px 22px; }
  h1 { font-size: 28px; }
  .hero-name { font-size: 20px; }
  .hero-price { font-size: 38px; }
}
`;
