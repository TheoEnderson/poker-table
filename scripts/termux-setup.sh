#!/usr/bin/env bash
set -euo pipefail

# Poker Table — Setup Inicial no Termux (Android)
# Executado UMA ÚNICA VEZ para instalar dependências mínimas de produção.

echo ""
echo "=== Poker Table — Setup Inicial no Termux ==="
echo ""

# 1. Verificar Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "[ERRO] Node.js não foi encontrado no Termux."
  echo "Instale o Node.js executando: pkg install nodejs-lts"
  echo ""
  exit 1
fi

NODE_RAW=$(node -v)
NODE_CLEAN="${NODE_RAW#v}"
IFS='.' read -r NODE_MAJOR NODE_MINOR NODE_PATCH <<< "$NODE_CLEAN"
NODE_PATCH="${NODE_PATCH%%[!0-9]*}"

if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 13 ]; }; then
  echo "[ERRO] Node.js ${NODE_RAW} detectado. O Poker Table requer Node.js 22.13.0 ou superior."
  echo "Atualize o Node.js com: pkg update && pkg install nodejs-lts"
  echo ""
  exit 1
fi

echo "[OK] Node.js ${NODE_RAW} verificado."

# 2. Instalar apenas dependências de produção (express, socket.io, zod)
# Não instala devDependencies (Vite, TypeScript, Playwright, Vitest)
echo ""
echo "Instalando dependências de produção do servidor (apenas módulos puros JS)..."
npm install --omit=dev --no-audit --no-fund

echo ""
echo "[OK] Instalação concluída com sucesso!"
echo "Para iniciar a partida, execute:"
echo "  ./termux-start.sh [IP_DO_HOTSPOT]"
echo ""
