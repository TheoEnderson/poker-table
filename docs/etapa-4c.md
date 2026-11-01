# Etapa 4C — Avanço de Streets e Controles do Anfitrião

## 1. Visão Geral

A **Etapa 4C** implementou a coordenação e os controles de avanço entre as fases do Texas Hold'em (**Pré-flop → Flop → Turn → River → Showdown**) para partidas presenciais com cartas físicas e celulares conectados à rede local.

O anfitrião da mesa é o responsável por avançar as rodadas após a colocação das cartas físicas na mesa, enquanto o servidor autoritativo mantém a validação transacional e determinística do motor de poker.

---

## 2. Auditoria e Semântica do Avanço de Streets

### 2.1 Comando `advance-street`
- O comando `advance-street` faz parte dos contratos do protocolo (`@poker-table/protocol`):
  ```typescript
  { type: 'advance-street' }
  ```
- O comando transporta `commandId` (UUID) para idempotência e `expectedRevision` para validação de concorrência optimística.

### 2.2 Autorização Administrativa no Servidor
- No backend (`apps/server/src/rooms/service.ts`), a execução de `advance-street` exige verificação administrativa rigorosa:
  ```typescript
  this.admin(c, row);
  ```
- Caso um participante comum (sem credencial de anfitrião ou sem token administrativo válido) envie o comando, o servidor rejeita imediatamente a operação com erro `FORBIDDEN`.

### 2.3 Condições do Motor para Avanço
- No motor (`packages/engine/src/hand-flow.ts`), a função `canAdvanceStreet(state)` estabelece os requisitos autoritativos:
  1. A mão precisa estar em andamento (`state.status === 'in_progress'`).
  2. A rodada de apostas da street atual precisa estar concluída (`state.currentRound.status === 'completed'`).
- Tentativas prematuras de avanço (quando jogadores ainda possuem ações pendentes) são rejeitadas pelo servidor com o código `CANNOT_ADVANCE_STREET`.
- Quando a mão já alcançou o showdown ou foi encerrada por desistência (`hand_ended_by_fold`), qualquer avanço é rejeitado com `HAND_ALREADY_COMPLETED`.

### 2.4 Projeção Autoritativa no Snapshot Público (`canAdvanceStreet`)
- Para evitar duplicação ou dedução heurística de regras do motor no cliente mobile, o protocolo estendeu `handSnapshotSchema`:
  ```typescript
  canAdvanceStreet: z.boolean().optional()
  ```
- O servidor projeta o valor autoritativo calculado por `canAdvanceStreet(hand)` no snapshot público da mão.
- O componente visual exige estritamente `hand.canAdvanceStreet === true`, sem tentar inferir permissões localmente por contagem de jogadores ou atores pendentes. Se o campo estiver ausente ou falso, o controle não é habilitado.

---

## 3. Componente `HostStreetControls` (`components/table/HostStreetControls.tsx`)

O painel administrativo do anfitrião foi implementado com design compacto, alta usabilidade e respeito às restrições de espaço em smartphones:

1. **Conformidade com as Regras de Hooks:** Todos os Hooks React (`useState`, `useEffect`) são executados incondicionalmente no topo do componente, na mesma ordem em cada renderização, prevenindo divergências de estado entre transições de status (`hand-active`, `hand-settled`, `game-complete`). O efeito de invalidação monitora `game.status`, `room.revision`, `hand.street`, `hand.status` e `canAdvance`.
2. **Exclusividade:** Visível exclusivamente para o anfitrião da partida (`isHost: true`) durante a mão ativa (`hand.status === 'in_progress'`) quando `canAdvanceStreet === true`. Jogadores comuns e espectadores nunca visualizam os controles administrativos.
3. **Ocupação sob Demanda:** Quando o estado da rodada não permite avanço (ou seja, durante as rodadas ativas de apostas ou após showdown/liquidação), o componente retorna `null`, garantindo que não ocupe espaço visual na tela.
4. **Identificação Clara das Transições:**
   - **Pré-flop encerrado:** Botão `Iniciar Flop ♠` (revela as 3 primeiras cartas comunitárias).
   - **Flop encerrado:** Botão `Iniciar Turn ♠` (revela a 4ª carta comunitária).
   - **Turn encerrado:** Botão `Iniciar River ♠` (revela a 5ª carta comunitária).
   - **River encerrado:** Botão `Ir para Showdown ♠` (transita para a apuração final).
5. **Touch Target Ergonômico:** Botões com altura mínima de 48px, respeitando os padrões de acessibilidade para interação com o polegar.
6. **Invalidação Automática de Diálogos:** Caso uma sincronização externa, mudança de street ou atualização de status ocorra enquanto o modal de confirmação estiver aberto, o diálogo é descartado automaticamente para prevenir submissões obsoletas.

---

## 4. Confirmação Acessível de Cartas Físicas

Como o Poker Table opera com cartas físicas de baralho, o anfitrião precisa distribuí-las na mesa real antes de avançar o estado virtual:

- **Flop:** Modal com título `"Iniciar Flop?"` e instrução `"Confirme que as três cartas do flop já foram colocadas na mesa."`.
- **Turn:** Modal com título `"Iniciar Turn?"` e instrução `"Confirme que a carta do turn (quarta carta) já foi colocada na mesa."`.
- **River:** Modal com título `"Iniciar River?"` e instrução `"Confirme que a carta do river (quinta carta) já foi colocada na mesa."`.
- **Showdown:** Transição direta sem modal de cartas, pois nenhuma carta comunitária adicional precisa ser revelada na mesa.
- **Cancelamento Seguro:** O toque em "Cancelar" fecha o diálogo sem qualquer efeito colateral ou alteração de estado no servidor.

---

## 5. Tratamento de All-ins e Casos Especiais

- Quando todos os jogadores restantes vão All-in (ou quando resta apenas um jogador com fichas que já cobriu todos os all-ins adversários), o motor de poker conclui a rodada e avança a mão diretamente para o estado `showdown`.
- Nesses cenários, os controles de aposta e avanço de street encerram seu ciclo naturalmente, e o painel exibe `"Showdown: cartas na mesa. Aguardando a distribuição dos prêmios."`.
- Nenhuma street artificial ou aposta fantasma é criada para jogadores sem fichas.

---

## 6. Feedback Contextual para os Jogadores

Enquanto o anfitrião não aciona o avanço de street, os jogadores recebem mensagens contextuais e precisas no rodapé informativo (`ActionDock`):

- **No Pré-flop:** `"Aguardando o anfitrião iniciar o Flop."`
- **No Flop:** `"Aguardando o anfitrião iniciar o Turn."`
- **No Turn:** `"Aguardando o anfitrião iniciar o River."`
- **No River:** `"Rodada de apostas encerrada. Aguardando Showdown."`
- **Para o Anfitrião:** `"Apostas igualadas. Aguardando o anfitrião avançar a rodada."`

Após a confirmação autoritativa do servidor, todos os clientes sincronizam a nova street e o estado do pote simultaneamente via Socket.IO.

---

## 7. Verificação e Testes

### 7.1 Testes de Integração e Servidor (Vitest)
O arquivo `tests/game-4c-advance-street.test.ts` foi adicionado com 7 testes:
1. `permite ao anfitrião avançar pelas streets (flop -> turn -> river -> showdown) quando a rodada está concluída`.
2. `rejeita avanço de street enviado por participante que não é anfitrião (FORBIDDEN)`.
3. `rejeita avanço prematuro quando ainda existem ações pendentes na street (CANNOT_ADVANCE_STREET)`.
4. `deduplica comandos advance-street idempotentemente com mesmo commandId`.
5. `rejeita advance-street com revisão desatualizada (STALE_STATE)`.
6. `transita diretamente para showdown quando todos os jogadores restantes estão all-in e rejeita avanço posterior`.
7. `difunde o estado atualizado da street para todos os clientes conectados`.

Total da suíte Vitest: **463 testes aprovados em 22 arquivos**.

### 7.2 Testes E2E (Playwright)
Em `tests/e2e/active-table.spec.ts`, foram adicionados e refinados dois testes completos de ponta a ponta (totalizando **12 testes E2E aprovados**):
1. `host advances streets progressively with physical card confirmations until showdown (Etapa 4C)`:
   - Isolamento real de sessões via `browser.newContext()` para convidados, garantindo partições independentes de `localStorage` e cookies com fechamento em bloco `finally`.
   - Persistência e validação da sessão do anfitrião após entrada de participantes e reloads da página (`await page.reload()`).
   - Sequência real completa: Pré-flop → Flop → Turn → River → Showdown.
   - Diálogo modal de confirmação física e cancelamento sem efeitos colaterais.
   - Verificação de layout responsivo a 320px e áreas de toque de 48px.
2. `survives hand-settled and next-hand state transitions without React Hook errors`:
   - Monitoramento contínuo de erros de console e exceções de página.
   - Avanço progressivo por todas as streets até o showdown.
   - Liquidação autoritativa pelo anfitrião (`settle-hand`), verificando renderização estável em `hand-settled`.
   - Validação de que nenhuma violação das Regras de Hooks (`Rendered fewer/more hooks than expected`) ocorre durante as mudanças de fase.
   - Início de nova mão (`next-hand`), validando o ciclo de vida completo sem degradação.

