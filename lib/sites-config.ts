import { Octokit } from '@octokit/rest';
import fs from 'fs';
import path from 'path';
import type { SitesRegistry, SiteConfig } from './types';

const SITES_PATH = 'data/sites.json';
const SITES_FILE = path.join(process.cwd(), SITES_PATH);

export const DEFAULT_SITES: SiteConfig[] = [
  {
    id: 'alvi',
    name: 'Alvi',
    baseUrl: 'https://www.alvi.cl',
    searchUrlTemplate: 'https://www.alvi.cl/search?q={q}',
    queries: ['pechuga pollo', 'pechuga deshuesada', 'filete pechuga'],
    strategy: 'next_data',
    enabled: true,
    needsChromium: false,
    notes: 'Mayorista con club socio. Inyecta productos en __NEXT_DATA__.',
  },
  {
    id: 'jumbo',
    name: 'Jumbo',
    baseUrl: 'https://www.jumbo.cl',
    searchUrlTemplate: 'https://www.jumbo.cl/buscapagina?ft={q}',
    queries: ['pechuga pollo'],
    strategy: 'unknown',
    enabled: false,
    needsChromium: true,
    notes: 'Cloudflare + SPA. Necesita Chromium (Vercel Pro).',
  },
  {
    id: 'lider',
    name: 'Lider',
    baseUrl: 'https://www.lider.cl',
    searchUrlTemplate: 'https://www.lider.cl/supermercado/search?search_query={q}',
    queries: ['pechuga pollo'],
    strategy: 'unknown',
    enabled: false,
    needsChromium: true,
    notes: 'Cloudflare + SPA. Necesita Chromium.',
  },
  {
    id: 'tottus',
    name: 'Tottus',
    baseUrl: 'https://tottus.falabella.com',
    searchUrlTemplate: 'https://tottus.falabella.com/tottus-cl/search?Ntt={q}',
    queries: ['pechuga pollo'],
    strategy: 'unknown',
    enabled: false,
    needsChromium: true,
    notes: 'Cloudflare challenge. Necesita Chromium.',
  },
];

export function readLocalRegistry(): SitesRegistry {
  try {
    const raw = fs.readFileSync(SITES_FILE, 'utf8');
    const parsed = JSON.parse(raw) as SitesRegistry;
    if (!parsed.sites?.length) throw new Error('empty');
    return parsed;
  } catch {
    return { version: 1, sites: DEFAULT_SITES };
  }
}

async function getOctokit(): Promise<{
  octokit: Octokit;
  owner: string;
  repo: string;
  branch: string;
} | null> {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!token || !owner || !repo) return null;
  return { octokit: new Octokit({ auth: token }), owner, repo, branch };
}

export async function readRegistry(): Promise<SitesRegistry> {
  // En Vercel runtime, lee el archivo desde el bundle (versión del último deploy)
  return readLocalRegistry();
}

export async function writeRegistry(reg: SitesRegistry): Promise<{ commitSha: string } | null> {
  const gh = await getOctokit();
  if (!gh) {
    // En dev local, escribir al filesystem
    fs.writeFileSync(SITES_FILE, JSON.stringify(reg, null, 2));
    return null;
  }
  const { octokit, owner, repo, branch } = gh;
  const content = Buffer.from(JSON.stringify(reg, null, 2)).toString('base64');

  let sha: string | undefined;
  try {
    const cur = await octokit.rest.repos.getContent({ owner, repo, path: SITES_PATH, ref: branch });
    if (!Array.isArray(cur.data) && cur.data.type === 'file') sha = cur.data.sha;
  } catch (e: any) {
    if (e.status !== 404) throw e;
  }

  const res = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: SITES_PATH,
    branch,
    message: `chore: actualización del registro de sitios (${new Date().toISOString()})`,
    content,
    sha,
    committer: { name: 'cotizador-bot', email: 'bot@cotizador-pollo.vercel.app' },
    author: { name: 'cotizador-bot', email: 'bot@cotizador-pollo.vercel.app' },
  });
  return { commitSha: res.data.commit.sha || '' };
}

export async function addSite(site: SiteConfig): Promise<void> {
  const reg = await readRegistry();
  const idx = reg.sites.findIndex((s) => s.id === site.id);
  if (idx >= 0) reg.sites[idx] = site;
  else reg.sites.push(site);
  await writeRegistry(reg);
}

export async function removeSite(id: string): Promise<void> {
  const reg = await readRegistry();
  reg.sites = reg.sites.filter((s) => s.id !== id);
  await writeRegistry(reg);
}

export async function toggleSite(id: string, enabled: boolean): Promise<void> {
  const reg = await readRegistry();
  const s = reg.sites.find((s) => s.id === id);
  if (s) {
    s.enabled = enabled;
    await writeRegistry(reg);
  }
}
