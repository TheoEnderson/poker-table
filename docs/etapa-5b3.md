# Poker Table — Documentação da Etapa 5B.3: Refinamento e Estabilização do Aplicativo Android

## 1. Contexto e Objetivos

Com a conclusão da Etapa 5B.2, o Poker Table demonstrou com sucesso a capacidade de empacotar e executar o runtime Node.js nativo (`libnode.so`, `libc++_shared.so` e `libpoker-native.so`) no Xiaomi Redmi Note 11 via APK autônomo, sem qualquer dependência de Termux ou computadores auxiliares.

O objetivo da Etapa 5B.3 foi transformar esse protótipo em uma aplicação estável, segura, responsiva e ergonomicamente consistente, sanando incoerências reais de rotulação de rede, navegação acidental e ciclo de vida do servidor.

---

## 2. Problemas Identificados e Diagnosticados

1. **Incoerência na classificação de redes (Falso Hotspot):**
   - Ao executar no Wi-Fi doméstico (`192.168.1.41`), o sistema exibia o rótulo `192.168.1.41 · wlan0 (hotspot)`.
   - *Causa:* O servidor (`network.ts`) aplicava incondicionalmente a string `(hotspot)` a qualquer interface manual ou selecionada pelo usuário, mesmo tratando-se de conexão cliente a um roteador convencional.
2. **Fragilidade no fluxo de navegação do anfitrião:**
   - Ao retornar do WebView da partida para o painel nativo, o botão principal continuava exibindo "Criar mesa (Anfitrião)".
   - Ao clicar novamente, o app enviava uma nova intenção de inicialização desnecessária.
   - Ao retornar à mesa, o método `openWebView` recarregava incondicionalmente a URL raiz (`http://127.0.0.1:3000`), resetando a tela e desorientando o anfitrião que já se encontrava na sala `/room/XXXX`.
   - O botão de voltar do hardware ou do topo navegava para trás no histórico da WebView (voltando para telas anteriores de formulário), em vez de alternar de forma limpa para o painel nativo.
3. **Ausência de confirmação para encerrar o servidor:**
   - O botão "Parar servidor" executava o encerramento imediato do processo sem aviso prévio, arriscando desconectar os outros jogadores por um toque acidental.
4. **Dessincronização de status entre processos isolados:**
   - Como o `PokerTableService` executa no processo isolado `:server` e a `MainActivity` no processo principal, variáveis estáticas de memória não são compartilhadas. Se a `MainActivity` fosse minimizada ou recriada, ela não recebia o status ativo a menos que o serviço disparasse um novo broadcast.
5. **Sobrecarga de arquivos desnecessários no APK:**
   - O pacote de assets do Node.js continha mais de 2.700 arquivos, incluindo tipagens TypeScript (`.d.ts`), sourcemaps (`.map`), suítes de testes de bibliotecas de terceiros (`zod/src`, `test/`) e builds de cliente redundantes (`socket.io/client-dist`), desacelerando a extração na primeira inicialização.

---

## 3. Melhorias Implementadas

### 3.1 Classificação Honesta e Seleção Dinâmica de Rede
- **`NetworkHelper.kt`:**
  - Integrado ao `ConnectivityManager` do Android para identificar ativamente via `NetworkCapabilities.TRANSPORT_WIFI` as interfaces que são de fato clientes de roteadores Wi-Fi (`WIFI_CONNECTED`).
  - Classifica como `HOTSPOT_PROBABLE` apenas interfaces com prefixos dedicados (`ap*`, `softap*`, `swlan*`, `rndis*`) ou secundárias com faixas IP típicas de tethering Android (`10.107.*`, `192.168.43.*`).
  - Classifica interfaces ambíguas como `WIRELESS_LAN` ("Interface sem fio"), sem alegar certezas inexistentes.
  - Adicionado monitoramento de conectividade em tempo real via `ConnectivityManager.NetworkCallback`, atualizando as opções da interface automaticamente quando redes forem ativadas ou desativadas.
  - Criado seletor Spinner com opções claras:
    - *Automático (recomendado)*
    - *Interfaces detectadas com descrição real*
    - *Outro / Inserir IP manualmente*
- **`apps/server/src/http/network.ts`:**
  - Corrigida a marcação de interface selecionada: utiliza `${name} (selecionada)` em vez de forçar `${name} (hotspot)`.
  - Interfaces SoftAP reais preservam a categorização de Hotspot.

### 3.2 Refinamento da Identidade Visual e Ergonomia
- Implementados drawables dedicados para cartões (`bg_card.xml`) e campos (`bg_input.xml`) com cantos arredondados (12dp e 8dp) e bordas sutis com a paleta oficial verde-escuro e dourado.
- Estados de servidor autoexplicativos:
  - **Parado:** Indicador neutro/cinza, texto "Servidor parado", botão dourado "Criar mesa (Anfitrião)".
  - **Iniciando:** Indicador âmbar, texto "Iniciando servidor local…", botão desabilitado "Iniciando mesa…".
  - **Ativo:** Indicador verde, texto "Mesa ativa na rede local", detalhes com a URL acessível, botão principal "Retornar à mesa" e botão secundário de destaque "Encerrar mesa".
  - **Encerrando:** Indicador laranja, texto "Encerrando servidor…", botões desabilitados.
  - **Erro:** Indicador vermelho, orientação para verificar a porta ou tentar novamente.

### 3.3 Fluxo do Anfitrião e Preservação de Estado
- **Prevenção de recriação de servidor:** Se o servidor já estiver em `STATUS_RUNNING`, o botão principal executa a reabertura imediata da mesa sem reiniciar processos.
- **Diálogo de confirmação:** O botão "Encerrar mesa" abre diálogo modal alertando que a partida continuará salva no banco SQLite, mas os convidados serão desconectados da rede local.
- **Navegação não destrutiva:**
  - O botão "Painel" na barra do jogo e o botão voltar do sistema operacional apenas ocultam o contêiner do WebView e exibem o painel nativo, preservando a instância do WebView intacta em segundo plano.
  - A função `openWebView` verifica se a URL atual da WebView já é a pretendida, evitando recarregamentos do estado React.
- **Sincronização de processo via `ACTION_QUERY_STATUS`:** A `MainActivity` consulta o estado do serviço no `onStart()` e `onResume()`, além de realizar ping assíncrono em `http://127.0.0.1:3000/health`.

### 3.4 Otimização do Empacotamento de Assets
- O script `scripts/bundle-android-assets.sh` agora remove de forma segura sourcemaps (`.map`), arquivos de declaração TypeScript (`.d.ts`), suítes de testes (`test/`, `tests/`) e arquivos de documentação (`.md`), preservando rigorosamente arquivos `LICENSE*`, `COPYING*` e `NOTICE*`.
- **Resultado:** Redução de 2.723 arquivos (20 MB) para 820 arquivos (8,0 MB), diminuindo o tempo de extração para o armazenamento interno na primeira execução.

### 3.5 Sincronização Dinâmica do IP do Hotspot na WebView do Anfitrião
- **Causa Raiz Diagnosticada:**
  1. A WebView do anfitrião acessa a mesa via loopback (`127.0.0.1:3000`). O seletor `Invite.tsx` buscava uma interface com `address === location.hostname` (`127.0.0.1`), que não existe na lista de interfaces de rede externa, ficando suscetível a fallbacks obsoletos.
  2. `Invite.tsx` consultava `/api/network` apenas uma vez na montagem inicial (`useEffect(..., [])`). Ao ligar o hotspot após iniciar a mesa, a interface não se atualizava.
  3. No Android nativo, chamadas a `refreshNetworkInterfaces()` reatribuíam o adapter do Spinner resetando a seleção do usuário para o índice 0 (`wlan0`).
  4. O runtime Node.js lia a variável `LAN_IP` estaticamente apenas na inicialização.
- **Solução Implementada:**
  1. **Proteção e Dynamic Target no Servidor (`network.ts` e `app.ts`):** Adicionada rota `POST /api/network/target` protegida por `isLoopbackAddress(req.socket.remoteAddress)`. Apenas requisições locais (127.0.0.1 / ::1 / ::ffff:127.0.0.1) originadas no próprio dispositivo anfitrião podem alterar o alvo da partida, rejeitando convidados externos com HTTP 403 Forbidden.
  2. **Tratamento de Loopback e Atualização Dinâmica no Frontend (`Invite.tsx`):** Ao detectar execução em `localhost` ou `127.0.0.1`, adota a primeira interface física anunciada pelo backend (`addresses[0]`), que já reflete o alvo configurado. Adicionado polling a cada 4 segundos, escutas de `focus` e `visibilitychange`, exposição global de `window.__refreshNetwork` e botão manual "Atualizar redes".
  3. **Persistência e Notificação no Android (`MainActivity.kt` e `PokerTableService.kt`):** A variável `userSelectedIp` preserva a escolha do usuário entre atualizações de conectividade. Ao selecionar uma rede ou retornar à WebView, o app notifica o servidor via `POST /api/network/target`, atualiza o serviço em primeiro plano via `ACTION_UPDATE_LAN_IP` e invoca `window.__refreshNetwork` via JavaScript.

### 3.6 Regras de Distribuição e ProGuard
- Criado arquivo `apps/android/app/proguard-rules.pro` preservando métodos nativos da classe `com.pokertable.NodeBridge`.
- Preservadas as configurações estáveis: `applicationId = "com.pokertable"`, `versionCode = 1`, `versionName = "0.1.0"`.

---

## 4. Arquivos Modificados e Criados

| Arquivo | Status | Descrição |
|---|---|---|
| `apps/server/src/http/network.ts` | Modificado | Elimina rotulação falsa de hotspot em Wi-Fi doméstico, padroniza `(selecionada)`, adiciona dynamic target e validação `isLoopbackAddress`. |
| `apps/server/src/http/app.ts` | Modificado | Adiciona rota `POST /api/network/target` com validação de origem loopback contra chamadas de convidados da rede local. |
| `apps/web/src/components/Invite.tsx` | Modificado | Suporte a loopback para anfitrião, atualização em foco/visibilidade, polling de 4s, `window.__refreshNetwork` e botão manual. |
| `tests/network.test.ts` | Modificado | Suíte cobrindo Cenários A, B, C, D, E, validação `isLoopbackAddress` e endpoint HTTP de dynamic target. |
| `apps/android/app/src/main/java/com/pokertable/NetworkHelper.kt` | Modificado | Detecção real com `ConnectivityManager`, enum de classificação e rótulos honestos. |
| `apps/android/app/src/main/java/com/pokertable/PokerTableService.kt` | Modificado | Adiciona ação `ACTION_QUERY_STATUS`, estado `STOPPING` e tolerância a chamadas duplicadas. |
| `apps/android/app/src/main/java/com/pokertable/MainActivity.kt` | Modificado | Gerenciamento de ciclo de vida, navegação segura, diálogo de encerramento e spinner de redes. |
| `apps/android/app/src/main/res/layout/activity_main.xml` | Modificado | Interface remodelada com cartões, spinner, botões dinâmicos e controle superior. |
| `apps/android/app/src/main/res/values/strings.xml` | Modificado | Textos acessíveis para leigos, sem jargões de programação. |
| `apps/android/app/src/main/res/values/colors.xml` | Modificado | Cores de estado (verde, âmbar, laranja, cinza, perigo) e paleta verde/ouro. |
| `apps/android/app/src/main/res/values/styles.xml` | Modificado | Tema Material atualizado. |
| `apps/android/app/src/main/res/drawable/bg_card.xml` | Criado | Fundo de cartão com 12dp de raio e borda sutil. |
| `apps/android/app/src/main/res/drawable/bg_input.xml` | Criado | Fundo de campos de texto e seletores com 8dp de raio. |
| `apps/android/app/proguard-rules.pro` | Criado | Regras ProGuard para proteção da ponte JNI `NodeBridge`. |
| `scripts/bundle-android-assets.sh` | Modificado | Poda segura de arquivos de desenvolvimento preservando licenças. |
| `docs/etapa-5b3.md` | Criado | Documentação desta etapa. |

---

## 5. Resultados dos Testes Automatizados

Executados de forma estritamente sequencial com limite de 1 worker em máquina com 9 GiB de RAM:

1. **`npm run lint`:** 0 erros, 0 avisos.
2. **`npm run build`:** Sucesso (compilação TypeScript + bundle Vite client).
3. **`npx vitest run --maxWorkers=1 --no-file-parallelism`:** 493 testes aprovados em 23 suítes (100% de sucesso).
4. **`npx playwright test --workers=1`:** 19 testes E2E aprovados em 36.2s.
5. **`./scripts/build-apk.sh`:** **BUILD SUCCESSFUL** em 44s (código 0).
6. **`apksigner verify`:** Aprovado (assinatura v2 íntegra).
7. **`git diff --check`:** Aprovado (sem inconsistências de whitespace).

---

## 6. Verificação do APK Compilado

- **Caminho:** `apps/android/app/build/outputs/apk/debug/app-debug.apk`
- **Tamanho:** 136 MB
- **Bibliotecas nativas contidas (arm64-v8a):**
  - `lib/arm64-v8a/libc++_shared.so` (1.292.896 bytes)
  - `lib/arm64-v8a/libnode.so` (65.303.672 bytes)
  - `lib/arm64-v8a/libpoker-native.so` (62.400 bytes)
- **Quantidade de arquivos internos:** Reduzida de 2.723 para 1.675 arquivos.

---

## 7. Roteiro Recomendado para Validação Física no Redmi Note 11

Como solicitado, **a instalação automática via ADB NÃO foi executada**, permitindo revisar as alterações antes da atualização no dispositivo.

### Passo 1 — Atualizar o APK no celular
Conectar o Xiaomi Redmi Note 11 via USB (ADB autorizado) e executar:
```bash
adb -s 1ac9e1f0 install -r -t apps/android/app/build/outputs/apk/debug/app-debug.apk
```

### Passo 2 — Validar a tela inicial e classificação de rede
1. Abrir o Poker Table.
2. Verificar o cartão de status: deve indicar "Servidor parado" com ponto cinza.
3. Verificar o seletor de rede:
   - Se conectado ao Wi-Fi doméstico: deve exibir a opção com rótulo `(Wi-Fi conectada)`.
   - Se o Hotspot for ativado: deve identificar e sugerir a interface do Hotspot como prioritária.
   - Alternar para "Outro / Inserir IP manualmente" e conferir que o campo de texto customizado aparece.

### Passo 3 — Validar fluxo do anfitrião
1. Tocar em **Criar mesa (Anfitrião)**.
2. O botão deve mudar para "Iniciando mesa…" (desabilitado) e o status para "Iniciando servidor local…".
3. Em poucos segundos, o app deve abrir a interface da mesa diretamente no WebView.
4. Tocar no botão **Painel** (ou no botão Voltar do Android):
   - A visualização deve retornar ao painel nativo.
   - O status deve exibir "Mesa ativa na rede local".
   - O botão principal agora deve exibir **"Retornar à mesa"**.
   - O botão **"Encerrar mesa"** deve estar visível.
5. Tocar em **Retornar à mesa**:
   - A partida deve reaparecer imediatamente no exato ponto onde estava, sem recarregar nem reiniciar o servidor.

### Passo 4 — Validar encerramento seguro e persistência
1. No painel nativo, tocar em **Encerrar mesa**.
2. Conferir o diálogo de confirmação:
   - Tocar em "Cancelar": o servidor permanece ativo.
   - Tocar em "Encerrar Mesa": o servidor finaliza o serviço e o status volta para "Servidor parado".
3. Iniciar novamente: a recuperação de dados do SQLite garantirá a integridade de mãos anteriores.

---

## 8. Recomendações para a Versão v0.2.0

1. **Assinatura de Release:**
   - Criar uma keystore dedicada de release protegida por variáveis de ambiente locais (fora do repositório Git).
2. **Compressão adicional:**
   - Para versões de distribuição ampla além de `arm64-v8a`, utilizar App Bundles (`.aab`) para que o Google Play distribua apenas a arquitetura do dispositivo do usuário (~68 MB de download).
3. **Gerenciamento de bateria no MIUI/HyperOS:**
   - Incluir na tela inicial uma dica rápida convidando o usuário a definir "Sem restrições de bateria" nas configurações do aplicativo no Redmi Note 11, evitando que o sistema mate o Foreground Service em partidas muito longas com o celular bloqueado.
