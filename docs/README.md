# Documentação Técnica — Poker Table

Este diretório contém a documentação técnica, especificações de arquitetura e relatórios de engenharia desenvolvidos ao longo da evolução do Poker Table.

Cada documento registra as decisões de projeto, regras de autoridade, contratos de protocolo e auditorias de cada ciclo de entrega.

---

## Índice das Etapas de Desenvolvimento

### Etapa 3 — Infraestrutura de Jogo e Multiplayer LAN
- [Etapa 3A — Inicialização da primeira mão](etapa-3a.md): Comandos de criação de sala, assentos, papéis de Dealer/Small Blind/Big Blind e deduções automáticas de cacife.
- [Etapa 3B — Apostas e streets pela LAN](etapa-3b.md): Validação de turnos, ações dos jogadores (Fold, Check, Call, Raise, All-in) e transição de streets.
- [Etapa 3C — Showdown, Distribuição de Prêmios e Próximas Mãos](etapa-3c.md): Apuração de vencedores, potes principais e paralelos (*side pots*), empates (*split pot*) e rotação do botão.
- [Etapa 3D — Auditoria de Estabilidade e Robustez](etapa-3d.md): Testes de resiliência a quedas de rede, reconexão de clientes e integridade do banco SQLite.

### Etapa 4 — Interface Mobile-First e Experiência do Usuário
- [Etapa 4A — Design System Mobile e Estrutura da Mesa](etapa-4a.md): Layout responsivo da mesa, posicionamento ergonômico de assentos e fichas.
- [Etapa 4B — Controles de Apostas Mobile](etapa-4b.md): Seletor numérico de apostas, atalhos táticos de raise e confirmação de all-in.
- [Etapa 4C — Avanço de Streets e Controles do Anfitrião](etapa-4c.md): Painel do anfitrião para confirmação de cartas físicas comunitárias e transição de fases.
- [Etapa 4D — Liquidação de Mãos e Próximas Rodadas](etapa-4d.md): Fluxo de Showdown na tela do anfitrião e encerramento automático por desistência.
- [Etapa 4E.1 — Correções de Usabilidade](etapa-4e1.md): Refinamentos de ergonomia tátil e remoção de elementos deformados no mobile.
- [Etapa 4E.2 — Refinamento Mobile e Redução de Redundâncias](etapa-4e2.md): Otimização visual, feedback tátil e consolidação de controles.
- [Etapa 4E.3 — Validação Offline e Preparação para Uso Real](etapa-4e3.md): Auditoria do QR Code offline, CSP estrita e estabilização para a release v0.1.0.

### Etapa 5 — Plataforma Android Autônoma
- [Etapa 5A.1 — Hospedagem no Android via Termux](etapa-5a1.md): Investigação preliminar e scripts portáteis para execução via ambiente Termux (opção alternativa/legada).
- [Etapa 5B.1 — Aplicativo Android com Servidor Integrado](etapa-5b1.md): Protótipo de aplicativo Kotlin com WebView integrada e Foreground Service.
- [Etapa 5B.2 — Integração Real do Node.js ao APK](etapa-5b2.md): Empacotamento de runtime nativo Node.js 24 FULL (`libnode.so`), ponte C++ (JNI) e compilação NDK para `arm64-v8a`.
- [Etapa 5B.3 — Refinamento e Estabilização do Aplicativo Android](etapa-5b3.md): Detecção e seleção de interfaces de rede (Wi-Fi e Hotspot móvel), sincronização de IP da WebView e persistência de sessão.

---

## Arquitetura Geral

O Poker Table adota uma arquitetura em camadas estritamente isoladas:

1. **Motor de Poker (`packages/engine`)**:
   - Totalmente desacoplado de React, Socket.IO, Express e SQLite.
   - Lógica determinística e funcional: cálculo de potes, side pots, turnos, limites de aposta e regras de Texas Hold'em.
   - Cobertura extensiva de testes unitários com Vitest.

2. **Protocolo Compartilhado (`packages/protocol`)**:
   - Esquemas de validação em tempo de execução com Zod.
   - Tipagens estritas em TypeScript compartilhadas entre cliente, servidor e aplicativo.

3. **Servidor Autoritativo (`apps/server`)**:
   - Express 5 + Socket.IO 4 para comunicação em tempo real via WebSockets.
   - Persistência transacional com SQLite nativo (`node:sqlite`).
   - Os clientes nunca modificam o estado diretamente; toda ação é processada e validada pelo servidor.

4. **Cliente Web (`apps/web`)**:
   - Interface móvel em React 19, Vite e Tailwind CSS.
   - Geração de QR Code 100% offline via Canvas, sem dependência de internet ou CDNs externas.

5. **Aplicativo Android Standalone (`apps/android`)**:
   - App nativo em Kotlin executando o servidor Node.js 24 incorporado em C++ através de JNI.
   - Foreground Service persistente para evitar suspensão pelo gerenciador de bateria do Android.
