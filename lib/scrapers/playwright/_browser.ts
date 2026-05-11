/**
 * Helpers compartidos para los scrapers Playwright dedicados por sitio.
 * Se importa SOLO desde scripts que corren en GH Actions (no en Vercel).
 */
type Browser = any;
type Page = any;

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
  });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

export async function newPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({
    userAgent: UA,
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: { 'Accept-Language': 'es-CL,es;q=0.9' },
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['es-CL', 'es', 'en'] });
  });
  return ctx.newPage();
}

export async function passCloudflare(page: Page, maxWaitMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const title = await page.title().catch(() => '');
    const url = page.url();
    if (!/just a moment|cloudflare|attention required|verificando/i.test(title) && !/__cf_chl_/.test(url)) {
      return true;
    }
    await page.waitForTimeout(2000);
  }
  return false;
}

export async function waitForPechuga(page: Page, timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ok = await page.evaluate(() => {
        const txt = document.body?.innerText || '';
        return /pechuga/i.test(txt) && /\$\s?\d{2,}/.test(txt);
      });
      if (ok) return true;
    } catch {}
    await page.waitForTimeout(1000);
  }
  return false;
}

export async function scrollFully(page: Page, steps = 6): Promise<void> {
  for (let i = 0; i < steps; i++) {
    try { await page.mouse.wheel(0, 2000); } catch {}
    await page.waitForTimeout(1200);
  }
}

export function clpToInt(s: string): number {
  const m = s.match(/(\d{1,3}(?:[.,]\d{3})*|\d+)/);
  if (!m) return 0;
  return parseInt(m[1].replace(/[.,]/g, ''), 10) || 0;
}

export function parseWeightKg(text: string): number | null {
  const tx = text.toLowerCase();
  const kg = tx.match(/(\d+(?:[.,]\d+)?)\s*kg\b/);
  if (kg) return parseFloat(kg[1].replace(',', '.'));
  const g = tx.match(/(\d+(?:[.,]\d+)?)\s*g(?:r|ramos?)?\b/);
  if (g) return parseFloat(g[1].replace(',', '.')) / 1000;
  return null;
}

export function isPechugaDeshuesada(name: string): boolean {
  const n = name.toLowerCase();
  if (!n.includes('pechuga')) return false;
  if (!/(deshues|fil[eé]|sin hueso)/i.test(n)) return false;
  if (/(apan|cocid|hambur|nugget|breaded|empan)/i.test(n)) return false;
  return true;
}
