import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ok, useLanGame, waitFor } from './support/lan-game.js';

describe('Multiplayer LAN Resilience and Security Audit (Etapa 3D)', () => {
  const g = useLanGame();

  describe('1. Desconexões e reconexões em momentos críticos', () => {
    it('preserves turn, identity and chips when the actor disconnects preflop, waiting without auto-fold', async () => {
      await g.setup(3);
      const actorIdx = g.actorIndex();
      const actorId = g.admissions[actorIdx].credentials.playerId;
      const stateBefore = g.state();
      const potBefore = stateBefore.game!.hand.pot;

      // Actor disconnects
      g.sockets[actorIdx].disconnect();
      await waitFor(() => !g.state().players.find(p => p.id === actorId)!.connected);

      // Financial state and actor turn must be preserved
      const stateDuring = g.state();
      expect(stateDuring.game!.hand.currentActorId).toBe(actorId);
      expect(stateDuring.game!.hand.pot).toBe(potBefore);

      // Other players cannot act out of turn
      const otherIdx = (actorIdx + 1) % 3;
      const outOfTurnReply = await g.command(otherIdx, { type: 'game-action', action: 'call' });
      expect(outOfTurnReply).toMatchObject({ error: { code: 'OUT_OF_TURN' } });

      // Actor reconnects
      g.sockets[actorIdx].connect();
      await waitFor(() => g.sockets[actorIdx].connected && g.state().players.find(p => p.id === actorId)!.connected);

      // Actor can now act normally
      await g.act('call');
      expect(g.state().game!.hand.pot).toBe(potBefore + 20); // UTG calls 20 (already 0 committed)
      g.assertConserved();
    });

    it('handles disconnection after elimination, continuing next hand without the eliminated player', async () => {
      await g.setup(3);
      // Give P2 only 10 chips so P2 is eliminated when forced all-in on small blind (or during preflop)
      g.seedStacks([1990, 1000, 10]); // Host=1990, P1=1000, P2=10
      // In 3-player initial hand: Dealer=Seat 1 (Host), SB=Seat 2 (P1), BB=Seat 3 (P2).
      // P2 has 10 chips and bigBlind is 20, so P2 is all-in from BB for 10 chips!
      expect(g.hand().players.find(p => p.id === g.admissions[2].credentials.playerId)!.isAllIn).toBe(true);

      // Play through: Host calls 20, P1 calls 10 more (matches BB 20)
      await g.act('call');
      await g.act('call');
      // Advance flop, turn, river to showdown
      await g.advance();
      await g.finishRound();
      await g.advance();
      await g.finishRound();
      await g.advance();
      await g.finishRound();
      await g.advance(); // showdown

      // Main pot (disputed by all 3) is 30 (10 from each). Side pot between Host and P1 is 20 (10 from each).
      // Settle both pots awarding all to Host
      const hostId = g.host.credentials.playerId;
      await g.settle([
        { potId: 'main', winners: [hostId] },
        { potId: 'side-1', winners: [hostId] },
      ]);

      const settled = g.state();
      expect(settled.game?.status).toBe('hand-settled');
      const p2Id = g.admissions[2].credentials.playerId;
      if (settled.game?.status === 'hand-settled') {
        expect(settled.game.settlement.players.find(p => p.id === p2Id)!.chips).toBe(0);
      }

      // P2 (now eliminated) disconnects
      g.sockets[2].disconnect();
      await waitFor(() => !g.state().players.find(p => p.id === p2Id)!.connected);

      // Host starts next hand: heads-up between Host and P1
      await g.nextHand();
      const stateHand2 = g.state();
      expect(stateHand2.game?.status).toBe('hand-active');
      expect(stateHand2.game!.hand.players).toHaveLength(2);
      expect(stateHand2.game!.hand.players.some(p => p.id === p2Id)).toBe(false);
      g.assertConserved();
    });

    it('preserves state when player disconnects after raising, and continues smoothly on opponent action', async () => {
      await g.setup(3);
      const actorIdx = g.actorIndex();
      const actorId = g.admissions[actorIdx].credentials.playerId;

      // Actor raises to 60
      await g.act('raise', 60);
      expect(g.state().game!.hand.pot).toBe(90); // 10 SB + 20 BB + 60 Raise

      // Actor disconnects immediately after raising
      g.sockets[actorIdx].disconnect();
      await waitFor(() => !g.state().players.find(p => p.id === actorId)!.connected);

      // The next player can act
      const nextActorIdx = g.actorIndex();
      expect(nextActorIdx).not.toBe(actorIdx);
      await g.act('fold');

      // Original actor reconnects
      g.sockets[actorIdx].connect();
      await waitFor(() => g.sockets[actorIdx].connected && g.state().players.find(p => p.id === actorId)!.connected);
      expect(g.state().game?.status).toBe('hand-active');
      g.assertConserved();
    });

    it('preserves showdown state and awards pot when eligible player is disconnected during settlement', async () => {
      await g.setup(3);
      const p1 = g.admissions[1].credentials.playerId;

      // Play all streets to showdown
      await g.finishRound();
      await g.advance(); // flop
      await g.finishRound();
      await g.advance(); // turn
      await g.finishRound();
      await g.advance(); // river
      await g.finishRound();
      await g.advance(); // showdown

      expect(g.state().game?.status).toBe('hand-active');
      expect(g.state().game?.hand.status).toBe('showdown');

      // P1 (winner-to-be) disconnects during showdown
      g.sockets[1].disconnect();
      await waitFor(() => !g.state().players.find(p => p.id === p1)!.connected);

      // Host settles hand awarding main pot to disconnected P1
      await g.settle([{ potId: 'main', winners: [p1] }]);

      const settledState = g.state();
      expect(settledState.game?.status).toBe('hand-settled');
      if (settledState.game?.status === 'hand-settled') {
        const p1Settled = settledState.game.settlement.players.find(p => p.id === p1)!;
        expect(p1Settled.chips).toBe(1040); // 1000 - 20 committed + 60 won
      }

      // P1 reconnects and syncs updated stack
      g.sockets[1].connect();
      await waitFor(() => g.sockets[1].connected && g.state().players.find(p => p.id === p1)!.connected);
      const synced = await g.sync(g.sockets[1]);
      expect(synced.game?.status).toBe('hand-settled');
      g.assertConserved();
    });

    it('preserves hand-settled state when player disconnects before next-hand, and resumes correctly', async () => {
      await g.setup(3);

      // Fold preflop so hand ends
      await g.act('fold');
      await g.act('fold');
      expect(g.state().game?.hand.status).toBe('hand_ended_by_fold');

      await g.settle();
      expect(g.state().game?.status).toBe('hand-settled');

      // P2 disconnects while hand is settled
      const p2 = g.admissions[2].credentials.playerId;
      g.sockets[2].disconnect();
      await waitFor(() => !g.state().players.find(p => p.id === p2)!.connected);

      // Host starts next hand
      await g.nextHand();
      const stateHand2 = g.state();
      expect(stateHand2.game?.status).toBe('hand-active');
      expect(stateHand2.game?.hand.pot).toBe(30); // new blinds

      // P2 reconnects and syncs
      g.sockets[2].connect();
      await waitFor(() => g.sockets[2].connected && g.state().players.find(p => p.id === p2)!.connected);
      const synced = await g.sync(g.sockets[2]);
      expect(synced.game?.status).toBe('hand-active');
      g.assertConserved();
    });

    it('maintains consistent presence across two concurrent tabs for the same credentials', async () => {
      await g.setup(2);
      const hostCredentials = g.host.credentials;

      // Host opens a second tab with identical credentials
      const secondTab = await g.connect(hostCredentials);
      expect(g.state().players.find(p => p.id === hostCredentials.playerId)!.connected).toBe(true);

      // Tab 1 receives room:state when Tab 2 sends a command (rename)
      let tab1Received = false;
      g.sockets[0].once('room:state', () => { tab1Received = true; });

      const renameCmd = await g.envelope({ type: 'rename', name: 'HostTab2' }, secondTab);
      ok(await g.send(secondTab, renameCmd));
      expect(tab1Received).toBe(true);
      expect(g.state().players.find(p => p.id === hostCredentials.playerId)!.name).toBe('HostTab2');

      // Tab 1 disconnects: Host must STILL appear connected because Tab 2 is active
      g.sockets[0].disconnect();
      // Brief wait to ensure disconnect was processed
      await new Promise(r => setTimeout(r, 50));
      expect(g.state().players.find(p => p.id === hostCredentials.playerId)!.connected).toBe(true);

      // Now Tab 2 also disconnects: Host must transition to disconnected
      secondTab.disconnect();
      await waitFor(() => !g.state().players.find(p => p.id === hostCredentials.playerId)!.connected);

      // Tab 1 reconnects: Host transitions back to connected
      g.sockets[0].connect();
      await waitFor(() => g.sockets[0].connected && g.state().players.find(p => p.id === hostCredentials.playerId)!.connected);
    });
  });

  describe('2. Comandos atrasados, duplicados e conflitantes', () => {
    it('rejects commands with stale revision with STALE_STATE and refreshes client state', async () => {
      await g.setup(3);
      const staleInput = {
        type: 'game-action',
        action: 'call',
        commandId: randomUUID(),
        expectedRevision: 9999, // Stale/invalid revision
      };
      const reply = await g.send(g.sockets[g.actorIndex()], staleInput);
      expect(reply).toMatchObject({ error: { code: 'STALE_STATE' } });
    });

    it('idempotently returns previous result for duplicate commandId with identical payload', async () => {
      await g.setup(3);
      const actorIdx = g.actorIndex();
      const input = await g.envelope({ type: 'game-action', action: 'call' }, g.sockets[actorIdx]);

      const res1 = await g.send(g.sockets[actorIdx], input);
      expect(res1.ok).toBe(true);
      const revisionAfter = g.state().revision;
      const potAfter = g.state().game!.hand.pot;

      // Duplicate resend (e.g. lost ACK)
      const res2 = await g.send(g.sockets[actorIdx], input);
      expect(res2.ok).toBe(true);
      expect(g.state().revision).toBe(revisionAfter);
      expect(g.state().game!.hand.pot).toBe(potAfter);
      g.assertConserved();
    });

    it('rejects reused commandId with conflicting payload with COMMAND_CONFLICT', async () => {
      await g.setup(3);
      const actorIdx = g.actorIndex();
      const input = await g.envelope({ type: 'game-action', action: 'call' }, g.sockets[actorIdx]);
      ok(await g.send(g.sockets[actorIdx], input));

      // Attempt to reuse same commandId with different payload
      const conflicting = {
        type: 'rename',
        name: 'EvilName',
        commandId: input.commandId,
        expectedRevision: g.state().revision,
      };
      const res = await g.send(g.sockets[actorIdx], conflicting);
      expect(res).toMatchObject({ error: { code: 'COMMAND_CONFLICT' } });
    });
  });

  describe('3. Isolamento entre salas no mesmo servidor', () => {
    it('completely isolates state, events and commands between separate rooms', async () => {
      // Room 1 created via g.setup
      await g.setup(2);
      const host1Socket = g.sockets[0];

      // Create Room 2 on the same server instance
      const host2Admission = g.app.rooms.create({
        hostName: 'Host2',
        config: { name: 'Mesa 2', maxPlayers: 6, startingChips: 500, smallBlind: 5, bigBlind: 10 },
      });
      const room2Id = host2Admission.room.id;
      expect(g.roomId).not.toBe(room2Id);
      const host2Socket = await g.connect(host2Admission.credentials);

      // Track broadcasts
      let room1Broadcasts = 0;
      let room2Broadcasts = 0;
      host1Socket.on('room:state', () => { room1Broadcasts++; });
      host2Socket.on('room:state', () => { room2Broadcasts++; });

      // Host 1 executes a poker action in Room 1
      await g.act('call');
      expect(room1Broadcasts).toBeGreaterThan(0);
      expect(room2Broadcasts).toBe(0); // Room 2 received zero events!

      // Host 2 sending command renames their own player in Room 2, never Room 1
      const renameCmd = {
        type: 'rename' as const,
        name: 'Hacker',
        commandId: randomUUID(),
        expectedRevision: g.app.rooms.state(room2Id).revision,
      };
      ok(await g.send(host2Socket, renameCmd));
      expect(g.state().players.some(p => p.name === 'Hacker')).toBe(false);
      expect(g.app.rooms.state(room2Id).players.some(p => p.name === 'Hacker')).toBe(true);

      // Close Room 1
      const closeCmd = await g.envelope({ type: 'close-room' }, host1Socket);
      ok(await g.send(host1Socket, closeCmd));
      expect(g.state().closed).toBe(true);

      // Room 2 must remain open and unaffected
      const room2State = g.app.rooms.state(room2Id);
      expect(room2State.closed).toBe(false);
      expect(room2State.config.startingChips).toBe(500);

      host2Socket.disconnect();
    });
  });

  describe('4. Robustez do Socket.IO e validação estrita', () => {
    it('gracefully rejects malformed and invalid payloads without crashing', async () => {
      await g.setup(2);
      const socket = g.sockets[0];

      const malformedPayloads = [
        null,
        'string-payload',
        12345,
        {},
        { type: 'unknown-type', commandId: randomUUID(), expectedRevision: 1 },
        { type: 'game-action', action: 'raise', amount: -50, commandId: randomUUID(), expectedRevision: 1 },
        { type: 'game-action', action: 'raise', amount: 'not-a-number', commandId: randomUUID(), expectedRevision: 1 },
        { type: 'select-seat', seat: 999, commandId: randomUUID(), expectedRevision: 1 },
        { type: 'settle-hand', decisions: 'invalid', commandId: randomUUID(), expectedRevision: 1 },
      ];

      for (const payload of malformedPayloads) {
        const reply = await g.send(socket, payload);
        expect(reply.ok).toBe(false);
        if (!reply.ok) {
          expect(['INVALID_INPUT', 'ROOM_CLOSED', 'STALE_STATE']).toContain(reply.error.code);
        }
      }

      // Verify server is still completely responsive
      const syncReply = await g.sync(socket);
      expect(syncReply.id).toBe(g.roomId);
    });

    it('safely handles commands when client provides no ack callback', async () => {
      await g.setup(2);
      const socket = g.sockets[0];

      // Emit without ACK callback - should not throw unhandled exception on server
      const untypedEmit = socket.emit.bind(socket) as (ev: string, ...args: unknown[]) => void;
      untypedEmit('room:command', { type: 'unknown' });
      untypedEmit('room:sync');

      await new Promise(r => setTimeout(r, 100));
      const syncReply = await g.sync(socket);
      expect(syncReply.id).toBe(g.roomId);
    });
  });

  describe('5. Auditoria de segurança dos snapshots', () => {
    it('never leaks sessionToken, adminToken, password hashes or secrets in any snapshot', async () => {
      await g.setup(3);
      const hostCreds = g.host.credentials;
      const p1Creds = g.admissions[1].credentials;

      const secrets = [
        hostCreds.sessionToken,
        hostCreds.adminToken!,
        p1Creds.sessionToken,
      ];

      const forbiddenKeys = new Set([
        'adminToken',
        'sessionToken',
        'admin_hash',
        'session_hash',
        'adminHash',
        'sessionHash',
        'password',
        'secret',
      ]);

      const inspectSnapshot = (obj: unknown, path = ''): void => {
        if (!obj || typeof obj !== 'object') return;
        for (const [key, val] of Object.entries(obj)) {
          expect(forbiddenKeys.has(key), `Forbidden key "${key}" found at path "${path}.${key}"`).toBe(false);
          if (typeof val === 'string') {
            for (const secret of secrets) {
              expect(val.includes(secret), `Secret leaked in value at path "${path}.${key}"`).toBe(false);
            }
          } else if (typeof val === 'object') {
            inspectSnapshot(val, `${path}.${key}`);
          }
        }
      };

      // 1. Inspect RoomState from sync
      const synced = await g.sync();
      inspectSnapshot(synced, 'syncedRoomState');

      // 2. Play hand to showdown and settle
      await g.finishRound();
      await g.advance(); // flop
      await g.finishRound();
      await g.advance(); // turn
      await g.finishRound();
      await g.advance(); // river
      await g.finishRound();
      await g.advance(); // showdown
      const settled = await g.settle([{ potId: 'main', winners: [p1Creds.playerId] }]);

      // 3. Inspect settled RoomState and SettlementSnapshot
      inspectSnapshot(settled, 'settledRoomState');
      expect(settled.game?.status).toBe('hand-settled');

      // 4. Start next hand and inspect active game state
      const hand2 = await g.nextHand();
      inspectSnapshot(hand2, 'hand2RoomState');
    });
  });

  describe('6. Limpeza de recursos e integridade da tabela de comandos', () => {
    it('cleans up in-memory connection sets when all sockets for a player disconnect', async () => {
      await g.setup(2);
      const p1Id = g.admissions[1].credentials.playerId;

      // Verify connection is registered
      const roomsService = g.app.rooms as unknown as { connections: Map<string, Set<string>> };
      expect(roomsService.connections.get(p1Id)?.size).toBe(1);

      // Connect second socket for P1
      const p1Socket2 = await g.connect(g.admissions[1].credentials);
      expect(roomsService.connections.get(p1Id)?.size).toBe(2);

      // Disconnect socket 2
      p1Socket2.disconnect();
      await waitFor(() => roomsService.connections.get(p1Id)?.size === 1);

      // Disconnect socket 1
      g.sockets[1].disconnect();
      await waitFor(() => roomsService.connections.has(p1Id) === false);
    });

    it('records durable commands without accumulating unbounded duplicate rows', async () => {
      await g.setup(2);
      const initialCommandsCount = g.app.store.db.prepare('SELECT COUNT(*) as count FROM commands WHERE room_id=?').get(g.roomId) as { count: number };

      // Execute 3 poker actions
      await g.act('call');
      await g.act('check');
      await g.advance();

      const newCommandsCount = g.app.store.db.prepare('SELECT COUNT(*) as count FROM commands WHERE room_id=?').get(g.roomId) as { count: number };
      expect(newCommandsCount.count).toBe(initialCommandsCount.count + 3);
    });
  });
});
