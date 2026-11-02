# Poker Table — Etapa 5B.2: Integração Real do Node.js ao APK

**Data**: Novembro de 2026
**Status**: Concluído (Runtime nativo Node.js 24 FULL integrado com ponte JNI e ciclo de vida isolado)
**Versão Base**: v0.1.0

---

## 1. Auditoria da Implementação da Etapa 5B.1

Em atendimento à auditoria obrigatória solicitada na Etapa 5B.2, examinamos detalhadamente todos os arquivos da Etapa 5B.1:

1. **Existe um runtime Node.js nativo incorporado ao projeto?**
   *Resposta*: **Não**. Na Etapa 5B.1, havia apenas a extração dos scripts JavaScript compilados para `filesDir/nodejs-project`, sem qualquer binário de runtime Node.js incorporado.
2. **Existe um `libnode.so` real para `arm64-v8a`?**
   *Resposta*: **Não**. Nenhum arquivo `libnode.so` estava presente no repositório ou no projeto Android.
3. **Existe uma ponte JNI funcional entre Kotlin e Node.js?**
   *Resposta*: **Não**. Não havia métodos nativos `external fun` em Kotlin nem funções JNI C/C++ implementadas.
4. **Existe código C/C++ que inicializa o runtime?**
   *Resposta*: **Não**. Não havia diretório `cpp`, arquivo `CMakeLists.txt` ou código C++.
5. **O Gradle está configurado para compilar essa ponte e incluir as bibliotecas nativas no APK?**
   *Resposta*: **Não**. O arquivo `build.gradle.kts` continha apenas `abiFilters`, sem o bloco `externalNativeBuild` (CMake) ou configuração de `sourceSets` para `jniLibs`.
6. **O método de inicialização do `NodeRunner.kt` realmente executa o Node.js ou depende de alguma implementação ausente?**
   *Resposta*: **Não executava**. O código tentava invocar `ProcessBuilder` passando o caminho de uma suposta biblioteca `.so`, o que no Android resulta em falha de execução (`ENOEXEC` / `EACCES`), pois bibliotecas compartilhadas não são executáveis de terminal. O fallback chamava o comando `node` do sistema, inexistente no Android fora do Termux.
7. **O projeto possui todos os arquivos necessários do Gradle Wrapper?**
   *Resposta*: **Incompleto**. Existia apenas `gradle-wrapper.properties`. Faltavam o script de execução `gradlew` e o binário `gradle-wrapper.jar`.

---

## 2. Integração do Runtime Nativo Node.js 24 (FULL)

### 2.1. Procedência e Licenciamento
- **Origem**: Distribuição oficial de compilação móvel do projeto `fogtape/nodejs-mobile` (tag `v24.21.0-0`, versão LTS do Node.js 24).
- **Linhagem**: O projeto é uma receita de compilação autônoma que puxa o código-fonte oficial do `nodejs/node` (v24.21.0) e aplica os patches móveis desenvolvidos pelo consórcio `digidem/nodejs-mobile` e `Janea Systems`.
- **Licença**: MIT Permissiva (tanto para o Node.js quanto para os patches móveis).
- **Variante**: **FULL** (não foi utilizada a versão *Lite*).
- **Verificação do módulo `node:sqlite`**: Inspecionamos a tabela de símbolos e strings do binário `libnode.so` extraído, confirmando a presença de:
  - Módulo nativo: `node:sqlite`
  - Funções SQLite C: `sqlite3_open_v2`, `sqlite3_prepare_v2`, `sqlite3_step`, etc.
  - Símbolo de inicialização: `_ZN4node5StartEiPPc` (`node::Start(int argc, char** argv)`).
- **Soma de verificação SHA256 do binário `libnode.so` (arm64-v8a)**:
  `955b308b1dfdf7662e8fe5ee4eb8c0c7d0a313f2d306387f2307529993c4bc32`
  Tamanho: 87.657.320 bytes (83,6 MB descomprimido / ~24,8 MB comprimido dentro do APK).
- **Compatibilidade**: Total compatibilidade com processadores 64-bit ARMv8 (incluindo o Qualcomm Snapdragon 680 do Xiaomi Redmi Note 11) e Android API 24+.

### 2.2. Script Automatizado de Obtenção do Runtime
Foi criado o script [`scripts/download-node-runtime.sh`](file:///home/theo-enderson/Projetos/poker-table/scripts/download-node-runtime.sh):
- Baixa via requisição HTTP Range o binário `libnode.so` para `arm64-v8a` e os cabeçalhos C++ (`node.h`, `v8.h`, `uv.h`) sem clonar nem compilar o Node.js inteiro a partir do zero no notebook.
- Valida o hash SHA256 antes da instalação em `apps/android/app/src/main/jniLibs/arm64-v8a/libnode.so`.
- O diretório `jniLibs` foi adicionado ao `.gitignore` para evitar poluir o histórico Git com binários de 84 MB.

---

## 3. Implementação da Inicialização Real e Ponte JNI

### 3.1. Ponte JNI C++ (`native-lib.cpp` e `CMakeLists.txt`)
- Criado `apps/android/app/src/main/cpp/CMakeLists.txt` configurando a biblioteca compartilhada importada `libnode.so` e a biblioteca de ponte `poker-native`.
- Criado `apps/android/app/src/main/cpp/native-lib.cpp`:
  - Implementa a função JNI `Java_com_pokertable_NodeBridge_startNodeWithArguments`.
  - Redireciona os descritores de arquivo `stdout` e `stderr` do processo C para o Android Logcat sob a tag `"NodeJS"`, permitindo que `console.log()` e `console.error()` apareçam diretamente no `adb logcat`.
  - Invoca `node::Start(argc, argv)` no thread de segundo plano.

### 3.2. Configuração de Ambiente POSIX (`NodeRunner.kt`)
- Como o Node.js depende das variáveis de ambiente do processo para identificar portas e caminhos, o `NodeRunner.kt` utiliza a API nativa Android `android.system.Os.setenv`:
  - `PORT=3000`
  - `HOST=0.0.0.0`
  - `NODE_ENV=production`
  - `DATABASE_PATH=/data/user/0/com.pokertable/files/data/poker-table.sqlite`
  - `WEB_DIRECTORY=/data/user/0/com.pokertable/files/nodejs-project/web`
  - `LAN_IP=<IP_SELECIONADO>`
- Altera o diretório de trabalho do processo para `context.filesDir/nodejs-project` via `Os.chdir()`.
- Dispara thread paralela de monitoramento que verifica a prontidão do endpoint HTTP `/health`.

### 3.3. Ciclo de Vida e Limitação de Instância Única do V8
- **Limitação**: O runtime Node.js/V8 não permite ser finalizado e re-inicializado de forma limpa no mesmo processo de sistema operacional sem risco de falha de asserção (*assertion error*) ou `SIGSEGV`.
- **Solução Implementada**:
  - O serviço `PokerTableService` executa no processo isolado `android:process=":server"`.
  - Ao parar o servidor (`ACTION_STOP` ou encerramento da partida), o serviço libera o `WakeLock`, remove a notificação persistente e finaliza o processo `:server` via `android.os.Process.killProcess(android.os.Process.myPid())`.
  - A interface nativa e a `MainActivity` rodam no processo principal da aplicação e **não sofrem nenhuma interrupção**.
  - Quando o usuário decide criar ou hospedar uma nova mesa, o Android instancia um processo `:server` totalmente novo e limpo, onde o Node.js inicia sem conflitos.

---

## 4. Gradle Wrapper e Configuração de Compilação

1. **Gradle Wrapper**:
   - Foram instalados `apps/android/gradlew` e `apps/android/gradle/wrapper/gradle-wrapper.jar` oficiais para Gradle 8.11.1.
   - O comando `./gradlew -v` foi executado e validado no notebook com Java 17 (`OpenJDK 17.0.20.1`).
2. **Configuração do Módulo App (`apps/android/app/build.gradle.kts`)**:
   - Adicionado `externalNativeBuild { cmake { path = file("src/main/cpp/CMakeLists.txt"); version = "3.22.1" } }`.
   - Adicionado `sourceSets { getByName("main") { jniLibs.srcDirs("src/main/jniLibs") } }`.

---

## 5. Diagnóstico do Ambiente do Notebook e Instruções de Build

O script [`scripts/build-apk.sh`](file:///home/theo-enderson/Projetos/poker-table/scripts/build-apk.sh) inspeciona os pré-requisitos:
- **Node.js (Host)**: `v22.22.1` [OK]
- **Java SDK**: `OpenJDK 17.0.20.1` em `/usr/lib/jvm/java-17-openjdk-amd64` [OK]
- **Gradle Wrapper**: `Gradle 8.11.1` [OK]
- **Assets de Produção**: `apps/android/app/src/main/assets/nodejs-project` (20 MB) [OK]
- **Runtime Nativo**: `apps/android/app/src/main/jniLibs/arm64-v8a/libnode.so` (84 MB, Node.js 24 FULL) [OK]
- **Ponte JNI C++**: `apps/android/app/src/main/cpp/native-lib.cpp` e `CMakeLists.txt` [OK]
- **Android SDK / NDK**: Não instalados neste notebook Ubuntu.

### Como gerar o arquivo APK:
- **Opção A — Via Android Studio (Recomendado)**:
  1. Abrir o Android Studio.
  2. Selecionar `Open` e apontar para a pasta: `apps/android`.
  3. O Android Studio detectará o NDK, CMake e o runtime `libnode.so`.
  4. Executar: `Build -> Build Bundle(s) / APK(s) -> Build APK(s)`.
- **Opção B — Via Linha de Comando (com ferramentas enxutas do SDK)**:
  1. Instalar as ferramentas de linha de comando (`~1.5 GB` de espaço em disco):
     ```bash
     sdkmanager "platforms;android-34" "build-tools;34.0.0" "cmake;3.22.1" "ndk;27.0.12077973"
     ```
  2. Exportar o caminho:
     ```bash
     export ANDROID_HOME=$HOME/Android/Sdk
     ```
  3. Executar o script de build:
     ```bash
     ./scripts/build-apk.sh
     ```

## 6. Resolução dos Problemas da Primeira Compilação

Durante a primeira execução real de `./scripts/build-apk.sh` com o Android SDK e NDK instalados, foram identificadas e corrigidas duas falhas:

### 6.1. Restrição Estrita à Arquitetura `arm64-v8a`
- **Causa**: O `build.gradle.kts` mantinha `x86_64` nos filtros de ABI, fazendo o CMake tentar compilar a ponte para x86_64 e falhar pela ausência de `jniLibs/x86_64/libnode.so`.
- **Correção**: Configurado `abiFilters.clear()` e `abiFilters.add("arm64-v8a")` tanto no bloco `defaultConfig.ndk` quanto no bloco `defaultConfig.externalNativeBuild.cmake`. O CMake passou a processar exclusivamente a arquitetura `arm64-v8a` (alvo do Redmi Note 11).

### 6.2. Correção de Tipagem e Remoção de `Os.chdir` no Kotlin
- **Causa**: O método `android.system.Os.chdir` não existe como API pública no Android SDK, gerando erro de símbolo não resolvido e quebrando a inferência de tipo do `runCatching`.
- **Correção**:
  - Remoção de `Os.chdir` do código Kotlin, substituindo o bloco por `try/catch` com tipagem explícita.
  - Utilização estrita de caminhos absolutos nas variáveis de ambiente (`DATABASE_PATH`, `WEB_DIRECTORY`) e no script de inicialização do Node.js.
  - Implementação segura da função JNI `NodeBridge.changeWorkingDirectory(path)` em C++ via POSIX `chdir()` com tratamento de `errno`, operando estritamente no processo isolado `:server`.

---

## 7. Verificações do APK Gerado

A compilação do APK de debug foi concluída com sucesso via Gradle 8.11.1 e NDK 27:
- **Localização**: `apps/android/app/build/outputs/apk/debug/app-debug.apk`
- **Tamanho**: `74 MB` (77.404.160 bytes)
- **Bibliotecas nativas contidas**:
  - `lib/arm64-v8a/libnode.so` (65.303.672 bytes)
  - `lib/arm64-v8a/libpoker-native.so` (1.154.448 bytes)
- **Assets empacotados**:
  - Servidor: `assets/nodejs-project/server/main.js`
  - Frontend React: `assets/nodejs-project/web/index.html` e `dist/assets/*`
  - Dependências de produção: `express`, `socket.io`, `zod`, `@poker-table/engine`, `@poker-table/protocol`
- **Assinatura**: Validada com `apksigner verify` (esquema APK Signature Scheme v2 ativo).
- **Compatibilidade**: `minSdkVersion: 26` (Android 8.0+), `targetSdkVersion: 34` (Android 14), `native-code: arm64-v8a` (SoC Qualcomm Snapdragon 680 do Redmi Note 11).

---

## 8. Resultados dos Testes

- `npm run lint`: **0 erros, 0 avisos** (aprovado).
- `npm run build`: **Compilação TypeScript e bundle Vite aprovados**.
- `npx vitest run --maxWorkers=1 --no-file-parallelism`: **485 testes aprovados** em 23 arquivos de teste.
- `npx playwright test --workers=1`: **19 testes E2E aprovados** (37.9s).
- `./scripts/build-apk.sh`: **BUILD SUCCESSFUL** (código 0, APK gerado em 54s).
- `apksigner verify`: **Aprovado** (v2 scheme verificado).
- `git diff --check`: **Aprovado** (limpo).

---

## 9. Resolução de Inicialização Real no Android (libc++_shared.so e Remoção de Fallback)

### 9.1 Diagnóstico do Erro Real via Logcat
Ao iniciar a criação da mesa no Xiaomi Redmi Note 11, o Logcat reportou:
```text
PokerTable:NodeBridge: java.lang.UnsatisfiedLinkError: dlopen failed: library "libc++_shared.so" not found: needed by .../lib/arm64-v8a/libnode.so
```
Seguido pelo erro colateral:
```text
Cannot run program "node" error=13, Permission denied
```
- **Causa raiz:** O runtime Node.js nativo (`libnode.so`) possui dependência dinâmica explícita com `libc++_shared.so`. Como o módulo CMake nativo não havia declarado `-DANDROID_STL=c++_shared`, o AGP não incluiu a biblioteca C++ compartilhada do NDK no pacote APK.
- **Causa colateral:** O `NodeRunner.kt` continha uma tentativa de fallback de executar `ProcessBuilder("node")`, que gerava uma mensagem espúria de permissão negada em vez de reportar o erro real de link do JNI.

### 9.2 Alterações Implementadas
1. **Inclusão da `libc++_shared.so`:**
   - Adicionado `-DANDROID_STL=c++_shared` nos argumentos do CMake em `apps/android/app/build.gradle.kts`.
   - Adicionada regra `packaging.jniLibs.pickFirsts += "**/libc++_shared.so"`.
   - Automatizada a cópia da biblioteca do NDK 27 (`usr/lib/aarch64-linux-android/libc++_shared.so`) para `jniLibs/arm64-v8a/` no `scripts/build-apk.sh`.
2. **Ordem de carregamento JNI em `NodeBridge.kt`:**
   - Carrega explicitamente `System.loadLibrary("c++_shared")` antes de `libnode` e `libpoker-native`.
   - Captura e preserva a exceção exata (`loadError: Throwable?`) via `getLoadError()`.
3. **Remoção de fallback espúrio em `NodeRunner.kt`:**
   - Verificação direta de `!NodeBridge.isNativeLoaded()`, abortando com log detalhado e retornando `onReady(false)` sem mascarar a falha com tentativas externas.
4. **Verificação das bibliotecas no APK:**
   - `lib/arm64-v8a/libc++_shared.so` (1.292.896 bytes)
   - `lib/arm64-v8a/libnode.so` (65.303.672 bytes)
   - `lib/arm64-v8a/libpoker-native.so` (62.400 bytes)
5. **Instalação no dispositivo físico:**
   - Instalado diretamente no Xiaomi Redmi Note 11 conectado via `adb -s 1ac9e1f0 install -r -t apps/android/app/build/outputs/apk/debug/app-debug.apk` com status `Success`.
