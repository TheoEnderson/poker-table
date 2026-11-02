#!/usr/bin/env bash
set -euo pipefail

# Poker Table — Download e Verificação do Runtime Node.js Nativo (fogtape/nodejs-mobile v24.21.0-0 FULL)
# Extrai libnode.so (arm64-v8a) e os cabeçalhos C++ para integração com o APK.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

LIB_DEST="$SCRIPT_DIR/apps/android/app/src/main/jniLibs/arm64-v8a/libnode.so"
HEADERS_DEST="$SCRIPT_DIR/apps/android/app/src/main/cpp/include/node/node.h"
EXPECTED_SHA256="955b308b1dfdf7662e8fe5ee4eb8c0c7d0a313f2d306387f2307529993c4bc32"
RELEASE_URL="https://github.com/fogtape/nodejs-mobile/releases/download/v24.21.0-0/nodejs-mobile-android-24.21.0-0.zip"

echo ""
echo "=== Poker Table — Runtime Node.js Android (fogtape/nodejs-mobile v24 FULL) ==="
echo ""

# 1. Verificar se libnode.so já existe e confere com a soma de verificação
if [ -f "$LIB_DEST" ]; then
  CURRENT_SHA=$(sha256sum "$LIB_DEST" | cut -d' ' -f1)
  if [ "$CURRENT_SHA" = "$EXPECTED_SHA256" ]; then
    echo "[OK] libnode.so (arm64-v8a) já está presente e validado por SHA256:"
    echo "     Arquivo: $LIB_DEST"
    echo "     SHA256:  $CURRENT_SHA"
    exit 0
  else
    echo "[AVISO] libnode.so existente com hash divergente. Reextraindo..."
  fi
fi

echo "[INFO] Baixando binário nativo pré-compilado para arm64-v8a..."
mkdir -p "$(dirname "$LIB_DEST")"
mkdir -p "$(dirname "$HEADERS_DEST")"

python3 - << EOF
import urllib.request, zipfile, io, os, hashlib, sys

url = "$RELEASE_URL"
expected_sha = "$EXPECTED_SHA256"
lib_dest = "$LIB_DEST"
headers_base = "$SCRIPT_DIR/apps/android/app/src/main/cpp"

class RemoteZipFile(io.RawIOBase):
    def __init__(self, u):
        self.url = u
        req = urllib.request.Request(u, method="HEAD")
        with urllib.request.urlopen(req) as resp:
            self.final_url = resp.url
            self.size = int(resp.headers["Content-Length"])
        self.pos = 0

    def seek(self, offset, whence=io.SEEK_SET):
        if whence == io.SEEK_SET: self.pos = offset
        elif whence == io.SEEK_CUR: self.pos += offset
        elif whence == io.SEEK_END: self.pos = self.size + offset
        return self.pos

    def tell(self): return self.pos

    def read(self, size=-1):
        if size == -1 or self.pos + size > self.size:
            size = self.size - self.pos
        if size <= 0: return b""
        req = urllib.request.Request(self.final_url, headers={"Range": f"bytes={self.pos}-{self.pos+size-1}"})
        with urllib.request.urlopen(req) as r:
            data = r.read()
        self.pos += len(data)
        return data

print("Conectando ao release asset em:", url)
rzf = RemoteZipFile(url)

with zipfile.ZipFile(rzf) as z:
    # 1. Extrai libnode.so para arm64-v8a
    print("Extraindo bin/arm64-v8a/libnode.so...")
    hasher = hashlib.sha256()
    with z.open("bin/arm64-v8a/libnode.so") as src, open(lib_dest, "wb") as dst:
        while chunk := src.read(1024 * 1024):
            hasher.update(chunk)
            dst.write(chunk)

    sha = hasher.hexdigest()
    if sha != expected_sha:
        print(f"ERRO: SHA256 divergente: {sha} != {expected_sha}", file=sys.stderr)
        sys.exit(1)
    print("libnode.so extraído e validado com sucesso!")

    # 2. Extrai cabeçalhos include/node se ainda não existirem
    if not os.path.exists("$HEADERS_DEST"):
        print("Extraindo cabeçalhos C++ para apps/android/app/src/main/cpp/include...")
        for name in z.namelist():
            if name.startswith("include/"):
                tpath = os.path.join(headers_base, name)
                if name.endswith("/"):
                    os.makedirs(tpath, exist_ok=True)
                else:
                    os.makedirs(os.path.dirname(tpath), exist_ok=True)
                    with z.open(name) as src, open(tpath, "wb") as dst:
                        dst.write(src.read())
EOF

echo ""
echo "[OK] Runtime Node.js nativo pronto em: $LIB_DEST"
echo ""
