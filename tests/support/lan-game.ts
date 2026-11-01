import { afterEach, beforeEach, expect } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHandFlow, type HandFlowState } from '@poker-table/engine';
import type { Admission, ClientEvents, Command, Credentials, Reply, RoomState, ServerEvents } from '@poker-table/protocol';
import { createApplication } from '../../apps/server/src/http/app.js';
import { decodeHand, encodeHand } from '../../apps/server/src/persistence/hand.js';

export type Client = Socket<ServerEvents, ClientEvents>;
export const config = { name: 'Etapa 3B', maxPlayers: 10, startingChips: 1000, smallBlind: 10, bigBlind: 20 };
export const ok = (reply: Reply<RoomState>) => { if (!reply.ok) throw Error(JSON.stringify(reply.error)); return reply.data; };
export const waitFor = async (condition: () => boolean) => { await expect.poll(condition, { timeout: 5000 }).toBe(true); };

class LanGame {
  app!: ReturnType<typeof createApplication>;
  directory!: string;
  base!: string;
  clients: Client[] = [];
  admissions: Admission[] = [];
  sockets: Client[] = [];
  get host() { return this.admissions[0]; }
  get roomId() { return this.host.room.id; }
  async open() {
    this.directory = mkdtempSync(join(tmpdir(), 'poker-actions-'));
    this.app = createApplication({ databasePath: join(this.directory, 'test.sqlite') });
    this.base = `http://127.0.0.1:${await this.app.listen(0, '127.0.0.1')}`;
  }
  async close() {
    this.clients.forEach(c => c.disconnect());
    await this.app.close();
    rmSync(this.directory, { recursive: true, force: true });
  }
  client(credentials: unknown) {
    const socket: Client = io(this.base, { auth: { protocol: 1, credentials }, transports: ['websocket'], autoConnect: false, reconnectionDelay: 50 });
    this.clients.push(socket);
    return socket;
  }
  async connect(credentials: Credentials) {
    const socket = this.client(credentials);
    await new Promise<void>((resolve, reject) => {
      socket.once('room:state', () => resolve()); socket.once('connect_error', reject); socket.connect();
    });
    return socket;
  }
  async setup(count = 3, start = true) {
    const host = this.app.rooms.create({ hostName: 'Host', config });
    this.admissions.push(host);
    this.sockets.push(await this.connect(host.credentials));
    ok(await this.command(0, { type: 'select-seat', seat: 1 }));
    for (let i = 1; i < count; i++) {
      const guest = this.app.rooms.join(host.room.code, { name: `P${i}`, seat: i + 1 });
      this.admissions.push(guest); this.sockets.push(await this.connect(guest.credentials));
    }
    if (start) ok(await this.command(0, { type: 'start-game' }));
    return this.state();
  }
  state() { return this.app.rooms.state(this.roomId); }
  raw() { return (this.app.store.db.prepare('SELECT game FROM rooms WHERE id=?').get(this.roomId) as { game: string }).game; }
  hand() { const state = this.state(); return decodeHand(this.raw(), state.config, state.players); }
  sync(socket = this.sockets[0]) {
    return new Promise<RoomState>((resolve, reject) => socket.timeout(3000).emit('room:sync', (error, r) => {
      if (error) reject(Error('room:sync ACK timeout'));
      else if (r.ok) resolve(r.data);
      else reject(Error(r.error.message));
    }));
  }
  send(socket: Client, input: unknown) {
    return new Promise<Reply<RoomState>>((resolve, reject) => socket.timeout(3000).emit('room:command', input as Command, (error, reply) => {
      if (error) reject(Error('room:command ACK timeout'));
      else resolve(reply);
    }));
  }
  async envelope(payload: Record<string, unknown>, socket = this.sockets[0]) {
    return { ...payload, commandId: randomUUID(), expectedRevision: (await this.sync(socket)).revision };
  }
  async command(index: number, payload: Record<string, unknown>) {
    return this.send(this.sockets[index], await this.envelope(payload, this.sockets[index]));
  }
  actorIndex() { return this.admissions.findIndex(a => a.credentials.playerId === this.state().game!.hand.currentActorId); }
  async act(action: string, amount?: number) {
    return ok(await this.command(this.actorIndex(), { type: 'game-action', action, ...(amount === undefined ? {} : { amount }) }));
  }
  async advance() { return ok(await this.command(0, { type: 'advance-street' })); }
  async finishRound() {
    for (let n = 0; this.hand().currentActorId !== null; n++) {
      if (n >= 15) throw Error('Round failed to finish');
      const hand = this.hand(), actor = hand.players.find(p => p.id === hand.currentActorId)!;
      await this.act(actor.roundCommitted < hand.currentRound.currentBet ? 'call' : 'check');
    }
  }
  async restart() {
    const port = Number(new URL(this.base).port);
    const disconnected = Promise.all(this.sockets.map(s => new Promise<void>(resolve => {
      if (!s.connected) resolve(); else s.once('disconnect', () => resolve());
    })));
    await this.app.close();
    await disconnected;
    this.app = createApplication({ databasePath: join(this.directory, 'test.sqlite') });
    await this.app.listen(port, '127.0.0.1');
    await waitFor(() => this.sockets.every(s => s.connected));
    return this.sync();
  }
  // Explicit storage fixture for short all-ins: uniform 3A stacks cannot reach these
  // situations in the first hand. Origin is generated by the real engine, never mocked.
  seedStacks(stacks: number[]) {
    expect(stacks.reduce((a, b) => a + b, 0)).toBe(config.startingChips * stacks.length);
    const hand = startHandFlow({
      players: this.admissions.map((a, i) => ({ id: a.credentials.playerId, seat: i + 1, chips: stacks[i] })),
      blinds: config,
    });
    const state = this.state();
    this.app.store.db.prepare('UPDATE rooms SET game=? WHERE id=?').run(encodeHand(hand, config, state.players, 2), this.roomId);
  }
  assertConserved(hand: HandFlowState = this.hand()) {
    expect(hand.players.reduce((total, p) => total + p.chips, hand.pot)).toBe(config.startingChips * hand.players.length);
    expect(hand.players.reduce((total, p) => total + p.totalCommitted, 0)).toBe(hand.pot);
  }
}

export function useLanGame() {
  const game = new LanGame();
  beforeEach(async () => { game.clients = []; game.admissions = []; game.sockets = []; await game.open(); });
  afterEach(() => game.close());
  return game;
}
