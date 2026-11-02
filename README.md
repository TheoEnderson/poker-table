# Poker Table

Aplicativo offline para gerenciamento de fichas virtuais em partidas presenciais de Texas Hold'em com cartas físicas de baralho.

Os jogadores utilizam cartas reais na mesa e seus próprios celulares (conectados à mesma rede Wi-Fi ou Ponto de Acesso/Hotspot) para fazer apostas, controlar fichas e acompanhar o pote.

**Não depende de conexão com a internet externa.**

---

## Modos de Hospedagem

O Poker Table permite dois modos de operação para o anfitrião da partida:

### Opção A: Aplicativo Android Independente (Recomendado)
- O anfitrião instala o aplicativo Poker Table no celular Android (`app-debug.apk` ou `app-release.apk`).
- O servidor Node.js e o banco SQLite executam diretamente dentro do smartphone Android como um serviço em primeiro plano protegido contra suspensão de tela.
- **Não requer notebook, computador, terminal ou comandos.**
- O anfitrião participa da partida pela tela do próprio aplicativo.
- Permite partidas em qualquer lugar utilizando o **Ponto de Acesso (Hotspot)** do próprio celular, mesmo no meio da praia, sítio ou locais sem sinal.

### Opção B: Computador / Notebook (Ubuntu Linux, macOS, Windows)
- O anfitrião executa o servidor local no computador conectado ao Wi-Fi doméstico.
- Útil quando há um computador disponível na mesa ou para ambientes de desenvolvimento.
- Iniciado com um único comando: `./scripts/start.sh` ou `npm start`.

---

## Como Funciona a Partida

### 1. Para os Convidados (Jogadores)
- **Não precisam instalar nada:** Os convidados usam qualquer smartphone (Android ou iPhone) com o navegador web comum (Chrome, Safari, Firefox, Edge, etc.).
- Conectam o celular ao Wi-Fi da mesa (ou ao Hotspot do anfitrião).
- Escaneiam o **QR Code** exibido pelo anfitrião ou acessam o link direto (ex: `http://10.107.248.23:3000/join/ABCD12`).
- Escolhem um assento vago, informam o nome e recebem suas fichas iniciais.

### 2. Partida com Hotspot sem Internet (Ponto de Acesso Móvel)
Você pode jogar em qualquer lugar sem precisar de internet ou gastar plano de dados:
1. **Ligue o Ponto de Acesso (Hotspot)** nas configurações do celular do anfitrião (os dados móveis podem ficar desligados).
2. **Abra o aplicativo Poker Table:** O seletor de rede identificará automaticamente a interface do Hotspot (ex: `10.107.248.23 · wlan1`).
3. **Toque em "Criar mesa (Anfitrião)":** O servidor iniciará e a tela da mesa abrirá.
4. **Convide os amigos:** Peça aos outros jogadores para conectarem seus celulares no Wi-Fi do seu Hotspot e escanearem o QR Code gerado na seção "Convide a mesa".

---

## Guia Básico para o Anfitrião

1. **Configuração da Sala:**
   - Defina o nome da mesa, número de assentos (2 a 10 jogadores), cacife inicial (stack de fichas) e valores de Small Blind e Big Blind.
2. **Entrada dos Jogadores:**
   - Aguarde os convidados escolherem seus lugares. O anfitrião também escolhe seu próprio assento.
   - Quando todos estiverem prontos, clique em **"Iniciar partida"**.
3. **Durante as Mãos:**
   - As cartas de mão físicas são distribuídas normalmente aos jogadores pelo Dealer.
   - Cada jogador realiza suas ações no celular durante sua vez (Fold, Check, Call, Raise ou All-in).
   - O anfitrião avança as etapas da mesa (**Flop**, **Turn**, **River** e **Showdown**) clicando em **"Confirmar cartas na mesa"** após virar as cartas físicas no pano.
4. **Apuração do Pote e Próxima Mão:**
   - No Showdown (ou quando todos dão fold), o anfitrião seleciona o vencedor do pote ou declara empate (*split pot*). As fichas são creditadas instantaneamente.
   - O anfitrião clica em **"Iniciar próxima mão"**: o sistema gira automaticamente o botão de Dealer e cobra as blinds da nova rodada.

---

## Requisitos do Sistema

### Para Hospedar pelo Aplicativo Android:
- **Smartphone Android:** Android 8.0 ou superior (API 26+).
- **Arquitetura:** Processadores ARM de 64 bits (`arm64-v8a`), presente na imensa maioria dos smartphones modernos.
- **Armazenamento:** ~150 MB livres para instalação do APK com runtime nativo.

### Para Hospedar pelo Notebook:
- **Node.js:** Versão 22.13.0 ou superior (com suporte ao módulo nativo `node:sqlite`).
- **npm:** Versão 10 ou superior.
- **Rede:** Interface Wi-Fi ou cabo Ethernet conectada na mesma sub-rede dos celulares.

### Para os Convidados (Jogadores):
- Qualquer aparelho com navegador web moderno (iOS Safari, Android Chrome, Firefox, etc.).

---

## Instalação e Execução pelo Notebook

Caso queira hospedar a partir do notebook Ubuntu/Linux:

```bash
# 1. Instalar dependências (apenas na primeira vez, requer internet)
npm install

# 2. Compilar os pacotes
npm run build

# 3. Iniciar o servidor offline
./scripts/start.sh
```

Variáveis de ambiente opcionais:
- `PORT`: Porta TCP de escuta (padrão: `3000`).
- `DATABASE_PATH`: Caminho do banco SQLite local (padrão: `data/poker-table.sqlite`).

---

## Compilação do Aplicativo Android (APK)

Para compilar o APK a partir do código-fonte:

```bash
# Requisitos: Java 17 e Android SDK (API 34, NDK 27, CMake 3.22.1)
./scripts/build-apk.sh
```

O script baixa e valida o runtime Node.js nativo (com checksum SHA256), empacota os assets compilados do servidor e gera o APK em:
`apps/android/app/build/outputs/apk/debug/app-debug.apk`

---

## Limitações Conhecidas

- **Uso de Baralho Físico:** O aplicativo gerencia estritamente fichas, apostas, blinds, potes e turnos. Não há distribuição ou revelação de cartas virtuais na tela; o jogo depende do baralho de cartas físicas na mesa.
- **Rede Local Exclusiva:** Todos os dispositivos devem estar conectados no mesmo roteador Wi-Fi ou no Hotspot do anfitrião. Não há servidores em nuvem nem comunicação via internet externa.
- **Sem Fichas Reais ou Pagamentos:** As fichas são virtuais e recreativas, sem suporte a transações financeiras ou apostas com dinheiro real.

---

## Segurança e Tolerância a Falhas

- **Persistência Confiável em SQLite:** O progresso da partida é gravado de forma transacional em banco de dados SQLite local. Se o aplicativo for minimizado, reiniciado ou o celular descarregar, ao reabrir a mesa todas as fichas e mãos em andamento são restauradas.
- **Proteção do Endpoint de Rede:** O endpoint administrativo de reconfiguração de IP (`POST /api/network/target`) rejeita requisições vindas da rede local com HTTP 403 Forbidden, aceitando apenas chamadas locais originadas pelo próprio anfitrião (`127.0.0.1`).
- **Tokens Criptográficos de Sessão:** Cada jogador possui token individual seguro persistido no navegador. Convidados não têm acesso aos comandos administrativos do anfitrião.
- **Content Security Policy (CSP):** Todas as páginas web são servidas com diretivas CSP rígidas, bloqueando a execução de scripts remotos e conexões com servidores externos.

---

## Estrutura do Repositório

```text
poker-table/
├── apps/
│   ├── android/          # Aplicativo Android nativo (Kotlin, JNI C++, Foreground Service)
│   ├── server/           # Servidor local Node.js (Express, Socket.IO, persistência SQLite)
│   └── web/              # Interface web dos jogadores (React, TypeScript, QR Code offline)
├── packages/
│   ├── engine/           # Motor puro de poker (regras de apostas, potes, streets e turnos)
│   └── protocol/         # Contratos, esquemas de validação Zod e tipagens compartilhadas
├── scripts/
│   ├── build-apk.sh      # Script de compilação do APK Android com NDK
│   ├── bundle-android-assets.sh # Empacotador de assets do servidor para o APK
│   ├── download-node-runtime.sh # Download reproduzível do runtime nativo com SHA256
│   └── start.sh          # Inicialização rápida no Ubuntu/Linux
├── tests/                # Testes unitários Vitest e testes E2E Playwright
└── docs/                 # Documentação detalhada da arquitetura e etapas de entrega
```

---

## Licença

Desenvolvido para uso recreativo e educacional em partidas presenciais. Todos os direitos reservados.
