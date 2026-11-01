# Etapa 4A — Design System Mobile e Estrutura da Mesa

## 1. Visão Geral

A **Etapa 4A** introduziu a primeira versão da interface visual de jogo mobile-first para o Poker Table, projetada especificamente para jogadores que participam de partidas presenciais conectando seus smartphones ao servidor local via Wi-Fi.

Nesta etapa, o foco foi a **arquitetura de visualização, ergonomia visual e legibilidade financeira**, sem introduzir ações funcionais de aposta ou governança administrativa (reservadas para as subetapas 4B a 4D).

Todos os **450 testes Vitest** e **6 testes Playwright E2E** (incluindo responsividade a 320px, fluxo de início do lobby com desconexão e modo espectador) foram aprovados.

---

## 2. Decisões de Design System e Identidade Visual

A interface foi inspirada em mesas profissionais de poker de alto nível, refinada para visualização rápida sob diferentes condições de iluminação em celulares:

- **Fundo Grafite Profundo (`#0d1411` a `#1a2721`):** Reduz o cansaço visual e cria superfícies de cartas e painéis com profundidade discreta.
- **Verde-Esmeralda (`#10b981` / `#064e3b`):** Aplicado nos elementos de destaque de ação, feltro central da mesa e sinalização do jogador da vez (com pulso visual sutil).
- **Dourado Acetinado (`#e2bc73` / `#f59e0b`):** Reservado com exclusividade para grandezas monetárias (stacks, potes), botão do Dealer (`D`) e distinção do anfitrião (`Host`).
- **Vermelho-Rubi (`#ef4444` / `#7f1d1d`):** Reservado para situações críticas como All-in e perda de conexão.
- **Tipografia Numérica Tabular (`font-variant-numeric: tabular-nums`):** Garante alinhamento numérico impecável sem que os valores "saltem" ao serem atualizados.
- **Sem Novas Dependências:** Implementação 100% nativa em CSS moderno e React 19, sem frameworks pesados de componentes ou animações.

---

## 3. Componentização

Os novos componentes de visualização foram organizados na pasta `apps/web/src/components/`:

### 3.1 Componentes Comuns (`components/common/`)
- **`ChipAmount`:** Renderiza quantias financeiras com formatação monetária brasileira (`pt-BR`), números tabulares, tamanhos consistentes (`sm`, `md`, `lg`, `xl`) e glifo dourado de ficha.

### 3.2 Componentes da Mesa (`components/table/`)
- **`ActiveTable`:** Coordenador principal da mesa em modo de partida iniciada (`room.game !== null`). Integra o cabeçalho compacto, pote, fita de jogadores, painel pessoal e rodapé.
- **`StreetIndicator`:** Badge semântico indicando a fase atual: `PRÉ-FLOP`, `FLOP`, `TURN`, `RIVER`, `SHOWDOWN`, `MÃO ENCERRADA`, `MÃO LIQUIDADA` ou `PARTIDA ENCERRADA`.
- **`PotSummary`:** Painel central de destaque com o Pote Total acumulado, indicador de Blinds (`SB / BB`) e sinalização clara do jogador que possui a vez de agir.
- **`SeatStrip`:** Fita horizontal com rolagem suave (`scroll-snap`), acomodando confortavelmente de 2 a 10 jogadores sem quebrar a largura da página.
- **`PlayerCard`:** Card compacto individual de cada assento exibindo:
  - Número do assento (`#1`, `#2`...).
  - Nome do participante.
  - Stack atual de fichas.
  - Badges semânticos: Dealer (`D`), Small Blind (`SB`), Big Blind (`BB`), Próprio usuário (`Você`).
  - Tags de estado: `FOLD`, `ALL-IN`, `SUA VEZ`, ou aposta corrente na street (`+{roundCommitted}`).
  - Presença em rede (indicador discreto de ausência caso o jogador desconecte).
- **`MyStatusPanel`:** Console tático do jogador autenticado. Aponta com destaque o seu stack pessoal, seu assento, o total já apostado na street e pílulas de status imediato (`É A SUA VEZ DE AGIR!`, `Aguardando sua vez`, `Fold`, `All-in`, `Eliminado`).
- **`FutureActionDock`:** Área reservada no rodapé para os futuros botões de aposta da Etapa 4B, exibindo estados puramente informativos e contextuais sem botões falsos.
- **`SettlementBanner`:** Exibido em estados `hand-settled` e `game-complete`, detalhando o total distribuído, os vencedores de cada pote e a consagração do campeão final.

---

## 4. Preservação do Lobby e Compatibilidade

A separação de estados foi estritamente mantida:
- **Lobby (`room.game === null`):** A experiência original de preparação com seleção de assentos no `SeatMap`, compartilhamento de código, QR Code e entrada de convidados permanece 100% funcional. Foi adicionado para o anfitrião o botão "Iniciar partida ♠" assim que 2 ou mais jogadores sentam e conectam.
- **Partida Iniciada (`room.game !== null`):** A tela transita para o console mobile `ActiveTable`. Na parte inferior, uma seção secundária acessível mantém o `SeatMap` (com assentos bloqueados), o formulário de perfil e a nota de sincronização, garantindo que os jogadores ainda possam ajustar seu nome ou sair da mesa, e preservando integralmente a compatibilidade com a suíte de testes E2E do Playwright (`game-start.spec.ts`).

---

## 5. Respeito às Restrições do Protocolo e Refinamentos de UX

Em conformidade com a arquitetura definida e a auditoria final da Etapa 4A:
- **Alinhamento da Condição de Início com o Backend:** A condição de habilitação de início da partida valida estritamente se `seatedCount >= 2` e se todos os jogadores sentados estão conectados (`allSeatedConnected`), evitando rejeições ou inconsistências visuais.
- **Visibilidade Proeminente da Ação de Início no Lobby:** O botão de iniciar foi posicionado no painel principal, logo acima do mapa de assentos (`SeatMap`). Quando bloqueado, apresenta avisos discretos e contextuais informando o motivo (e.g. *"Aguardando pelo menos 2 participantes sentados para iniciar."* ou *"Aguardando todos os participantes sentados se conectarem."*). Botões duplicados foram eliminados da barra lateral.
- **Rótulo Dinâmico do Pote:** O componente `PotSummary` adapta seu título semântico para `"POTE TOTAL"` durante as streets ativas, `"POTE DISTRIBUÍDO"` na liquidação (`hand-settled`) e `"POTE DA ÚLTIMA MÃO"` no encerramento da partida (`game-complete`).
- **Diferenciação Visual de Espectadores e Eliminados:** Participantes sem assento (`seat === null`) visualizam a mesa em modo espectador explícito (`"MODO ESPECTADOR"`, `"Sem assento"`, `"Apenas observando"`), sem simulação de stacks fictícios. Participantes eliminados são sinalizados com seu saldo real zerado e tag de eliminação.
- **Visibilidade Primária de Erros:** Erros retornados pelo servidor são exibidos com destaque no topo da mesa ativa (`ActiveTable`), permitindo reação imediata dos jogadores em caso de falhas de comando ou rede.
- O frontend consome exclusivamente as propriedades públicas de `handSnapshotSchema` e `settlementSnapshotSchema`.
- Nenhuma regra interna do motor (como `currentRound.currentBet` ou incrementos mínimos) foi inventada ou presumida no cliente.
- Durante a mão ativa, os stacks exibidos provêm de `game.hand.players`. Após a liquidação (`hand-settled` ou `game-complete`), os stacks finais provêm de `game.settlement.players`, assegurando que o saldo exibido reflita exatamente o crédito dos prêmios.

---

## 6. Próximos Passos (Etapa 4B em diante)

- **Etapa 4B:** Implementação dos controles funcionais de apostas no `ActionDock` (Fold, Check, Call, seletor de Raise e All-in com travas contra toques acidentais).
- **Etapa 4C:** Controles do anfitrião para avanço de streets (`advance-street`) e feedback tátil/vibração ao receber a vez.
- **Etapa 4D:** Modal de seleção manual de vencedores (`settle-hand`) e acionamento de `next-hand`.
- **Etapa 4E:** Polimento final, atalhos rápidos e auditoria completa de acessibilidade.
