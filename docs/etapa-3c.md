# Etapa 3C — Showdown, Distribuição de Prêmios e Próximas Mãos Multiplayer

## Contratos e permissões

A Etapa 3C adiciona dois novos comandos administrativos emitidos pelo anfitrião através dos eventos existentes `room:command` e sincronizados via `room:state` e `room:sync`:

```ts
// Liquidação da mão concluída (showdown ou fold geral)
{
  type: 'settle-hand',
  decisions: [{ potId: 'main', winners: ['uuid1', 'uuid2'] }],
  commandId,
  expectedRevision
}

// Início da próxima mão a partir do resultado liquidado
{
  type: 'next-hand',
  commandId,
  expectedRevision
}
```

Ambos os comandos exigem identidade do anfitrião e validação estrita do `adminToken` em timing constante via `admin_hash` no banco. Clientes comuns que tentarem emitir `settle-hand` ou `next-hand` recebem `FORBIDDEN`.

O comando `settle-hand` recebe uma lista tipada de decisões por pote (`potId` e array não vazio de `winners`). Se omitido ou vazio em encerramentos por fold, o sobrevivente único é premiado automaticamente pelo motor. Em showdown, o servidor rejeita com `MISSING_DECISION` qualquer pote disputado sem vencedor informado, com `DUPLICATE_DECISION` decisões repetidas para o mesmo pote, com `INVALID_POT` potes inexistentes e com `INELIGIBLE_WINNER` vencedores não elegíveis (jogadores que deram fold ou all-in em níveis inferiores).

## Formato do GameState e SettlementSnapshot

O estado público da partida (`game`) evolui para uma união discriminada estrita baseada em `status`:

1. `hand-active`: mão em andamento pelas streets (`preflop`, `flop`, `turn`, `river`) ou concluída aguardando liquidação (`showdown`, `hand_ended_by_fold`).
2. `hand-settled`: prêmios distribuídos com sucesso pelo motor; a mesa aguarda o comando do anfitrião para abrir a mão seguinte.
3. `game-complete`: restou apenas um jogador com fichas na mesa após a liquidação; o jogo está oficialmente encerrado e identifica `winnerId`.

Todos os três estados preservam a propriedade `hand: HandSnapshot`, garantindo que consumidores existentes (como telas e componentes de assentos) nunca encontrem propriedades indefinidas.

O `SettlementSnapshot` projeta de forma imutável e transparente os detalhes da distribuição:
- `originalPot`: montante acumulado total antes dos pagamentos.
- `dealerSeat`: assento do dealer da mão liquidada.
- `players`: lista de participantes com `chips` atualizados, `totalWon`, `previousChips`, flags `folded` e `isAllIn`.
- `pots`: cada pote construído (`main` ou `side`), seu índice, valor e lista de IDs elegíveis.
- `potAwards`: resolução detalhada pote a pote, contendo os vencedores declarados e o valor exato destinado a cada um (incluindo tratamento de divisões e fichas ímpares pela Regra TDA 21).
- `summary`: total consolidado distribuído e resumo de premiações por jogador.

Essa estrutura permite que os celulares de todos os jogadores apresentem com fidelidade para onde foram as fichas de cada pote, sem expor regras internas ou segredos do servidor.

## Ciclo de vida completo e conservação de fichas

O fluxo entre mãos obedece a regras rígidas de integridade:

1. **Apostas e Encerramento:** Os jogadores apostam até o showdown ou até restarem folds suficientes. Apostas ou avanços posteriores são bloqueados com `HAND_ALREADY_COMPLETED`.
2. **Liquidação (`settle-hand`):** O anfitrião informa os vencedores. O motor executa `settleHandFlow()` de forma pura. As fichas dos potes são creditadas aos stacks finais. O pote zera.
3. **Avaliação de Sobreviventes:**
   - Se 2 ou mais jogadores possuem fichas (`chips > 0`), o estado passa para `hand-settled`.
   - Se 1 jogador possui fichas, o estado passa para `game-complete` com `winnerId`. Chamadas futuras a `next-hand` são rejeitadas com `GAME_OVER`.
4. **Próxima Mão (`next-hand`):**
   - Jogadores com `chips === 0` são eliminados e excluídos de `hand.players`.
   - O botão do dealer rotaciona deterministicamente no sentido horário entre os jogadores ativos remanescentes.
   - Em transições para Heads-Up (2 jogadores ativos), aplica-se a Regra 36-C da Poker TDA 2026: o botão é ajustado para impedir que um jogador pague o Big Blind duas vezes seguidas.
   - Small Blind e Big Blind são cobrados dos novos assentos respectivos.
   - Uma nova rodada pré-flop é aberta com `handNumber` incrementado.

**Conservação absoluta do orçamento:** Em todas as transições e mãos, a soma dos stacks de todos os participantes (incluindo eliminados com zero) somada ao pote da mão atual é exatamente igual ao orçamento inicial da mesa (`startingChips * totalDeJogadores`). Nenhuma fração de ficha é criada ou destruída.

## Persistência SQLite v3 e Verificação Determinística

O armazenamento persiste no campo `rooms.game` como JSON v3 (mantendo suporte transparente de leitura para mãos v1 e v2 legadas):

- `persistedV3Active`: `{ version: 3, status: 'hand-active', hand, handNumber, tableBudget, previousSettlement? }`
- `persistedV3Settled`: `{ version: 3, status: 'hand-settled', hand, settlement, decisions, handNumber, tableBudget }`
- `persistedV3Complete`: `{ version: 3, status: 'game-complete', hand, settlement, winnerId, decisions, handNumber, tableBudget }`

A validação de integridade no servidor (`verifyGameV3`) não reproduz regras ad-hoc nem duplica lógica:
- Para estados liquidados (`hand-settled` e `game-complete`), o validador executa a função pura `settleHandFlow(hand, decisions)` do motor e compara profundamente o resultado calculado com o `settlement` persistido. Isso valida matematicamente todos os potes principais, potes paralelos, divisões e regra de fichas ímpares.
- Para mãos subsequentes (`handNumber > 1`), o validador executa `startNextHand(previousSettlement)` e compara o estado inicial `handState` com a origem da nova mão, comprovando que stacks, blinds e dealer foram determinados exclusivamente pelo motor.
- O orçamento total da mesa (`tableBudget`) é verificado em todas as etapas.

## Transações, Idempotência e Tratamento de Erros

Todas as operações de `settle-hand` e `next-hand` são processadas sob transação SQLite com bloqueio imediato (`BEGIN IMMEDIATE`):
- O estado atual é lido e validado antes de aplicar a transação.
- O comando é deduplicado na tabela `commands` através de hash SHA-256 do payload.
- Retentativas com o mesmo `commandId` e payload idêntico devolvem o estado atual sem reexecutar liquidações nem alterar a revisão da sala. Retentativas com payload alterado disparam `COMMAND_CONFLICT`.
- Tentativas concorrentes com revisão defasada recebem `STALE_STATE`.
- Em caso de falha em qualquer validação do motor ou do banco, a transação sofre rollback integral e nenhuma mutação é gravada.

Erros mapeados para o anfitrião e jogadores:
- `HAND_NOT_ENDED`: tentativa de liquidar mão ainda em andamento.
- `ALREADY_SETTLED`: tentativa de liquidar mão que já foi liquidada.
- `INVALID_ACTION`: tentativa de iniciar próxima mão enquanto a atual ainda está em andamento.
- `GAME_OVER`: tentativa de avançar para próxima mão quando a partida já atingiu seu vencedor final.
- `MISSING_DECISION`, `DUPLICATE_DECISION`, `INELIGIBLE_WINNER`, `INVALID_POT`: erros de especificação de vencedores.

## Desconexão e Recuperação

O reinício do servidor preserva o estado completo da liquidação e das mãos avançadas:
- O banco recupera o snapshot v3 sem necessitar reprocessar histórico de apostas.
- Ao reconectar, os clientes recebem o estado sincronizado (`hand-settled`, `hand-active` ou `game-complete`) com os stacks exatos e sem recálculo financeiro.
- Jogadores eliminados continuam registrados na sala como espectadores/participantes históricos, mas não recebem vez nem participam das novas mãos.

