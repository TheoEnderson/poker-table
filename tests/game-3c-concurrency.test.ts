import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Failure } from '@poker-table/protocol';
import { decodeGame } from '../apps/server/src/persistence/hand.js';
import { ok, useLanGame } from './support/lan-game.js';

describe('Concurrency and Rollback for Settlement and Next Hand (Etapa 3C)', () => {
  const g = useLanGame();

  describe('1. Liquidação concorrente', () => {
    it('rejects concurrent settlement with stale revision and preserves single payout', async () => {
      await g.setup(3);
      const p1 = g.admissions[1].credentials.playerId;

      // Advance to showdown
      await g.finishRound();
      await g.advance(); // flop
      await g.finishRound();
      await g.advance(); // turn
      await g.finishRound();
      await g.advance(); // river
      await g.finishRound();
      await g.advance(); // showdown

      const second = await g.connect(g.host.credentials);
      const input = await g.envelope({ type: 'settle-hand', decisions: [{ potId: 'main', winners: [p1] }] });
      const revisionBefore = input.expectedRevision;

      const [res1, res2] = await Promise.all([
        g.send(g.sockets[0], input),
        g.send(second, { ...input, commandId: randomUUID() }),
      ]);

      const successes = [res1, res2].filter(r => r.ok);
      const stale = [res1, res2].filter(r => !r.ok);

      expect(successes).toHaveLength(1);
      expect(stale).toHaveLength(1);
      expect((stale[0] as Failure).error.code).toBe('STALE_STATE');

      const state = g.state();
      expect(state.revision).toBe(revisionBefore + 1);
      expect(state.game?.status).toBe('hand-settled');

      if (state.game?.status === 'hand-settled') {
        expect(state.game.settlement.summary.totalDistributed).toBe(60);
        const p1Settled = state.game.settlement.players.find(p => p.id === p1)!;
        expect(p1Settled.chips).toBe(1040); // 1000 - 20 + 60
      }
      g.assertConserved();
    });

    it('idempotently handles simultaneous settlements with identical commandId', async () => {
      await g.setup(3);
      const p1 = g.admissions[1].credentials.playerId;

      await g.finishRound();
      await g.advance();
      await g.finishRound();
      await g.advance();
      await g.finishRound();
      await g.advance();
      await g.finishRound();
      await g.advance(); // showdown

      const second = await g.connect(g.host.credentials);
      const input = await g.envelope({ type: 'settle-hand', decisions: [{ potId: 'main', winners: [p1] }] });
      const revisionBefore = input.expectedRevision;

      const [res1, res2] = await Promise.all([
        g.send(g.sockets[0], input),
        g.send(second, input),
      ]);

      expect(res1.ok).toBe(true);
      expect(res2.ok).toBe(true);
      if (res1.ok && res2.ok) {
        expect(res1.data.revision).toBe(revisionBefore + 1);
        expect(res2.data.revision).toBe(revisionBefore + 1);
        expect(res1.data.game?.status).toBe('hand-settled');
        expect(res2.data.game?.status).toBe('hand-settled');
      }

      const state = g.state();
      expect(state.revision).toBe(revisionBefore + 1);
      if (state.game?.status === 'hand-settled') {
        expect(state.game.settlement.summary.totalDistributed).toBe(60);
      }
      g.assertConserved();
    });
  });

  describe('2. Próxima mão concorrente', () => {
    it('serializes concurrent next-hand commands rejecting the stale one', async () => {
      await g.setup(3);
      const p1 = g.admissions[1].credentials.playerId;

      await g.finishRound();
      await g.advance();
      await g.finishRound();
      await g.advance();
      await g.finishRound();
      await g.advance();
      await g.finishRound();
      await g.advance(); // showdown

      await g.settle([{ potId: 'main', winners: [p1] }]);
      expect(g.state().game?.status).toBe('hand-settled');

      const second = await g.connect(g.host.credentials);
      const input = await g.envelope({ type: 'next-hand' });
      const revisionBefore = input.expectedRevision;

      const [res1, res2] = await Promise.all([
        g.send(g.sockets[0], input),
        g.send(second, { ...input, commandId: randomUUID() }),
      ]);

      const successes = [res1, res2].filter(r => r.ok);
      const stale = [res1, res2].filter(r => !r.ok);

      expect(successes).toHaveLength(1);
      expect(stale).toHaveLength(1);
      expect((stale[0] as Failure).error.code).toBe('STALE_STATE');

      const state = g.state();
      expect(state.revision).toBe(revisionBefore + 1);
      expect(state.game?.status).toBe('hand-active');

      const hand2 = g.hand();
      // Dealer rotated only once: seat 1 -> seat 2
      expect(hand2.dealerSeat).toBe(2);
      // Blinds charged only once (pot is 30, not 60)
      expect(hand2.pot).toBe(30);

      const stored = decodeGame(g.raw(), state.config, state.players);
      expect(stored.handNumber).toBe(2);
      g.assertConserved();
    });

    it('idempotently handles simultaneous next-hand with identical commandId', async () => {
      await g.setup(3);
      const p1 = g.admissions[1].credentials.playerId;

      await g.finishRound();
      await g.advance();
      await g.finishRound();
      await g.advance();
      await g.finishRound();
      await g.advance();
      await g.finishRound();
      await g.advance(); // showdown

      await g.settle([{ potId: 'main', winners: [p1] }]);

      const second = await g.connect(g.host.credentials);
      const input = await g.envelope({ type: 'next-hand' });
      const revisionBefore = input.expectedRevision;

      const [res1, res2] = await Promise.all([
        g.send(g.sockets[0], input),
        g.send(second, input),
      ]);

      expect(res1.ok).toBe(true);
      expect(res2.ok).toBe(true);
      if (res1.ok && res2.ok) {
        expect(res1.data.revision).toBe(revisionBefore + 1);
        expect(res2.data.revision).toBe(revisionBefore + 1);
        expect(res1.data.game?.status).toBe('hand-active');
      }

      const state = g.state();
      expect(state.revision).toBe(revisionBefore + 1);

      const hand2 = g.hand();
      expect(hand2.dealerSeat).toBe(2);
      expect(hand2.pot).toBe(30);

      const stored = decodeGame(g.raw(), state.config, state.players);
      expect(stored.handNumber).toBe(2);
      g.assertConserved();
    });
  });

  describe('3. Rollback da liquidação', () => {
    it.each(['game', 'command', 'revision'])(
      'rolls back settle-hand when writing %s fails, allowing a safe retry',
      async stage => {
        await g.setup(3);
        const p1 = g.admissions[1].credentials.playerId;

        await g.finishRound();
        await g.advance();
        await g.finishRound();
        await g.advance();
        await g.finishRound();
        await g.advance();
        await g.finishRound();
        await g.advance(); // showdown

        const before = g.state();
        const rawBefore = g.raw();
        const input = await g.envelope({
          type: 'settle-hand',
          decisions: [{ potId: 'main', winners: [p1] }],
        });

        const target =
          stage === 'game'
            ? 'UPDATE OF game ON rooms'
            : stage === 'command'
              ? 'INSERT ON commands'
              : 'UPDATE OF revision ON rooms';

        g.app.store.db.exec(`CREATE TRIGGER fail_settle BEFORE ${target} BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);

        let broadcasts = 0;
        g.sockets[0].on('room:state', () => broadcasts++);

        const reply = await g.send(g.sockets[0], input);
        expect(reply.ok).toBe(false);
        if (!reply.ok) {
          expect(reply.error.code).toBe('STORAGE_ERROR');
        }

        // State, stacks, commands and revision must remain unchanged
        expect(await g.sync()).toEqual(before);
        expect(g.raw()).toBe(rawBefore);
        expect(broadcasts).toBe(0);
        expect(
          g.app.store.db.prepare('SELECT * FROM commands WHERE command_id=?').get(input.commandId),
        ).toBeUndefined();

        // Remove trigger and retry successfully
        g.app.store.db.exec('DROP TRIGGER fail_settle');

        const retried = ok(await g.send(g.sockets[0], input));
        expect(retried.game?.status).toBe('hand-settled');
        expect(retried.revision).toBe(before.revision + 1);
        g.assertConserved();
      },
    );
  });

  describe('4. Rollback da próxima mão', () => {
    it.each(['game', 'command', 'revision'])(
      'rolls back next-hand when writing %s fails, allowing a safe retry',
      async stage => {
        await g.setup(3);
        const p1 = g.admissions[1].credentials.playerId;

        await g.finishRound();
        await g.advance();
        await g.finishRound();
        await g.advance();
        await g.finishRound();
        await g.advance();
        await g.finishRound();
        await g.advance(); // showdown

        await g.settle([{ potId: 'main', winners: [p1] }]);

        const before = g.state();
        const rawBefore = g.raw();
        expect(before.game?.status).toBe('hand-settled');

        const input = await g.envelope({ type: 'next-hand' });

        const target =
          stage === 'game'
            ? 'UPDATE OF game ON rooms'
            : stage === 'command'
              ? 'INSERT ON commands'
              : 'UPDATE OF revision ON rooms';

        g.app.store.db.exec(`CREATE TRIGGER fail_next BEFORE ${target} BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);

        let broadcasts = 0;
        g.sockets[0].on('room:state', () => broadcasts++);

        const reply = await g.send(g.sockets[0], input);
        expect(reply.ok).toBe(false);
        if (!reply.ok) {
          expect(reply.error.code).toBe('STORAGE_ERROR');
        }

        // Must remain hand-settled, no new hand, dealer not rotated, no blinds debited
        expect(await g.sync()).toEqual(before);
        expect(g.raw()).toBe(rawBefore);
        expect(broadcasts).toBe(0);
        expect(
          g.app.store.db.prepare('SELECT * FROM commands WHERE command_id=?').get(input.commandId),
        ).toBeUndefined();

        const storedBefore = decodeGame(g.raw(), before.config, before.players);
        expect(storedBefore.status).toBe('hand-settled');
        expect(storedBefore.handNumber).toBe(1);

        // Remove trigger and retry successfully
        g.app.store.db.exec('DROP TRIGGER fail_next');

        const retried = ok(await g.send(g.sockets[0], input));
        expect(retried.game?.status).toBe('hand-active');
        expect(retried.revision).toBe(before.revision + 1);

        const hand2 = g.hand();
        expect(hand2.dealerSeat).toBe(2);
        expect(hand2.pot).toBe(30);

        const storedAfter = decodeGame(g.raw(), before.config, before.players);
        expect(storedAfter.handNumber).toBe(2);
        g.assertConserved();
      },
    );
  });
});

