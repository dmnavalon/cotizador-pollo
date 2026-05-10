# Cotizador Pechuga de Pollo

App Next.js que scrapea tiendas online chilenas todos los **domingos a las 22:00 (hora Chile)** buscando el menor precio/kg de pechuga de pollo deshuesada, y muestra el resultado en una página mobile-first.

## Stack
- Next.js 14 (App Router)
- TypeScript
- Vercel (hosting + cron)
- GitHub (storage del snapshot vía commits automáticos)
- `fetch` nativo (sin Chromium) — extrae datos de SSR (`__NEXT_DATA__`, JSON-LD, microdata)

## Características
- 🏠 **Home** con menor precio/kg destacado, última actualización y botón "Actualizar ahora"
- ⚙ **/sites** — gestor para agregar/quitar tiendas, con auto-detección de patrón de scraping
- 🤖 **Cron semanal** (Vercel) — domingos 22:00 CL = lunes 02:00 UTC
- 💾 **Snapshot commiteado al repo** — historial de precios versionado en `data/products.json`

## Deploy

### 1. Crear repo en GitHub
```bash
cd cotizador-pollo
git init -b main
git add -A
git commit -m "feat: cotizador inicial"
gh repo create cotizador-pollo --public --source=. --push
```

### 2. Deploy a Vercel
```bash
vercel link
vercel --prod
```

### 3. Configurar variables de entorno en Vercel
En el dashboard del proyecto (Settings → Environment Variables) o por CLI:

```bash
# Secret para autorizar el cron y el botón "Actualizar"
vercel env add CRON_SECRET production
# (pega un string largo aleatorio)

# Para que el cron commitee el snapshot al repo
vercel env add GITHUB_TOKEN production       # PAT con `contents:write` en el repo
vercel env add GITHUB_OWNER production       # tu usuario de GitHub
vercel env add GITHUB_REPO production        # cotizador-pollo
vercel env add GITHUB_BRANCH production      # main
```

Reproduce las mismas vars en `preview` y `development` si querés probar local.

### 4. Redeploy para que el cron quede activo
```bash
vercel --prod
```

## Uso
- **Ver precios**: abre la URL pública.
- **Forzar actualización**: aprieta "🔄 Actualizar ahora" en el home. La primera vez te pedirá el `CRON_SECRET` (queda guardado en localStorage).
- **Agregar sitio nuevo**: andá a `/sites`, completá el formulario, dale a "Probar scraping" para que el bot intente aprender el patrón, y después "Agregar sitio".

## Cómo "aprende" el bot un sitio nuevo
1. Hace `fetch` a la URL de búsqueda con un User-Agent normal.
2. Intenta extraer datos vía:
   - `__NEXT_DATA__` (sitios Next.js con SSR — Alvi, etc.)
   - JSON-LD `Product` (schema.org)
   - Microdata (`itemtype="Product"`)
3. Filtra productos cuyo nombre contenga "pechuga" + "deshuesada/filete/sin hueso" y descarta procesados (apanados, cocidos, hamburguesas).
4. Calcula precio/kg desde formato + precio.
5. Si nada funciona, marca el sitio como `needsChromium` y queda deshabilitado.

## Limitaciones actuales (Vercel Hobby)
Sitios protegidos por Cloudflare o que renderizan productos 100% client-side **no funcionan** sin un navegador real (Chromium). Estos sitios quedan en el registro pero marcados como `needsChromium`:
- Jumbo, Lider, Tottus, Santa Isabel, Unimarc

**Para habilitarlos**: subir a Vercel Pro (60s timeout) e instalar `@sparticuz/chromium` + `puppeteer-core`. Ver `lib/scrapers/jumbo.ts` para el placeholder.

## Estructura
```
cotizador-pollo/
├── app/
│   ├── page.tsx              # Home con productos
│   ├── RefreshButton.tsx     # Botón "Actualizar ahora"
│   ├── sites/page.tsx        # Gestor de sitios
│   └── api/
│       ├── refresh/route.ts  # Cron + botón → corre scrape
│       ├── sites/route.ts    # CRUD sitios
│       └── test-scrape/      # Auto-detección al agregar sitio
├── lib/
│   ├── scrape.ts             # Orquestador
│   ├── scrapers/
│   │   ├── alvi.ts           # Scraper dedicado para Alvi
│   │   ├── generic.ts        # Scraper genérico multi-patrón
│   │   ├── jumbo.ts          # Placeholder (needsChromium)
│   │   ├── lider.ts
│   │   └── tottus.ts
│   ├── github.ts             # Commit del snapshot al repo
│   ├── sites-config.ts       # Registry de sitios
│   ├── data-snapshot.ts      # Read/write de products.json
│   └── types.ts
├── data/
│   ├── products.json         # Snapshot último scrape (commiteado)
│   └── sites.json            # Registro de sitios
├── scripts/scrape-local.ts   # Seed local: `npm run scrape`
└── vercel.json               # Cron config
```

## Comandos
```bash
npm run dev      # localhost:3000
npm run scrape   # corre el scrape local, escribe data/products.json
npm run build    # build de producción
```
