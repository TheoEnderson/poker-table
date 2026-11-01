# Poker Table

Aplicativo offline para gerenciamento de fichas virtuais em partidas presenciais de Texas Hold'em com cartas físicas.

O servidor executa em um computador pessoal (como um notebook Linux/Ubuntu, macOS ou Windows) e os jogadores utilizam seus próprios smartphones conectados à mesma rede Wi-Fi local, sem qualquer dependência de conexão com a internet externa.

---

## Funcionalidades

- **Gerenciamento de Salas**: Criação simplificada de salas com definição de cacife (buy-in inicial) e blinds (small/big blind).
- **Assentos e Papéis**: Distinção entre anfitrião da mesa e jogadores participantes, escolha dinâmica de assentos numerados.
- **Ciclo Completo de Apostas**: Controles autoritativos para Fold, Check, Call, Raise com incrementos táticos ou seletor numérico, e All-in com confirmação de segurança.
- **Avanço Manual de Streets**: O anfitrião controla a transição entre Pré-flop, Flop, Turn, River e Showdown após revelar as cartas físicas na mesa.
- **Apuração de Showdown e Potes Múltiplos**: Distribuição assistida de fichas para vencedores de potes principais e paralelos (*side pots*), com suporte total a empates (*split pot*).
- **Encerramento por Desistência**: Reconhecimento automático de vitória quando todos os adversários dão fold.
- **Início da Próxima Mão**: Rotação automática de Dealer (botão), Small Blind e Big Blind com dedução imediata das apostas obrigatórias.
- **QR Code 100% Offline**: Geração no navegador de imagem PNG em Base64 para entrada instantânea dos celulares, sem requisições a CDNs ou APIs externas.
- **Reconexão e Tolerância a Falhas**: Reconexão transparente via WebSockets/Socket.IO caso o navegador feche ou o sinal Wi-Fi oscile.
- **Persistência Local em SQLite**: Estado íntegro da partida gravado a cada comando no arquivo local SQLite do servidor.

---

## Requisitos do Sistema

- **Node.js**: Versão 22.13.0 ou superior (com suporte nativo ao módulo `node:sqlite`).
- **npm**: Versão 10 ou superior.
- **Rede Local**: Roteador Wi-Fi ou ponto de acesso pessoal (Hotspot) onde o computador e os celulares estejam conectados na mesma sub-rede (LAN). **Nenhum acesso à internet externa é necessário.**

---

## Preparação Inicial (Única etapa que requer internet)

Antes da primeira partida offline, clone o repositório, instale as dependências e compile os pacotes do monorepo:

```bash
# 1. Instalar dependências
npm install

# 2. Compilar todos os pacotes (protocol, engine, apps/web e apps/server)
npm run build
```

Uma vez compilado, o projeto está pronto para operar de forma 100% desconectada.

---

## Como Iniciar o Aplicativo Offline

Você pode iniciar o servidor utilizando o script facilitador ou diretamente via npm:

### Opção 1: Script facilitador (Recomendado para Ubuntu/Linux)

```bash
./scripts/start.sh
```

O script verifica os pré-requisitos locais sem tentar baixar nada da internet e inicia o servidor imediatamente.

### Opção 2: Comando npm padrão

```bash
npm start
```

### Configurações Opcionais de Ambiente

- `PORT`: Define a porta TCP de escuta (padrão: `3000`). Exemplo: `PORT=3001 ./scripts/start.sh`
- `DATABASE_PATH`: Caminho do arquivo SQLite (padrão: `data/poker-table.sqlite`). Exemplo: `DATABASE_PATH=/caminho/banco.sqlite ./scripts/start.sh`

Para encerrar o servidor, pressione `Ctrl+C` no terminal.

---

## Como Conectar os Celulares na Partida

1. Certifique-se de que o computador e os celulares estão conectados na **mesma rede Wi-Fi**.
2. Ao iniciar o servidor, o terminal exibirá as URLs locais disponíveis, por exemplo:
   - `http://localhost:3000` (acesso no próprio computador)
   - `http://192.168.1.15:3000` (acesso pelos smartphones na rede Wi-Fi)
3. Abra a URL local no navegador do computador e clique em **Criar Sala**.
4. Os jogadores podem entrar na sala de duas formas:
   - **QR Code**: Escanear o código exibido na tela do anfitrião com a câmera do celular.
   - **Link Direto**: Digitar o endereço `http://<IP-DO-NOTEBOOK>:3000/join/<CODIGO-DA-SALA>` no navegador do celular.

---

## Persistência e Recuperação de Estado

- Todos os eventos e mutações da partida são gravados com garantia transacional em `data/poker-table.sqlite`.
- **Queda de Celular / Recarga de Aba**: Se o celular de um jogador for bloqueado, perder o sinal ou a página for atualizada, o token salvo no `localStorage` do navegador restaura o jogador exatamente no seu assento e com suas fichas atuais.
- **Interrupção do Servidor**: Se o servidor for finalizado com `Ctrl+C` ou o computador desligar, ao executar `./scripts/start.sh` novamente a sala, jogadores, potes e o estado da mão ativa permanecem preservados no banco SQLite.
- **Reinício Limpo de Dados**: Caso deseje apagar todas as partidas e começar um banco novo, basta remover o arquivo SQLite:
  ```bash
  rm data/poker-table.sqlite*
  ```

---

## Testes Automatizados

O projeto conta com suíte abrangente de testes unitários, testes de integração do motor e testes de ponta a ponta (E2E) com Playwright.

Para execução segura em máquinas com recursos limitados de memória, execute os testes sequencialmente:

```bash
# Validação de código e tipos
npm run lint
npm run build

# Testes unitários e de integração (Vitest)
npx vitest run --maxWorkers=1 --no-file-parallelism

# Testes de ponta a ponta (Playwright)
npx playwright test --workers=1
```

---

## Limitações Conhecidas

- **Cartas Físicas**: O sistema gerencia exclusivamente as fichas e regras de aposta. Não há geração nem visualização de cartas virtuais na tela; o anfitrião e os jogadores utilizam baralho físico na mesa.
- **Sem Senha por Sala**: Qualquer dispositivo na mesma rede local que possua o código de 6 caracteres ou escaneie o QR code pode solicitar entrada na sala.
- **Sem Pagamentos Reais**: As fichas são puramente fictícias/pontuações para controle presencial.
- **Escopo Exclusivo de Rede Local (LAN)**: Não há suporte a roteamento público, NAT traversal, WebRTC externo ou servidores em nuvem.

---

## Modelo de Segurança na Rede Local (LAN)

- **Comandos Administrativos Restritos**: Apenas o anfitrião possui o token de administração (`adminToken`) para iniciar a partida, avançar streets, apurar potes e avançar mãos.
- **Tokens de Sessão**: Cada jogador recebe um token criptográfico gerado pelo servidor, persistido em seu dispositivo e validado via hash HMAC.
- **Proteção do QR Code**: O QR code de convite e os links compartilhados contêm apenas o código público da sala (`/join/<codigo>`), nunca expondo segredos ou privilégios de anfitrião.
- **Content Security Policy (CSP) Estrita**: O servidor aplica cabeçalhos HTTP que restringem scripts, estilos e conexões exclusivamente à própria origem (`'self'`), bloqueando qualquer tentativa de telemetria ou comunicação externa.

---

## Estrutura do Projeto

O repositório é organizado como um monorepo TypeScript gerenciado com npm workspaces:

```
poker-table/
├── apps/
│   ├── server/           # Backend Node.js, Express, Socket.IO e SQLite
│   └── web/              # Frontend React, Vite, Tailwind/CSS e QR Code local
├── packages/
│   ├── engine/           # Motor puro de poker (regras de Texas Hold'em, potes, ações)
│   └── protocol/         # Contratos, esquemas de validação Zod e tipagens compartilhadas
├── scripts/
│   └── start.sh          # Script de inicialização offline para Linux/Ubuntu
├── tests/                # Testes unitários, de integração e cenários E2E Playwright
└── data/                 # Diretório de persistência SQLite local (não versionado)
```

---

## Licença e Uso

Este projeto foi desenvolvido para fins educacionais e uso pessoal em partidas recreativas presenciais. Todos os direitos reservados aos respectivos autores.
