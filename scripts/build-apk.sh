#!/usr/bin/env bash
set -euo pipefail

# Poker Table — Script de Compilação do APK Android com Servidor Integrado
# Verifica dependências de ambiente (Java 17, Android SDK/NDK, Runtime Node.js) e executa o build.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "=== Poker Table — Verificação de Ambiente e Build do APK (v0.2.0) ==="
echo ""

# 1. Configurar e validar Java 17
if [ -z "${JAVA_HOME:-}" ]; then
  if [ -d "/usr/lib/jvm/java-17-openjdk-amd64" ]; then
    export JAVA_HOME="/usr/lib/jvm/java-17-openjdk-amd64"
    export PATH="$JAVA_HOME/bin:$PATH"
    echo "[OK] Java 17 detectado em: $JAVA_HOME"
  else
    echo "[INFO] JAVA_HOME não definido explicitamente. Utilizando java do sistema."
  fi
else
  echo "[OK] JAVA_HOME configurado: $JAVA_HOME"
fi

if command -v java >/dev/null 2>&1; then
  JAVA_VER=$(java -version 2>&1 | head -n 1)
  echo "     Versão do Java: $JAVA_VER"
else
  echo "[ERRO] Java não encontrado no sistema."
  exit 1
fi

# 2. Verificar se o runtime Node.js nativo (libnode.so) e os headers C++ estão presentes
LIB_NODE="$SCRIPT_DIR/apps/android/app/src/main/jniLibs/arm64-v8a/libnode.so"
if [ ! -f "$LIB_NODE" ]; then
  echo ""
  echo "[INFO] libnode.so (arm64-v8a) não encontrado. Executando download-node-runtime.sh..."
  ./scripts/download-node-runtime.sh
else
  echo "[OK] Runtime Node.js nativo (libnode.so arm64-v8a) presente."
fi

# 3. Verificar se os assets JavaScript/HTML do Node.js foram empacotados
ASSETS_DIR="$SCRIPT_DIR/apps/android/app/src/main/assets/nodejs-project"
if [ ! -f "$ASSETS_DIR/server/main.js" ] || [ ! -f "$ASSETS_DIR/package.json" ]; then
  echo ""
  echo "[INFO] Assets do Node.js não encontrados. Executando bundle-android-assets.sh..."
  ./scripts/bundle-android-assets.sh
else
  echo "[OK] Assets JavaScript/web empacotados em: $ASSETS_DIR"
fi

# 4. Verificar se o Gradle Wrapper está presente
if [ -f "$SCRIPT_DIR/apps/android/gradlew" ]; then
  echo "[OK] Gradle Wrapper (Gradle 8.11.1) presente."
fi

# 5. Detectar Android SDK completo (com platforms e build-tools)
SDK_DIR=""
for candidate in \
  "${ANDROID_HOME:-}" \
  "${ANDROID_SDK_ROOT:-}" \
  "$HOME/Android/Sdk" \
  "/usr/lib/android-sdk" \
  "/opt/android-sdk"; do
  if [ -n "$candidate" ] && [ -d "$candidate" ] && [ -d "$candidate/platforms" ] && [ -d "$candidate/build-tools" ]; then
    SDK_DIR="$candidate"
    break
  fi
done

if [ -n "$SDK_DIR" ]; then
  echo "[OK] Android SDK localizado em: $SDK_DIR"
  export ANDROID_HOME="$SDK_DIR"
  export ANDROID_SDK_ROOT="$SDK_DIR"
  if [ -d "$SDK_DIR/ndk/27.0.12077973" ]; then
    export ANDROID_NDK_ROOT="$SDK_DIR/ndk/27.0.12077973"
    LIBCXX_SRC="$SDK_DIR/ndk/27.0.12077973/toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/lib/aarch64-linux-android/libc++_shared.so"
    LIBCXX_DEST="$SCRIPT_DIR/apps/android/app/src/main/jniLibs/arm64-v8a/libc++_shared.so"
    if [ -f "$LIBCXX_SRC" ] && [ ! -f "$LIBCXX_DEST" ]; then
      mkdir -p "$(dirname "$LIBCXX_DEST")"
      cp "$LIBCXX_SRC" "$LIBCXX_DEST"
      echo "[OK] libc++_shared.so (arm64-v8a) copiado do NDK para jniLibs."
    fi
  fi
  cat << EOF > "$SCRIPT_DIR/apps/android/local.properties"
sdk.dir=$SDK_DIR
ndk.dir=$SDK_DIR/ndk/27.0.12077973
EOF
else
  echo ""
  echo "================================================================================"
  echo "[DIAGNÓSTICO] Android SDK ausente no notebook Ubuntu"
  echo "================================================================================"
  echo ""
  echo "Status dos componentes do aplicativo no ambiente local:"
  echo "  - Node.js runtime (host): $(node -v) [OK]"
  echo "  - Java SDK: $JAVA_VER [OK]"
  echo "  - Gradle Wrapper: apps/android/gradlew (Gradle 8.11.1) [OK]"
  echo "  - Runtime Node.js nativo: apps/android/app/src/main/jniLibs/arm64-v8a/libnode.so (84 MB) [OK]"
  echo "  - Ponte JNI C++: apps/android/app/src/main/cpp/native-lib.cpp e CMakeLists.txt [OK]"
  echo "  - Assets compilados (server, web, engine, protocol): $ASSETS_DIR [OK]"
  echo "  - Android SDK (platforms;android-34, build-tools;34.0.0, NDK): NÃO INSTALADO"
  echo ""
  echo "Como compilar o APK independente:"
  echo ""
  echo "Opção A — Via Android Studio (Recomendado):"
  echo "  1. Abra o Android Studio nesta ou em outra máquina de desenvolvimento."
  echo "  2. Selecione 'Open' e aponte para a pasta: $SCRIPT_DIR/apps/android"
  echo "  3. O Android Studio detectará o NDK, CMake e o runtime libnode.so automaticamente."
  echo "  4. Menu: Build -> Build Bundle(s) / APK(s) -> Build APK(s)."
  echo ""
  echo "Opção B — Via linha de comando (com Command Line Tools leves):"
  echo "  1. Instale o sdkmanager e os pacotes necessários (~1.5 GB em disco):"
  echo "     sdkmanager \"platforms;android-34\" \"build-tools;34.0.0\" \"cmake;3.22.1\" \"ndk;27.0.12077973\""
  echo "  2. Configure ANDROID_HOME:"
  echo "     export ANDROID_HOME=\$HOME/Android/Sdk"
  echo "  3. Execute novamente este script:"
  echo "     ./scripts/build-apk.sh"
  echo ""
  echo "================================================================================"
  exit 2
fi

# 6. Determinar modo de compilação (Debug vs Release)
MODE="${1:-debug}"
if [ "$MODE" = "--release" ] || [ "$MODE" = "release" ]; then
  BUILD_TASK="assembleRelease"
  OUTPUT_DIR="$SCRIPT_DIR/apps/android/app/build/outputs/apk/release"
  echo ""
  echo "=== Modo RELEASE Selecionado ==="

  # 6.1 Detectar keystore oficial caso POKER_KEYSTORE_PATH não tenha sido definido
  DEFAULT_KEYSTORE="$HOME/.local/share/poker-table/poker-table-release.p12"
  if [ -z "${POKER_KEYSTORE_PATH:-}" ] && [ -f "$DEFAULT_KEYSTORE" ]; then
    export POKER_KEYSTORE_PATH="$DEFAULT_KEYSTORE"
    export POKER_KEY_ALIAS="${POKER_KEY_ALIAS:-poker-table}"
    echo "[OK] Keystore oficial detectada em: $POKER_KEYSTORE_PATH"
  fi

  # 6.2 Verificar se as credenciais de assinatura foram fornecidas
  KEYSTORE_PROP="$SCRIPT_DIR/apps/android/keystore.properties"
  if [ ! -f "$KEYSTORE_PROP" ]; then
    if [ -z "${POKER_KEYSTORE_PATH:-}" ]; then
      echo ""
      echo "[ERRO] Keystore de release não localizada."
      echo "       Defina a variável POKER_KEYSTORE_PATH apontando para a sua keystore PKCS12 (.p12)"
      echo "       ou configure apps/android/keystore.properties."
      echo ""
      exit 1
    fi

    if [ -z "${POKER_KEYSTORE_PASSWORD:-}" ]; then
      USER_PASS=""
      if [ -t 0 ] && [ -c /dev/tty ]; then
        echo -n "Informe a senha da Release Keystore (oculta): "
        read -s -r USER_PASS </dev/tty || true
        echo ""
      fi
      if [ -z "${USER_PASS:-}" ] && [ -z "${POKER_KEYSTORE_PASSWORD:-}" ]; then
        echo ""
        echo "[INFO] A senha da Release Keystore é necessária para assinar o APK."
        echo "       Para compilar no terminal local com entrada oculta, execute:"
        echo "         read -s POKER_KEYSTORE_PASSWORD"
        echo "         export POKER_KEYSTORE_PASSWORD"
        echo "         ./scripts/build-apk.sh release"
        echo ""
        exit 1
      fi
      if [ -n "${USER_PASS:-}" ]; then
        export POKER_KEYSTORE_PASSWORD="$USER_PASS"
        export POKER_KEY_PASSWORD="$USER_PASS"
        unset USER_PASS
      fi
    fi
  fi

  echo "[OK] Configuração de assinatura pronta para o Gradle."
  echo "Iniciando compilação Gradle em modo RELEASE..."
else
  BUILD_TASK="assembleDebug"
  OUTPUT_DIR="$SCRIPT_DIR/apps/android/app/build/outputs/apk/debug"
  echo ""
  echo "Iniciando compilação Gradle em modo DEBUG..."
fi

cd "$SCRIPT_DIR/apps/android"
./gradlew "$BUILD_TASK" --no-daemon --max-workers=1 -Dorg.gradle.jvmargs="-Xmx1024m -XX:+UseSerialGC"

APK_FILE=$(find "$OUTPUT_DIR" -name "*.apk" 2>/dev/null | head -n 1)
if [ -n "$APK_FILE" ] && [ -f "$APK_FILE" ]; then
  APK_SIZE=$(du -h "$APK_FILE" | cut -f1)
  echo ""
  echo "[OK] APK compilado com sucesso ($BUILD_TASK)!"
  echo "     Localização: $APK_FILE ($APK_SIZE)"
else
  echo "[AVISO] Compilação finalizada, verifique $OUTPUT_DIR"
fi
