import { describe, expect, it } from 'vitest';
import { decodeGame } from '../apps/server/src/persistence/hand.js';
import { useLanGame } from './support/lan-game.js';

describe('Prolonged Sessions and Lifecycle Stability (Etapa 3D)', () => {
  const g = useLanGame();

  async function playShowdownHand(winnerId: string) {
    await g.finishRound(); // preflop
    await g.advance(); // flop
    await g.finishRound();
    await g.advance(); // turn
    await g.finishRound();
    await g.advance(); // river
    await g.finishRound();
    await g.advance(); // showdown
    expect(g.state().game?.hand.status).toBe('showdown');
    await g.settle([{ potId: 'main', winners: [winnerId] }]);
    await g.nextHand();
  }

  async function playPreflopFoldHand() {
    await g.act('fold');
    await g.act('fold');
    expect(g.state().game?.hand.status).toBe('hand_ended_by_fold');
    await g.settle();
    await g.nextHand();
  }

  async function playFlopFoldHand() {
    await g.finishRound(); // preflop
    await g.advance(); // flop
    await g.act('raise', 20); // first actor bets
    while (g.hand().currentActorId !== null && g.state().game?.hand.status === 'in_progress') {
      await g.act('fold');
    }
    expect(g.state().game?.hand.status).toBe('hand_ended_by_fold');
    await g.settle();
    await g.nextHand();
  }

  async function refreshSockets() {
    for (let i = 0; i < g.sockets.length; i++) {
      g.sockets[i].disconnect();
      g.sockets[i] = await g.connect(g.admissions[i].credentials);
    }
  }

  it('runs a prolonged deterministic session of 25 consecutive hands with rotating dealer, blinds and balanced bankroll', async () => {
    await g.setup(3);
    const players = g.admissions.map(a => a.credentials.playerId);
    let previousDealerSeat = g.hand().dealerSeat;
    expect(previousDealerSeat).toBe(1);

    for (let handNum = 1; handNum <= 25; handNum++) {
      // Reconnect sockets periodically (every 5 hands) to test live session reconnection
      // and prevent flooding the single connection rate limiter.
      if (handNum > 1 && handNum % 5 === 1) {
        await refreshSockets();
      }

      const stateBefore = g.state();
      expect(stateBefore.game?.status).toBe('hand-active');

      const storedBefore = decodeGame(g.raw(), stateBefore.config, stateBefore.players);
      expect(storedBefore.handNumber).toBe(handNum);
      expect(storedBefore.tableBudget).toBe(3000);

      // Verify dealer rotated clockwise among occupied seats
      if (handNum > 1) {
        const currentDealerSeat = g.hand().dealerSeat;
        const expectedDealer = (previousDealerSeat % 3) + 1;
        expect(currentDealerSeat).toBe(expectedDealer);
        previousDealerSeat = currentDealerSeat;
      }

      // Check blinds distribution
      const hand = g.hand();
      expect(hand.pot).toBe(30); // SB (10) + BB (20)
      g.assertConserved();

      // Cycle winners so all 3 players remain funded across the 25 hands
      const targetWinner = players[(handNum - 1) % 3];

      if (handNum % 3 === 1) {
        await playShowdownHand(targetWinner);
      } else if (handNum % 3 === 2) {
        await playPreflopFoldHand();
      } else {
        await playFlopFoldHand();
      }

      // Verify bankroll conservation after each hand
      g.assertConserved();
    }

    // After 25 hands completed, hand 26 is active in preflop
    const finalState = g.state();
    expect(finalState.game?.status).toBe('hand-active');
    const finalStored = decodeGame(g.raw(), finalState.config, finalState.players);
    expect(finalStored.handNumber).toBe(26);
    expect(finalStored.tableBudget).toBe(3000);
    g.assertConserved();
  });

  it('runs a prolonged session with player elimination, heads-up transition (TDA 36-C) and game completion', async () => {
    await g.setup(3);
    const host = g.admissions[0].credentials.playerId;
    const p1 = g.admissions[1].credentials.playerId;
    const p2 = g.admissions[2].credentials.playerId;

    // Seed stacks: Host (seat 1) = 1000, P1 (seat 2) = 60, P2 (seat 3) = 1940
    g.seedStacks([1000, 60, 1940]);

    // Hand 1: P1 goes all in preflop for 60
    await g.act('call'); // Host calls 20
    await g.act('all-in'); // P1 all-in 60
    await g.act('call'); // P2 calls 60
    await g.act('call'); // Host calls 60

    // Advance to showdown
    await g.advance(); // flop
    await g.finishRound();
    await g.advance(); // turn
    await g.finishRound();
    await g.advance(); // river
    await g.finishRound();
    await g.advance(); // showdown

    // Host wins main pot
    await g.settle([{ potId: 'main', winners: [host] }]);
    expect(g.state().game?.status).toBe('hand-settled');

    // P1 was eliminated (0 chips).
    // Start Hand 2 (Transitions to Heads-Up)
    await refreshSockets();
    await g.nextHand();
    expect(g.state().game?.status).toBe('hand-active');

    const hand2 = g.hand();
    expect(hand2.players).toHaveLength(2);
    expect(hand2.players.find(p => p.id === p1)).toBeUndefined();
    g.assertConserved();

    // Play 5 hands in heads-up between Host and P2
    for (let huHand = 2; huHand <= 6; huHand++) {
      if (huHand === 4) await refreshSockets();
      expect(g.hand().players).toHaveLength(2);
      g.assertConserved();

      // Check down to river showdown
      await g.finishRound(); // preflop
      await g.advance(); // flop
      await g.finishRound();
      await g.advance(); // turn
      await g.finishRound();
      await g.advance(); // river
      await g.finishRound();
      await g.advance(); // showdown

      // Alternate winner between Host and P2
      const huWinner = huHand % 2 === 0 ? p2 : host;
      await g.settle([{ potId: 'main', winners: [huWinner] }]);

      if (huHand < 6) {
        await g.nextHand();
      }
    }

    // Now in Hand 6 settled. Start Hand 7 and eliminate P2.
    await g.nextHand();
    expect(g.hand().players).toHaveLength(2);

    // First player goes all-in, opponent calls
    await g.act('all-in');
    await g.act('call');
    expect(g.hand().status).toBe('showdown');

    // P2 has the larger stack and wins the all-in showdown, eliminating Host and winning the entire tournament
    const completeState = await g.settle([{ potId: 'main', winners: [p2] }]);
    expect(completeState.game?.status).toBe('game-complete');

    if (completeState.game?.status === 'game-complete') {
      expect(completeState.game.winnerId).toBe(p2);
      expect(completeState.game.settlement.summary.totalDistributed).toBe(completeState.game.settlement.originalPot);
      const winner = completeState.game.settlement.players.find(p => p.id === p2)!;
      expect(winner.chips).toBe(3000);
    }

    // Rejects next-hand when game is complete
    const replyOver = await g.command(0, { type: 'next-hand' });
    expect(replyOver.ok).toBe(false);
    if (!replyOver.ok) {
      expect(replyOver.error.code).toBe('GAME_OVER');
    }
  });

  it('recovers state across server restart during a prolonged session without repeating actions or blinds', async () => {
    await g.setup(3);
    const host = g.admissions[0].credentials.playerId;
    const p1 = g.admissions[1].credentials.playerId;

    // Run 5 full hands
    for (let h = 1; h <= 5; h++) {
      if (h === 4) await refreshSockets();
      await g.finishRound();
      await g.advance();
      await g.finishRound();
      await g.advance();
      await g.finishRound();
      await g.advance();
      await g.finishRound();
      await g.advance(); // showdown
      await g.settle([{ potId: 'main', winners: [h % 2 === 0 ? p1 : host] }]);
      await g.nextHand();
    }

    // Now in Hand 6: play preflop and advance to Flop
    expect(decodeGame(g.raw(), g.state().config, g.state().players).handNumber).toBe(6);
    await g.finishRound(); // preflop calls
    await g.advance(); // street flop
    expect(g.hand().street).toBe('flop');

    // First player acts on flop: raises 20
    await g.act('raise', 20);
    const potBeforeRestart = g.hand().pot;
    const actorBeforeRestart = g.hand().currentActorId;
    const rawBeforeRestart = g.raw();
    const stateBeforeRestart = g.state();

    // Restart the server
    const afterRestart = await g.restart();
    expect(afterRestart.game?.status).toBe('hand-active');
    expect(afterRestart.game).toEqual(stateBeforeRestart.game);

    // Verify exact recovery
    const recoveredHand = g.hand();
    expect(recoveredHand.street).toBe('flop');
    expect(recoveredHand.pot).toBe(potBeforeRestart);
    expect(recoveredHand.currentActorId).toBe(actorBeforeRestart);
    expect(g.raw()).toBe(rawBeforeRestart);

    const storedRecovered = decodeGame(g.raw(), afterRestart.config, afterRestart.players);
    expect(storedRecovered.handNumber).toBe(6);
    expect(storedRecovered.tableBudget).toBe(3000);

    // Continue the hand seamlessly after restart
    await g.finishRound(); // remaining players call/fold
    await g.advance(); // turn
    await g.finishRound();
    await g.advance(); // river
    await g.finishRound();
    await g.advance(); // showdown

    await g.settle([{ potId: 'main', winners: [host] }]);
    const hand7State = await g.nextHand();
    expect(hand7State.game?.status).toBe('hand-active');
    expect(decodeGame(g.raw(), hand7State.config, hand7State.players).handNumber).toBe(7);
    g.assertConserved();
  });
});
