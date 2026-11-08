# Poker Table

[![Release](https://img.shields.io/github/v/release/TheoEnderson/poker-table?color=blue&label=Release)](https://github.com/TheoEnderson/poker-table/releases/tag/v0.2.0)
[![License: MIT](https://img.shields.io/badge/Licen%C3%A7a-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.13-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Android](https://img.shields.io/badge/Android-8.0%2B%20(arm64--v8a)-3DDC84?logo=android&logoColor=white)](https://github.com/TheoEnderson/poker-table/releases/tag/v0.2.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

Aplicativo offline para gerenciamento de fichas virtuais em partidas presenciais de Texas Hold'em com cartas físicas de baralho.

Os jogadores utilizam cartas reais na mesa e seus próprios celulares — conectados à mesma rede Wi-Fi ou Ponto de Acesso (Hotspot) — para fazer apostas, controlar fichas e acompanhar os potes em tempo real, sem necessidade de maletas de fichas físicas nem conexão com a internet.

---

> ### Download da Versão Oficial (Android)
>
> A versão **v0.2.0** traz um aplicativo Android independente com servidor Node.js e banco SQLite embutidos, sem depender de computador ou Termux.
>
> - **Download do APK**: [PokerTable-v0.2.0-android-arm64.apk (70 MB)](https://github.com/TheoEnderson/poker-table/releases/download/v0.2.0/PokerTable-v0.2.0-android-arm64.apk)
> - **Notas da Release**: [GitHub Release v0.2.0](https://github.com/TheoEnderson/poker-table/releases/tag/v0.2.0)
> - **Arquitetura**: ARM de 64 bits (`arm64-v8a`) — compatível com a imensa maioria dos smartphones modernos
> - **Requisito Mínimo**: Android 8.0 ou superior (API 26+)
> - **Homologação em Dispositivo Real**: Validado fisicamente no Xiaomi Redmi Note 11 (Android 13)
> - **Checksum SHA-256**: `7d26548b9662774c7a2d341f2bb52558918b74d64d8cbf22d1e4dae16b154b2d`

---

## O que é o Poker Table?

Em jogos caseiros de Texas Hold'em, transportar e organizar fichas plásticas pode ser inconveniente, e contar potes paralelos (*side pots*) ou conferir blinds frequentemente gera dúvidas e atrasos.

O **Poker Table** resolve esse problema mantendo a essência do jogo presencial:

- **Cartas Físicas no Pano**: O baralho real continua sendo embaralhado e distribuído pelos próprios jogadores na mesa.
- **Fichas e Apostas no Celular**: Cada jogador utiliza seu smartphone para ver seu saldo, dar fold, pagar, aumentar apostas ou ir all-in.
- **Automação de Potes e Regras**: O sistema calcula automaticamente o pote principal, potes paralelos, valores mínimos de aposta, divisão em empates (*split pot*) e rotação de Dealer, Small Blind e Big Blind.
- **100% Desconectado da Internet**: Todas as comunicações ocorrem exclusivamente na rede local (Wi-Fi da casa ou Ponto de Acesso do celular).

---

## Funcionalidades

- **Mesa Presencial com Suporte a 2–10 Jogadores**: Capacidade configurável entre 2 e 10 participantes na criação da sala (padrão de 6 assentos no feltro virtual), com visualização em tempo real das posições.
- **Controle Automático de Blinds e Dealer**: Rotação correta do botão de Dealer, Small Blind e Big Blind a cada nova mão, com dedução imediata das apostas obrigatórias.
- **Ações Completas de Aposta**: Controles autoritativos para *Fold*, *Check*, *Call*, *Raise* (com seletor numérico ou atalhos táticos de 2.5x, 3x e Pote) e *All-in* com confirmação de segurança.
- **Avanço de Streets pelo Anfitrião**: O anfitrião comanda o avanço das fases (**Pré-flop → Flop → Turn → River → Showdown**) após abrir as cartas físicas comunitárias na mesa.
- **Potes Paralelos e Divisão de Pote**: Cálculo exato de múltiplos *side pots* em situações de all-in e suporte nativo a empates (*split pot*) no Showdown.
- **Encerramento por Desistência**: Vitória declarada e creditada de imediato quando todos os adversários dão fold.
- **Persistência Transacional (SQLite)**: Estado gravado a cada comando no banco SQLite local. Se o aplicativo for fechado ou o aparelho reiniciar, o estado da partida e as fichas são recuperados sem perdas.
- **Entrada Rápida por QR Code Offline**: O anfitrião exibe um QR Code gerado localmente pelo navegador (em Canvas), permitindo que os convidados entrem na mesa em segundos.
- **Dois Modos de Hospedagem**: Pode ser executado diretamente no celular Android (como anfitrião autônomo) ou em qualquer computador pessoal (Ubuntu Linux, macOS ou Windows).

---

## Modos de Hospedagem

### Opção 1: Aplicativo Android Independente (Recomendado)

O anfitrião utiliza o aplicativo nativo do Poker Table no smartphone Android:

1. O servidor Node.js e o banco SQLite executam diretamente dentro do celular como um serviço em primeiro plano (*Foreground Service*), protegido contra suspensão de tela.
2. Não requer computador, terminal ou ferramentas extras instaladas.
3. Permite partidas em qualquer lugar utilizando o **Ponto de Acesso (Hotspot)** do próprio celular, mesmo em locais sem internet ou sinal de operadora.

### Opção 2: Computador / Notebook (Linux, macOS, Windows)

O anfitrião executa o servidor local no computador conectado ao Wi-Fi:

1. Ideal para ambientes de desenvolvimento ou quando há um computador disponível próximo à mesa.
2. Iniciado com um único comando: `./scripts/start.sh` (Linux/macOS) ou `npm start`.

---

## Como Utilizar

### Cenário A: Hospedando pelo Celular Android

1. **Conecte a uma Rede Local**:
   - **No Ponto de Acesso / Hotspot (Sem Internet)**: Ative o Ponto de Acesso nas configurações do celular (os dados móveis podem ficar desligados).
   - **No Wi-Fi**: Conecte o celular à rede Wi-Fi local onde a partida acontecerá.
2. **Abra o Poker Table**:
   - O aplicativo identifica as interfaces disponíveis e seleciona o IP correto (ex: `10.107.248.23` no Hotspot ou `192.168.1.x` no Wi-Fi).
3. **Toque em "Criar mesa (Anfitrião)"**:
   - O servidor interno será iniciado e a interface da mesa abrirá na tela do celular.
4. **Configure a Sala**:
   - Defina o nome da mesa, número de participantes (2 a 10 pessoas, com padrão inicial de 6 assentos), cacife inicial (stack de fichas) e valores de Small Blind e Big Blind.
5. **Convide os Jogadores**:
   - Toque em **"Convide a mesa"** para exibir o QR Code e o link da sala.

### Cenário B: Hospedando pelo Computador

1. Conecte o computador à mesma rede Wi-Fi dos celulares.
2. No terminal do projeto, execute:
   ```bash
   ./scripts/start.sh
   ```
3. O terminal indicará o endereço da mesa (ex: `http://192.168.1.50:3000`).
4. Abra o endereço no navegador do computador e crie a sala.

### Como os Convidados Participam

Os convidados **não precisam instalar nenhum aplicativo**:

1. Conectam seus smartphones à mesma rede Wi-Fi (ou ao Hotspot móvel do anfitrião).
2. Escaneiam o QR Code exibido pelo anfitrião ou acessam o link direto pelo navegador (Chrome, Safari, Firefox, Edge, etc.).
3. Escolhem um assento vazio, informam seu nome e entram na partida.

---

## Como Funciona o Modo 100% Offline

Existe uma diferença fundamental entre *operar offline* e *comunicação entre aparelhos*:

- **Offline (Sem Internet)**: O Poker Table não faz nenhuma requisição externa. Não há servidores em nuvem, dependência de sinal de internet, login de terceiros, CDNs ou telemetria.
- **Rede Local (LAN)**: Para que os celulares dos convidados se comuniquem com o servidor do anfitrião, todos os aparelhos precisam estar na mesma sub-rede local.
- **Uso com Hotspot Portátil**: Ao ativar o Hotspot do celular do anfitrião, o aparelho cria uma rede Wi-Fi local própria. Os amigos se conectam a essa rede e jogam normalmente, mesmo no meio da praia, sítio ou viagens, sem gastar dados móveis.
- **Arquitetura Autoritativa**: O servidor (rodando no celular do anfitrião ou no computador) valida cada aposta e turno contra as regras do motor. Os navegadores dos jogadores recebem atualizações imediatas via WebSocket.

---

## Tecnologias Utilizadas

| Camada | Tecnologias |
| :--- | :--- |
| **Android App** | Kotlin, Android NDK 27, C++ (CMake / JNI), Runtime nativo Node.js 24 (`libnode.so`), Foreground Service, Android WebView |
| **Backend & Servidor** | Node.js (>= 22.13), Express 5, Socket.IO 4, SQLite nativo (`node:sqlite`) |
| **Frontend Web** | React 19, TypeScript, Vite, Tailwind CSS, Lucide Icons, QRCode Canvas offline |
| **Motor de Poker** | TypeScript puro e isolado (`packages/engine`), determinístico, com alta cobertura de testes unitários |
| **Contratos & Protocolo** | Zod (validação de schemas em runtime) e tipagem TypeScript compartilhada (`packages/protocol`) |
| **Testes & Qualidade** | Vitest (testes unitários e integração), Playwright (testes E2E no navegador), ESLint 9 |

---

## Estrutura do Repositório

O projeto é organizado como um monorepo modular:

```text
poker-table/
├── apps/
│   ├── android/          # Aplicativo nativo Android (Kotlin, C++/JNI, Foreground Service)
│   ├── server/           # Servidor local Node.js (Express, Socket.IO, persistência SQLite)
│   └── web/              # Interface web dos jogadores (React 19, TypeScript, Vite)
├── packages/
│   ├── engine/           # Motor puro de poker (regras de Texas Hold'em, potes e limites)
│   └── protocol/         # Contratos, esquemas de validação Zod e tipagens compartilhadas
├── scripts/
│   ├── build-apk.sh      # Script de compilação do APK Android com NDK e assinatura
│   ├── bundle-android-assets.sh # Empacotador de assets do servidor para o APK
│   ├── download-node-runtime.sh # Download reproduzível do runtime nativo com SHA256
│   └── start.sh          # Inicialização rápida no Ubuntu/Linux
├── tests/                # Testes unitários Vitest e testes E2E Playwright
└── docs/                 # Documentação técnica e relatórios de engenharia por etapa
```

---

## Desenvolvimento

### Pré-requisitos

- **Node.js**: Versão 22.13.0 ou superior (com suporte ao módulo `node:sqlite`).
- **npm**: Versão 10 ou superior.
- **Para compilação Android (opcional)**: JDK 17, Android SDK (API 34), NDK 27 e CMake 3.22.1.

### Instalação e Execução

```bash
# 1. Instalar dependências de todos os pacotes do monorepo
npm install

# 2. Compilar todos os pacotes (protocol, engine, web e server)
npm run build

# 3. Executar o servidor em modo de desenvolvimento (com recarga automática)
npm run dev

# 4. Executar os testes automatizados
npm test

# 5. Executar a verificação completa do projeto (Lint + Testes + Build)
npm run check

# 6. Executar testes ponta a ponta (E2E) no navegador
npm run test:e2e
```

### Compilação do Aplicativo Android (APK)

```bash
# Compilar o APK de desenvolvimento (Debug)
./scripts/build-apk.sh

# Compilar o APK assinado para distribuição (Release)
./scripts/build-apk.sh --release
```

O script baixa e valida o runtime Node.js nativo (com verificação de integridade SHA-256), compila a ponte JNI C++, empacota os assets do servidor e gera o APK pronto para instalação.

---

## Segurança e Confiabilidade

- **Persistência Confiável com SQLite**: As fichas, mãos em andamento e histórico da sala são persistidos atomicamente no SQLite local. Quedas repentinas de energia ou fechamentos do aplicativo não corrompem o estado da mesa.
- **Proteção de Acesso Administrativo**: O endpoint administrativo de reconfiguração de IP (`POST /api/network/target`) rejeita requisições vindas da rede externa (HTTP 403 Forbidden), aceitando exclusivamente chamadas originadas pelo próprio dispositivo anfitrião (`127.0.0.1`).
- **Tokens Individuais de Sessão**: Cada jogador recebe um token criptográfico no navegador. Convidados não têm acesso às ações de controle do anfitrião.
- **Content Security Policy Estrita (CSP)**: Todas as páginas web são servidas com diretivas CSP rígidas, bloqueando a execução de scripts remotos e conexões com servidores externos.

---

## Documentação Técnica

Para detalhes sobre a evolução do projeto, especificações de arquitetura e histórico de cada ciclo de entrega, consulte a pasta [docs/](docs/README.md).

---

## Licença

Este projeto é distribuído sob a licença [MIT](LICENSE). Consulte o arquivo [LICENSE](LICENSE) para obter mais informações.
