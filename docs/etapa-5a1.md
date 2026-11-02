# Poker Table — Documentação da Etapa 5A.1: Preparar Hospedagem no Android via Termux

## 1. Visão Geral e Diagnóstico de Compatibilidade

A Etapa 5A.1 estabelece a infraestrutura técnica e os procedimentos necessários para executar o servidor do Poker Table diretamente em um smartphone Android utilizando o ambiente Termux.

O objetivo é permitir que o anfitrião utilize seu celular simultaneamente como servidor e como cliente (via navegador), enquanto os demais participantes se conectam ao ponto de acesso Wi-Fi (Hotspot) do próprio smartphone, eliminando por completo a necessidade de um notebook na mesa de jogo.

### 1.1 Diagnóstico Técnico do Monorepo no Termux
- **Runtime Node.js e `node:sqlite`**: O Termux disponibiliza pacotes oficiais atualizados (`pkg install nodejs-lts`), incluindo suporte nativo ao módulo embutido `node:sqlite`. Os testes práticos já demonstraram funcionamento pleno sem necessidade de drivers SQLite externos ou compiladores C++.
- **Dependências de Produção**:
  - `@poker-table/server` depende apenas de `@poker-table/protocol`, `@poker-table/engine`, `express`, `socket.io` e `zod`.
  - Nenhuma dessas dependências possui módulos binários nativos C++ no runtime. Todas são implementadas em JavaScript puro.
  - As ferramentas de compilação pesadas (Vite, Rollup, TypeScript, Playwright e Vitest) são estritamente `devDependencies` e **não** precisam ser instaladas nem executadas no smartphone.
- **Frontend Estático (`apps/web/dist`)**: O frontend é compilado no notebook Ubuntu e distribuído como arquivos estáticos (HTML, CSS e JavaScript empacotado). O servidor Express serve essa pasta de forma transparente sem exigir compilação no dispositivo móvel.

---

## 2. Método de Empacotamento Escolhido e Justificativa

### 2.1 Estratégia Adotada: Pacote Portátil Pré-Compilado
- O notebook Ubuntu compila todos os pacotes do monorepo (`npm run build`).
- O script `scripts/bundle-android.sh` cria um arquivo compactado leve (`dist-android/poker-table-android.tar.gz`, ~220 KB) contendo:
  - Manifestos `package.json` da raiz e dos workspaces.
  - `package-lock.json` para resolução determinística de versões.
  - Pastas compiladas de produção: `apps/server/dist`, `apps/web/dist`, `packages/engine/dist` e `packages/protocol/dist`.
  - Scripts de configuração e inicialização específicos para Termux (`termux-setup.sh` e `termux-start.sh`).
- **O que foi intencionalmente excluído**:
  - `node_modules` do notebook (evita transportar binários x86_64, ferramentas de dev e caminhos absolutos).
  - Códigos-fonte TypeScript (`src/`), suítes de testes (`tests/`) e arquivos de documentação.
  - Bancos SQLite (`data/`) e arquivos de histórico `.git`.

### 2.2 Por que instalar dependências de produção no Termux (`npm install --omit=dev`)
- A execução de `npm install --omit=dev` uma única vez no Termux:
  1. Cria os symlinks locais de workspaces (`@poker-table/engine` e `@poker-table/protocol`) com caminhos nativos do sistema de arquivos do Android (`/data/data/com.termux/files/...`).
  2. Instala apenas os três módulos puros de produção (`express`, `socket.io`, `zod`).
  3. Não requer compiladores C++, Python ou `node-gyp`.
  4. Uma vez realizada a instalação inicial, a partida opera 100% desconectada da internet.

---

## 3. Suporte à Rede de Hotspot Android e Resolução de IP

### 3.1 Descoberta Real no Redmi Note 11 (Múltiplas Interfaces Wi-Fi)
Em teste prático no Xiaomi Redmi Note 11 com o Hotspot ativado, `os.networkInterfaces()` reportou:
- `wlan1 → 10.107.248.23` (Rede do Hotspot onde os convidados se conectam)
- `wlan0 → 192.168.1.41` (Conexão Wi-Fi cliente convencional com o roteador)
- `lo → 127.0.0.1` (Loopback local)

**Risco identificado**: Caso o sistema ordene interfaces apenas alfabeticamente, `wlan0` seria escolhida por padrão, gerando um QR Code com IP da rede externa em vez da rede do Hotspot. Além disso, em outros fabricantes ou versões de Android, o Hotspot pode ser `wlan0`, `ap0` ou `swlan0`.

### 3.2 Soluções Implementadas
1. **Não Presunção de Nomes Fixos**:
   - O sistema **não** assume que `wlan0` ou `wlan1` é sempre o Hotspot.
   - Quando não há configuração manual e existe apenas uma interface física adequada, ela é selecionada automaticamente.
   - Quando existem múltiplas interfaces físicas (ex.: `wlan0` e `wlan1`), ambas são listadas e disponibilizadas tanto no terminal quanto no seletor de rede da tela de convite (`Invite.tsx`).
2. **Seleção e Configuração Flexível (`LAN_IP` ou `LAN_INTERFACE`)**:
   - O anfitrião pode configurar o endereço preferencial passando o **IP** (ex.: `10.107.248.23`) ou o **nome da interface** (ex.: `wlan1`).
   - Suportado via argumento CLI: `./termux-start.sh 10.107.248.23` ou `./termux-start.sh wlan1`.
   - Suportado via variáveis de ambiente: `LAN_IP=10.107.248.23` ou `LAN_INTERFACE=wlan1`.
   - A interface correspondente é rotulada como `(hotspot)` e ganha prioridade máxima (índice 0).
3. **QR Code Autoritativo**:
   - O componente `Invite.tsx` seleciona automaticamente a interface prioritária `(hotspot)`, gerando o QR Code diretamente para os convidados no endereço correto (ex.: `http://10.107.248.23:3000/join/<codigo>`).
   - O anfitrião pode alternar entre as interfaces detectadas a qualquer momento pelo menu suspenso na interface web, atualizando o QR Code em tempo real.
4. **Preservação do Escuta em `0.0.0.0`**:
   - O servidor permanece escutando em `0.0.0.0:${port}`. Isso garante que o anfitrião no próprio celular acesse por `http://localhost:${port}` sem sofrer impacto da configuração do IP anunciado aos convidados.
5. **Preservação Total do Ambiente Ubuntu**:
   - Em computadores convencionais com uma única interface Wi-Fi/Ethernet, o comportamento automático permanece inalterado e transparente.

---

## 4. Estabilidade no Android (Xiaomi Redmi Note 11)

### 4.1 Bloqueio de Suspensão de CPU (`termux-wake-lock`)
- O Android suspende processos em segundo plano quando a tela é desligada ou quando o usuário alterna para outro aplicativo (como o Google Chrome).
- Para manter o Node.js respondendo continuamente às requisições do Socket.IO:
  ```bash
  termux-wake-lock
  ```
  Isso ativa uma notificação persistente na barra de status do Android e impede o deep sleep do processador.
  Ao final da partida, execute `termux-wake-unlock` para liberar o bloqueio.

### 4.2 Otimização de Bateria no MIUI / HyperOS
- No Xiaomi Redmi Note 11:
  1. Vá em **Configurações → Apps → Gerenciar apps → Termux**.
  2. Selecione **Economia de bateria** e mude para **Sem restrições**.
  3. Ative a opção **Início automático**, se disponível.
  4. Na tela de aplicativos recentes do Android, pressione e segure o cartão do Termux e toque no ícone de **Cadeado** para impedir o encerramento acidental.

---

## 5. Procedimento de Transferência e Execução no Celular

### Passo 1: No Notebook Ubuntu
1. Gere o pacote de distribuição:
   ```bash
   ./scripts/bundle-android.sh
   ```
2. Inicie o servidor de transferência local pela rede:
   ```bash
   python3 -m http.server 8000 --directory dist-android
   ```
   Verifique o IP do notebook exibido ou via `ip addr` (exemplo: `192.168.1.37`).

### Passo 2: No Smartphone (Redmi Note 11 com Termux)
1. Conecte o Redmi à mesma rede Wi-Fi do notebook.
2. Abra o Termux e baixe o pacote:
   ```bash
   curl -O http://192.168.1.37:8000/poker-table-android.tar.gz
   tar -xzf poker-table-android.tar.gz
   cd poker-table-android
   ```
3. Execute o setup inicial (apenas na primeira vez):
   ```bash
   ./termux-setup.sh
   ```

### Passo 3: Iniciar a Partida Offline no Celular
1. Ative o ponto de acesso Wi-Fi (Hotspot) no Redmi Note 11.
2. Desative os dados móveis (4G/5G).
3. Verifique o IP do hotspot no Redmi (exemplo: `10.107.248.23`).
4. No Termux, ative o wake lock e inicie o servidor:
   ```bash
   termux-wake-lock
   ./termux-start.sh 10.107.248.23
   ```
5. No próprio Redmi, abra o Chrome em `http://localhost:3000` e crie a mesa como anfitrião.
6. Os demais jogadores conectam seus celulares no Wi-Fi do hotspot e escaneiam o QR Code exibido.

---

## 6. Limitações e Riscos Conhecidos para Validação Física

1. **Gestão de Processos em Segundo Plano**: O anfitrião alternará entre o Chrome e o Termux. Se o MIUI encerrar o processo por falta de memória livre, a partida é interrompida (o estado é recuperado ao reiniciar graças ao SQLite).
2. **Desconexão ao Alternar Redes**: Se o anfitrião ativar o Hotspot depois de ter iniciado o servidor sem especificar `LAN_IP`, o endereço de rede pode não coincidir. O uso de `./termux-start.sh <IP_DO_HOTSPOT>` resolve essa dependência.
3. **Múltiplos Dispositivos Conectados**: O desempenho da rede Wi-Fi depende da capacidade do rádio hotspot do smartphone gerenciar de 2 a 10 conexões simultâneas de WebSockets em tempo real. Testes físicos na Etapa 5A.2 validarão essa latência na prática.
