import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  advanceBlindsOnNextHand,
  adjustTrackerForServerDowntime,
  computeBlindsState,
  type ClientEvents,
  type Credentials,
  type Reply,
  type RoomConfig,
  type RoomState,
  type ServerEvents,
} from '@poker-table/protocol';
import { createApplication } from '../apps/server/src/http/app.js';
import {
  initClockSync,
  computeSynchronizedRemaining,
  formatCountdownTime,
} from '../apps/web/src/utils/clock-sync.js';

type Client = Socket<ServerEvents, ClientEvents>;
const ok = <T>(reply: Reply<T>): T => {
  if (!reply.ok) throw new Error(JSON.stringify(reply.error));
  return reply.data;
};

describe('Clock Synchronization & Idle Downtime Recovery', () => {
  describe('Client-Side Monotonic Clock Sync', () => {
    it('handles a client phone with system clock 5 minutes ahead without distorting countdown', () => {
      // O servidor informa que faltam 300 segundos (5 minutos) para expirar o nível
      const serverSecondsRemaining = 300;

      // O relógio de parede (Date.now()) do celular está 5 minutos adiantado
      const clientWallClockSkewMs = 5 * 60 * 1000;
      const fakeWallClockNow = Date.now() + clientWallClockSkewMs;

      // O timer monotônico (performance.now()) marca t = 1000ms
      let clientPerfTime = 1000;

      const sync = initClockSync(serverSecondsRemaining, clientPerfTime);

      // No instante inicial, o contador sincronizado exibe exatamente 300s (5:00)
      expect(computeSynchronizedRemaining(sync, clientPerfTime)).toBe(300);
      expect(formatCountdownTime(computeSynchronizedRemaining(sync, clientPerfTime))).toBe('5:00');

      // Avança 10 segundos no timer monotônico (10.000ms)
      clientPerfTime += 10_000;

      // O tempo restante agora é 290s (4:50), completamente imune ao desvio de Date.now()
      expect(computeSynchronizedRemaining(sync, clientPerfTime)).toBe(290);
      expect(formatCountdownTime(computeSynchronizedRemaining(sync, clientPerfTime))).toBe('4:50');

      // O relógio do sistema pode estar em qualquer valor arbitrário sem afetar o cálculo
      expect(fakeWallClockNow).toBeGreaterThan(Date.now());
    });

    it('handles a client phone with system clock 5 minutes behind without distorting countdown', () => {
      // O servidor informa que faltam 300 segundos
      const serverSecondsRemaining = 300;

      // O relógio de parede (Date.now()) do celular está 5 minutos atrasado
      const clientWallClockSkewMs = -5 * 60 * 1000;
      const fakeWallClockNow = Date.now() + clientWallClockSkewMs;

      let clientPerfTime = 5000;
      const sync = initClockSync(serverSecondsRemaining, clientPerfTime);

      // Inicia em 300s
      expect(computeSynchronizedRemaining(sync, clientPerfTime)).toBe(300);
      expect(formatCountdownTime(computeSynchronizedRemaining(sync, clientPerfTime))).toBe('5:00');

      // Avança 30 segundos monotônicos
      clientPerfTime += 30_000;

      expect(computeSynchronizedRemaining(sync, clientPerfTime)).toBe(270);
      expect(formatCountdownTime(computeSynchronizedRemaining(sync, clientPerfTime))).toBe('4:30');
      expect(fakeWallClockNow).toBeLessThan(Date.now());
    });

    it('synchronizes two clients receiving the same temporal state regardless of system clocks', () => {
      const serverSecondsRemaining = 180; // 3 minutos

      // Cliente 1 tem relógio adiantado 1 hora, Cliente 2 tem relógio atrasado 2 horas
      let perfClient1 = 20_000;
      let perfClient2 = 500_000;

      const syncClient1 = initClockSync(serverSecondsRemaining, perfClient1);
      const syncClient2 = initClockSync(serverSecondsRemaining, perfClient2);

      expect(computeSynchronizedRemaining(syncClient1, perfClient1)).toBe(180);
      expect(computeSynchronizedRemaining(syncClient2, perfClient2)).toBe(180);

      // Decorrem 15 segundos em tempo real
      perfClient1 += 15_000;
      perfClient2 += 15_000;

      const rem1 = computeSynchronizedRemaining(syncClient1, perfClient1);
      const rem2 = computeSynchronizedRemaining(syncClient2, perfClient2);

      expect(rem1).toBe(165);
      expect(rem2).toBe(165);
      expect(formatCountdownTime(rem1)).toBe('2:45');
      expect(formatCountdownTime(rem2)).toBe('2:45');
    });

    it('recalculates remaining time immediately upon returning from a suspended background tab', () => {
      const serverSecondsRemaining = 120; // 2 minutos
      let clientPerfTime = 10_000;

      const sync = initClockSync(serverSecondsRemaining, clientPerfTime);
      expect(computeSynchronizedRemaining(sync, clientPerfTime)).toBe(120);

      // A aba é suspensa ou o celular bloqueado durante 45 segundos
      clientPerfTime += 45_000;

      // Ao reativar a aba (evento visibilitychange), a leitura do performance.now()
      // mede diretamente o intervalo total decorrido durante a suspensão
      const remainingAfterWake = computeSynchronizedRemaining(sync, clientPerfTime);
      expect(remainingAfterWake).toBe(75);
      expect(formatCountdownTime(remainingAfterWake)).toBe('1:15');
    });

    it('correctly behaves on the last configured level without displaying a non-existent next level', () => {
      const structure = {
        type: 'time' as const,
        minutesPerLevel: 10,
        levels: [
          { smallBlind: 10, bigBlind: 20 },
          { smallBlind: 25, bigBlind: 50 },
        ],
      };

      const now = 1700000000000;
      // Nível 1 (último nível da lista de 2 níveis)
      const lastLevelTracker = {
        levelIndex: 1,
        handsInCurrentLevel: 3,
        levelStartedAt: new Date(now - 15 * 60 * 1000).toISOString(), // iniciado há 15 min (> 10 min)
      };

      const state = computeBlindsState(
        structure,
        lastLevelTracker,
        { smallBlind: 25, bigBlind: 50 },
        now,
      );

      expect(state.currentLevelIndex).toBe(1);
      expect(state.nextLevel).toBeNull();
      // Como não há próximo nível, isNextLevelPending deve ser false
      expect(state.isNextLevelPending).toBe(false);

      // O contador chega a 0s, mas não há próximo nível
      const sync = initClockSync(state.secondsRemainingInLevel ?? 0, 1000);
      expect(computeSynchronizedRemaining(sync, 1000)).toBe(0);

      // Ao chamar advanceBlindsOnNextHand, o motor preserva o último nível
      const adv = advanceBlindsOnNextHand(structure, lastLevelTracker, { smallBlind: 25, bigBlind: 50 }, now);
      expect(adv.tracker?.levelIndex).toBe(1);
      expect(adv.blinds).toEqual({ smallBlind: 25, bigBlind: 50 });
    });
  });

  describe('Integration: Active Hand Expiration, Reconnection & Idle Heartbeat Recovery', () => {
    let directory: string;
    let app: ReturnType<typeof createApplication>;
    let port: number;

    const connectClient = (credentials: Credentials): Promise<Client> =>
      new Promise((resolve, reject) => {
        const socket: Client = io(`http://127.0.0.1:${port}`, {
          auth: { protocol: 1, credentials },
          reconnection: false,
        });
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', reject);
      });

    const syncClient = (socket: Client): Promise<RoomState> =>
      new Promise((resolve, reject) => {
        socket.emit('room:sync', reply => {
          if (!reply.ok) reject(reply.error);
          else resolve(reply.data);
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
      return new Promise<Reply<RoomState>>(resolve => {
        socket.emit(
          'room:command',
          envelope as Parameters<ClientEvents['room:command']>[0],
          resolve,
        );
      });
    };

    beforeEach(async () => {
      directory = mkdtempSync(join(tmpdir(), 'poker-clock-sync-test-'));
      app = createApplication({ databasePath: join(directory, 'test.sqlite') });
      port = await app.listen(0);
    });

    afterEach(async () => {
      await app.close();
      rmSync(directory, { recursive: true, force: true });
    });

    it('preserves active hand blinds when level expires during street and updates isNextLevelPending', async () => {
      const config: RoomConfig = {
        name: 'Mesa Blinds Time',
        maxPlayers: 2,
        startingChips: 1000,
        smallBlind: 10,
        bigBlind: 20,
        blindsStructure: {
          type: 'time',
          minutesPerLevel: 1, // 1 minuto
          levels: [
            { smallBlind: 10, bigBlind: 20 },
            { smallBlind: 20, bigBlind: 40 },
          ],
        },
      };

      const hostAdm = app.rooms.create({ hostName: 'Host', config });
      const hostSocket = await connectClient(hostAdm.credentials);
      ok(await sendCommand(hostSocket, { type: 'select-seat', seat: 1 }));

      const guestAdm = app.rooms.join(hostAdm.room.code, { name: 'Guest', seat: 2 });
      const guestSocket = await connectClient(guestAdm.credentials);

      // Inicia a partida (Nível 0: SB 10, BB 20)
      const startReply = ok(await sendCommand(hostSocket, { type: 'start-game' }));

      expect(startReply.game?.hand.smallBlind).toBe(10);
      expect(startReply.game?.hand.bigBlind).toBe(20);
      expect(startReply.game?.blindsState?.isNextLevelPending).toBe(false);

      // Simula o tempo avançando 70 segundos (além do 1 minuto do nível)
      const startedAtMs = new Date(startReply.game?.blindsState?.levelStartedAt ?? 0).getTime();
      const afterExpiryMs = startedAtMs + 70_000;

      // A mão ativa continua ocorrendo com os blinds originais da mão (10/20)
      const stateDuringPlay = app.rooms.state(hostAdm.room.id);
      expect(stateDuringPlay.game?.hand.smallBlind).toBe(10);
      expect(stateDuringPlay.game?.hand.bigBlind).toBe(20);

      // O computeBlindsState no tempo após a expiração marca isNextLevelPending = true
      const blindsCheck = computeBlindsState(
        config.blindsStructure,
        {
          levelIndex: 0,
          handsInCurrentLevel: 1,
          levelStartedAt: startReply.game?.blindsState?.levelStartedAt ?? '',
        },
        { smallBlind: 10, bigBlind: 20 },
        afterExpiryMs,
      );
      expect(blindsCheck.isNextLevelPending).toBe(true);
      expect(blindsCheck.nextLevel).toEqual({ levelIndex: 1, smallBlind: 20, bigBlind: 40 });

      hostSocket.disconnect();
      guestSocket.disconnect();
    });

    it('allows a reconnecting client to retrieve pending level state after expiration', async () => {
      const config: RoomConfig = {
        name: 'Mesa Reconnect Expired',
        maxPlayers: 2,
        startingChips: 1000,
        smallBlind: 10,
        bigBlind: 20,
        blindsStructure: {
          type: 'time',
          minutesPerLevel: 1,
          levels: [
            { smallBlind: 10, bigBlind: 20 },
            { smallBlind: 25, bigBlind: 50 },
          ],
        },
      };

      const hostAdm = app.rooms.create({ hostName: 'Host', config });
      const hostSocket = await connectClient(hostAdm.credentials);
      ok(await sendCommand(hostSocket, { type: 'select-seat', seat: 1 }));

      const guestAdm = app.rooms.join(hostAdm.room.code, { name: 'Guest', seat: 2 });
      const guestSocket = await connectClient(guestAdm.credentials);

      // Ambos conectados, inicia partida
      ok(await sendCommand(hostSocket, { type: 'start-game' }));

      // Guest desconecta temporariamente
      guestSocket.disconnect();

      // Guest reconecta após o tempo
      const reconnectedGuestSocket = await connectClient(guestAdm.credentials);

      // O sync do convidado retorna o snapshot atual com status conectável
      const syncRes = await syncClient(reconnectedGuestSocket);
      expect(syncRes.game).toBeDefined();
      expect(syncRes.game?.blindsState?.type).toBe('time');
      expect(syncRes.game?.blindsState?.secondsRemainingInLevel).toBeDefined();

      hostSocket.disconnect();
      reconnectedGuestSocket.disconnect();
    });

    it('does not falsely pause tournament clock on idle games after server restart due to periodic heartbeat', async () => {
      const config: RoomConfig = {
        name: 'Mesa Heartbeat Idle',
        maxPlayers: 2,
        startingChips: 1000,
        smallBlind: 10,
        bigBlind: 20,
        blindsStructure: {
          type: 'time',
          minutesPerLevel: 10, // 10 minutos
          levels: [
            { smallBlind: 10, bigBlind: 20 },
            { smallBlind: 20, bigBlind: 40 },
          ],
        },
      };

      const hostAdm = app.rooms.create({ hostName: 'Host', config });
      const hostSocket = await connectClient(hostAdm.credentials);
      ok(await sendCommand(hostSocket, { type: 'select-seat', seat: 1 }));

      const guestAdm = app.rooms.join(hostAdm.room.code, { name: 'Guest', seat: 2 });
      const guestSocket = await connectClient(guestAdm.credentials);

      const startRes = ok(await sendCommand(hostSocket, { type: 'start-game' }));
      const startedAt = startRes.game?.blindsState?.levelStartedAt;
      hostSocket.disconnect();
      guestSocket.disconnect();

      // Simula uma partida que ficou ociosa por 10 minutos com o servidor ligado.
      // O heartbeat do servidor mantém lastSavedAt atualizado durante o tempo em que esteve ativo.
      const tenMinutesLater = Date.now() + 10 * 60 * 1000;
      app.rooms.flushHeartbeat(tenMinutesLater);

      // O servidor é desligado no instante tenMinutesLater
      await app.close();

      // O servidor é reiniciado 5 segundos depois (downtime real = 5s)
      const restartBootMs = tenMinutesLater + 5_000;
      const newApp = createApplication({ databasePath: join(directory, 'test.sqlite') });
      Object.assign(newApp.rooms, { serverBootAt: restartBootMs });

      // Recupera a partida pós-reboot
      const restoredState = newApp.rooms.state(hostAdm.room.id);
      expect(restoredState.game).toBeDefined();

      // Como o lastSavedAt foi mantido pelo heartbeat até 5s antes do reinício,
      // a diferença (5s <= 60s) NÃO provoca nenhuma pausa indevida em levelStartedAt!
      expect(restoredState.game?.blindsState?.levelStartedAt).toBe(startedAt);

      await newApp.close();
    });

    it('correctly applies pause policy when server was actually offline for 15 minutes', () => {
      const baseMs = 1700000000000;
      const startedAt = new Date(baseMs).toISOString();

      // Servidor parou em t = 2 minutos
      const lastSavedAt = new Date(baseMs + 2 * 60 * 1000).toISOString();

      // Servidor foi religado em t = 17 minutos (downtime real = 15 minutos = 900.000 ms)
      const serverBootAt = baseMs + 17 * 60 * 1000;

      const adjusted = adjustTrackerForServerDowntime(
        {
          levelIndex: 0,
          handsInCurrentLevel: 1,
          levelStartedAt: startedAt,
          lastSavedAt,
        },
        serverBootAt,
      );

      // Downtime de 15 minutos: os primeiros 60s contam normalmente, os 14 minutos excedentes são pausados
      // Portanto, levelStartedAt deve ser adiado em exatamente 14 minutos (840.000 ms)
      const expectedStartedMs = baseMs + 14 * 60 * 1000;
      expect(new Date(adjusted.levelStartedAt).getTime()).toBe(expectedStartedMs);
      expect(adjusted.lastSavedAt).toBe(new Date(serverBootAt).toISOString());
    });

    it('maintains backwards compatibility when loading v0.2.0 stored games without blindsTracker or admittedPlayerIds', async () => {
      const config: RoomConfig = {
        name: 'Mesa v0.2.0 Compatibility',
        maxPlayers: 2,
        startingChips: 1000,
        smallBlind: 10,
        bigBlind: 20,
      };

      const hostAdm = app.rooms.create({ hostName: 'Host', config });
      const hostSocket = await connectClient(hostAdm.credentials);
      ok(await sendCommand(hostSocket, { type: 'select-seat', seat: 1 }));

      const guestAdm = app.rooms.join(hostAdm.room.code, { name: 'Guest', seat: 2 });
      const guestSocket = await connectClient(guestAdm.credentials);

      // Inicia a partida normalmente para criar um estado poker válido pelo motor
      ok(await sendCommand(hostSocket, { type: 'start-game' }));

      // Recupera o JSON salvo no SQLite
      const row = app.store.db.prepare('SELECT game FROM rooms WHERE id=?').get(hostAdm.room.id) as { game: string };
      expect(row.game).toBeDefined();
      const gameObj = JSON.parse(row.game);

      // Converte para formato autêntico v0.2.0: remove blindsTracker e admittedPlayerIds
      delete gameObj.blindsTracker;
      delete gameObj.admittedPlayerIds;

      app.store.db.prepare('UPDATE rooms SET game=? WHERE id=?').run(JSON.stringify(gameObj), hostAdm.room.id);

      // Lê o estado pelo RoomService e confirma decodificação limpa
      const state = app.rooms.state(hostAdm.room.id);
      expect(state.game).toBeDefined();
      expect(state.game?.status).toBe('hand-active');
      expect(state.game?.blindsState?.type).toBe('fixed');
      expect(state.game?.hand.players).toHaveLength(2);

      hostSocket.disconnect();
      guestSocket.disconnect();
    });
  });
});
