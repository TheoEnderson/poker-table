# Etapa 3B — Apostas e streets pela LAN

## Contratos e permissões

Os eventos `room:command`, `room:state` e `room:sync`, as sessões, o ACK
`Reply<RoomState>` e a revisão da sala permanecem os mesmos.

```ts
// amount é obrigatório somente para raise; proibido nas outras ações.
{ type: 'game-action', action: 'fold' | 'check' | 'call' | 'all-in', commandId, expectedRevision }
{ type: 'game-action', action: 'raise', amount: 100, commandId, expectedRevision }
{ type: 'advance-street', commandId, expectedRevision }
```

Os objetos Zod são estritos, discriminados por comando e ação. Raises exigem
inteiro seguro positivo. Campos como `playerId`, `roomId`, `chips`, `pot` ou
`isHost` são rejeitados. O ID do ator e a sala vêm exclusivamente da sessão.

O jogador precisa pertencer à mão. `applyHandAction()` valida sua vez, status,
capacidade de agir, call/check, aumento mínimo e reabertura. O anfitrião não
ganha permissão para apostar por outro jogador. Participantes sem assento na
mão não podem apostar. Não há débitos ou regras de apostas duplicados no servidor.

**Raise é o total da street.** Se o jogador já comprometeu 20, `amount: 100`
significa completar até 100, não pagar mais 100. No flop, os valores do pré-flop
não entram nesse alvo. Uma aposta inicial pós-flop também usa `raise`, de acordo
com a API existente do motor; não foi criado um comando `bet` separado.

`advance-street` exige a identidade do anfitrião e seu token administrativo.
O servidor consulta `canAdvanceStreet()` e chama `advanceStreet()`. A sequência
é pré-flop → flop → turn → river → showdown, desde que a rodada esteja concluída.
O motor mantém os stacks e as contribuições totais, zerando as contribuições da
street ao abrir a próxima rodada. O pote da rodada é acumulado, não a soma
exclusiva de suas contribuições atuais.

Fold pode encerrar a mão e all-ins podem levar diretamente ao showdown em uma
street anterior ao river. Esses estados são persistidos como produzidos pelo
motor, bloqueando apostas e avanços posteriores. Não há liquidação automática.
`game.status` continua `hand-active` significando mão não liquidada;
`game.hand.status` distingue os encerramentos de apostas.

## Persistência e integridade

O esquema SQLite permanece na versão 2. Apenas o JSON em `rooms.game` evolui:

- **JSON v1:** inicialização da 3A, com seu validador anterior e comparação
  integral com uma referência inicial produzida pelo motor. Novas partidas
  também começam neste formato. A leitura não regrava a mão.
- **JSON v2:** gravado na primeira ação ou avanço confirmado, contendo o
  `HandFlowState` completo, incluindo `currentRound`, `lastActionBet`,
  incrementos de raise, contribuições acumuladas e snapshot imutável de origem.

A v2 valida estrutura e inteiros seguros, IDs/assentos únicos e associados à
sala, identidade dos jogadores entre snapshots, posições/blinds, status,
fila/ator, folds/all-ins, stacks, contribuições e conservação financeira:

```text
totalCommitted = baseCommitted + roundCommitted
roundCommitted = currentRound.players[i].committed
sum(totalCommitted) = hand.pot = currentRound.pot
sum(chips) + hand.pot = orçamento inicial da mesa
chips + totalCommitted = stack individual de origem
```

O snapshot de origem `handState` é comparado a uma referência calculada com
`createInitialHand()`, usando os stacks de origem e a configuração de blinds.
Esse cálculo puro valida a origem; não substitui o estado atual, não repete
ações nem grava ou debita blinds. A mão recuperada é o snapshot salvo, congelado
recursivamente após a validação. O estado evoluído nunca é comparado como se
fosse uma mão recém-inicializada.

O validador aceita stacks de origem não uniformes na v2, desde que conservem
o orçamento da sala e os demais invariantes. A API `start-game` continua
produzindo exclusivamente stacks uniformes; clientes não podem fornecer esses
valores. Essa distinção permite testar cenários legais do motor com stacks
distintos sem alterar as regras de inicialização.

**Limite da validação:** um snapshot consistente não prova toda a sequência
anterior de apostas. Não há log de eventos nem assinatura do banco. Uma alteração
coordenada que preserve invariantes, por exemplo nos stacks de origem ou nos
dados históricos de reabertura, pode não ser detectável. O validador verifica
consistência, não autenticidade histórica. O banco é armazenamento confiável do
servidor; não recebe snapshots de clientes. Um histórico verificável exigiria
outra decisão de arquitetura, fora desta etapa.

## Transações, erros e sincronização

A transição é processada dentro do `BEGIN IMMEDIATE` existente: estado lido e
validado, API do motor executada, resultado validado e gravado, comando registrado
e revisão incrementada. Qualquer falha reverte tudo. ACK e broadcast continuam
ocorrendo somente após o commit. Não há novo cache financeiro em memória.

A deduplicação por sala/jogador/`commandId` precede a verificação de revisão:
retry idêntico devolve o snapshot atual; payload diferente gera `COMMAND_CONFLICT`.
Comandos distintos com a mesma revisão não aplicam duas transições: o perdedor
recebe `STALE_STATE`. Repetir um avanço confirmado não pula outra street.
Comandos inválidos não são registrados, não aumentam a revisão e não geram
broadcast de mudança. O resync direcionado de uma revisão antiga permanece.

`EngineError` de uma transição recebe código e mensagem públicos estáveis:
`OUT_OF_TURN`, `CANNOT_CHECK`, `CANNOT_RAISE`, `ACTION_NOT_REOPENED`,
`INVALID_RAISE_AMOUNT`, `INSUFFICIENT_CHIPS`, `ROUND_NOT_ACTIVE`,
`HAND_ALREADY_COMPLETED`, `CANNOT_ADVANCE_STREET` ou `INVALID_ACTION`.
Ausência de partida usa `GAME_NOT_STARTED`; identidade/permissão usa os erros
existentes. Falha de armazenamento, snapshot inválido e falha inesperada de
integridade não são apresentados como simples ação inválida: usam `STORAGE_ERROR`.
O resync provocado por `STALE_STATE` também trata falhas de leitura sem lançar
uma exceção não capturada no callback do socket.

O DTO público permanece o da 3A. Não expõe `currentRound`, hashes, tokens ou
estrutura de armazenamento. A interface existente continua aceitando os
snapshots; não foram adicionados controles de apostas ou de avanço.

## Desconexão, recuperação e testes

Desconectar não executa fold, não transfere a vez e não remove fichas/assento.
A mão pode ficar aguardando indefinidamente a reconexão do ator. O anfitrião
também precisa reconectar para avançar uma street concluída.

Após reinício, o estado financeiro e os comandos processados permanecem. A
presença é reconstruída e a revisão avança como antes. Nenhuma aposta é repetida.
Os testes cobrem recuperação durante pré-flop/flop/turn/river, depois de fold
e showdown, incluindo a continuidade da mão e a repetição de comandos antigos.

`tests/game-actions.test.ts` e `tests/game-recovery.test.ts` usam servidor,
Socket.IO e SQLite temporário reais. Uma mão completa é jogada pela rede até
showdown. Também cobrem concorrência, autorização, corrupção e rollback via
triggers SQLite. Os testes e E2E anteriores permanecem intactos.

All-ins incompletos não são alcançáveis na primeira mão com stacks uniformes.
Para esses testes específicos, a origem é gerada pelo motor com stacks distintos
e inserida como fixture v2 no banco; as apostas posteriores são comandos reais
Socket.IO e comparadas ao resultado das APIs públicas. Isso não representa uma
capacidade de configurar stacks individuais pela interface ou protocolo.

## Preparação para a Etapa 3C

Não há seleção de vencedores, distribuição, rebuys, timers ou próxima mão.
O motor não foi modificado. Antes de integrar a liquidação, definir os contratos
de decisões por pote, autorização, identificadores de mão e representação do
estado liquidado, com garantias de distribuição única e conservação de fichas.
A próxima mão também precisará de uma evolução explícita do orçamento/stacks de
origem; o validador desta etapa continua vinculado ao orçamento da primeira mão.
