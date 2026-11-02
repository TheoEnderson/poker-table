#!/usr/bin/env bash
set -euo pipefail

# Poker Table — Gerador do Pacote Portátil para Android (Termux)
# Executado no notebook Ubuntu para compilar e empacotar o projeto.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

DIST_DIR="$SCRIPT_DIR/dist-android"
PACKAGE_NAME="poker-table-android"
STAGE_DIR="$DIST_DIR/$PACKAGE_NAME"

echo ""
echo "=== Poker Table — Empacotador Android (Termux) ==="
echo ""

# 1. Verificar se a compilação de produção existe
if [ ! -f "apps/server/dist/main.js" ] || [ ! -f "apps/web/dist/index.html" ] || [ ! -f "packages/engine/dist/index.js" ] || [ ! -f "packages/protocol/dist/index.js" ]; then
  echo "[AVISO] Arquivos compilados não encontrados ou desatualizados."
  echo "Executando build do projeto..."
  npm run build
fi

# 2. Criar diretório limpo de staging
rm -rf "$DIST_DIR"
mkdir -p "$STAGE_DIR"
mkdir -p "$STAGE_DIR/apps/server"
mkdir -p "$STAGE_DIR/apps/web"
mkdir -p "$STAGE_DIR/packages/engine"
mkdir -p "$STAGE_DIR/packages/protocol"

# 3. Copiar manifestos e artefatos compilados (sem fontes, sem testes, sem bancos)
cp package.json package-lock.json "$STAGE_DIR/"

cp apps/server/package.json "$STAGE_DIR/apps/server/"
cp -r apps/server/dist "$STAGE_DIR/apps/server/"

cp apps/web/package.json "$STAGE_DIR/apps/web/"
cp -r apps/web/dist "$STAGE_DIR/apps/web/"

cp packages/engine/package.json "$STAGE_DIR/packages/engine/"
cp -r packages/engine/dist "$STAGE_DIR/packages/engine/"

cp packages/protocol/package.json "$STAGE_DIR/packages/protocol/"
cp -r packages/protocol/dist "$STAGE_DIR/packages/protocol/"

# 4. Copiar scripts de inicialização e setup para Termux
cp scripts/termux-start.sh "$STAGE_DIR/"
cp scripts/termux-setup.sh "$STAGE_DIR/"
chmod +x "$STAGE_DIR/termux-start.sh" "$STAGE_DIR/termux-setup.sh"

# 5. Criar instrução de uso simplificada para o celular
cat << 'EOF' > "$STAGE_DIR/README.txt"
Poker Table — Instruções no Termux (Android)
============================================

1. Preparação inicial (executar apenas uma vez, com conexão de internet):
   ./termux-setup.sh

2. Iniciar o servidor no celular:
   ./termux-start.sh [IP_DO_HOTSPOT]

   Exemplo:
   ./termux-start.sh 10.107.248.23

3. Abrir no navegador do celular (anfitrião):
   http://localhost:3000

4. Os convidados conectam no Wi-Fi do Hotspot e escaneiam o QR Code ou acessam:
   http://<IP_DO_HOTSPOT>:3000

Para encerrar o servidor: pressione Ctrl+C no Termux.
EOF

# 6. Gerar arquivo compactado (tar.gz)
cd "$DIST_DIR"
tar -czf "$PACKAGE_NAME.tar.gz" "$PACKAGE_NAME"
TAR_SIZE=$(du -h "$PACKAGE_NAME.tar.gz" | cut -f1)

echo "[OK] Pacote portátil criado com sucesso!"
echo "     Arquivo: $DIST_DIR/$PACKAGE_NAME.tar.gz ($TAR_SIZE)"
echo ""
echo "=== Como transferir para o celular pela rede local ==="
echo ""
echo "1. No notebook, inicie um servidor HTTP temporário na pasta de distribuição:"
echo "   python3 -m http.server 8000 --directory \"$DIST_DIR\""
echo ""
echo "2. No celular (Termux), conectado ao mesmo Wi-Fi ou Hotspot, baixe e descompacte:"
echo "   curl -O http://<IP_DO_NOTEBOOK>:8000/$PACKAGE_NAME.tar.gz"
echo "   tar -xzf $PACKAGE_NAME.tar.gz"
echo "   cd $PACKAGE_NAME"
echo "   ./termux-setup.sh"
echo ""
