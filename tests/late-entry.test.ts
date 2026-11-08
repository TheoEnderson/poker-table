import { describe, expect, it } from 'vitest';
import { useLanGame, waitFor } from './support/lan-game.js';

describe('Late Entry into Active Games (Entrada tardia de jogadores)', () => {
  const g = useLanGame();

  it('allows late join during pre-flop without modifying current hand, pot, or actor', async () => {
    // 1. Inicia jogo com 2 jogadores (Heads-up)
    await g.setup(2);
    const hostId = g.admissions[0].credentials.playerId;
    const p1Id = g.admissions[1].credentials.playerId;

    const initialHand = g.hand();
    expect(initialHand.players).toHaveLength(2);
    expect(initialHand.pot).toBe(30);
    const initialActor = initialHand.currentActorId;

    // 2. Novo jogador (P2) entra na sala durante o Pré-flop com assento 3
    const p2Admission = g.app.rooms.join(g.host.room.code, { name: 'P2', seat: 3 });
    g.admissions.push(p2Admission);
    const p2Socket = await g.connect(p2Admission.credentials);
    g.sockets.push(p2Socket);

    // 3. Verifica sincronização da sala: P2 está na lista de participantes com assento 3
    const roomState = g.state();
    expect(roomState.players).toHaveLength(3);
    const p2InRoom = roomState.players.find(p => p.id === p2Admission.credentials.playerId);
    expect(p2InRoom).toBeDefined();
    expect(p2InRoom?.seat).toBe(3);
    expect(p2InRoom?.connected).toBe(true);

    // 4. Mão atual permanece estritamente intocada
    const handAfterJoin = g.hand();
    expect(handAfterJoin.players).toHaveLength(2);
    expect(handAfterJoin.players.map(p => p.id)).toEqual([hostId, p1Id]);
    expect(handAfterJoin.pot).toBe(30);
    expect(handAfterJoin.currentActorId).toBe(initialActor);
    expect(handAfterJoin.street).toBe('preflop');

    // 5. Novo jogador é impedido de executar qualquer ação na mão ativa
    const forbiddenAction = await g.command(2, { type: 'game-action', action: 'fold' });
    expect(forbiddenAction).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('allows unseated newcomer to select an available seat during active game, rejecting taken seats and active players', async () => {
    await g.setup(2);
    const p1Id = g.admissions[1].credentials.playerId;

    // Novo jogador entra sem assento
    const newcomer = g.app.rooms.join(g.host.room.code, { name: 'Novato' });
    g.admissions.push(newcomer);
    const newcomerSocket = await g.connect(newcomer.credentials);
    g.sockets.push(newcomerSocket);

    // Tenta escolher assento ocupado (assento 2 ocupado pelo P1)
    const takenReply = await g.command(2, { type: 'select-seat', seat: 2 });
    expect(takenReply).toMatchObject({
      ok: false,
      error: { code: 'SEAT_TAKEN' },
    });

    // Escolhe assento 4 disponível
    const selectReply = await g.command(2, { type: 'select-seat', seat: 4 });
    expect(selectReply.ok).toBe(true);
    expect(g.state().players.find(p => p.id === newcomer.credentials.playerId)?.seat).toBe(4);

    // Jogador ativo da mão (P1) é impedido de trocar de assento durante a mão ativa
    const activeChangeSeat = await g.command(1, { type: 'select-seat', seat: 5 });
    expect(activeChangeSeat).toMatchObject({
      ok: false,
      error: { code: 'GAME_IN_PROGRESS' },
    });
    expect(g.state().players.find(p => p.id === p1Id)?.seat).toBe(2);
  });

  it('allows late join across all streets (Flop, Turn, River, Showdown)', async () => {
    await g.setup(2);

    // Pré-flop -> P2 entra
    await g.finishRound();
    await g.advance(); // Flop
    expect(g.hand().street).toBe('flop');

    const p2 = g.app.rooms.join(g.host.room.code, { name: 'P2', seat: 3 });
    g.admissions.push(p2);
    g.sockets.push(await g.connect(p2.credentials));

    await g.finishRound();
    await g.advance(); // Turn
    expect(g.hand().street).toBe('turn');

    const p3 = g.app.rooms.join(g.host.room.code, { name: 'P3', seat: 4 });
    g.admissions.push(p3);
    g.sockets.push(await g.connect(p3.credentials));

    await g.finishRound();
    await g.advance(); // River
    expect(g.hand().street).toBe('river');

    await g.finishRound();
    await g.advance(); // Showdown
    expect(g.hand().status).toBe('showdown');

    // Mão em showdown continua com apenas os 2 participantes originais
    expect(g.hand().players).toHaveLength(2);
    // Mas a sala possui 4 participantes
    expect(g.state().players).toHaveLength(4);
  });

  it('admits connected latecomer to the next hand with starting chips and rotated dealer', async () => {
    await g.setup(2);
    const hostId = g.admissions[0].credentials.playerId;

    // Hand 1: Heads-up (Host seat 1, P1 seat 2). Dealer: Host
    expect(g.hand().dealerSeat).toBe(1);

    // P2 entra tardiamente no assento 3
    const p2 = g.app.rooms.join(g.host.room.code, { name: 'P2', seat: 3 });
    g.admissions.push(p2);
    g.sockets.push(await g.connect(p2.credentials));
    const p2Id = p2.credentials.playerId;

    // Finaliza Hand 1 até Showdown
    await g.finishRound(); // preflop
    await g.advance(); // flop
    await g.finishRound();
    await g.advance(); // turn
    await g.finishRound();
    await g.advance(); // river
    await g.finishRound();
    await g.advance(); // showdown

    // Liquida a mão 1: Host vence
    await g.settle([{ potId: 'main', winners: [hostId] }]);
    expect(g.state().game?.status).toBe('hand-settled');

    // Host inicia a Próxima Mão (Hand 2)
    const hand2State = await g.nextHand();
    expect(hand2State.game?.status).toBe('hand-active');

    const hand2 = g.hand();
    // Hand 2 agora inclui 3 jogadores!
    expect(hand2.players).toHaveLength(3);
    const h2P2 = hand2.players.find(p => p.id === p2Id);
    expect(h2P2).toBeDefined();
    expect(h2P2?.seat).toBe(3);

    // P2 recebeu exatamente as fichas iniciais (1000 - blinds se aplicável)
    // Em 3 jogadores com dealer anterior no assento 1:
    // Dealer avança para o assento 2 (P1)!
    // Small Blind é assento 3 (P2)!
    // Big Blind é assento 1 (Host)!
    expect(hand2.dealerSeat).toBe(2);
    expect(hand2.smallBlindSeat).toBe(3);
    expect(hand2.bigBlindSeat).toBe(1);

    // P2 pagou SB (10), stack restante é 990
    expect(h2P2?.chips).toBe(990);
    expect(h2P2?.roundCommitted).toBe(10);

    // Orçamento total da mesa conservado: 3 jogadores * 1000 = 3000 fichas
    const totalChips = hand2.players.reduce((sum, p) => sum + p.chips, hand2.pot);
    expect(totalChips).toBe(3000);
  });

  it('does NOT include disconnected newcomer in next-hand, preventing table stall', async () => {
    await g.setup(2);
    const hostId = g.admissions[0].credentials.playerId;
    const p1Id = g.admissions[1].credentials.playerId;

    // P2 entra no assento 3
    const p2 = g.app.rooms.join(g.host.room.code, { name: 'P2', seat: 3 });
    g.admissions.push(p2);
    const p2Socket = await g.connect(p2.credentials);
    g.sockets.push(p2Socket);
    const p2Id = p2.credentials.playerId;

    // P2 desconecta antes da próxima mão
    p2Socket.disconnect();
    g.sockets = [g.sockets[0], g.sockets[1]];
    await waitFor(() => !g.state().players.find(p => p.id === p2Id)?.connected);

    // Liquida Hand 1
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.settle([{ potId: 'main', winners: [hostId] }]);

    // Anfitrião inicia Hand 2
    const hand2State = await g.nextHand();
    expect(hand2State.game?.status).toBe('hand-active');

    const hand2 = g.hand();
    // P2 desconectado NÃO foi incluído na Hand 2!
    expect(hand2.players).toHaveLength(2);
    expect(hand2.players.map(p => p.id)).toEqual([hostId, p1Id]);
    expect(hand2.players.some(p => p.id === p2Id)).toBe(false);

    // Orçamento total permanece 2000 (sem fichas para P2 enquanto desconectado)
    const totalChips2 = hand2.players.reduce((sum, p) => sum + p.chips, hand2.pot);
    expect(totalChips2).toBe(2000);

    // P2 não postou blinds e não bloqueia a partida
    expect(hand2.playersToAct.includes(p2Id)).toBe(false);

    // P2 continua com seu assento preservado
    expect(g.state().players.find(p => p.id === p2Id)?.seat).toBe(3);

    // Verifica que o estado persiste no SQLite mesmo com P2 desconectado
    await g.restart();
    expect(g.hand().players).toHaveLength(2);
    expect(g.state().players.find(p => p.id === p2Id)?.seat).toBe(3);

    // 6. P2 reconecta durante a Hand 2
    const p2ReconnectedSocket = await g.connect(p2.credentials);
    g.sockets.push(p2ReconnectedSocket);
    await waitFor(() => Boolean(g.state().players.find(p => p.id === p2Id)?.connected));

    // 7. P2 permanece aguardando durante o restante da Hand 2 (não tem fichas na mão ativa nem pode agir)
    expect(g.hand().players.some(p => p.id === p2Id)).toBe(false);
    const forbiddenDuringHand2 = await g.command(2, { type: 'game-action', action: 'fold' });
    expect(forbiddenDuringHand2).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });

    // Joga a Hand 2 até o fim e liquida
    await g.finishRound();
    await g.advance(); // Flop
    await g.finishRound();
    await g.advance(); // Turn
    await g.finishRound();
    await g.advance(); // River
    await g.finishRound();
    await g.advance(); // Showdown
    await g.settle([{ potId: 'main', winners: [p1Id] }]);

    // 8. Anfitrião inicia Hand 3 -> Agora que P2 está conectado, é admitido com sucesso!
    const hand3State = await g.nextHand();
    expect(hand3State.game?.status).toBe('hand-active');

    const hand3 = g.hand();
    expect(hand3.players).toHaveLength(3);
    expect(hand3.players.some(p => p.id === p2Id)).toBe(true);

    // Orçamento da mesa aumenta apenas agora (+1000 fichas, total 3000, sem duplicação)
    const totalChips3 = hand3.players.reduce((sum, p) => sum + p.chips, hand3.pot);
    expect(totalChips3).toBe(3000);
    const p2InHand3 = hand3.players.find(p => p.id === p2Id)!;
    expect(p2InHand3.chips + p2InHand3.roundCommitted).toBe(1000);

    // Estado persiste e recupera com sucesso após novo reinício do servidor com os 3 jogadores
    await g.restart();
    expect(g.hand().players).toHaveLength(3);
    const recoveredTotal = g.hand().players.reduce((sum, p) => sum + p.chips, g.hand().pot);
    expect(recoveredTotal).toBe(3000);
  });

  it('rejects late entry when room reaches maxPlayers', async () => {
    // Configura sala com maxPlayers = 2
    const host = g.app.rooms.create({
      hostName: 'Host',
      config: { ...g.host?.room?.config ?? { name: 'Test', startingChips: 1000, smallBlind: 10, bigBlind: 20 }, maxPlayers: 2 },
    });
    g.admissions.push(host);
    g.sockets.push(await g.connect(host.credentials));
    await g.command(0, { type: 'select-seat', seat: 1 });

    const p1 = g.app.rooms.join(host.room.code, { name: 'P1', seat: 2 });
    g.admissions.push(p1);
    g.sockets.push(await g.connect(p1.credentials));

    // Inicia jogo
    await g.command(0, { type: 'start-game' });
    expect(g.state().game?.status).toBe('hand-active');

    // Tentativa de 3º jogador entrar com sala lotada
    expect(() => g.app.rooms.join(host.room.code, { name: 'P3' })).toThrowError(/cheia/i);
  });

  it('preserves durable state across SQLite server recovery when latecomer is waiting', async () => {
    await g.setup(2);

    // P2 entra tardiamente no assento 3
    const p2 = g.app.rooms.join(g.host.room.code, { name: 'P2', seat: 3 });
    g.admissions.push(p2);
    g.sockets.push(await g.connect(p2.credentials));

    // Simula reinício / crash recovery do servidor
    await g.restart();

    // Estado recuperado com fidelidade: jogo ativo, 2 jogadores na mão, 3 participantes na sala
    const state = g.state();
    expect(state.game?.status).toBe('hand-active');
    expect(state.game?.hand.players).toHaveLength(2);
    expect(state.players).toHaveLength(3);
    expect(state.players.find(p => p.id === p2.credentials.playerId)?.seat).toBe(3);
  });

  it('allows latecomer to join when game is complete and play after reset-game', async () => {
    await g.setup(2);
    const hostId = g.admissions[0].credentials.playerId;
    const p1Id = g.admissions[1].credentials.playerId;

    // Leva Hand 1 até All-in de P1 para que P1 fique com 0 fichas -> game-complete
    await g.act('all-in'); // Host (SB) raises all-in
    await g.act('call'); // P1 (BB) calls all-in
    expect(g.hand().status).toBe('showdown');
    await g.settle([{ potId: 'main', winners: [hostId] }]);
    expect(g.state().game?.status).toBe('game-complete');

    // Novo participante entra na sala com partida concluída
    const newcomer = g.app.rooms.join(g.host.room.code, { name: 'Recém-chegado', seat: 4 });
    g.admissions.push(newcomer);
    g.sockets.push(await g.connect(newcomer.credentials));

    expect(g.state().players).toHaveLength(3);
    expect(g.state().players.find(p => p.id === newcomer.credentials.playerId)?.seat).toBe(4);

    // Anfitrião reinicia a partida (reset-game)
    const resetReply = await g.command(0, { type: 'reset-game' });
    expect(resetReply.ok).toBe(true);

    // Sala retorna ao lobby com todos os 3 participantes sentados
    const lobbyState = g.state();
    expect(lobbyState.game).toBeNull();
    expect(lobbyState.players).toHaveLength(3);
    expect(lobbyState.players.every(p => p.seat !== null)).toBe(true);

    // Anfitrião inicia nova partida com os 3 participantes
    const startReply = await g.command(0, { type: 'start-game' });
    expect(startReply.ok).toBe(true);

    const newGame = g.hand();
    expect(newGame.players).toHaveLength(3);
    expect(newGame.players.some(p => p.id === newcomer.credentials.playerId)).toBe(true);
    expect(newGame.players.some(p => p.id === hostId)).toBe(true);
    expect(newGame.players.some(p => p.id === p1Id)).toBe(true);
  });

  it('allows a newcomer to occupy a seat previously freed by a waiting player who left', async () => {
    // 2 jogadores: Host (1), P1 (2)
    await g.setup(2);

    // Um jogador entra tardiamente no assento 3
    const waitingPlayer = g.app.rooms.join(g.host.room.code, { name: 'Desistente', seat: 3 });
    g.admissions.push(waitingPlayer);
    g.sockets.push(await g.connect(waitingPlayer.credentials));

    expect(g.state().players.some(p => p.seat === 3)).toBe(true);

    // O jogador no assento 3 decide sair da sala antes da próxima mão (leave)
    const leaveReply = await g.command(2, { type: 'leave' });
    expect(leaveReply.ok).toBe(true);
    // Assento 3 foi liberado
    expect(g.state().players.some(p => p.seat === 3)).toBe(false);

    // Um novo jogador entra tardiamente e escolhe o assento 3 que foi liberado
    const newcomer = g.app.rooms.join(g.host.room.code, { name: 'Novo Assento 3', seat: 3 });
    g.admissions.push(newcomer);
    g.sockets.push(await g.connect(newcomer.credentials));

    expect(g.state().players.find(p => p.id === newcomer.credentials.playerId)?.seat).toBe(3);

    // Finaliza Hand 1 até Showdown e liquidação
    await g.finishRound();
    await g.advance(); // Flop
    await g.finishRound();
    await g.advance(); // Turn
    await g.finishRound();
    await g.advance(); // River
    await g.finishRound();
    await g.advance(); // Showdown
    await g.settle([{ potId: 'main', winners: [g.admissions[0].credentials.playerId] }]);

    // Anfitrião inicia Hand 2
    const hand2State = await g.nextHand();
    expect(hand2State.game?.status).toBe('hand-active');

    const hand2 = g.hand();
    // Hand 2 contém Host, P1 e o novo jogador no assento 3
    expect(hand2.players).toHaveLength(3);
    expect(hand2.players.some(p => p.id === newcomer.credentials.playerId)).toBe(true);
  });

  it('strictly rejects any manipulated action from a newcomer during an active hand', async () => {
    await g.setup(2);

    // Newcomer entra durante a mão ativa
    const newcomer = g.app.rooms.join(g.host.room.code, { name: 'Invasor', seat: 5 });
    g.admissions.push(newcomer);
    g.sockets.push(await g.connect(newcomer.credentials));

    // Testa todas as ações possíveis: check, call, raise, all-in, fold
    const actions = [
      { type: 'game-action' as const, action: 'check' as const },
      { type: 'game-action' as const, action: 'call' as const },
      { type: 'game-action' as const, action: 'raise' as const, amount: 100 },
      { type: 'game-action' as const, action: 'all-in' as const },
      { type: 'game-action' as const, action: 'fold' as const },
    ];

    for (const act of actions) {
      const reply = await g.command(2, act);
      expect(reply).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN' },
      });
    }

    // Tentar advance-street sem ser host
    const advanceReply = await g.command(2, { type: 'advance-street' });
    expect(advanceReply).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('conserves bankroll perfectly when multiple players join across different hands', async () => {
    // 2 jogadores iniciais: 2000 fichas
    await g.setup(2);

    // Mão 1: P2 entra no assento 3 (+1000 fichas)
    const p2 = g.app.rooms.join(g.host.room.code, { name: 'P2', seat: 3 });
    g.admissions.push(p2);
    g.sockets.push(await g.connect(p2.credentials));

    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.settle([{ potId: 'main', winners: [g.admissions[0].credentials.playerId] }]);

    // Inicia Mão 2: 3 jogadores na mesa, total 3000 fichas
    await g.nextHand();
    const hand2 = g.hand();
    expect(hand2.players).toHaveLength(3);
    const total2 = hand2.players.reduce((sum, p) => sum + p.chips, hand2.pot);
    expect(total2).toBe(3000);

    // Durante Mão 2: P3 entra no assento 4 (+1000 fichas na próxima mão)
    const p3 = g.app.rooms.join(g.host.room.code, { name: 'P3', seat: 4 });
    g.admissions.push(p3);
    g.sockets.push(await g.connect(p3.credentials));

    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.settle([{ potId: 'main', winners: [g.admissions[1].credentials.playerId] }]);

    // Inicia Mão 3: 4 jogadores na mesa, total 4000 fichas
    await g.nextHand();
    const hand3 = g.hand();
    expect(hand3.players).toHaveLength(4);
    const total3 = hand3.players.reduce((sum, p) => sum + p.chips, hand3.pot);
    expect(total3).toBe(4000);
  });
});
