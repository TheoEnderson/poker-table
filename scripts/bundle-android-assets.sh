#!/usr/bin/env bash
set -euo pipefail

# Poker Table — Empacotador de Assets para o Aplicativo Android
# Prepara a árvore nodejs-project em apps/android/app/src/main/assets/

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

ASSETS_TARGET="$SCRIPT_DIR/apps/android/app/src/main/assets/nodejs-project"

echo ""
echo "=== Poker Table — Empacotamento de Assets Android ==="
echo ""

# 1. Compilar pacotes TypeScript do projeto
echo "[1/4] Compilando TypeScript e frontend..."
npm run build

# 2. Limpar e criar estrutura de diretórios
echo "[2/4] Preparando estrutura de assets em $ASSETS_TARGET..."
rm -rf "$ASSETS_TARGET"
mkdir -p "$ASSETS_TARGET/server"
mkdir -p "$ASSETS_TARGET/web"
mkdir -p "$ASSETS_TARGET/node_modules/@poker-table/engine"
mkdir -p "$ASSETS_TARGET/node_modules/@poker-table/protocol"

# 3. Copiar artefatos compilados
echo "[3/4] Copiando artefatos compilados do servidor, web e motor..."
cp -r apps/server/dist/* "$ASSETS_TARGET/server/"
cat << 'EOF' > "$ASSETS_TARGET/server/package.json"
{
  "type": "module"
}
EOF

cp -r apps/web/dist/* "$ASSETS_TARGET/web/"

cp -r packages/engine/dist "$ASSETS_TARGET/node_modules/@poker-table/engine/"
cp packages/engine/package.json "$ASSETS_TARGET/node_modules/@poker-table/engine/"

cp -r packages/protocol/dist "$ASSETS_TARGET/node_modules/@poker-table/protocol/"
cp packages/protocol/package.json "$ASSETS_TARGET/node_modules/@poker-table/protocol/"

# 4. Empacotar dependências de produção do servidor (express, socket.io, zod)
echo "[4/4] Empacotando dependências de produção..."
TEMP_PROD_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_PROD_DIR"' EXIT

cat << 'EOF' > "$TEMP_PROD_DIR/package.json"
{
  "name": "poker-table-runtime",
  "version": "0.3.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "express": "5.1.0",
    "socket.io": "4.8.1",
    "zod": "^4.6.7"
  }
}
EOF

# Instala apenas dependências de produção no diretório temporário
npm install --prefix "$TEMP_PROD_DIR" --omit=dev --no-audit --no-fund --loglevel=error

# Copia node_modules de produção para o diretório de assets
cp -r "$TEMP_PROD_DIR/node_modules"/* "$ASSETS_TARGET/node_modules/"

# 4.1. Limpeza segura de arquivos não executáveis no runtime (preservando licenças e avisos legais)
echo "     Otimizando árvore de arquivos (removendo sourcemaps, tipagens e testes)..."
find "$ASSETS_TARGET/node_modules" -type f \( -name "*.map" -o -name "*.d.ts" -o -name "*.d.mts" -o -name "*.d.cts" \) -delete
find "$ASSETS_TARGET/node_modules" -type f -name "*.md" ! -name "LICENSE*" ! -name "COPYING*" ! -name "NOTICE*" -delete
find "$ASSETS_TARGET/node_modules" -type d \( -name "test" -o -name "tests" -o -name "__tests__" \) -exec rm -rf {} +
if [ -d "$ASSETS_TARGET/node_modules/socket.io/client-dist" ]; then
  rm -rf "$ASSETS_TARGET/node_modules/socket.io/client-dist"
fi
if [ -d "$ASSETS_TARGET/node_modules/zod/src" ]; then
  rm -rf "$ASSETS_TARGET/node_modules/zod/src"
fi
find "$ASSETS_TARGET/node_modules" -type f \( -name ".npmignore" -o -name ".eslintrc*" -o -name ".prettier*" \) -delete

# Copia manifest raiz de execução
cat << 'EOF' > "$ASSETS_TARGET/package.json"
{
  "name": "poker-table-android-bundle",
  "version": "0.3.0",
  "type": "module",
  "main": "server/main.js"
}
EOF

# Estatísticas finais
TOTAL_SIZE=$(du -sh "$ASSETS_TARGET" | cut -f1)
FILE_COUNT=$(find "$ASSETS_TARGET" -type f | wc -l)

echo ""
echo "[OK] Assets Android preparados com sucesso!"
echo "     Destino: $ASSETS_TARGET"
echo "     Tamanho total: $TOTAL_SIZE ($FILE_COUNT arquivos)"
echo ""
