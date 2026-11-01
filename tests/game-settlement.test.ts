import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { useLanGame } from './support/lan-game.js';

describe('Showdown and Settlement Multiplayer (Etapa 3C.1)', () => {
  const g = useLanGame();

  it('settles showdown with single winner and updates stacks', async () => {
    await g.setup(3);
    const host = g.admissions[0].credentials.playerId;
    const p1 = g.admissions[1].credentials.playerId;
    const p2 = g.admissions[2].credentials.playerId;

    // Preflop: dealer is host (seat 1), SB is p1 (seat 2), BB is p2 (seat 3)
    // Host acts first (calls BB 20), p1 calls 10, p2 checks
    await g.finishRound();
    await g.advance(); // flop
    await g.finishRound();
    await g.advance(); // turn
    await g.finishRound();
    await g.advance(); // river
    await g.finishRound();
    await g.advance(); // showdown

    expect(g.state().game?.hand.status).toBe('showdown');
    expect(g.state().game?.status).toBe('hand-active');

    // Host awards main pot (60) to p1
    const settled = await g.settle([{ potId: 'main', winners: [p1] }]);

    expect(settled.game?.status).toBe('hand-settled');
    if (settled.game?.status === 'hand-settled') {
      expect(settled.game.settlement.originalPot).toBe(60);
      expect(settled.game.settlement.summary.totalDistributed).toBe(60);
      expect(settled.game.settlement.summary.playerAwards).toEqual([{ playerId: p1, amount: 60 }]);

      const settledP1 = settled.game.settlement.players.find(p => p.id === p1)!;
      const settledHost = settled.game.settlement.players.find(p => p.id === host)!;
      const settledP2 = settled.game.settlement.players.find(p => p.id === p2)!;

      expect(settledP1.chips).toBe(1000 - 20 + 60); // 1040
      expect(settledHost.chips).toBe(1000 - 20); // 980
      expect(settledP2.chips).toBe(1000 - 20); // 980
      expect(settledP1.totalWon).toBe(60);
      expect(settledHost.totalWon).toBe(0);
      expect(settledP2.totalWon).toBe(0);
    }

    g.assertConserved();

    // Verify all clients receive the state via broadcast
    const syncP1 = await g.sync(g.sockets[1]);
    expect(syncP1.game?.status).toBe('hand-settled');
    expect(syncP1.revision).toBe(settled.revision);
  });

  it('settles showdown with split pot and applies TDA Rule 21 odd chip allocation', async () => {
    await g.setup(3);
    const p1 = g.admissions[1].credentials.playerId;
    const p2 = g.admissions[2].credentials.playerId;

    // Seed stacks: host (seat 1, dealer) = 1965, p1 (seat 2, SB) = 35, p2 (seat 3, BB) = 1000
    // Total: 3000 chips.
    g.seedStacks([1965, 35, 1000]);

    // Preflop:
    // P1 (SB) posted 10, remaining chips: 25.
    // P2 (BB) posted 20, remaining chips: 980.
    // Host calls 20.
    await g.act('call');
    // P1 goes all-in for 35 total (calls remaining 25).
    await g.act('all-in');
    // P2 calls 35 (adds 15).
    await g.act('call');
    // Host calls 35 (adds 15).
    await g.act('call');

    // Flop, Turn, River check down
    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance(); // showdown

    expect(g.state().game?.hand.status).toBe('showdown');
    // Main pot: 35 * 3 = 105 chips.
    // Host awards tie to P1 and P2
    const settled = await g.settle([{ potId: 'main', winners: [p1, p2] }]);

    expect(settled.game?.status).toBe('hand-settled');
    if (settled.game?.status === 'hand-settled') {
      expect(settled.game.settlement.originalPot).toBe(105);
      expect(settled.game.settlement.summary.totalDistributed).toBe(105);

      // 105 / 2 = 52 each + 1 odd chip.
      // Dealer is Host (seat 1). First player clockwise from dealer is P1 (seat 2).
      // Per TDA Rule 21: P1 receives 53, P2 receives 52.
      const awardP1 = settled.game.settlement.summary.playerAwards.find(a => a.playerId === p1)!;
      const awardP2 = settled.game.settlement.summary.playerAwards.find(a => a.playerId === p2)!;
      expect(awardP1.amount).toBe(53);
      expect(awardP2.amount).toBe(52);
    }
    g.assertConserved();
  });

  it('settles main pot and side pot with different winners', async () => {
    await g.setup(3);
    const host = g.admissions[0].credentials.playerId;
    const p1 = g.admissions[1].credentials.playerId;

    // Seed stacks: Host (seat 1) = 50, P1 (seat 2) = 200, P2 (seat 3) = 2750
    g.seedStacks([50, 200, 2750]);

    // Preflop:
    // P1 posted SB 10, P2 posted BB 20.
    // Host calls 20. P1 calls 10 (20 total). P2 checks.
    await g.finishRound();
    await g.advance(); // flop

    // Flop:
    // P1 checks. P2 bets 30.
    // Host calls 30 (all-in: 20 + 30 = 50 chips committed).
    // P1 calls 30 (50 committed).
    await g.act('check'); // P1
    await g.act('raise', 30); // P2
    await g.act('all-in'); // Host (stack was 30, goes all-in)
    await g.act('call'); // P1

    await g.advance(); // turn
    // Turn: Host is all-in. P1 (stack 150) and P2 can bet.
    // P1 bets 100. P2 calls 100.
    await g.act('raise', 100);
    await g.act('call');

    await g.advance(); // river
    await g.finishRound(); // both check
    await g.advance(); // showdown

    expect(g.state().game?.hand.status).toBe('showdown');
    const hand = g.hand();
    expect(hand.pot).toBe(50 * 3 + 100 * 2); // 150 main + 200 side = 350

    // Host awards Main Pot to Host, Side Pot to P1
    const settled = await g.settle([
      { potId: 'main', winners: [host] },
      { potId: 'side-1', winners: [p1] },
    ]);

    expect(settled.game?.status).toBe('hand-settled');
    if (settled.game?.status === 'hand-settled') {
      const awardHost = settled.game.settlement.summary.playerAwards.find(a => a.playerId === host)!;
      const awardP1 = settled.game.settlement.summary.playerAwards.find(a => a.playerId === p1)!;
      expect(awardHost.amount).toBe(150);
      expect(awardP1.amount).toBe(200);
    }
    g.assertConserved();
  });

  it('settles hand ended by fold automatically without requiring decisions', async () => {
    await g.setup(3);
    const p1 = g.admissions[1].credentials.playerId;

    // Preflop:
    // Host (first to act) folds.
    await g.act('fold');
    // P1 (SB) raises to 60.
    await g.act('raise', 60);
    // P2 (BB) folds.
    await g.act('fold');

    // Hand ended by fold! P1 is sole survivor.
    expect(g.state().game?.hand.status).toBe('hand_ended_by_fold');

    // Host settles without decisions
    const settled = await g.settle();
    expect(settled.game?.status).toBe('hand-settled');
    if (settled.game?.status === 'hand-settled') {
      expect(settled.game.settlement.summary.totalDistributed).toBe(40);
      const p1Award = settled.game.settlement.summary.playerAwards.find(a => a.playerId === p1)!;
      expect(p1Award.amount).toBe(settled.game.settlement.originalPot);
    }
    g.assertConserved();
  });

  it('enforces host authorization and rejects non-admin settlement', async () => {
    await g.setup(3);
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();

    // Guest client (index 1) attempts to settle
    const reply = await g.send(g.sockets[1], await g.envelope({ type: 'settle-hand', decisions: [] }, g.sockets[1]));
    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.error.code).toBe('FORBIDDEN');
    }
  });

  it('rejects settlement when hand is not ended', async () => {
    await g.setup(3);
    // Hand is in preflop
    const reply = await g.command(0, { type: 'settle-hand', decisions: [] });
    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.error.code).toBe('HAND_NOT_ENDED');
    }
  });

  it('rejects invalid decisions: missing decision, duplicate decision, ineligible winner, invalid pot', async () => {
    await g.setup(3);
    const p1 = g.admissions[1].credentials.playerId;
    const p2 = g.admissions[2].credentials.playerId;

    // Advance to showdown
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();

    // 1. Missing decision for contested main pot
    const replyMissing = await g.command(0, { type: 'settle-hand', decisions: [] });
    expect(replyMissing.ok).toBe(false);
    if (!replyMissing.ok) expect(replyMissing.error.code).toBe('MISSING_DECISION');

    // 2. Duplicate decision for same pot
    const replyDup = await g.command(0, {
      type: 'settle-hand',
      decisions: [
        { potId: 'main', winners: [p1] },
        { potId: 'main', winners: [p2] },
      ],
    });
    expect(replyDup.ok).toBe(false);
    if (!replyDup.ok) expect(replyDup.error.code).toBe('DUPLICATE_DECISION');

    // 3. Invalid pot ID
    const replyBadPot = await g.command(0, {
      type: 'settle-hand',
      decisions: [{ potId: 'non-existent-pot', winners: [p1] }],
    });
    expect(replyBadPot.ok).toBe(false);
    if (!replyBadPot.ok) expect(replyBadPot.error.code).toBe('INVALID_POT');

    // 4. Ineligible winner (random unknown UUID)
    const replyIneligible = await g.command(0, {
      type: 'settle-hand',
      decisions: [{ potId: 'main', winners: [randomUUID()] }],
    });
    expect(replyIneligible.ok).toBe(false);
    if (!replyIneligible.ok) expect(replyIneligible.error.code).toBe('INELIGIBLE_WINNER');
  });

  it('rejects settlement on already settled hand', async () => {
    await g.setup(3);
    const p1 = g.admissions[1].credentials.playerId;

    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();

    await g.settle([{ potId: 'main', winners: [p1] }]);

    // Try to settle again
    const reply = await g.command(0, { type: 'settle-hand', decisions: [{ potId: 'main', winners: [p1] }] });
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.error.code).toBe('ALREADY_SETTLED');
  });

  it('handles idempotency and command conflict', async () => {
    await g.setup(3);
    const p1 = g.admissions[1].credentials.playerId;
    const p2 = g.admissions[2].credentials.playerId;

    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();

    const envelope = await g.envelope({ type: 'settle-hand', decisions: [{ potId: 'main', winners: [p1] }] });
    const reply1 = await g.send(g.sockets[0], envelope);
    expect(reply1.ok).toBe(true);

    // Resend exact same commandId with same payload -> returns ok without error or bumping revision
    const reply2 = await g.send(g.sockets[0], envelope);
    expect(reply2.ok).toBe(true);
    if (reply1.ok && reply2.ok) {
      expect(reply2.data.revision).toBe(reply1.data.revision);
      expect(reply2.data.game?.status).toBe('hand-settled');
    }

    // Send same commandId with different payload -> COMMAND_CONFLICT
    const conflictEnvelope = { ...envelope, decisions: [{ potId: 'main', winners: [p2] }] };
    const replyConflict = await g.send(g.sockets[0], conflictEnvelope);
    expect(replyConflict.ok).toBe(false);
    if (!replyConflict.ok) expect(replyConflict.error.code).toBe('COMMAND_CONFLICT');
  });

  it('recovers settled state across server restart', async () => {
    await g.setup(3);
    const p1 = g.admissions[1].credentials.playerId;

    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();
    await g.finishRound();
    await g.advance();

    const beforeRestart = await g.settle([{ potId: 'main', winners: [p1] }]);
    expect(beforeRestart.game?.status).toBe('hand-settled');
    const rawBefore = g.raw();

    // Restart server
    const afterRestart = await g.restart();
    expect(afterRestart.game?.status).toBe('hand-settled');
    if (afterRestart.game?.status === 'hand-settled' && beforeRestart.game?.status === 'hand-settled') {
      expect(afterRestart.game.settlement).toEqual(beforeRestart.game.settlement);
      expect(afterRestart.revision).toBeGreaterThan(beforeRestart.revision);
      expect(g.raw()).toBe(rawBefore);
    }
    g.assertConserved();
  });

});
