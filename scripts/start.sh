#!/usr/bin/env bash
set -euo pipefail

# Poker Table — Script de Inicialização para Ubuntu / Linux
# Permite iniciar o servidor na rede local sem depender de internet.

# Garante a execução a partir do diretório raiz do projeto
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

# 1. Verificar Node.js
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "[ERRO] Node.js não foi encontrado no sistema."
  echo "Instale o Node.js 22.13.0 ou superior para executar o Poker Table."
  echo ""
  exit 1
fi

NODE_RAW=$(node -v)
NODE_CLEAN="${NODE_RAW#v}"
IFS='.' read -r NODE_MAJOR NODE_MINOR NODE_PATCH <<< "$NODE_CLEAN"
NODE_PATCH="${NODE_PATCH%%[!0-9]*}"

if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 13 ]; }; then
  echo ""
  echo "[ERRO] Node.js ${NODE_RAW} detectado. O Poker Table requer Node.js 22.13.0 ou superior."
  echo "Atualize o Node.js para uma versão suportada."
  echo ""
  exit 1
fi

# 2. Verificar arquivos compilados
if [ ! -f "apps/server/dist/main.js" ] || [ ! -d "apps/web/dist" ]; then
  echo ""
  echo "[ERRO] Arquivos compilados do Poker Table não foram encontrados."
  echo "Antes do primeiro uso, compile o projeto com:"
  echo "  npm run build"
  echo ""
  exit 1
fi

# 3. Executar o servidor autoritativo
# Usa exec para substituir o shell pelo processo Node.js, garantindo repasse direto de sinais (Ctrl+C)
exec node apps/server/dist/main.js
