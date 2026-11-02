#!/usr/bin/env bash
set -euo pipefail

# Poker Table — Inicialização no Termux (Android)
# Executa o servidor autoritativo local no smartphone.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 1. Verificar Node.js
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "[ERRO] Node.js não foi encontrado no Termux."
  echo "Instale com: pkg install nodejs-lts"
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
  echo ""
  exit 1
fi

# 2. Verificar arquivos essenciais compilados
if [ ! -f "apps/server/dist/main.js" ] || [ ! -f "apps/web/dist/index.html" ]; then
  echo ""
  echo "[ERRO] Arquivos compilados do Poker Table não foram encontrados."
  echo "Certifique-se de descompactar o pacote gerado pelo notebook."
  echo ""
  exit 1
fi

# 3. Verificar dependências instaladas
if [ ! -d "node_modules" ]; then
  echo ""
  echo "[AVISO] Dependências de produção ainda não instaladas."
  echo "Executando setup inicial..."
  ./termux-setup.sh
fi

# 4. Configurar diretório de persistência SQLite privado
mkdir -p "data"
export DATABASE_PATH="${DATABASE_PATH:-data/poker-table.sqlite}"

# 5. Configurar IP de anúncio (Hotspot ou Wi-Fi)
# Pode ser passado como argumento: ./termux-start.sh 10.107.248.23
# Ou como variável de ambiente: LAN_IP=10.107.248.23 ./termux-start.sh
if [ $# -ge 1 ] && [ -n "$1" ]; then
  export LAN_IP="$1"
fi

echo ""
echo "=== Poker Table — Servidor Android (Termux) ==="
if [ -n "${LAN_IP:-}" ]; then
  echo "IP do Hotspot configurado: $LAN_IP"
else
  echo "Dica: Caso o IP do Hotspot não seja detectado automaticamente,"
  echo "inicie informando o IP: ./termux-start.sh <IP_DO_HOTSPOT>"
fi

# 6. Dica de estabilidade para segundo plano
echo ""
echo "Aviso de estabilidade:"
echo "- Para evitar que o Android suspenda o servidor ao abrir o Chrome,"
echo "  recomenda-se ativar o wake lock no Termux: termux-wake-lock"
echo "- Configure o app Termux na bateria do Xiaomi para 'Sem restrições'."
echo ""

# 7. Executar o servidor autoritativo
exec node apps/server/dist/main.js
