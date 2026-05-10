#!/usr/bin/env bash
# Deploy automatizado: GitHub + Vercel + env vars + cron semanal.
# Requiere: `gh` y `vercel` ya autenticados en tu Mac.
# Uso: cd al directorio del proyecto y ejecutar `bash deploy.sh`

set -euo pipefail

REPO_NAME="${REPO_NAME:-cotizador-pollo}"
GH_OWNER="${GH_OWNER:-$(gh api user --jq .login 2>/dev/null || echo "")}"

if [ -z "$GH_OWNER" ]; then
  echo "❌ No pude detectar tu usuario de GitHub. Corre 'gh auth login' primero."
  exit 1
fi

if ! command -v vercel >/dev/null 2>&1; then
  echo "❌ Falta vercel CLI. Instalá con 'npm i -g vercel' y 'vercel login'."
  exit 1
fi

echo "📦 Proyecto: ${GH_OWNER}/${REPO_NAME}"
echo ""

# 1) Git: asegurar repo inicializado y con commit
if [ ! -d .git ]; then
  git init -b main
fi
git config user.email "${USER}@$(hostname -s).local" 2>/dev/null || true
git add -A
if ! git diff --cached --quiet 2>/dev/null; then
  git commit -m "feat: cotizador inicial"
fi

# 2) Crear repo en GitHub y push
if ! gh repo view "${GH_OWNER}/${REPO_NAME}" >/dev/null 2>&1; then
  echo "🐙 Creando repo público en GitHub..."
  gh repo create "${GH_OWNER}/${REPO_NAME}" --public --source=. --remote=origin --push
else
  echo "🐙 Repo ya existe en GitHub."
  if ! git remote get-url origin >/dev/null 2>&1; then
    git remote add origin "https://github.com/${GH_OWNER}/${REPO_NAME}.git"
  fi
  git push -u origin main 2>/dev/null || git push origin main
fi

# 3) Generar CRON_SECRET
SECRET_FILE=".deploy-secret"
if [ ! -f "$SECRET_FILE" ]; then
  openssl rand -hex 24 > "$SECRET_FILE"
  echo "🔐 CRON_SECRET generado y guardado en .deploy-secret (ignorado por git)"
fi
CRON_SECRET=$(tr -d '\n' < "$SECRET_FILE")

# 4) Personal Access Token
echo "🔑 Generando PAT temporal vía 'gh auth token' (usa tu sesión actual)..."
GH_PAT=$(gh auth token)

# 5) Linkear con Vercel
echo "▲ Linkeando proyecto con Vercel..."
vercel link --yes --project "$REPO_NAME" >/dev/null 2>&1 || vercel link --yes

# 6) Setear env vars (sobreescribe si existen)
push_env() {
  local name="$1"
  local value="$2"
  vercel env rm "$name" production --yes 2>/dev/null || true
  printf "%s" "$value" | vercel env add "$name" production >/dev/null
  echo "   ✓ $name"
}

echo "▲ Configurando env vars en producción..."
push_env CRON_SECRET "$CRON_SECRET"
push_env GITHUB_TOKEN "$GH_PAT"
push_env GITHUB_OWNER "$GH_OWNER"
push_env GITHUB_REPO "$REPO_NAME"
push_env GITHUB_BRANCH "main"

# 7) Deploy
echo ""
echo "▲ Desplegando a producción..."
vercel --prod --yes

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "✅ Deploy completo"
echo ""
echo "🔐 Guarda este CRON_SECRET (lo pega el botón 'Actualizar ahora' la primera vez):"
echo ""
echo "    $CRON_SECRET"
echo ""
echo "🤖 Cron activo: lunes 02:00 UTC = domingo 22:00 hora Chile"
echo "═══════════════════════════════════════════════════════════════"
