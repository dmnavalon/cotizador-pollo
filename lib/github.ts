import { Octokit } from '@octokit/rest';
import type { DataSnapshot } from './types';

/**
 * Commitea el snapshot data/products.json al repo de GitHub, lo que dispara
 * un redeploy automático en Vercel.
 *
 * Requiere las env vars:
 *  - GITHUB_TOKEN   (PAT con permiso `contents:write` en el repo)
 *  - GITHUB_OWNER   (ej. "diegonarvaez")
 *  - GITHUB_REPO    (ej. "cotizador-pollo")
 *  - GITHUB_BRANCH  (por defecto "main")
 */
export async function commitSnapshot(snapshot: DataSnapshot): Promise<{ commitSha: string; url: string } | null> {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  const path = 'data/products.json';

  if (!token || !owner || !repo) {
    console.warn('[github] Skipping commit — missing GITHUB_TOKEN/OWNER/REPO env vars.');
    return null;
  }

  const octokit = new Octokit({ auth: token });
  const content = Buffer.from(JSON.stringify(snapshot, null, 2)).toString('base64');

  // Obtener el SHA actual del archivo (si existe) para hacer update
  let sha: string | undefined;
  try {
    const current = await octokit.rest.repos.getContent({ owner, repo, path, ref: branch });
    if (!Array.isArray(current.data) && current.data.type === 'file') {
      sha = current.data.sha;
    }
  } catch (e: any) {
    if (e.status !== 404) throw e;
  }

  const result = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    branch,
    message: `chore: actualización automática del scrape (${snapshot.updatedAt})`,
    content,
    sha,
    committer: { name: 'cotizador-bot', email: 'bot@cotizador-pollo.vercel.app' },
    author: { name: 'cotizador-bot', email: 'bot@cotizador-pollo.vercel.app' },
  });

  return {
    commitSha: result.data.commit.sha || '',
    url: result.data.commit.html_url || '',
  };
}
