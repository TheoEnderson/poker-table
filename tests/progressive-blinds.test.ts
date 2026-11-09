import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  advanceBlindsOnNextHand,
  adjustTrackerForServerDowntime,
  computeBlindsState,
  getDefaultBlindLevels,
  type ClientEvents,
  type Command,
  type Credentials,
  type Reply,
  type RoomConfig,
  type RoomState,
  type ServerEvents,
} from '@poker-table/protocol';
import { createApplication } from '../apps/server/src/http/app.js';

type Client = Socket<ServerEvents, ClientEvents>;
const ok = <T>(reply: Reply<T>): T => {
  if (!reply.ok) throw new Error(JSON.stringify(reply.error));
  return reply.data;
};

describe('Progressive Blinds (Blinds Progressivos)', () => {
  describe('Protocol & Computation Unit Tests', () => {
    it('generates standard blind presets correctly', () => {
      const levels = getDefaultBlindLevels(10, 20);
      expect(levels).toHaveLength(5);
      expect(levels[0]).toEqual({ smallBlind: 10, bigBlind: 20 });
      expect(levels[1]).toEqual({ smallBlind: 20, bigBlind: 40 });
      expect(levels[4]).toEqual({ smallBlind: 100, bigBlind: 200 });
    });

    it('computes fixed blinds state when no progressive structure is configured', () => {
      const state = computeBlindsState(
        { type: 'fixed' },
        undefined,
        { smallBlind: 10, bigBlind: 20 },
      );
      expect(state).toEqual({
        type: 'fixed',
        currentLevelIndex: 0,
        currentSmallBlind: 10,
        currentBigBlind: 20,
        nextLevel: null,
        isNextLevelPending: false,
      });
    });

    it('computes progression by hands correctly', () => {
      const structure = {
        type: 'hands' as const,
        handsPerLevel: 3,
        levels: [
          { smallBlind: 10, bigBlind: 20 },
          { smallBlind: 20, bigBlind: 40 },
          { smallBlind: 30, bigBlind: 60 },
        ],
      };

      // Mão 1 de 3 no nível 0
      const state1 = computeBlindsState(
        structure,
        { levelIndex: 0, handsInCurrentLevel: 1, levelStartedAt: '2026-01-01T00:00:00Z' },
        { smallBlind: 10, bigBlind: 20 },
      );
      expect(state1.currentLevelIndex).toBe(0);
      expect(state1.handsRemainingInLevel).toBe(2);
      expect(state1.isNextLevelPending).toBe(false);
      expect(state1.nextLevel).toEqual({ levelIndex: 1, smallBlind: 20, bigBlind: 40 });

      // Mão 3 de 3 no nível 0 (última mão do nível: próximo nível pendente para a próxima mão)
      const state3 = computeBlindsState(
        structure,
        { levelIndex: 0, handsInCurrentLevel: 3, levelStartedAt: '2026-01-01T00:00:00Z' },
        { smallBlind: 10, bigBlind: 20 },
      );
      expect(state3.currentLevelIndex).toBe(0);
      expect(state3.handsRemainingInLevel).toBe(0);
      expect(state3.isNextLevelPending).toBe(true);
      expect(state3.nextLevel).toEqual({ levelIndex: 1, smallBlind: 20, bigBlind: 40 });

      // Último nível: não há próximo nível e não há pendência
      const stateFinal = computeBlindsState(
        structure,
        { levelIndex: 2, handsInCurrentLevel: 10, levelStartedAt: '2026-01-01T00:00:00Z' },
        { smallBlind: 30, bigBlind: 60 },
      );
      expect(stateFinal.currentLevelIndex).toBe(2);
      expect(stateFinal.nextLevel).toBeNull();
      expect(stateFinal.isNextLevelPending).toBe(false);
    });

    it('advances levels by hands on next-hand', () => {
      const structure = {
        type: 'hands' as const,
        handsPerLevel: 2,
        levels: [
          { smallBlind: 10, bigBlind: 20 },
          { smallBlind: 20, bigBlind: 40 },
        ],
      };

      // Inicial: mão 1 no nível 0
      const t1 = { levelIndex: 0, handsInCurrentLevel: 1, levelStartedAt: '2026-01-01T00:00:00Z' };

      const baseBlinds = { smallBlind: 10, bigBlind: 20 };

      // Próxima mão (mão 2 de 2 no mesmo nível)
      const adv1 = advanceBlindsOnNextHand(structure, t1, baseBlinds);
      expect(adv1.tracker).toBeDefined();
      expect(adv1.tracker?.levelIndex).toBe(0);
      expect(adv1.tracker?.handsInCurrentLevel).toBe(2);
      expect(adv1.blinds).toEqual({ smallBlind: 10, bigBlind: 20 });

      // Próxima mão (avança para nível 1)
      const adv2 = advanceBlindsOnNextHand(structure, adv1.tracker, baseBlinds);
      expect(adv2.tracker).toBeDefined();
      expect(adv2.tracker?.levelIndex).toBe(1);
      expect(adv2.tracker?.handsInCurrentLevel).toBe(1);
      expect(adv2.blinds).toEqual({ smallBlind: 20, bigBlind: 40 });

      // Próxima mão já no último nível: permanece no nível 1 e continua contando mãos
      const adv3 = advanceBlindsOnNextHand(structure, adv2.tracker, baseBlinds);
      expect(adv3.tracker).toBeDefined();
      expect(adv3.tracker?.levelIndex).toBe(1);
      expect(adv3.tracker?.handsInCurrentLevel).toBe(2);
      expect(adv3.blinds).toEqual({ smallBlind: 20, bigBlind: 40 });
    });

    it('computes progression by time and applies downtime pause policy', () => {
      const structure = {
        type: 'time' as const,
        minutesPerLevel: 10,
        levels: [
          { smallBlind: 10, bigBlind: 20 },
          { smallBlind: 25, bigBlind: 50 },
        ],
      };

      const baseTime = 1700000000000;
      const startedAt = new Date(baseTime).toISOString();

      // 5 minutos depois (ainda no nível 0)
      const state5m = computeBlindsState(
        structure,
        { levelIndex: 0, handsInCurrentLevel: 1, levelStartedAt: startedAt },
        { smallBlind: 10, bigBlind: 20 },
        baseTime + 5 * 60 * 1000,
      );
      expect(state5m.currentLevelIndex).toBe(0);
      expect(state5m.isNextLevelPending).toBe(false);
      expect(state5m.nextLevel).toEqual({ levelIndex: 1, smallBlind: 25, bigBlind: 50 });

      // 10 minutos depois (expirou: isNextLevelPending = true)
      const state10m = computeBlindsState(
        structure,
        { levelIndex: 0, handsInCurrentLevel: 1, levelStartedAt: startedAt },
        { smallBlind: 10, bigBlind: 20 },
        baseTime + 10 * 60 * 1000,
      );
      expect(state10m.currentLevelIndex).toBe(0);
      expect(state10m.isNextLevelPending).toBe(true);

      // Downtime policy: servidor pausado por 20 minutos (1200s > 60s)
      const lastSavedAt = new Date(baseTime + 2 * 60 * 1000).toISOString(); // salvo aos 2min
      const serverRebootNow = baseTime + 22 * 60 * 1000; // religado aos 22min (downtime = 20min)
      const adjusted = adjustTrackerForServerDowntime(
        { levelIndex: 0, handsInCurrentLevel: 1, levelStartedAt: startedAt, lastSavedAt },
        serverRebootNow,
      );
      const stateReboot = computeBlindsState(
        structure,
        adjusted,
        { smallBlind: 10, bigBlind: 20 },
        serverRebootNow,
      );
      // O tempo offline (>60s) foi pausado, portanto o nível ainda não expirou
      expect(stateReboot.isNextLevelPending).toBe(false);
    });

    it('validates exact downtime accounting for 10s, 60s, 5min and 30min server interruptions', () => {
      const baseMs = 1700000000000;
      const startedAt = new Date(baseMs).toISOString();
      const lastSavedAt = new Date(baseMs + 1000).toISOString(); // salvo em t = 1s

      // 1. Interrupção de 10 segundos: downtime <= 60s
      // Não altera levelStartedAt; todos os 10s são contabilizados como tempo decorrido do nível
      const boot10s = new Date(lastSavedAt).getTime() + 10_000;
      const adj10s = adjustTrackerForServerDowntime(
        { levelIndex: 0, handsInCurrentLevel: 1, levelStartedAt: startedAt, lastSavedAt },
        boot10s,
      );
      expect(adj10s.levelStartedAt).toBe(startedAt);
      expect(adj10s.lastSavedAt).toBe(new Date(boot10s).toISOString());

      // 2. Interrupção de 60 segundos: no limite exato da tolerância
      // Não altera levelStartedAt; os 60s são contabilizados como tempo decorrido
      const boot60s = new Date(lastSavedAt).getTime() + 60_000;
      const adj60s = adjustTrackerForServerDowntime(
        { levelIndex: 0, handsInCurrentLevel: 1, levelStartedAt: startedAt, lastSavedAt },
        boot60s,
      );
      expect(adj60s.levelStartedAt).toBe(startedAt);
      expect(adj60s.lastSavedAt).toBe(new Date(boot60s).toISOString());

      // 3. Interrupção de 5 minutos (300 segundos): excesso de 240 segundos (4 minutos) pausado
      // Exatamente 1 minuto (60s) é contabilizado como decorrido; 4 minutos são pausados (+240.000 ms)
      const boot5m = new Date(lastSavedAt).getTime() + 300_000;
      const adj5m = adjustTrackerForServerDowntime(
        { levelIndex: 0, handsInCurrentLevel: 1, levelStartedAt: startedAt, lastSavedAt },
        boot5m,
      );
      const expectedStarted5m = new Date(baseMs + 240_000).toISOString();
      expect(adj5m.levelStartedAt).toBe(expectedStarted5m);

      // 4. Interrupção de 30 minutos (1.800 segundos): excesso de 1.740 segundos (29 minutos) pausado
      // Exatamente 1 minuto (60s) é contabilizado como decorrido; 29 minutos são pausados (+1.740.000 ms)
      const boot30m = new Date(lastSavedAt).getTime() + 1_800_000;
      const adj30m = adjustTrackerForServerDowntime(
        { levelIndex: 0, handsInCurrentLevel: 1, levelStartedAt: startedAt, lastSavedAt },
        boot30m,
      );
      const expectedStarted30m = new Date(baseMs + 1_740_000).toISOString();
      expect(adj30m.levelStartedAt).toBe(expectedStarted30m);
    });

    it('handles final level gracefully without index error, negative counters or invalid nextLevel', () => {
      const structure = {
        type: 'time' as const,
        minutesPerLevel: 5,
        levels: [
          { smallBlind: 10, bigBlind: 20 },
          { smallBlind: 25, bigBlind: 50 },
        ],
      };

      const now = 1700000000000;
      const startedAt = new Date(now - 10 * 60 * 1000).toISOString(); // 10 minutos atrás

      // Estado no último nível (index 1)
      const state = computeBlindsState(
        structure,
        { levelIndex: 1, handsInCurrentLevel: 5, levelStartedAt: startedAt },
        { smallBlind: 25, bigBlind: 50 },
        now,
      );

      expect(state.currentLevelIndex).toBe(1);
      expect(state.currentSmallBlind).toBe(25);
      expect(state.currentBigBlind).toBe(50);
      expect(state.nextLevel).toBeNull();
      expect(state.isNextLevelPending).toBe(false);
      expect(state.secondsRemainingInLevel).toBe(0); // Nunca negativo!

      // Avanço para a próxima mão quando já no último nível
      const adv = advanceBlindsOnNextHand(
        structure,
        { levelIndex: 1, handsInCurrentLevel: 5, levelStartedAt: startedAt },
        { smallBlind: 25, bigBlind: 50 },
        now,
      );

      // Permanece no nível final sem erro de índice
      expect(adv.tracker).toBeDefined();
      expect(adv.tracker?.levelIndex).toBe(1);
      expect(adv.tracker?.handsInCurrentLevel).toBe(6);
      expect(adv.blinds).toEqual({ smallBlind: 25, bigBlind: 50 });
    });
  });

  describe('Integration with Server & Active Rooms', () => {
    let dir: string;
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
        socket.timeout(3000).emit('room:command', envelope as unknown as Command, (err, reply) => {
          if (err) reject(err);
          else resolve(reply);
        });
      });
    };

    beforeEach(async () => {
      dir = mkdtempSync(join(tmpdir(), 'poker-blinds-'));
      app = createApplication({ databasePath: join(dir, 'test.sqlite') });
      base = `http://127.0.0.1:${await app.listen(0, '127.0.0.1')}`;
    });

    afterEach(async () => {
      clients.forEach((c) => c.disconnect());
      clients.length = 0;
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it('manages hands-based progressive blinds across hands without interrupting active hands', async () => {
      const config: RoomConfig = {
        name: 'Hands Tourney',
        maxPlayers: 10,
        startingChips: 1000,
        smallBlind: 10,
        bigBlind: 20,
        blindsStructure: {
          type: 'hands',
          handsPerLevel: 2,
          levels: [
            { smallBlind: 10, bigBlind: 20 },
            { smallBlind: 25, bigBlind: 50 },
            { smallBlind: 50, bigBlind: 100 },
          ],
        },
      };

      const hostAdm = app.rooms.create({ hostName: 'Host', config });
      const hostSocket = await connectClient(hostAdm.credentials);
      ok(await sendCommand(hostSocket, { type: 'select-seat', seat: 1 }));

      const p1Adm = app.rooms.join(hostAdm.room.code, { name: 'P1', seat: 2 });
      const p1Socket = await connectClient(p1Adm.credentials);

      // Inicia a partida: Mão 1
      ok(await sendCommand(hostSocket, { type: 'start-game' }));

      let state = app.rooms.state(hostAdm.room.id);
      expect(state.game?.hand).toBeDefined();
      expect(state.game?.hand.smallBlind).toBe(10);
      expect(state.game?.hand.bigBlind).toBe(20);
      expect(state.game?.blindsState?.type).toBe('hands');
      expect(state.game?.blindsState?.currentLevelIndex).toBe(0);
      expect(state.game?.blindsState?.handsRemainingInLevel).toBe(1);
      expect(state.game?.blindsState?.isNextLevelPending).toBe(false);

      // P1 dá fold para encerrar a Mão 1
      const foldActor = state.game?.hand.currentActorId === p1Adm.credentials.playerId ? p1Socket : hostSocket;
      ok(await sendCommand(foldActor, { type: 'game-action', action: 'fold' }));

      // Host liquida a mão
      ok(await sendCommand(hostSocket, { type: 'settle-hand' }));

      // Anfitrião avança para a Mão 2 (ainda Nível 1: mão 2 de 2)
      ok(await sendCommand(hostSocket, { type: 'next-hand' }));
      state = app.rooms.state(hostAdm.room.id);
      expect(state.game?.hand.smallBlind).toBe(10);
      expect(state.game?.hand.bigBlind).toBe(20);
      expect(state.game?.blindsState?.currentLevelIndex).toBe(0);
      expect(state.game?.blindsState?.handsRemainingInLevel).toBe(0);
      // Última mão do nível: isNextLevelPending deve ser true!
      expect(state.game?.blindsState?.isNextLevelPending).toBe(true);
      expect(state.game?.blindsState?.nextLevel).toEqual({ levelIndex: 1, smallBlind: 25, bigBlind: 50 });

      // Durante a Mão 2, os blinds ATIVOS permanecem estritamente 10/20!
      expect(state.game?.hand.smallBlind).toBe(10);
      expect(state.game?.hand.bigBlind).toBe(20);

      // P1 dá fold para encerrar a Mão 2
      const foldActor2 = state.game?.hand.currentActorId === p1Adm.credentials.playerId ? p1Socket : hostSocket;
      ok(await sendCommand(foldActor2, { type: 'game-action', action: 'fold' }));

      // Host liquida a mão 2
      ok(await sendCommand(hostSocket, { type: 'settle-hand' }));

      // Anfitrião avança para a Mão 3: AGORA deve mudar para Nível 2 (25/50)!
      ok(await sendCommand(hostSocket, { type: 'next-hand' }));
      state = app.rooms.state(hostAdm.room.id);
      expect(state.game?.hand.smallBlind).toBe(25);
      expect(state.game?.hand.bigBlind).toBe(50);
      expect(state.game?.blindsState?.currentLevelIndex).toBe(1);
      expect(state.game?.blindsState?.currentSmallBlind).toBe(25);
      expect(state.game?.blindsState?.currentBigBlind).toBe(50);
      expect(state.game?.blindsState?.nextLevel).toEqual({ levelIndex: 2, smallBlind: 50, bigBlind: 100 });
      expect(state.game?.blindsState?.handsRemainingInLevel).toBe(1);
      expect(state.game?.blindsState?.isNextLevelPending).toBe(false);
      // Pote inicial deve ser 25 + 50 = 75
      expect(state.game?.hand.pot).toBe(75);
    });

    it('persists blinds tracker in SQLite across server restarts', async () => {
      const config: RoomConfig = {
        name: 'Persistence Tourney',
        maxPlayers: 10,
        startingChips: 1000,
        smallBlind: 10,
        bigBlind: 20,
        blindsStructure: {
          type: 'hands',
          handsPerLevel: 1,
          levels: [
            { smallBlind: 10, bigBlind: 20 },
            { smallBlind: 30, bigBlind: 60 },
          ],
        },
      };

      const hostAdm = app.rooms.create({ hostName: 'Host', config });
      const hostSocket = await connectClient(hostAdm.credentials);
      ok(await sendCommand(hostSocket, { type: 'select-seat', seat: 1 }));

      const p1Adm = app.rooms.join(hostAdm.room.code, { name: 'P1', seat: 2 });
      const p1Socket = await connectClient(p1Adm.credentials);

      // Inicia mão 1
      ok(await sendCommand(hostSocket, { type: 'start-game' }));
      // Encerra mão 1
      const foldActor = app.rooms.state(hostAdm.room.id).game?.hand.currentActorId === p1Adm.credentials.playerId ? p1Socket : hostSocket;
      ok(await sendCommand(foldActor, { type: 'game-action', action: 'fold' }));
      ok(await sendCommand(hostSocket, { type: 'settle-hand' }));

      // Avança para mão 2 (nível 1: 30/60)
      ok(await sendCommand(hostSocket, { type: 'next-hand' }));
      let state = app.rooms.state(hostAdm.room.id);
      expect(state.game?.hand.smallBlind).toBe(30);
      expect(state.game?.hand.bigBlind).toBe(60);
      expect(state.game?.blindsState?.currentLevelIndex).toBe(1);

      // Fecha e reinicia o servidor apontando para o mesmo banco SQLite
      clients.forEach((c) => c.disconnect());
      clients.length = 0;
      await app.close();

      const newApp = createApplication({ databasePath: join(dir, 'test.sqlite') });
      const newPort = await newApp.listen(0, '127.0.0.1');
      base = `http://127.0.0.1:${newPort}`;
      app = newApp;

      // Recupera estado da sala recarregada
      state = app.rooms.state(hostAdm.room.id);
      expect(state.game?.hand.smallBlind).toBe(30);
      expect(state.game?.hand.bigBlind).toBe(60);
      expect(state.game?.blindsState?.currentLevelIndex).toBe(1);
      expect(state.game?.blindsState?.currentSmallBlind).toBe(30);
      expect(state.game?.blindsState?.currentBigBlind).toBe(60);
      expect(state.game?.blindsState?.nextLevel).toBeNull();
    });

    it('resets progressive blinds tracker back to Level 1 on reset-game while keeping structure', async () => {
      const config: RoomConfig = {
        name: 'Reset Tourney',
        maxPlayers: 10,
        startingChips: 500,
        smallBlind: 10,
        bigBlind: 20,
        blindsStructure: {
          type: 'hands',
          handsPerLevel: 1,
          levels: [
            { smallBlind: 10, bigBlind: 20 },
            { smallBlind: 50, bigBlind: 100 },
          ],
        },
      };

      const hostAdm = app.rooms.create({ hostName: 'Host', config });
      const hostSocket = await connectClient(hostAdm.credentials);
      ok(await sendCommand(hostSocket, { type: 'select-seat', seat: 1 }));

      const p1Adm = app.rooms.join(hostAdm.room.code, { name: 'P1', seat: 2 });
      const p1Socket = await connectClient(p1Adm.credentials);

      // Inicia mão 1
      ok(await sendCommand(hostSocket, { type: 'start-game' }));
      // Encerra mão 1
      const foldActor = app.rooms.state(hostAdm.room.id).game?.hand.currentActorId === p1Adm.credentials.playerId ? p1Socket : hostSocket;
      ok(await sendCommand(foldActor, { type: 'game-action', action: 'fold' }));
      ok(await sendCommand(hostSocket, { type: 'settle-hand' }));

      // Avança para mão 2 (nível 1: 50/100)
      ok(await sendCommand(hostSocket, { type: 'next-hand' }));

      let state = app.rooms.state(hostAdm.room.id);
      expect(state.game?.hand.smallBlind).toBe(50);
      expect(state.game?.hand.bigBlind).toBe(100);
      expect(state.game?.blindsState?.currentLevelIndex).toBe(1);

      // Encerra e liquida mão 2 antes de reiniciar
      const foldActor2 = app.rooms.state(hostAdm.room.id).game?.hand.currentActorId === p1Adm.credentials.playerId ? p1Socket : hostSocket;
      ok(await sendCommand(foldActor2, { type: 'game-action', action: 'fold' }));
      ok(await sendCommand(hostSocket, { type: 'settle-hand' }));

      // Anfitrião reseta o jogo após liquidação (retorna ao lobby)
      const resetState = ok(await sendCommand(hostSocket, { type: 'reset-game' }));
      expect(resetState.game).toBeNull();

      // Host inicia nova partida: deve recomeçar no Nível 1
      ok(await sendCommand(hostSocket, { type: 'start-game' }));

      state = app.rooms.state(hostAdm.room.id);
      expect(state.game?.hand.smallBlind).toBe(10);
      expect(state.game?.hand.bigBlind).toBe(20);
      expect(state.game?.blindsState?.currentLevelIndex).toBe(0);
      expect(state.game?.blindsState?.currentSmallBlind).toBe(10);
      expect(state.game?.blindsState?.currentBigBlind).toBe(20);
      expect(state.game?.blindsState?.handsRemainingInLevel).toBe(0);
      expect(state.game?.blindsState?.isNextLevelPending).toBe(true);
    });

    it('admits late entrant into next hand under progressive blinds', async () => {
      const config: RoomConfig = {
        name: 'Late Entry Tourney',
        maxPlayers: 10,
        startingChips: 1000,
        smallBlind: 10,
        bigBlind: 20,
        blindsStructure: {
          type: 'hands',
          handsPerLevel: 1,
          levels: [
            { smallBlind: 10, bigBlind: 20 },
            { smallBlind: 40, bigBlind: 80 },
          ],
        },
      };

      const hostAdm = app.rooms.create({ hostName: 'Host', config });
      const hostSocket = await connectClient(hostAdm.credentials);
      ok(await sendCommand(hostSocket, { type: 'select-seat', seat: 1 }));

      const p1Adm = app.rooms.join(hostAdm.room.code, { name: 'P1', seat: 2 });
      const p1Socket = await connectClient(p1Adm.credentials);

      // Inicia com 2 jogadores
      ok(await sendCommand(hostSocket, { type: 'start-game' }));

      // Jogador 3 entra tardiamente durante a mão 1
      const p2Adm = app.rooms.join(hostAdm.room.code, { name: 'P2', seat: 3 });
      await connectClient(p2Adm.credentials);

      // Mão 1 encerra
      const foldActor = app.rooms.state(hostAdm.room.id).game?.hand.currentActorId === p1Adm.credentials.playerId ? p1Socket : hostSocket;
      ok(await sendCommand(foldActor, { type: 'game-action', action: 'fold' }));
      ok(await sendCommand(hostSocket, { type: 'settle-hand' }));

      // Avança para mão 2: P2 participa e os blinds aumentaram para 40/80!
      ok(await sendCommand(hostSocket, { type: 'next-hand' }));

      const state = app.rooms.state(hostAdm.room.id);
      expect(state.game?.hand.players).toHaveLength(3);
      expect(state.game?.hand.smallBlind).toBe(40);
      expect(state.game?.hand.bigBlind).toBe(80);
      const p2InHand = state.game?.hand.players.find((p) => p.id === p2Adm.credentials.playerId);
      expect(p2InHand).toBeDefined();
    });

    it('handles short-stack all-in automatically when blinds increase', async () => {
      const config: RoomConfig = {
        name: 'Short Stack Tourney',
        maxPlayers: 10,
        startingChips: 50, // Começa com poucas fichas
        smallBlind: 10,
        bigBlind: 20,
        blindsStructure: {
          type: 'hands',
          handsPerLevel: 1,
          levels: [
            { smallBlind: 10, bigBlind: 20 },
            { smallBlind: 40, bigBlind: 80 }, // BB de 80 supera as 50 fichas do jogador
          ],
        },
      };

      const hostAdm = app.rooms.create({ hostName: 'Host', config });
      const hostSocket = await connectClient(hostAdm.credentials);
      ok(await sendCommand(hostSocket, { type: 'select-seat', seat: 1 }));

      const p1Adm = app.rooms.join(hostAdm.room.code, { name: 'P1', seat: 2 });
      const p1Socket = await connectClient(p1Adm.credentials);

      ok(await sendCommand(hostSocket, { type: 'start-game' }));

      // Mão 1 encerra
      const foldActor = app.rooms.state(hostAdm.room.id).game?.hand.currentActorId === p1Adm.credentials.playerId ? p1Socket : hostSocket;
      ok(await sendCommand(foldActor, { type: 'game-action', action: 'fold' }));
      ok(await sendCommand(hostSocket, { type: 'settle-hand' }));

      // Próxima mão: BB é 80, mas os jogadores têm cerca de 50 fichas
      ok(await sendCommand(hostSocket, { type: 'next-hand' }));

      const state = app.rooms.state(hostAdm.room.id);
      expect(state.game?.hand).toBeDefined();
      expect(state.game?.hand.smallBlind).toBe(40);
      expect(state.game?.hand.bigBlind).toBe(80);

      // O jogador no Big Blind deve ter entrado em all-in com o restante das suas fichas
      const bbPlayer = state.game?.hand.players.find((p) => p.roundCommitted > 0 && p.chips === 0);
      expect(bbPlayer).toBeDefined();
      expect(bbPlayer?.isAllIn).toBe(true);
      expect(bbPlayer?.chips).toBe(0);
      expect(bbPlayer?.roundCommitted).toBeGreaterThan(0);
    });

    it('manages time-based progressive blinds: advances level on next-hand when time expires', async () => {
      const config: RoomConfig = {
        name: 'Time Tourney',
        maxPlayers: 10,
        startingChips: 1000,
        smallBlind: 10,
        bigBlind: 20,
        blindsStructure: {
          type: 'time',
          minutesPerLevel: 5,
          levels: [
            { smallBlind: 10, bigBlind: 20 },
            { smallBlind: 30, bigBlind: 60 },
          ],
        },
      };

      const hostAdm = app.rooms.create({ hostName: 'Host', config });
      const hostSocket = await connectClient(hostAdm.credentials);
      ok(await sendCommand(hostSocket, { type: 'select-seat', seat: 1 }));

      const p1Adm = app.rooms.join(hostAdm.room.code, { name: 'P1', seat: 2 });
      const p1Socket = await connectClient(p1Adm.credentials);

      // Inicia jogo
      ok(await sendCommand(hostSocket, { type: 'start-game' }));

      let state = app.rooms.state(hostAdm.room.id);
      expect(state.game?.blindsState?.type).toBe('time');
      expect(state.game?.blindsState?.currentLevelIndex).toBe(0);
      expect(state.game?.blindsState?.isNextLevelPending).toBe(false);

      // Simula passagem de 6 minutos no relógio do sistema
      const realNow = Date.now();
      const fakeNow = realNow + 6 * 60 * 1000;
      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(fakeNow);

      try {
        // Durante a mão ativa, mesmo com tempo expirado, blinds ATIVOS permanecem 10/20!
        state = app.rooms.state(hostAdm.room.id);
        expect(state.game?.hand.smallBlind).toBe(10);
        expect(state.game?.hand.bigBlind).toBe(20);
        // Mas o blindsState já avisa que o próximo nível está pendente
        expect(state.game?.blindsState?.isNextLevelPending).toBe(true);
        expect(state.game?.blindsState?.nextLevel).toEqual({ levelIndex: 1, smallBlind: 30, bigBlind: 60 });

        // Encerra a mão 1
        const foldActor = state.game?.hand.currentActorId === p1Adm.credentials.playerId ? p1Socket : hostSocket;
        ok(await sendCommand(foldActor, { type: 'game-action', action: 'fold' }));
        ok(await sendCommand(hostSocket, { type: 'settle-hand' }));

        // Avança para mão 2: AGORA transita para o nível 2 (30/60)
        ok(await sendCommand(hostSocket, { type: 'next-hand' }));

        state = app.rooms.state(hostAdm.room.id);
        expect(state.game?.hand.smallBlind).toBe(30);
        expect(state.game?.hand.bigBlind).toBe(60);
        expect(state.game?.blindsState?.currentLevelIndex).toBe(1);
        expect(state.game?.blindsState?.currentSmallBlind).toBe(30);
        expect(state.game?.blindsState?.currentBigBlind).toBe(60);
      } finally {
        dateSpy.mockRestore();
      }
    });
  });
});
