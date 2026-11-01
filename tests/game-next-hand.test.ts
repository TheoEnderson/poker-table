import { describe, expect, it } from 'vitest';
import { useLanGame } from './support/lan-game.js';

describe('Next Hand, Elimination and Game Completion Multiplayer (Etapa 3C.2)', () => {
  const g = useLanGame();

  it('runs multiple consecutive hands preserving stacks, dealer rotation and bankroll', async () => {
    await g.setup(3);
    const host = g.admissions[0].credentials.playerId;
    const p1 = g.admissions[1].credentials.playerId;
    const p2 = g.admissions[2].credentials.playerId;

    // --- HAND 1 ---
    // Dealer: Host (seat 1), SB: P1 (seat 2), BB: P2 (seat 3)
    expect(g.hand().dealerSeat).toBe(1);

    await g.finishRound(); // preflop
    await g.advance(); // flop
    await g.finishRound();
    await g.advance(); // turn
    await g.finishRound();
    await g.advance(); // river
    await g.finishRound();
    await g.advance(); // showdown

    // Host awards pot (60) to P1
    const settled1 = await g.settle([{ potId: 'main', winners: [p1] }]);
    expect(settled1.game?.status).toBe('hand-settled');
    g.assertConserved();

    // --- TRANSITION TO HAND 2 ---
    const hand2State = await g.nextHand();
    expect(hand2State.game?.status).toBe('hand-active');

    const hand2 = g.hand();
    // Dealer rotated clockwise: Seat 1 -> Seat 2 (P1)!
    expect(hand2.dealerSeat).toBe(2);
    // In 3 players: SB is seat 3 (P2), BB is seat 1 (Host)
    expect(hand2.smallBlindSeat).toBe(3);
    expect(hand2.bigBlindSeat).toBe(1);

    // Initial stacks carried over into hand 2:
    // P1 (seat 2): had 1040 chips -> dealer, committed: 0, chips: 1040
    // P2 (seat 3): had 980 chips -> SB, committed: 10, chips: 970
    // Host (seat 1): had 980 chips -> BB, committed: 20, chips: 960
    const h2P1 = hand2.players.find(p => p.id === p1)!;
    const h2P2 = hand2.players.find(p => p.id === p2)!;
    const h2Host = hand2.players.find(p => p.id === host)!;

    expect(h2P1.chips).toBe(1040);
    expect(h2P2.chips).toBe(970);
    expect(h2Host.chips).toBe(960);
    expect(hand2.pot).toBe(30);

    g.assertConserved();

    // Play Hand 2:
    // First to act preflop: P1 (seat 2, clockwise after BB seat 1)
    expect(hand2.currentActorId).toBe(p1);
    await g.finishRound(); // preflop check/calls
    await g.advance(); // flop
    await g.finishRound();
    await g.advance(); // turn
    await g.finishRound();
    await g.advance(); // river
    await g.finishRound();
    await g.advance(); // showdown

    // Pot is 60: Host BB (20) + P1 call (20) + P2 SB call (20)
    // Settle Hand 2: award pot to Host
    const settled2 = await g.settle([{ potId: 'main', winners: [host] }]);
    expect(settled2.game?.status).toBe('hand-settled');

    if (settled2.game?.status === 'hand-settled') {
      const sHost = settled2.game.settlement.players.find(p => p.id === host)!;
      const sP1 = settled2.game.settlement.players.find(p => p.id === p1)!;
      const sP2 = settled2.game.settlement.players.find(p => p.id === p2)!;
      expect(sHost.chips).toBe(960 + 60); // 1020
      expect(sP1.chips).toBe(1040 - 20); // 1020
      expect(sP2.chips).toBe(970 - 10); // 960
    }
    g.assertConserved();

    // --- TRANSITION TO HAND 3 ---
    const hand3State = await g.nextHand();
    expect(hand3State.game?.status).toBe('hand-active');

    const hand3 = g.hand();
    // Dealer rotated clockwise: Seat 2 -> Seat 3 (P2)!
    expect(hand3.dealerSeat).toBe(3);
    expect(hand3.smallBlindSeat).toBe(1); // Host
    expect(hand3.bigBlindSeat).toBe(2); // P1

    g.assertConserved();
  });

  it('eliminates player with 0 chips and continues heads-up preserving bankroll', async () => {
    await g.setup(3);
    const host = g.admissions[0].credentials.playerId;
    const p1 = g.admissions[1].credentials.playerId;
    const p2 = g.admissions[2].credentials.playerId;

    // Seed stacks: Host (seat 1, dealer) = 1000, P1 (seat 2, SB) = 50, P2 (seat 3, BB) = 1950
    g.seedStacks([1000, 50, 1950]);

    // Preflop:
    // P1 (SB) posted 10 (chips: 40).
    // P2 (BB) posted 20 (chips: 1930).
    // Host calls 20.
    await g.act('call');
    // P1 goes all-in for 50 total.
    await g.act('all-in');
    // P2 calls 50.
    await g.act('call');
    // Host calls 50.
    await g.act('call');

    // Flop, turn, river
    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance(); // showdown

    // Main pot: 50 * 3 = 150.
    // Host awards main pot to Host
    const settled = await g.settle([{ potId: 'main', winners: [host] }]);
    expect(settled.game?.status).toBe('hand-settled');

    if (settled.game?.status === 'hand-settled') {
      const sP1 = settled.game.settlement.players.find(p => p.id === p1)!;
      expect(sP1.chips).toBe(0); // P1 is eliminated!
    }

    // Start next hand:
    const nextState = await g.nextHand();
    expect(nextState.game?.status).toBe('hand-active');

    const nextHand = g.hand();
    // Only 2 players in next hand! P1 has been excluded!
    expect(nextHand.players.length).toBe(2);
    expect(nextHand.players.map(p => p.id)).toEqual([host, p2]);
    expect(nextHand.players.find(p => p.id === p1)).toBeUndefined();

    // Total table bankroll is 100% conserved: 3000 chips!
    const totalChips = nextHand.players.reduce((sum, p) => sum + p.chips, nextHand.pot);
    expect(totalChips).toBe(3000);
    g.assertConserved();
  });

  it('completes game when only 1 player remains and rejects subsequent next-hand', async () => {
    await g.setup(2); // Heads-up table
    const host = g.admissions[0].credentials.playerId;
    const p1 = g.admissions[1].credentials.playerId;

    // In Heads-up: Dealer is seat 1 (Host, also SB), BB is seat 2 (P1)
    // Host goes all in (1000). P1 calls all in (1000).
    await g.act('all-in');
    await g.act('all-in');

    // Hand goes directly to showdown
    expect(g.hand().status).toBe('showdown');
    expect(g.hand().pot).toBe(2000);

    // Host awards pot to Host
    const settled = await g.settle([{ potId: 'main', winners: [host] }]);

    // Only Host has chips (> 0). P1 has 0 chips!
    // Game is COMPLETE!
    expect(settled.game?.status).toBe('game-complete');
    if (settled.game?.status === 'game-complete') {
      expect(settled.game.winnerId).toBe(host);
      expect(settled.game.settlement.summary.totalDistributed).toBe(2000);
      const winner = settled.game.settlement.players.find(p => p.id === host)!;
      const loser = settled.game.settlement.players.find(p => p.id === p1)!;
      expect(winner.chips).toBe(2000);
      expect(loser.chips).toBe(0);
    }
    g.assertConserved();

    // Any attempt to call next-hand must be rejected with GAME_OVER
    const replyNext = await g.command(0, { type: 'next-hand' });
    expect(replyNext.ok).toBe(false);
    if (!replyNext.ok) {
      expect(replyNext.error.code).toBe('GAME_OVER');
    }
  });

  it('rejects next-hand from non-host or during active hand', async () => {
    await g.setup(3);

    // 1. Hand is active -> rejected with INVALID_ACTION
    const replyActive = await g.command(0, { type: 'next-hand' });
    expect(replyActive.ok).toBe(false);
    if (!replyActive.ok) expect(replyActive.error.code).toBe('INVALID_ACTION');

    // Advance to showdown and settle
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();

    await g.settle([{ potId: 'main', winners: [g.admissions[0].credentials.playerId] }]);
    expect(g.state().game?.status).toBe('hand-settled');

    // 2. Non-host attempts next-hand -> rejected with FORBIDDEN
    const replyGuest = await g.send(g.sockets[1], await g.envelope({ type: 'next-hand' }, g.sockets[1]));
    expect(replyGuest.ok).toBe(false);
    if (!replyGuest.ok) expect(replyGuest.error.code).toBe('FORBIDDEN');
  });

  it('recovers Hand 2 state and elimination across server restart', async () => {
    await g.setup(3);
    const host = g.admissions[0].credentials.playerId;
    const p1 = g.admissions[1].credentials.playerId;

    // Eliminate P1
    g.seedStacks([1000, 50, 1950]);
    await g.act('call');
    await g.act('all-in');
    await g.act('call');
    await g.act('call');

    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();

    await g.settle([{ potId: 'main', winners: [host] }]);
    await g.nextHand();

    // Now in Hand 2 preflop, with 2 players (Host and P2)
    expect(g.hand().players.length).toBe(2);
    const rawBefore = g.raw();

    // Restart server
    const afterRestart = await g.restart();
    expect(afterRestart.game?.status).toBe('hand-active');
    expect(g.hand().players.length).toBe(2);
    expect(g.hand().players.some(p => p.id === p1)).toBe(false);
    expect(g.raw()).toBe(rawBefore);
    g.assertConserved();
  });
});
