import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { useLanGame, config } from './support/lan-game.js';

describe('Game Reset (Reiniciar Partida sem recriar sala)', () => {
  const g = useLanGame();

  // 1. Reset com todos os jogadores conectados
  it('1. resets game with all players connected, restoring room to lobby and starting fresh game', async () => {
    await g.setup(3);
    const host = g.admissions[0].credentials.playerId;
    const p1 = g.admissions[1].credentials.playerId;
    const p2 = g.admissions[2].credentials.playerId;

    // Both fold to P2
    await g.act('fold');
    await g.act('fold');
    const settled = await g.settle();
    expect(settled.game?.status).toBe('hand-settled');

    // Host executes reset-game
    const resetReply = await g.command(0, { type: 'reset-game' });
    expect(resetReply.ok).toBe(true);
    if (!resetReply.ok) return;

    // Game is reset to lobby preparation state (game is null)
    const resetState = resetReply.data;
    expect(resetState.game).toBeNull();

    // All 3 players preserve their seats and connections
    expect(resetState.players).toHaveLength(3);
    expect(resetState.players.map(p => ({ seat: p.seat, connected: p.connected }))).toEqual([
      { seat: 1, connected: true },
      { seat: 2, connected: true },
      { seat: 3, connected: true },
    ]);

    // Host can now start the new game
    const startReply = await g.command(0, { type: 'start-game' });
    expect(startReply.ok).toBe(true);
    if (!startReply.ok) return;

    const startState = startReply.data;
    expect(startState.game?.status).toBe('hand-active');
    expect(startState.game?.hand.street).toBe('preflop');

    // All players have their starting chips restored (minus new blinds)
    const hand = g.hand();
    const hHost = hand.players.find(p => p.id === host)!;
    const hP1 = hand.players.find(p => p.id === p1)!;
    const hP2 = hand.players.find(p => p.id === p2)!;

    expect(hHost.chips).toBe(config.startingChips); // dealer, no blind
    expect(hP1.chips).toBe(config.startingChips - config.smallBlind); // SB
    expect(hP2.chips).toBe(config.startingChips - config.bigBlind); // BB

    g.assertConserved();
  });

  // 2. Reset com 1 jogador desconectado
  it('2. resets game with 1 player disconnected, preserving seat and restored chips without auto-starting hand', async () => {
    await g.setup(3);
    const p2Id = g.admissions[2].credentials.playerId;

    // Disconnect player 2
    g.sockets[2].disconnect();

    // Remaining players fold
    await g.act('fold');
    await g.act('fold');
    await g.settle();

    expect(g.state().game?.status).toBe('hand-settled');

    // Host resets game while P2 is disconnected
    const resetReply = await g.command(0, { type: 'reset-game' });
    expect(resetReply.ok).toBe(true);
    if (!resetReply.ok) return;

    // Table returns to lobby preparation state
    const resetState = resetReply.data;
    expect(resetState.game).toBeNull();

    // Disconnected player P2 preserves seat 3!
    const p2InRoom = resetState.players.find(p => p.id === p2Id)!;
    expect(p2InRoom.seat).toBe(3);
    expect(p2InRoom.connected).toBe(false);

    // Starting hand while P2 is disconnected is prevented by server
    const startReply = await g.command(0, { type: 'start-game' });
    expect(startReply.ok).toBe(false);
    if (!startReply.ok) {
      expect(startReply.error.code).toBe('PLAYERS_DISCONNECTED');
    }
  });

  // 3. Jogador desconectado na posição de blind
  it('3. protects disconnected player in blind position from automatic chip deduction', async () => {
    await g.setup(3);
    const p1Id = g.admissions[1].credentials.playerId;

    await g.act('fold');
    await g.act('fold');
    await g.settle();

    // P1 (seat 2, which would be Small Blind) disconnects
    g.sockets[1].disconnect();

    // Host resets game
    const resetReply = await g.command(0, { type: 'reset-game' });
    expect(resetReply.ok).toBe(true);
    if (!resetReply.ok) return;

    // Because game is in lobby state, no hand is active and NO blind is deducted from P1
    expect(resetReply.data.game).toBeNull();
    expect(resetReply.data.players.find(p => p.id === p1Id)?.connected).toBe(false);

    // Trying to start game fails cleanly, preserving P1's chips intact
    const startReply = await g.command(0, { type: 'start-game' });
    expect(startReply.ok).toBe(false);
    if (!startReply.ok) {
      expect(startReply.error.code).toBe('PLAYERS_DISCONNECTED');
    }
  });

  // 4. Jogador desconectado como primeiro a agir
  it('4. prevents game freeze by not assigning disconnected player as currentActorId', async () => {
    await g.setup(4);
    // In 4-player, Dealer=1, SB=2, BB=3, UTG (first to act preflop) is seat 4 (P3)
    const p3Id = g.admissions[3].credentials.playerId;

    // Finish hand 1
    await g.act('fold');
    await g.act('fold');
    await g.act('fold');
    await g.settle();

    // P3 (seat 4, who would be UTG / first actor in Hand 1) disconnects
    g.sockets[3].disconnect();

    // Host resets game
    const resetReply = await g.command(0, { type: 'reset-game' });
    expect(resetReply.ok).toBe(true);
    if (!resetReply.ok) return;

    // Game is in lobby, so currentActorId does not exist and table is NEVER frozen
    expect(resetReply.data.game).toBeNull();
    expect(resetReply.data.players.find(p => p.id === p3Id)?.connected).toBe(false);

    // Start-game is safely blocked
    const startReply = await g.command(0, { type: 'start-game' });
    expect(startReply.ok).toBe(false);
    if (!startReply.ok) {
      expect(startReply.error.code).toBe('PLAYERS_DISCONNECTED');
    }
  });

  // 5. Reconexão do jogador após o reset
  it('5. allows starting hand cleanly when disconnected player reconnects after reset', async () => {
    await g.setup(3);
    const p2Creds = g.admissions[2].credentials;

    // Disconnect P2
    g.sockets[2].disconnect();
    await g.act('fold');
    await g.act('fold');
    await g.settle();

    // Host resets game
    const resetReply = await g.command(0, { type: 'reset-game' });
    expect(resetReply.ok).toBe(true);

    // P2 reconnects to the room with original session
    const p2Socket = await g.connect(p2Creds);
    g.sockets[2] = p2Socket;

    // Now all players are connected
    const syncState = await g.sync();
    expect(syncState.players.every(p => p.connected)).toBe(true);

    // Host starts the game
    const startReply = await g.command(0, { type: 'start-game' });
    expect(startReply.ok).toBe(true);
    if (!startReply.ok) return;

    expect(startReply.data.game?.status).toBe('hand-active');
    expect(startReply.data.game?.hand.players).toHaveLength(3);
    g.assertConserved();
  });

  // 6. Continuidade da partida com os jogadores disponíveis
  it('6. allows game continuity with available players if a player leaves in the lobby', async () => {
    await g.setup(3);
    await g.act('fold');
    await g.act('fold');
    await g.settle();

    // Host resets game -> returns to lobby
    const resetReply = await g.command(0, { type: 'reset-game' });
    expect(resetReply.ok).toBe(true);

    // P2 decides to leave the table in lobby
    const leaveReply = await g.command(2, { type: 'leave' });
    expect(leaveReply.ok).toBe(true);

    // Now 2 players remain seated (Host and P1)
    const state = g.state();
    expect(state.players.filter(p => p.seat !== null)).toHaveLength(2);

    // Host starts game with the available seated participants
    const startReply = await g.command(0, { type: 'start-game' });
    expect(startReply.ok).toBe(true);
    if (!startReply.ok) return;

    expect(startReply.data.game?.hand.players).toHaveLength(2);
    const hand = startReply.data.game!.hand;
    expect(hand.players.reduce((sum, p) => sum + p.chips + p.totalCommitted, 0)).toBe(config.startingChips * 2);
  });

  // 7. Restauração de saldos e assentos (incluindo eliminados)
  it('7. restores balances and seats after game-complete, restoring eliminated players with zero chips', async () => {
    await g.setup(2);
    const host = g.admissions[0].credentials.playerId;
    const p1 = g.admissions[1].credentials.playerId;

    // Seed stacks so P1 has only 20 chips (Big Blind)
    g.seedStacks([1980, 20]);

    // Host calls 20 BB -> P1 is all in -> showdown
    await g.act('call');
    expect(g.hand().status).toBe('showdown');

    // Host awards pot to Host -> P1 eliminated
    const settled = await g.settle([{ potId: 'main', winners: [host] }]);
    expect(settled.game?.status).toBe('game-complete');
    if (settled.game?.status === 'game-complete') {
      expect(settled.game.winnerId).toBe(host);
      const sP1 = settled.game.settlement.players.find(p => p.id === p1)!;
      expect(sP1.chips).toBe(0);
    }

    // Host resets game
    const resetReply = await g.command(0, { type: 'reset-game' });
    expect(resetReply.ok).toBe(true);
    if (!resetReply.ok) return;

    // P1 was eliminated, but preserved seat 2 in lobby
    const resetState = resetReply.data;
    expect(resetState.game).toBeNull();
    const p1InRoom = resetState.players.find(p => p.id === p1)!;
    expect(p1InRoom.seat).toBe(2);

    // Host starts game
    const startReply = await g.command(0, { type: 'start-game' });
    expect(startReply.ok).toBe(true);
    if (!startReply.ok) return;

    const hand = g.hand();
    expect(hand.players).toHaveLength(2);
    const hP1 = hand.players.find(p => p.id === p1)!;
    expect(hP1.chips + hP1.totalCommitted).toBe(config.startingChips);
    expect(hP1.folded).toBe(false);
    expect(hP1.isAllIn).toBe(false);

    g.assertConserved();
  });

  // 8. Proteção contra comandos duplicados (idempotência)
  it('8. handles duplicate reset-game commands idempotently', async () => {
    await g.setup(2);
    await g.act('fold');
    await g.settle();

    const commandId = randomUUID();
    const env = await g.envelope({ type: 'reset-game' });
    env.commandId = commandId;

    const reply1 = await g.send(g.sockets[0], env);
    expect(reply1.ok).toBe(true);

    // Resend identical command (same commandId and fingerprint)
    const reply2 = await g.send(g.sockets[0], env);
    expect(reply2.ok).toBe(true);

    // Conflict if different payload with same commandId
    const replyConflict = await g.send(g.sockets[0], {
      type: 'start-game',
      commandId,
      expectedRevision: reply1.ok ? reply1.data.revision : 0,
    });
    expect(replyConflict.ok).toBe(false);
    if (!replyConflict.ok) {
      expect(replyConflict.error.code).toBe('COMMAND_CONFLICT');
    }
  });

  // 9. Conservação financeira após o reset
  it('9. strictly maintains financial conservation before and after reset', async () => {
    await g.setup(3);
    const p1 = g.admissions[1].credentials.playerId;

    await g.finishRound(); // preflop
    await g.advance(); // flop
    await g.finishRound();
    await g.advance(); // turn
    await g.finishRound();
    await g.advance(); // river
    await g.finishRound();
    await g.advance(); // showdown

    // Award pot to P1
    const settled = await g.settle([{ potId: 'main', winners: [p1] }]);
    expect(settled.game?.status).toBe('hand-settled');

    // Reset game
    const resetReply = await g.command(0, { type: 'reset-game' });
    expect(resetReply.ok).toBe(true);

    // Start game
    const startReply = await g.command(0, { type: 'start-game' });
    expect(startReply.ok).toBe(true);

    // Total bankroll is exactly 3000
    g.assertConserved();
  });

  // Validações adicionais de segurança e limites
  it('rejects reset-game when sent by a non-host player', async () => {
    await g.setup(2);
    await g.act('fold');
    await g.settle();

    const reply = await g.command(1, { type: 'reset-game' });
    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.error.code).toBe('FORBIDDEN');
    }
  });

  it('rejects reset-game during an active hand (GAME_IN_PROGRESS)', async () => {
    await g.setup(2);
    expect(g.state().game?.status).toBe('hand-active');

    const reply = await g.command(0, { type: 'reset-game' });
    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.error.code).toBe('GAME_IN_PROGRESS');
    }
  });

  it('rejects reset-game before the game has started (GAME_NOT_STARTED)', async () => {
    await g.setup(2, false);
    expect(g.state().game).toBeNull();

    const reply = await g.command(0, { type: 'reset-game' });
    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.error.code).toBe('GAME_NOT_STARTED');
    }
  });

  it('rejects reset-game with stale expectedRevision', async () => {
    await g.setup(2);
    await g.act('fold');
    await g.settle();

    const currentRev = g.state().revision;
    const reply = await g.send(g.sockets[0], {
      type: 'reset-game',
      commandId: randomUUID(),
      expectedRevision: currentRev - 1, // Stale
    });

    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.error.code).toBe('STALE_STATE');
    }
  });

  it('survives server restart after reset-game without data loss', async () => {
    await g.setup(2);
    await g.act('fold');
    await g.settle();

    const resetReply = await g.command(0, { type: 'reset-game' });
    expect(resetReply.ok).toBe(true);

    // Restart server
    const recovered = await g.restart();
    expect(recovered.game).toBeNull();
    expect(recovered.players).toHaveLength(2);
    expect(recovered.players[0].seat).toBe(1);
    expect(recovered.players[1].seat).toBe(2);

    // Can start game cleanly after recovery
    const startReply = await g.command(0, { type: 'start-game' });
    expect(startReply.ok).toBe(true);
    g.assertConserved();
  });

  it('works in a 10-player full ring table', async () => {
    await g.setup(10);
    // Everyone folds to player 10
    for (let i = 0; i < 9; i++) {
      await g.act('fold');
    }
    await g.settle();
    expect(g.state().game?.status).toBe('hand-settled');

    const resetReply = await g.command(0, { type: 'reset-game' });
    expect(resetReply.ok).toBe(true);

    const startReply = await g.command(0, { type: 'start-game' });
    expect(startReply.ok).toBe(true);

    const hand = g.hand();
    expect(hand.players).toHaveLength(10);
    for (const p of hand.players) {
      expect(p.chips + p.totalCommitted).toBe(config.startingChips);
    }

    g.assertConserved();
  });
});
