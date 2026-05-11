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
  /**
   * Estado de stock detectado del scraper.
   *  - true: stock confirmado
   *  - false: sin stock confirmado
   *  - null: no se pudo determinar
   */
  inStock: boolean | null;
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

export interface SiteConfig {
  id: string;
  name: string;
  baseUrl: string;
  searchUrlTemplate: string;
  queries: string[];
  strategy: 'next_data' | 'jsonld' | 'microdata' | 'custom' | 'unknown';
  nextDataPath?: string;
  productSelector?: string;
  enabled: boolean;
  needsChromium: boolean;
  notes?: string;
  lastSuccessfulScrape?: string;
}

export interface SitesRegistry {
  version: number;
  sites: SiteConfig[];
}
