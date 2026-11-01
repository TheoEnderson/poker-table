# Etapa 4D — Liquidação de Mãos, Distribuição de Potes e Próximas Mãos

## 1. Visão Geral

A **Etapa 4D** conclui o ciclo funcional de uma partida presencial de Texas Hold'em no Poker Table:
1. Encerramento da rodada de apostas (Showdown ou Desistência).
2. Identificação e seleção autoritativa de vencedores.
3. Liquidação e distribuição determinística de potes (principal e secundários).
4. Exibição pública dos resultados financeiros e eliminações.
5. Início da próxima mão com rotação de dealer e blinds, ou encerramento definitivo com celebração do campeão.

A aplicação opera sem distribuição digital de cartas nem avaliação automática de mãos: as cartas físicas são avaliadas presencialmente pelos participantes, e o anfitrião registra os vencedores pela interface mobile em rede local sem internet.

---

## 2. Auditoria e Reutilização dos Contratos Existentes

Todo o processamento financeiro e de transição de estados permanece no backend autoritativo:
- **`settle-hand` (`packages/protocol` & `apps/server/src/rooms/service.ts`):**
  - Schema de entrada: `{ type: 'settle-hand', decisions: [{ potId: string, winners: string[] }] }`.
  - Exige credenciais administrativas do anfitrião (`this.admin(c, row)`).
  - Executa a função pura `settleHandFlow` do motor (`@poker-table/engine`).
  - Idempotência garantida por `commandId` (UUID) e concorrência optimística por `expectedRevision`.
- **`next-hand` (`packages/protocol` & `apps/server/src/rooms/service.ts`):**
  - Schema de entrada: `{ type: 'next-hand' }`.
  - Exige anfitrião autenticado.
  - Executa `startNextHand` do motor, eliminando jogadores sem fichas (`chips === 0`), rotacionando o dealer conforme as Regras TDA 2026 (inclusive a transição para heads-up TDA 36-C) e cobrando automaticamente as blinds da nova mão.
  - Rejeita execuções quando `game.status === 'game-complete'` com código `GAME_OVER`.

---

## 3. Extensão Mínima do Protocolo e Integração de `buildPots(hand)`

Para que o frontend exiba os potes reais e os jogadores elegíveis sem duplicação de regras financeiras no React, foram adicionados dois campos opcionais e somente leitura em `handSnapshotSchema` (`packages/protocol/src/game.ts`):

```typescript
pots: z.array(potSnapshotSchema).optional(),
survivorId: z.uuid().nullable().optional(),
```

- **Validação Completa pelo Motor (`apps/server/src/game/initial-hand.ts`):**
  A projeção pública utiliza diretamente `buildPots(hand)` passando o objeto `HandFlowState`. Dessa forma, o motor reaproveita integralmente suas validações matemáticas de correspondência entre contribuições individuais e valor total do pote, respeita a restituição de apostas não cobertas (`settleUncalled`), e projeta listas de IDs elegíveis (`eligiblePlayers`) para potes principais e side pots.
- **Segurança:** Nenhuma lógica de divisão de fichas ou de potes paralelos é calculada no cliente web. Se o estado estiver em andamento (`in_progress`), `pots` não é projetado.

---

## 4. Interface de Seleção de Vencedores (`HostSettlementControls.tsx`)

O componente `HostSettlementControls` atua em dois cenários distintos com ergonomia mobile-first:

### 4.1 Cenário A: Vencedor por Desistência (Fold)
Quando todos os adversários desistem, o motor define o vencedor de forma determinística:
- O painel exibe um cartão com destaque:
  `"Mão encerrada por desistência"`
  `"Vencedor da mão: #Assento Nome"`
  `"Pote a receber: X fichas"`
- Botão com altura mínima de 48px: `"Confirmar distribuição das fichas"`.
- O anfitrião não precisa selecionar manualmente o vencedor já determinado pelo motor.
- O diálogo de confirmação valida a transferência e envia `command({ type: 'settle-hand', decisions: [] })`.

### 4.2 Cenário B: Showdown com Cartas Físicas
Quando a mão avança até o showdown:
- **Potes Claramente Distintos:** Exibe cada pote calculado pelo motor (`Pote Principal` e eventuais `Potes Paralelos`).
- **Status Visual por Pote:** Cada caixa de pote possui uma pílula informativa (`✓ Definido` em verde ou `⚠️ Pendente` em amarelo).
- **Candidatos Elegíveis:** Botões individuais com assento, nome e indicador de toque para cada jogador presente em `pot.eligiblePlayers`. Jogadores que desistiram ou não cobriram o pote não aparecem como selecionáveis.
- **Potes com Elegível Único:** Potes secundários disputados por apenas um jogador são automaticamente pré-selecionados sem exigir ação do anfitrião.
- **Bloqueio de Confirmação:** O botão principal `"Confirmar Liquidação do Showdown ♠"` permanece desabilitado enquanto qualquer pote disputado estiver com seleção pendente.

### 4.3 Orientação para Showdown Antecipado por All-in
Quando todos os jogadores ativos entram em All-in antes do River (`game.hand.street !== 'river'`), a mão transita diretamente para o showdown. O painel do anfitrião exibe uma notificação destacada (`.early-showdown-notice`):
- `"⚠️ Showdown antecipado por All-in"`
- `"Revele todas as cartas comunitárias restantes na mesa física antes de declarar os vencedores."`
- Nenhuma street é avançada artificialmente e nenhuma alteração financeira é provocada no cliente.

---

## 5. Empates (Split Pot) e Arquitetura Pura de `toggleTie`

Para suportar mãos empatadas com cartas idênticas na mesa física:
- Cada pote possui um controle explícito `"Dividir pote (empate entre jogadores)"`.
- A alternância do modo empate (`toggleTie`) foi estruturada com atualizadores de estado estritamente puros e desacoplados:
  `setTieMode(prev => ({ ...prev, [potId]: willEnableTie }))`
  Quando desativado, `setSelectedWinners` retém apenas o primeiro vencedor selecionado sem aninhamento de chamadas.
- O motor de poker (`settleHandFlow`) recebe a lista de IDs em `winners` e divide as fichas igualmente.
- Fichas indivisíveis (ímpares) são alocadas no sentido horário a partir do dealer conforme a Regra 21 da Poker TDA.
- O resultado confirmado é difundido pelo servidor para todos os clientes, sem cálculo paralelo no cliente.

---

## 6. Confirmação Obrigatória e Proteção de Concorrência

1. **Modal de Confirmação (`ConfirmDialog`):**
   - Apresenta o resumo discriminado de cada pote, valor e respectivos vencedores (com indicação explícita de empates).
   - O toque em "Cancelar" fecha o diálogo sem qualquer efeito colateral.
2. **Proteção Contra Reenvios e Concorrência:**
   - Durante a requisição, botões entram em estado de carregamento (`aria-busy="true"` e `disabled={pending || disabled}`).
   - O comando transporta `commandId` único (UUID) e `expectedRevision` optimística.
   - Caso a mão mude de estado externamente ou ocorra reconexão durante o modal aberto, o `useEffect` descarta a confirmação obsoleta automaticamente.

---

## 7. Apresentação dos Resultados e Eliminações

Após a liquidação autoritativa (`game.status === 'hand-settled'` ou `'game-complete'`):
- **`SettlementBanner`:**
  - Total distribuído em fichas.
  - Discriminação de cada pote com seu vencedor ou lista de vencedores em caso de empate.
  - Seção de eliminações: lista os jogadores que ficaram com 0 fichas.
- **`PlayerCard`:**
  - Jogadores eliminados recebem a tag visual destacada `ELIMINADO`.
  - Stacks dos jogadores exibem os valores reais já creditados pelo servidor.

---

## 8. Iniciar Próxima Mão e Encerramento do Torneio

- **Próxima Mão:**
  - O anfitrião visualiza o botão destacado `"Iniciar Próxima Mão ♠"`.
  - Jogadores comuns visualizam o dock informativo `"Mão liquidada. Aguardando o anfitrião iniciar a próxima mão."`.
  - Ao clicar, o anfitrião dispara `command({ type: 'next-hand' })`.
  - O servidor atualiza o dealer, exclui os eliminados, debita os novos blinds e difunde a nova mão pré-flop.
- **Fim da Partida (`game-complete`):**
  - Quando resta apenas um participante com fichas, o servidor transita para `game-complete`.
  - O banner anuncia `"🏆 Fim de Partida"` e coroa o campeão com o total de fichas do torneio.
  - Nenhum botão de próxima mão é apresentado.

---

## 9. Verificação e Testes

### 9.1 Testes de Integração e Servidor (Vitest)
O arquivo `tests/game-4d-settlement.test.ts` adicionou 13 testes:
1. `liquida corretamente mão encerrada por fold com decisões vazias`.
2. `liquida showdown com vencedor único informado pelo anfitrião`.
3. `distribui igualmente fichas do pote quando houver empate entre múltiplos vencedores`.
4. `projeta potes paralelos e permite liquidação independente de cada pote` (com stacks desiguais legítimos e verificação matemática de Pote Principal de 600 fichas e Pote Secundário de 600 fichas).
5. `projeta pote secundário com apenas um jogador elegível e aceita decisão pré-selecionada`.
6. `preserva a conservação matemática exata das fichas da mesa após a liquidação`.
7. `deduplica comandos settle-hand com mesmo commandId`.
8. `rejeita settle-hand com revisão desatualizada`.
9. `rejeita settle-hand e next-hand enviados por participante comum (FORBIDDEN)`.
10. `rejeita tentativa de liquidar novamente uma mão já liquidada`.
11. `inicia próxima mão com rotação correta de dealer, blinds preservados e stacks atualizados`.
12. `reconhece eliminação de jogador e encerra a partida como game-complete quando restar apenas um com fichas`.
13. `recupera o estado de hand-settled após reinício do servidor`.

Total Vitest: **476 testes aprovados em 23 arquivos**.

### 9.2 Testes E2E Reais (Playwright)
O arquivo `tests/e2e/active-table.spec.ts` inclui 5 testes E2E para o fluxo completo da Etapa 4D com múltiplos contextos de navegador (`browser.newContext()`):
1. `host selects showdown winner via UI, settles hand, reviews results and starts next hand (Etapa 4D)`:
   - Ciclo real completo via UI: pré-flop, avanço de streets até showdown, seleção de vencedor no painel do anfitrião, confirmação modal, exibição de prêmios e início da próxima mão com dealer rotacionado.
2. `host settles fold-ended hand via UI and confirms prize distribution (Etapa 4D)`:
   - Desistência no pré-flop, reconhecimento do sobrevivente, liquidação por desistência no painel mobile e atualização dos stacks.
3. `host declares showdown tie (split pot) via UI with multiple winners (Etapa 4D)`:
   - Ativação do modo empate, seleção múltipla de vencedores, alternância repetida e pureza de `toggleTie`, confirmação e divisão igualitária do pote principal no `SettlementBanner`.
4. `host sees early showdown guidance when hand enters showdown before river due to all-in (Etapa 4D)`:
   - All-in mútuo no pré-flop, entrada imediata em showdown, apresentação do aviso de revelação de comunitárias físicas (`.early-showdown-notice`) e conclusão da mão com eliminação.
5. `host manages multiway hand with real side pots, selects distinct winners per pot via UI, and synchronizes final stacks (Etapa 4D)`:
   - Partida com 3 jogadores em contextos de navegador isolados; construção legítima de stacks desiguais; all-in de jogador curto com criação de Pote Principal (600) e Pote Paralelo (600); visualização separada dos potes com apenas os candidatos elegíveis de cada um; seleção de vencedores diferentes; confirmação discriminada; e verificação da sincronização e conservação exata das fichas entre todas as sessões.

Total Playwright: **17 testes aprovados**.
