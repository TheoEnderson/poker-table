import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  commandSchema,
  resetGameConfigSchema,
  type Admission,
  type ClientEvents,
  type Command,
  type Credentials,
  type Reply,
  type RoomState,
  type ServerEvents,
} from '@poker-table/protocol';
import { createApplication } from '../apps/server/src/http/app.js';

type Client = Socket<ServerEvents, ClientEvents>;

const ok = <T>(reply: Reply<T>): T => {
  if (!reply.ok) throw new Error(JSON.stringify(reply.error));
  return reply.data;
};

describe('Reset Game with Updated Room Settings (Issue #15)', () => {
  describe('Protocol Schema Validation', () => {
    it('accepts reset-game without config for backwards compatibility', () => {
      const res = commandSchema.safeParse({
        type: 'reset-game',
        commandId: randomUUID(),
        expectedRevision: 3,
      });
      expect(res.success).toBe(true);
    });

    it('accepts reset-game with valid fixed and progressive configs', () => {
      const fixed = commandSchema.safeParse({
        type: 'reset-game',
        commandId: randomUUID(),
        expectedRevision: 3,
        config: {
          startingChips: 2000,
          smallBlind: 25,
          bigBlind: 50,
          blindsStructure: { type: 'fixed' },
        },
      });
      expect(fixed.success).toBe(true);

      const hands = resetGameConfigSchema.safeParse({
        startingChips: 1500,
        smallBlind: 20,
        bigBlind: 40,
        blindsStructure: {
          type: 'hands',
          handsPerLevel: 2,
          levels: [
            { smallBlind: 20, bigBlind: 40 },
            { smallBlind: 40, bigBlind: 80 },
          ],
        },
      });
      expect(hands.success).toBe(true);
    });

    it('rejects invalid blind ordering, insufficient startingChips, non-integer chips, and mismatched level 1', () => {
      expect(
        resetGameConfigSchema.safeParse({
          startingChips: 1000,
          smallBlind: 50,
          bigBlind: 25,
        }).success,
      ).toBe(false);

      expect(
        resetGameConfigSchema.safeParse({
          startingChips: 40,
          smallBlind: 25,
          bigBlind: 50,
        }).success,
      ).toBe(false);

      expect(
        resetGameConfigSchema.safeParse({
          startingChips: 1000,
          smallBlind: 0,
          bigBlind: 20,
        }).success,
      ).toBe(false);

      expect(
        resetGameConfigSchema.safeParse({
          startingChips: 1000.5,
          smallBlind: 10,
          bigBlind: 20,
        }).success,
      ).toBe(false);

      expect(
        resetGameConfigSchema.safeParse({
          startingChips: 1000,
          smallBlind: 25,
          bigBlind: 50,
          blindsStructure: {
            type: 'hands',
            handsPerLevel: 3,
            levels: [
              { smallBlind: 10, bigBlind: 20 },
              { smallBlind: 25, bigBlind: 50 },
            ],
          },
        }).success,
      ).toBe(false);

      expect(
        resetGameConfigSchema.safeParse({
          startingChips: 1000,
          smallBlind: 10,
          bigBlind: 20,
          name: 'Should Not Be Allowed',
        }).success,
      ).toBe(false);
    });
  });

  describe('Server & SQLite Persistence Integration', () => {
    let dir: string;
    let dbFile: string;
    let app: ReturnType<typeof createApplication>;
    let base: string;
    const clients: Client[] = [];

    const connectClient = async (credentials: Credentials): Promise<Client> => {
      const socket: Client = io(base, {
        auth: { protocol: 1, credentials },
        transports: ['websocket'],
        autoConnect: false,
      });
      clients.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once('room:state', () => resolve());
        socket.once('connect_error', reject);
        socket.connect();
      });
      return socket;
    };

    const syncClient = (socket: Client): Promise<RoomState> =>
      new Promise((resolve, reject) => {
        socket.timeout(3000).emit('room:sync', (err, reply) => {
          if (err) reject(err);
          else if (reply.ok) resolve(reply.data);
          else reject(new Error(reply.error.message));
        });
      });

    const sendCommand = async (
      socket: Client,
      payload: Record<string, unknown>,
    ): Promise<Reply<RoomState>> => {
      const current = await syncClient(socket);
      const envelope = {
        ...payload,
        commandId: randomUUID(),
        expectedRevision: current.revision,
      };
      return new Promise((resolve, reject) => {
        socket.timeout(3000).emit('room:command', envelope as Command, (err, reply) => {
          if (err) reject(err);
          else resolve(reply);
        });
      });
    };

    const createTwoPlayerRoom = async (initialConfig?: {
      startingChips?: number;
      smallBlind?: number;
      bigBlind?: number;
      blindsStructure?: RoomState['config']['blindsStructure'];
    }) => {
      const res = await fetch(`${base}/api/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          hostName: 'Anfitriao',
          config: {
            name: 'Mesa Config',
            maxPlayers: 6,
            startingChips: initialConfig?.startingChips ?? 1000,
            smallBlind: initialConfig?.smallBlind ?? 10,
            bigBlind: initialConfig?.bigBlind ?? 20,
            blindsStructure: initialConfig?.blindsStructure ?? { type: 'fixed' },
          },
        }),
      });
      const hostAdm = ok((await res.json()) as Reply<Admission>);

      const joinRes = await fetch(`${base}/api/rooms/${hostAdm.room.code}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Convidado', seat: 2 }),
      });
      const guestAdm = ok((await joinRes.json()) as Reply<Admission>);

      const hostSocket = await connectClient(hostAdm.credentials);
      const guestSocket = await connectClient(guestAdm.credentials);

      ok(await sendCommand(hostSocket, { type: 'select-seat', seat: 1 }));
      ok(await sendCommand(hostSocket, { type: 'start-game' }));

      return { hostAdm, guestAdm, hostSocket, guestSocket };
    };

    const foldAndSettle = async (hostSocket: Client, guestSocket: Client) => {
      const state = await syncClient(hostSocket);
      if (state.game?.status !== 'hand-active') throw new Error('Expected active hand');
      const actorSocket = state.game.hand.currentActorId === state.players[0].id ? hostSocket : guestSocket;
      ok(await sendCommand(actorSocket, { type: 'game-action', action: 'fold' }));
      return ok(await sendCommand(hostSocket, { type: 'settle-hand', decisions: [] }));
    };

    beforeEach(async () => {
      dir = mkdtempSync(join(tmpdir(), 'poker-reset-settings-'));
      dbFile = join(dir, 'poker.sqlite');
      app = createApplication({ databasePath: dbFile });
      const port = await app.listen(0, '127.0.0.1');
      base = `http://127.0.0.1:${port}`;
    });

    afterEach(async () => {
      for (const s of clients.splice(0)) s.close();
      await app?.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it('keeps existing settings when reset-game is called without config', async () => {
      const { hostSocket, guestSocket } = await createTwoPlayerRoom({
        startingChips: 1200,
        smallBlind: 15,
        bigBlind: 30,
      });

      await foldAndSettle(hostSocket, guestSocket);

      const resetState = ok(await sendCommand(hostSocket, { type: 'reset-game' }));
      expect(resetState.game).toBeNull();
      expect(resetState.config.startingChips).toBe(1200);
      expect(resetState.config.smallBlind).toBe(15);
      expect(resetState.config.bigBlind).toBe(30);
    });

    it('updates startingChips and blinds on reset-game, broadcasts to guests, persists in SQLite, and applies on start-game', async () => {
      const { hostAdm, guestAdm, hostSocket, guestSocket } = await createTwoPlayerRoom();

      // Set a pre-action during the active hand so we also confirm it never leaks across reset-game
      const active = await syncClient(hostSocket);
      if (active.game?.status !== 'hand-active') throw new Error('Expected active hand');
      const nonActorSocket =
        active.game.hand.currentActorId === hostAdm.credentials.playerId ? guestSocket : hostSocket;
      ok(await sendCommand(nonActorSocket, { type: 'set-pre-action', preAction: { type: 'check-fold' } }));

      await foldAndSettle(hostSocket, guestSocket);

      const guestBroadcastPromise = new Promise<RoomState>(resolve => {
        const listener = (st: RoomState) => {
          if (st.game === null && st.config.startingChips === 2500) {
            guestSocket.off('room:state', listener);
            resolve(st);
          }
        };
        guestSocket.on('room:state', listener);
      });

      const resetState = ok(
        await sendCommand(hostSocket, {
          type: 'reset-game',
          config: {
            startingChips: 2500,
            smallBlind: 25,
            bigBlind: 50,
            blindsStructure: { type: 'fixed' },
          },
        }),
      );

      // Room code, name, maxPlayers, seats and participants remain intact
      expect(resetState.code).toBe(hostAdm.room.code);
      expect(resetState.config.name).toBe('Mesa Config');
      expect(resetState.config.maxPlayers).toBe(6);
      expect(resetState.config.startingChips).toBe(2500);
      expect(resetState.config.smallBlind).toBe(25);
      expect(resetState.config.bigBlind).toBe(50);
      expect(resetState.config.blindsStructure).toEqual({ type: 'fixed' });
      expect(resetState.players).toHaveLength(2);
      expect(resetState.players.map(p => p.seat)).toEqual([1, 2]);
      expect(resetState.game).toBeNull();

      const guestBroadcast = await guestBroadcastPromise;
      expect(guestBroadcast.config.startingChips).toBe(2500);
      expect(guestBroadcast.config.smallBlind).toBe(25);
      expect(guestBroadcast.config.bigBlind).toBe(50);

      // Close & reopen server against same SQLite DB to verify persistence
      for (const s of clients.splice(0)) s.close();
      await app.close();
      app = createApplication({ databasePath: dbFile });
      const port2 = await app.listen(0, '127.0.0.1');
      base = `http://127.0.0.1:${port2}`;

      const hostSocket2 = await connectClient(hostAdm.credentials);
      await connectClient(guestAdm.credentials);
      const restartedLobby = await syncClient(hostSocket2);
      expect(restartedLobby.config.startingChips).toBe(2500);
      expect(restartedLobby.config.smallBlind).toBe(25);
      expect(restartedLobby.config.bigBlind).toBe(50);

      // Start new game and check initial stacks & blinds
      const started = ok(await sendCommand(hostSocket2, { type: 'start-game' }));
      expect(started.game?.status).toBe('hand-active');
      if (started.game?.status === 'hand-active') {
        expect(started.game.hand.smallBlind).toBe(25);
        expect(started.game.hand.bigBlind).toBe(50);
        const totalChips = started.game.hand.players.reduce((sum, p) => sum + p.chips + p.totalCommitted, 0);
        expect(totalChips).toBe(5000);
        expect(started.game.hand.players.every(p => p.chips + p.totalCommitted === 2500)).toBe(true);
        expect(started.game.preActions).toBeUndefined();
      }
    });

    it('supports switching from fixed to progressive blinds and back to fixed, resetting blind level to 1', async () => {
      const { hostSocket, guestSocket } = await createTwoPlayerRoom();

      // Finish hand 1 with initial fixed blinds (10/20)
      await foldAndSettle(hostSocket, guestSocket);

      // Reset game switching to progressive by hands (1 hand/level, starting at 25/50 -> 50/100)
      const resetToProgressive = ok(
        await sendCommand(hostSocket, {
          type: 'reset-game',
          config: {
            startingChips: 3000,
            smallBlind: 25,
            bigBlind: 50,
            blindsStructure: {
              type: 'hands',
              handsPerLevel: 1,
              levels: [
                { smallBlind: 25, bigBlind: 50 },
                { smallBlind: 50, bigBlind: 100 },
              ],
            },
          },
        }),
      );
      expect(resetToProgressive.config.blindsStructure?.type).toBe('hands');

      // Start game -> Level 1 (25/50), and advance to Level 2 (50/100)
      const hand1 = ok(await sendCommand(hostSocket, { type: 'start-game' }));
      expect(hand1.game?.blindsState?.currentLevelIndex).toBe(0);
      expect(hand1.game?.blindsState?.currentSmallBlind).toBe(25);
      expect(hand1.game?.blindsState?.currentBigBlind).toBe(50);

      await foldAndSettle(hostSocket, guestSocket);
      const hand2 = ok(await sendCommand(hostSocket, { type: 'next-hand' }));
      expect(hand2.game?.blindsState?.currentLevelIndex).toBe(1);
      expect(hand2.game?.blindsState?.currentSmallBlind).toBe(50);
      expect(hand2.game?.blindsState?.currentBigBlind).toBe(100);

      // Settle hand 2 then reset switching to progressive by time
      await foldAndSettle(hostSocket, guestSocket);
      ok(
        await sendCommand(hostSocket, {
          type: 'reset-game',
          config: {
            startingChips: 1500,
            smallBlind: 100,
            bigBlind: 200,
            blindsStructure: {
              type: 'time',
              minutesPerLevel: 5,
              levels: [
                { smallBlind: 100, bigBlind: 200 },
                { smallBlind: 200, bigBlind: 400 },
              ],
            },
          },
        }),
      );
      const handAfterTimeReset = ok(await sendCommand(hostSocket, { type: 'start-game' }));
      expect(handAfterTimeReset.game?.blindsState?.type).toBe('time');
      expect(handAfterTimeReset.game?.blindsState?.currentLevelIndex).toBe(0);
      expect(handAfterTimeReset.game?.blindsState?.currentSmallBlind).toBe(100);
      expect(handAfterTimeReset.game?.blindsState?.currentBigBlind).toBe(200);

      // Finally reset switching back to fixed blinds
      await foldAndSettle(hostSocket, guestSocket);
      ok(
        await sendCommand(hostSocket, {
          type: 'reset-game',
          config: {
            startingChips: 1000,
            smallBlind: 10,
            bigBlind: 20,
            blindsStructure: { type: 'fixed' },
          },
        }),
      );
      const handBackToFixed = ok(await sendCommand(hostSocket, { type: 'start-game' }));
      expect(handBackToFixed.game?.blindsState?.type).toBe('fixed');
      expect(handBackToFixed.game?.hand.smallBlind).toBe(10);
      expect(handBackToFixed.game?.hand.bigBlind).toBe(20);
    });

    it('rejects reset-game with updated config from a non-host player', async () => {
      const { hostSocket, guestSocket } = await createTwoPlayerRoom();
      await foldAndSettle(hostSocket, guestSocket);

      const reply = await sendCommand(guestSocket, {
        type: 'reset-game',
        config: {
          startingChips: 5000,
          smallBlind: 50,
          bigBlind: 100,
          blindsStructure: { type: 'fixed' },
        },
      });
      expect(reply.ok).toBe(false);
      if (!reply.ok) {
        expect(reply.error.code).toBe('FORBIDDEN');
      }

      const current = await syncClient(hostSocket);
      expect(current.config.startingChips).toBe(1000);
      expect(current.game?.status).toBe('hand-settled');
    });

    it('rejects malformed reset-game config over socket without mutating room config', async () => {
      const { hostSocket, guestSocket } = await createTwoPlayerRoom();
      await foldAndSettle(hostSocket, guestSocket);

      const reply = await sendCommand(hostSocket, {
        type: 'reset-game',
        config: {
          startingChips: 100,
          smallBlind: 150,
          bigBlind: 100,
          blindsStructure: { type: 'fixed' },
        },
      });
      expect(reply.ok).toBe(false);

      const current = await syncClient(hostSocket);
      expect(current.config.startingChips).toBe(1000);
      expect(current.config.smallBlind).toBe(10);
      expect(current.config.bigBlind).toBe(20);
    });
  });
});
