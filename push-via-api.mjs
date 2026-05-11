#!/usr/bin/env node
import { Octokit } from '@octokit/rest';
import fs from 'fs';
import path from 'path';

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'dmnavalon';
const REPO = 'cotizador-pollo';
const BRANCH = 'main';
const ROOT = '/sessions/hopeful-wonderful-johnson/mnt/Desarrollos DMN/cotizador-pollo';
const MESSAGE = process.env.MSG || 'chore: actualización vía API';

const FILES_ARG = process.env.FILES;
const FILES = FILES_ARG
  ? FILES_ARG.split(',').map((s) => s.trim()).filter(Boolean)
  : fs.readFileSync(path.join(ROOT, '.push-files.txt'), 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);

if (!TOKEN) { console.error('GH_TOKEN env required'); process.exit(1); }
const octokit = new Octokit({ auth: TOKEN });

async function commitFile(filePath) {
  const absPath = path.join(ROOT, filePath);
  if (!fs.existsSync(absPath)) { console.log(`  ⚠ skipping ${filePath} (no existe)`); return null; }
  const content = fs.readFileSync(absPath);
  const b64 = content.toString('base64');
  let sha;
  try {
    const cur = await octokit.rest.repos.getContent({ owner: OWNER, repo: REPO, path: filePath, ref: BRANCH });
    if (!Array.isArray(cur.data) && cur.data.type === 'file') sha = cur.data.sha;
  } catch (e) { if (e.status !== 404) throw e; }
  const res = await octokit.rest.repos.createOrUpdateFileContents({
    owner: OWNER, repo: REPO, path: filePath, branch: BRANCH,
    message: `${MESSAGE} (${filePath})`, content: b64, sha,
    committer: { name: 'cotizador-bot', email: 'bot@cotizador-pollo.vercel.app' },
    author: { name: 'cotizador-bot', email: 'bot@cotizador-pollo.vercel.app' },
  });
  return res.data.commit.sha.slice(0, 7);
}

(async () => {
  for (const f of FILES) {
    process.stdout.write(`  ${f} ... `);
    try {
      const sha = await commitFile(f);
      console.log(sha ? `✓ ${sha}` : 'skip');
    } catch (e) {
      console.log(`✗ ${e.message}`);
    }
  }
  if (process.env.TRIGGER_WORKFLOW !== 'false') {
    console.log('\n▶ Disparando workflow scrape.yml…');
    try {
      await octokit.rest.actions.createWorkflowDispatch({
        owner: OWNER, repo: REPO, workflow_id: 'scrape.yml', ref: BRANCH,
        inputs: { reason: MESSAGE.slice(0, 80) },
      });
      console.log('✓ Workflow disparado');
    } catch (e) { console.log(`✗ ${e.message}`); }
  }
})();
