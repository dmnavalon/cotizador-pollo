export interface PriceTier {
  minQty: number;
  unitPrice: number;
  pricePerKg: number;
  label: string;
}

export interface Product {
  store: string;
  id: string;
  name: string;
  brand: string;
  format: string;
  weightKg: number;
  url: string;
  image: string | null;
  tiers: PriceTier[];
  bestPricePerKg: number;
  ean: string | null;
}

export interface ScrapeResult {
  store: string;
  products: Product[];
  error: string | null;
  durationMs: number;
}

export interface DataSnapshot {
  updatedAt: string;
  scrapes: ScrapeResult[];
  allProducts: Product[];
  best: Product | null;
  totalProducts: number;
}

/**
 * Configuración de un sitio en el registro editable por el usuario.
 * El scraper genérico intenta detectar productos automáticamente, pero el
 * usuario puede sobreescribir patrones manualmente si la auto-detección falla.
 */
export interface SiteConfig {
  /** Identificador interno único (slug) */
  id: string;
  /** Nombre legible (ej: "Alvi", "Don Pollo") */
  name: string;
  /** URL base del sitio */
  baseUrl: string;
  /** URL de búsqueda. {q} se reemplaza por el término. */
  searchUrlTemplate: string;
  /** Términos de búsqueda a usar */
  queries: string[];
  /** Estrategia de parseo detectada/configurada */
  strategy: 'next_data' | 'jsonld' | 'microdata' | 'custom' | 'unknown';
  /** JSON path dentro de __NEXT_DATA__ donde están los productos (si aplica) */
  nextDataPath?: string;
  /** Selector CSS de la tarjeta de producto (si custom) */
  productSelector?: string;
  /** Si el sitio está activo en la rotación de scraping */
  enabled: boolean;
  /** Si requiere Chromium (no soportado en Hobby) */
  needsChromium: boolean;
  /** Notas del usuario */
  notes?: string;
  /** Última vez que se logró scrapear con éxito */
  lastSuccessfulScrape?: string;
}

export interface SitesRegistry {
  version: number;
  sites: SiteConfig[];
}
