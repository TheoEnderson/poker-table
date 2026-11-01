import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Reply, RoomState } from '@poker-table/protocol';
import { RoomError } from '../apps/server/src/errors.js';
import { decodeGame } from '../apps/server/src/persistence/hand.js';
import { useLanGame } from './support/lan-game.js';

describe('Multiplayer LAN Persistence and Tampering Audit (Etapa 3D)', () => {
  const g = useLanGame();

  const expectStorageError = (fn: () => void) => {
    try {
      fn();
      expect.unreachable('Expected STORAGE_ERROR to be thrown');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(RoomError);
      expect((err as RoomError).code).toBe('STORAGE_ERROR');
    }
  };

  describe('1. Compatibilidade com formatos de persistência v1, v2 e v3', () => {
    it('decodes format v1 unchanged and preserves 3A compatibility', async () => {
      await g.setup(3);
      const raw = g.raw();
      const parsed = JSON.parse(raw);
      expect(parsed.version).toBe(1);

      const state = g.state();
      const decoded = decodeGame(raw, state.config, state.players);
      expect(decoded.version).toBe(1);
      expect(decoded.status).toBe('hand-active');
      expect(decoded.handNumber).toBe(1);
      expect(decoded.tableBudget).toBe(3000);
      expect(decoded.hand.dealerSeat).toBe(1);
    });

    it('decodes format v2 unchanged after betting transitions', async () => {
      await g.setup(3);
      await g.act('call'); // Action upgrades to v2
      const raw = g.raw();
      const parsed = JSON.parse(raw);
      expect(parsed.version).toBe(2);

      const state = g.state();
      const decoded = decodeGame(raw, state.config, state.players);
      expect(decoded.version).toBe(2);
      expect(decoded.status).toBe('hand-active');
      expect(decoded.handNumber).toBe(1);
      expect(decoded.tableBudget).toBe(3000);
    });

    it('decodes format v3 across hand-settled, hand-active (hand 2) and game-complete', async () => {
      await g.setup(2);
      const p1Id = g.admissions[1].credentials.playerId;

      // 1. Fold preflop -> hand ended by fold -> settle
      await g.act('fold');
      await g.settle();

      const settledRaw = g.raw();
      const settledParsed = JSON.parse(settledRaw);
      expect(settledParsed.version).toBe(3);
      expect(settledParsed.status).toBe('hand-settled');

      const state1 = g.state();
      const decodedSettled = decodeGame(settledRaw, state1.config, state1.players);
      expect(decodedSettled.version).toBe(3);
      expect(decodedSettled.status).toBe('hand-settled');
      expect(decodedSettled.handNumber).toBe(1);
      expect(decodedSettled.tableBudget).toBe(2000);

      // 2. Start next hand -> hand-active (hand 2)
      await g.nextHand();
      const hand2Raw = g.raw();
      const hand2Parsed = JSON.parse(hand2Raw);
      expect(hand2Parsed.version).toBe(3);
      expect(hand2Parsed.status).toBe('hand-active');
      expect(hand2Parsed.handNumber).toBe(2);

      const state2 = g.state();
      const decodedHand2 = decodeGame(hand2Raw, state2.config, state2.players);
      expect(decodedHand2.version).toBe(3);
      expect(decodedHand2.status).toBe('hand-active');
      expect(decodedHand2.handNumber).toBe(2);
      expect(decodedHand2.tableBudget).toBe(2000);
      if (decodedHand2.version === 3 && decodedHand2.status === 'hand-active') {
        expect(decodedHand2.previousSettlement).toBeDefined();
      }

      // 3. Heads-up all-in to elimination -> game-complete
      // Hand 2: Dealer is Seat 2 (P1). SB is Seat 2 (10), BB is Seat 1 (Host, 20).
      // In heads-up preflop, SB acts first:
      await g.act('all-in');
      await g.act('call'); // Host calls all-in with their remaining chips
      // When both players are all-in, the engine transitions immediately to showdown
      expect(g.hand().status).toBe('showdown');

      // P1 wins main pot -> Host is eliminated with 0 chips -> game-complete!
      await g.settle([
        { potId: 'main', winners: [p1Id] },
      ]);

      const completeRaw = g.raw();
      const completeParsed = JSON.parse(completeRaw);
      expect(completeParsed.version).toBe(3);
      expect(completeParsed.status).toBe('game-complete');
      expect(completeParsed.winnerId).toBe(p1Id);

      const state3 = g.state();
      const decodedComplete = decodeGame(completeRaw, state3.config, state3.players);
      expect(decodedComplete.version).toBe(3);
      expect(decodedComplete.status).toBe('game-complete');
      if (decodedComplete.version === 3 && decodedComplete.status === 'game-complete') {
        expect(decodedComplete.winnerId).toBe(p1Id);
        expect(decodedComplete.tableBudget).toBe(2000);
      }
    });
  });

  describe('2. Resiliência a adulterações e corrupções consistentes', () => {
    it('rejects tampering with tableBudget in v3 hand-active', async () => {
      await g.setup(2);
      await g.act('fold');
      await g.settle();
      await g.nextHand(); // hand 2 active v3

      const state = g.state();
      const saved = JSON.parse(g.raw());
      saved.tableBudget = 2500; // Tamper: inconsistent budget
      expectStorageError(() => decodeGame(JSON.stringify(saved), state.config, state.players));
    });

    it('rejects tampering with handNumber (e.g. 0 or negative)', async () => {
      await g.setup(2);
      await g.act('fold');
      await g.settle();
      await g.nextHand();

      const state = g.state();
      const saved = JSON.parse(g.raw());
      saved.handNumber = 0; // Invalid hand number
      expectStorageError(() => decodeGame(JSON.stringify(saved), state.config, state.players));
    });

    it('rejects tampering with settlement awards in hand-settled even if tableBudget is untouched', async () => {
      await g.setup(2);
      await g.act('fold');
      await g.settle();

      const state = g.state();
      const saved = JSON.parse(g.raw());
      // Tamper: swap 10 chips from winner to folded player
      saved.settlement.players[0].chips += 10;
      saved.settlement.players[1].chips -= 10;
      expectStorageError(() => decodeGame(JSON.stringify(saved), state.config, state.players));
    });

    it('rejects tampering with winnerId in game-complete', async () => {
      await g.setup(2);
      const hostId = g.host.credentials.playerId;
      const p1Id = g.admissions[1].credentials.playerId;

      await g.act('fold');
      await g.settle();
      await g.nextHand();
      await g.act('all-in');
      await g.act('call');
      expect(g.hand().status).toBe('showdown');
      await g.settle([
        { potId: 'main', winners: [p1Id] },
      ]);

      const state = g.state();
      const saved = JSON.parse(g.raw());
      expect(saved.status).toBe('game-complete');

      // Tamper winnerId to the eliminated player (hostId has 0 chips)
      saved.winnerId = hostId;
      expectStorageError(() => decodeGame(JSON.stringify(saved), state.config, state.players));

      // Tamper winnerId to a fake UUID
      saved.winnerId = randomUUID();
      expectStorageError(() => decodeGame(JSON.stringify(saved), state.config, state.players));
    });

    it('rejects tampering with previousSettlement in hand-active hand 2', async () => {
      await g.setup(2);
      await g.act('fold');
      await g.settle();
      await g.nextHand();

      const state = g.state();
      const saved = JSON.parse(g.raw());
      // Tamper chips in previousSettlement so pure startNextHand(prev) doesn't match handState
      saved.previousSettlement.players[0].chips += 50;
      saved.previousSettlement.players[1].chips -= 50;
      expectStorageError(() => decodeGame(JSON.stringify(saved), state.config, state.players));
    });
  });

  describe('3. Não apagar nem reinicializar banco em caso de falha de leitura', () => {
    it('preserves corrupted database row on disk and recovers immediately upon repair', async () => {
      await g.setup(2);
      await g.act('call');

      const rawValid = g.raw();
      const revisionBefore = g.state().revision;

      // Inject unparseable corrupt JSON into database
      const corruptedJson = '{"version": 2, "hand": "MALFORMED_DATA"';
      g.app.store.db.prepare('UPDATE rooms SET game=? WHERE id=?').run(corruptedJson, g.roomId);

      // Attempt sync: returns STORAGE_ERROR
      const syncReply = await new Promise<Reply<RoomState>>(resolve => g.sockets[0].emit('room:sync', resolve));
      expect(syncReply).toMatchObject({ error: { code: 'STORAGE_ERROR' } });

      // Attempt command: returns STORAGE_ERROR
      const cmdReply = await g.send(g.sockets[0], {
        type: 'game-action',
        action: 'check',
        commandId: randomUUID(),
        expectedRevision: revisionBefore,
      });
      expect(cmdReply).toMatchObject({ error: { code: 'STORAGE_ERROR' } });

      // Verify the SQLite row was NOT erased, truncated or reset to null!
      const rowInDb = g.app.store.db.prepare('SELECT game, revision, closed FROM rooms WHERE id=?').get(g.roomId) as {
        game: string;
        revision: number;
        closed: number;
      };
      expect(rowInDb.game).toBe(corruptedJson);
      expect(rowInDb.revision).toBe(revisionBefore);
      expect(rowInDb.closed).toBe(0);

      // Admin repairs/restores valid JSON in database
      g.app.store.db.prepare('UPDATE rooms SET game=? WHERE id=?').run(rawValid, g.roomId);

      // Subsequent sync succeeds immediately!
      const repairedSync = await g.sync();
      expect(repairedSync.id).toBe(g.roomId);
      expect(repairedSync.game?.status).toBe('hand-active');
      g.assertConserved();
    });
  });
});
