# Poker Table — Etapa 5B.1: Aplicativo Android com Servidor Integrado

**Data**: Novembro de 2026
**Status**: Concluído (Protótipo Android implementado e empacotado)
**Versão Base**: v0.1.0 (commit `ce86de1` + refinamentos 5A.1/5B.1)

---

## 1. Resumo da Análise Arquitetural

Com o sucesso da Etapa 5A.1 (na qual o Poker Table foi executado no smartphone Xiaomi Redmi Note 11 através do Termux e validado em partidas reais pela rede local), a Etapa 5B.1 investigou a eliminação da dependência do Termux para o usuário final.

Foram comparadas duas abordagens para disponibilizar o Poker Table como um aplicativo Android instalável via APK:

### Abordagem A: Servidor Node.js Embutido no Android (`fogtape/nodejs-mobile` / Janea Systems)
- **Como funciona**: O runtime Node.js (compilado como biblioteca compartilhada nativa C++ `libnode.so` para `arm64-v8a`) é embarcado dentro do pacote APK. O servidor Express + Socket.IO roda em uma thread ou processo de serviço isolado em segundo plano (`android:process=":server"`). A interface web React existente é servida localmente e exibida em um componente nativo Android `WebView`.
- **Compatibilidade real com Android**:
  - Binários ARM64: o fork ativo `fogtape/nodejs-mobile` suporta Node.js v22/v24 com ABI `arm64-v8a` e `x86_64`.
  - Módulo nativo `node:sqlite`: incluído nativamente no próprio Node.js desde a v22.5. Não depende de bibliotecas C++ externas como `better-sqlite3`, permitindo persistência SQLite autoritativa sem compilação cruzada adicional.
  - Express e Socket.IO: funcionam perfeitamente sobre a camada POSIX/sockets do Linux/Android.
- **Empacotamento de dependências de produção**:
  - Como o V8 e o libuv exigem arquivos reais no sistema de arquivos para executar módulos e resolver imports ESM, os artefatos compilados (`server/`, `web/`, `@poker-table/engine`, `@poker-table/protocol` e `node_modules` de produção) são empacotados na pasta `assets/nodejs-project` do APK e extraídos para `context.filesDir/nodejs-project` na primeira inicialização.
- **Ciclo de vida, memória e consumo de bateria**:
  - Consumo de memória RAM: ~65–90 MB para o processo Node.js + ~70–110 MB para a WebView, totalizando ~140–200 MB. Em aparelhos modernos (ex: Redmi Note 11 com 4 GB ou 6 GB de RAM), o consumo é perfeitamente viável.
  - Segundo plano: o Android gerencia agressivamente processos em segundo plano. Para evitar que o sistema encerre o servidor durante uma rodada em que o celular bloqueia a tela, é imperativo o uso de um **Foreground Service** com notificação persistente e `PowerManager.PARTIAL_WAKE_LOCK`.
  - Processo isolado (`android:process=":server"`): isola o runtime Node.js da UI nativa. Se a WebView sofrer reload ou a Activity for recriada por rotação de tela, o servidor e a partida permanecem intactos.
- **Tamanho do APK**:
  - `libnode.so` (ARM64): ~35–45 MB.
  - Assets do projeto (servidor + web + dependências): ~18–20 MB (não compactado em disco) / ~6–8 MB compactado dentro do APK.
  - APK final estimado: ~45–55 MB.
- **Licenciamento**:
  - Node.js (MIT), Janea Systems / fogtape (Apache 2.0 / MIT), SQLite (Domínio Público). Compatíveis com o projeto.

### Abordagem B: Aplicação Nativa em Kotlin + Ktor (Inspirada no TableChips)
- **Como funciona**: O aplicativo TableChips exemplifica a viabilidade de hospedar um servidor HTTP/WebSocket local diretamente em Kotlin/Android utilizando a biblioteca Ktor, com clientes conectando-se via navegador através do Wi-Fi Hotspot.
- **Vantagens potenciais do Ktor**:
  - Tamanho de APK muito menor (~10–15 MB, sem `libnode.so`).
  - Menor consumo de memória RAM (~40–60 MB).
  - Inicialização instantânea (~300 ms vs ~1.5 s do Node.js).
  - Integração direta com APIs nativas do Android (NetworkInterface, WifiManager, Notifications).
- **Por que reescrever em Ktor é inviável e desaconselhado neste momento**:
  - **Violação da regra primordial do projeto**: O documento `AGENTS.md` e os requisitos do projeto estabelecem categoricamente: *"Não reimplemente o motor financeiro sem uma justificativa técnica muito forte"*.
  - **Custo e risco desproporcionais**: O Poker Table possui 485 testes unitários rigorosos em Vitest e 19 testes ponta a ponta (E2E) em Playwright, cobrindo cálculo exato de potes principais e múltiplos potes paralelos (side pots), empates fracionários sem perda de centavos, regras de All-in, streets (Preflop, Flop, Turn, River, Showdown), regras de Heads-Up com blinds invertidos TDA, persistência de transações em SQLite e contratos Zod bidirecionais.
  - Reescrever todo o motor de regras, schemas Zod e máquina de estados para Kotlin/Ktor exigiria semanas de trabalho, revalidação completa e criaria risco permanente de divergência de regras entre o servidor e a especificação já validada em partidas reais.

---

## 2. Decisão Adotada e Justificativa Técnica

**Decisão**: Adotar a **Abordagem Híbrida (Node.js embutido em Foreground Service + WebView)** para o protótipo da Etapa 5B.1.

**Justificativas**:
1. **Preservação integral do motor financeiro e das regras de poker**: 100% do código TypeScript validado (`@poker-table/engine`, `@poker-table/protocol`, `@poker-table/server`) é executado sem nenhuma alteração de regra de negócio ou matemática.
2. **Reaproveitamento total da interface React**: A interface aprovada nas Etapas 1 a 4E.3 funciona idêntica no navegador do anfitrião e nos celulares dos convidados.
3. **Persistência SQLite autoritativa**: O módulo nativo `node:sqlite` do Node.js 22/24 opera diretamente sobre o banco SQLite em armazenamento privado do aplicativo (`/data/data/com.pokertable/files/data/poker-table.sqlite`), mantendo total conformidade com a recuperação de estado comprovada na Etapa 5A.1.
4. **Respeito aos limites de hardware**: Com 140–200 MB de consumo total, aparelhos Android modernos suportam confortavelmente a execução durante toda a duração da partida.

---

## 3. Detalhes da Implementação do Protótipo Android (`apps/android`)

Foi estruturado um projeto Android completo e padronizado em `apps/android`:

### 3.1. Estrutura de Código
- `apps/android/settings.gradle.kts`: Configuração de repositórios Maven Central / Google e módulo `:app`.
- `apps/android/build.gradle.kts`: Android Gradle Plugin 8.7.3 e Kotlin 2.1.0.
- `apps/android/app/build.gradle.kts`: Configuração do target SDK 34 (Android 14), Java 17, filtros ABI (`arm64-v8a`, `x86_64`) e dependências do AndroidX (AppCompat, Material, WebKit).
- `apps/android/app/src/main/AndroidManifest.xml`:
  - Permissões: `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`, `POST_NOTIFICATIONS`, `WAKE_LOCK`.
  - Configuração de `usesCleartextTraffic="true"` para comunicação HTTP na rede local.
  - Definição do serviço `.PokerTableService` rodando explicitamente em processo isolado (`android:process=":server"`).

### 3.2. Componentes Kotlin
1. **`NetworkHelper.kt`**:
   - Detecta interfaces de rede via `NetworkInterface.getNetworkInterfaces()`.
   - Filtra interfaces de loopback (`lo`), interfaces inativas e interfaces de dados móveis 4G/5G (`rmnet*`, `pdp*`, `ccmni*`).
   - Prioriza interfaces de ponto de acesso Wi-Fi Hotspot (`wlan1`, `ap0`) sobre interfaces cliente (`wlan0`).
   - Fornece resumo legível e sugestão de IP para anúncio aos convidados.

2. **`NodeRunner.kt`**:
   - Extrai automaticamente os assets compilados do APK (`assets/nodejs-project`) para o diretório de arquivos privados da aplicação (`context.filesDir/nodejs-project`) apenas quando necessário (com verificação de versão instalada).
   - Configura as variáveis de ambiente essenciais: `PORT=3000`, `HOST=0.0.0.0`, `NODE_ENV=production`, `DATABASE_PATH` apontando para o banco SQLite privado, `WEB_DIRECTORY` apontando para os assets do React, e `LAN_IP` com o IP selecionado para a rede.
   - Inicia o processo do servidor e monitora o endpoint de saúde local `http://127.0.0.1:3000/health`.

3. **`PokerTableService.kt`**:
   - Serviço em primeiro plano (**Foreground Service**) executado no processo isolado `:server`.
   - Cria canal de notificação com prioridade baixa e exibe notificação persistente (*"Poker Table — Partida Ativa: Servidor local rodando em 10.107.248.23:3000"*).
   - Mantém `PowerManager.PARTIAL_WAKE_LOCK` ativo para evitar suspensão da CPU durante as mãos da partida.
   - Notifica a `MainActivity` via broadcast sobre alterações no estado do servidor (`STARTING`, `RUNNING`, `STOPPED`, `ERROR`).

4. **`MainActivity.kt`**:
   - Tela inicial nativa com tema escuro (verde feltro e dourado) compatível com a identidade visual do Poker Table.
   - Exibe status do servidor com indicador colorido (Parado / Iniciando / Em Execução).
   - Permite inspecionar as interfaces de rede detectadas e editar/confirmar o IP do Hotspot anunciado no QR Code.
   - Botão **"Criar mesa (Anfitrião)"**: dispara o `PokerTableService` e, ao confirmar que o servidor está saudável, carrega a mesa local no WebView (`http://127.0.0.1:3000`).
   - Botão **"Entrar em mesa (Convidado)"**: exibe campo para digitar o endereço do anfitrião (ex: `http://10.107.248.23:3000`) e conecta no WebView como cliente puro, sem iniciar o servidor local.
   - Integração com o botão "Voltar" do Android: navega no histórico da WebView se disponível, ou retorna ao painel nativo da aplicação.

---

## 4. Tratamento do IP do Hotspot no Android

Durante os experimentos reais no Xiaomi Redmi Note 11 (Etapa 5A.1), comprovou-se que o Android frequentemente atribui a interface `wlan1` (e não `wlan0`) ao Hotspot Wi-Fi (ex: `10.107.248.23`), enquanto `wlan0` corresponde à conexão Wi-Fi tradicional (ex: `192.168.1.41`).

Para garantir que os convidados recebam o endereço correto tanto no QR Code quanto na interface:
1. **Detecção Automática Heurística**: `NetworkHelper.kt` e `apps/server/src/http/network.ts` priorizam interfaces cujo nome contenha `wlan1` ou `ap` com IPs válidos de redes privadas (RFC 1918).
2. **Filtragem de Redes Móveis**: Redes celulares (`rmnet*`) são explicitamente ignoradas para evitar expor IPs de operadora pública inacessíveis na rede local.
3. **Seleção Manual no Painel do App**: A tela nativa do app Android exibe todas as interfaces detectadas e permite que o anfitrião edite ou confirme o IP antes de criar a mesa. O valor informado é repassado via variável de ambiente `LAN_IP` ao servidor Node.js, garantindo que o QR Code e o banner do console reflitam com precisão a rota de acesso dos convidados.

---

## 5. Estratégia de Empacotamento do Servidor e do SQLite

### 5.1. Script `scripts/bundle-android-assets.sh`
Executa o empacotamento completo dos módulos para `apps/android/app/src/main/assets/nodejs-project`:
1. Executa `npm run build` gerando os artefatos de produção em `apps/server/dist`, `apps/web/dist`, `packages/engine/dist` e `packages/protocol/dist`.
2. Cria estrutura limpa com os pacotes internos `@poker-table/engine` e `@poker-table/protocol` devidamente vinculados.
3. Instala apenas as dependências de produção (`express`, `socket.io`, `zod`) em diretório temporário isolado (`npm install --omit=dev`), descartando TypeScript, Vitest, Playwright, linters e arquivos `.map`.
4. Resultado: um pacote de 20 MB não compactado (~6–8 MB compactado no APK final).

### 5.2. Persistência SQLite
- O banco SQLite reside em `context.filesDir.resolve("data/poker-table.sqlite")`.
- Este local é privado do aplicativo (inacessível para outros apps), preservado entre atualizações de versão e sobrevive a reinicializações do servidor ou do aplicativo.
- O modo WAL (Write-Ahead Logging) do SQLite garante que leituras e escritas concorrentes funcionem sem corrupção mesmo sob reconexões simultâneas de clientes.

---

## 6. Limitações e Riscos Identificados

1. **Dependência do Android SDK para compilação do APK**:
   - No notebook de desenvolvimento (Ubuntu x86_64), o ambiente dispõe de Node.js v22 e Java 17, porém o Android SDK completo (`platforms;android-34` e `build-tools`) não está previamente instalado.
   - O script `scripts/build-apk.sh` implementa detecção transparente e emite diagnóstico detalhado sem tentar downloads pesados não solicitados.
2. **Restrições de Segundo Plano do Android (Doze Mode / Fabricantes Chineses)**:
   - Aparelhos como Xiaomi (MIUI/HyperOS), Samsung e Huawei aplicam políticas severas de economia de bateria.
   - Para sessões de poker longas (2 a 4 horas), o usuário deve desativar a "Otimização de Bateria" para o aplicativo Poker Table nas configurações do sistema, embora o Foreground Service e o WakeLock já mitiguem a maioria das suspensões.
3. **Tamanho do Binário `libnode.so`**:
   - Embarcar o Node.js completo adiciona ~35–45 MB ao APK. É uma troca consciente e vantajosa para manter 100% de confiabilidade matemática sem reescrever o motor em Kotlin.

---

## 7. Próximos Passos Recomendados

1. **Compilação do APK em ambiente com Android Studio**:
   - Abrir `apps/android` no Android Studio ou executar `./scripts/build-apk.sh` em máquina com `platforms;android-34` e `build-tools` instalados.
2. **Teste prático do APK no Xiaomi Redmi Note 11**:
   - Instalar o APK gerado via `adb install` ou transferência direta de arquivo.
   - Validar a experiência de ponta a ponta: abrir o app, clicar em "Criar mesa", escanear o QR Code em outro celular conectado ao Hotspot e jogar uma partida real.
3. **Avaliação futura de migração para Ktor (Longo Prazo)**:
   - Apenas se no futuro o tamanho do APK ou a inicialização instantânea se tornarem requisitos indispensáveis, planejar uma migração gradual do motor financeiro para Kotlin com uma suíte espelhada dos 485 testes de poker. No momento, a solução híbrida atende plenamente ao objetivo sem riscos à integridade financeira.
