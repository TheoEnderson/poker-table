# Etapa 3A — Inicialização da primeira mão

## Comando e autoridade

O evento Socket.IO existente `room:command` aceita:

```ts
{
  type: 'start-game',
  commandId: '<UUID novo para esta intenção>',
  expectedRevision: room.revision
}
```

O ACK continua sendo `Reply<RoomState>` e a atualização é publicada em
`room:state`. Não há evento paralelo de jogo nem nova sessão ou revisão.
`room:sync` e a reconexão entregam o mesmo snapshot atualizado.

O comando usa `startingChips`, `smallBlind` e `bigBlind` da configuração que o
anfitrião informou ao criar a sala. Mantém os limites existentes: inteiros
positivos até 1.000.000, big blind >= small blind e stack >= big blind.
Também verifica o produto entre stack e quantidade de jogadores antes de chamar
o motor. Valores individuais de stacks, participantes, dealer, pote, sala-alvo e
flags administrativas não são aceitos no payload.

A autenticação usa o token de sessão existente; a autorização exige tanto o ID
do anfitrião registrado no banco quanto seu token administrativo válido, como
no encerramento da sala. O alvo é sempre a sala da sessão autenticada.

## Participantes e ciclo de vida

- `room.game === null`: preparação, com o comportamento anterior de salas.
- `room.game.status === 'hand-active'`: há uma mão válida, ainda não liquidada.
  O status da mão é separado: por exemplo, blinds podem deixar todos all-in e
  o próprio motor retornar `hand.status === 'showdown'` já na inicialização.
  Esta etapa apenas preserva esse resultado; não executa showdown ou prêmios.
- São necessários 2–10 participantes sentados, todos conectados por pelo menos
  uma sessão Socket.IO. Um sentado desconectado bloqueia o início até reconectar
  ou sair/liberar seu assento durante a preparação. Não é excluído silenciosamente.
- Participantes sem assento ficam fora da mão; o anfitrião pode administrá-la
  sem estar sentado. Não é criado um novo papel de espectador.
- Após iniciar, todas as novas entradas e trocas/liberações de assento são
  bloqueadas. Participantes da mão não podem sair definitivamente. Desconectar
  preserva identidade, fichas e assento. Participantes que já estavam sem
  assento podem renomear-se ou sair, mas não entrar na mão.
- Renomear continua permitido; a identidade na mão é o ID estável, e o nome
  atual fica em `room.players`. Encerrar a sala continua exclusivo do anfitrião;
  arquiva a sala e preserva a mão, sem liquidá-la ou remover seus participantes.

`startHandFlow()` recebe os IDs e assentos autoritativos com stacks uniformes.
O motor escolhe dealer, blinds, débitos e ordem; suas regras não foram alteradas.

## Snapshot e persistência

`RoomState` inclui `game: null | { status: 'hand-active', hand: HandSnapshot }`.
O DTO explícito expõe street/status, IDs, assentos, stacks, contribuições,
fold/all-in, posições/blinds, pote, jogador da vez e fila de ação. A revisão
é `room.revision`, única para sala, presença e jogo. Não expõe os objetos
internos `handState`/`currentRound`, hashes ou tokens.

A migração SQLite v2 adiciona `rooms.game`, nullable para as salas existentes.
Esse campo é a única fonte durável da mão, como JSON com `version: 1`, status
e `HandFlowState`. O formato v1 permite somente a mão inicial. A recuperação
valida estrutura, inteiros seguros, referências entre jogadores/assentos,
consistência entre os snapshots internos e conservação de fichas; restaura
o congelamento recursivo. Para validar a versão 1, recalcula temporariamente uma mão de
referência usando o motor e compara seu conteúdo ao estado persistido.
Esse cálculo é puro: não substitui a mão recuperada, não grava no banco
e não debita blinds novamente da partida.
Dados inválidos ou versões desconhecidas retornam `STORAGE_ERROR`, sem reset
automático do jogo ou exclusão do banco.

Gravação da mão, revisão e registro do comando ocorrem na mesma transação
`BEGIN IMMEDIATE`. O broadcast e o ACK só acontecem depois do commit. Falhas
revertem todos os efeitos. O serviço continua síncrono e o SQLite serializa
as gravações; não há outro estado financeiro em memória.

A deduplicação preserva `(room_id, player_id, command_id)` e o fingerprint do
payload. Uma repetição idêntica devolve o estado atual antes de verificar a
revisão antiga. Outro payload com o mesmo ID retorna `COMMAND_CONFLICT`.
Comandos distintos concorrentes encontram `STALE_STATE`; uma nova tentativa
com revisão atual encontra `GAME_ALREADY_STARTED`. As garantias sobrevivem
ao reinício. A revisão avança no reinício e nas mudanças de presença, como antes.

## Erros e compatibilidade

Novos códigos: `GAME_ALREADY_STARTED`, `GAME_IN_PROGRESS`,
`INSUFFICIENT_PLAYERS`, `PLAYERS_DISCONNECTED`. Validação usa `INVALID_INPUT`,
autorização usa `FORBIDDEN`/`UNAUTHORIZED` e falhas de banco usam `STORAGE_ERROR`.

Os eventos e comandos anteriores continuam disponíveis. O frontend servido
localmente incorpora o novo schema e mantém a proteção contra revisões atrasadas.
Uma aba com o bundle antigo deve ser recarregada, pois seu schema estrito não
conhece `game`. Não há compatibilidade prometida entre bundles de versões
diferentes; protocolo de handshake permanece em 1 nesta entrega conjunta.

## Limites e próxima etapa

Não há botão para iniciar nem controles de apostas nesta entrega: o início
está disponível no protocolo. A interface apenas reflete o bloqueio de assentos,
saída e convites após o início e informa que a mão foi salva.

Não há ações, avanço de streets, prêmios ou próxima mão pela rede. Antes da
Etapa 3B, evoluir explicitamente o formato persistido para mãos em andamento,
adicionar contratos de ação e associar o ator exclusivamente à sessão. Manter
o mesmo commit transacional e testar ações repetidas, concorrência e reinício
durante apostas antes de ampliar a interface.

Os testes específicos em `tests/game-start.test.ts` usam Socket.IO e SQLite
temporário reais, incluindo falhas de gravação por triggers SQLite. A suíte
anterior de salas, motor e multiplayer permanece intacta.
