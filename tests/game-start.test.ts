import { afterEach, beforeEach, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { roomStateSchema, type Admission, type ClientEvents, type Command, type Credentials, type Reply, type RoomState, type ServerEvents } from '@poker-table/protocol';
import { createApplication } from '../apps/server/src/http/app.js';
import { initializeHand } from '../apps/server/src/game/initial-hand.js';
import { decodeHand } from '../apps/server/src/persistence/hand.js';

type Client = Socket<ServerEvents, ClientEvents>;
let app: ReturnType<typeof createApplication>, base: string, directory: string;
const clients: Client[] = [];
const config = { name: 'Etapa 3A', maxPlayers: 10, startingChips: 1000, smallBlind: 10, bigBlind: 20 };
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'poker-game-'));
  app = createApplication({ databasePath: join(directory, 'test.sqlite') });
  base = `http://127.0.0.1:${await app.listen(0, '127.0.0.1')}`;
});
afterEach(async () => {
  clients.splice(0).forEach(c => c.disconnect());
  await app.close();
  rmSync(directory, { recursive: true, force: true });
});
function client(credentials: unknown): Client {
  const socket: Client = io(base, { auth: { protocol: 1, credentials }, transports: ['websocket'], autoConnect: false, reconnectionDelay: 50 });
  clients.push(socket);
  return socket;
}
async function connect(credentials: Credentials) {
  const socket = client(credentials);
  await new Promise<void>((resolve, reject) => {
    socket.once('room:state', () => resolve()); socket.once('connect_error', reject); socket.connect();
  });
  return socket;
}
const sync = (socket: Client) => new Promise<RoomState>((resolve, reject) => socket.emit('room:sync', r => r.ok ? resolve(r.data) : reject(Error(r.error.message))));
const send = (socket: Client, command: unknown) => new Promise<Reply<RoomState>>(resolve => socket.emit('room:command', command as Command, resolve));
const command = async (socket: Client, payload: Record<string, unknown>) => send(socket, { ...payload, commandId: randomUUID(), expectedRevision: (await sync(socket)).revision });
const waitFor = async (condition: () => boolean) => { await expect.poll(condition, { timeout: 5000 }).toBe(true); };
const post = async (path: string, body: unknown) => (await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<Reply<Admission>>;
function value(reply: Reply<RoomState>): RoomState {
  if (!reply.ok) throw new Error(JSON.stringify(reply.error));
  return reply.data;
}
async function table(seats = [1, 2], overrides = {}) {
  const host = app.rooms.create({ hostName: 'Host', config: { ...config, ...overrides } });
  app.rooms.command(host.credentials, { type: 'select-seat', seat: seats[0], commandId: randomUUID(), expectedRevision: host.room.revision });
  const admissions = [host, ...seats.slice(1).map((seat, i) => app.rooms.join(host.room.code, { name: `P${i}`, seat }))];
  const sockets = await Promise.all(admissions.map(a => connect(a.credentials)));
  return { host, admissions, sockets, socket: sockets[0] };
}
const rawHand = (id: string) => (app.store.db.prepare('SELECT game FROM rooms WHERE id=?').get(id) as { game: string | null }).game;

it.each([[1, 2], [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [9, 3, 6]])('starts and broadcasts correct positions, blinds, actors and conserved chips at seats %j', async (...seats) => {
  const { host, socket, sockets, admissions } = await table(seats);
  const observed: RoomState[] = [];
  sockets.forEach(s => s.on('room:state', state => { if (state.game) observed.push(state); }));
  const before = await sync(socket), state = value(await command(socket, { type: 'start-game' }));
  expect(roomStateSchema.safeParse(state).success).toBe(true);
  expect(before.game).toBeNull();
  expect(state.revision).toBe(before.revision + 1);
  const sorted = [...seats].sort((a, b) => a - b);
  const hand = state.game!.hand, sb = sorted[seats.length === 2 ? 0 : 1], bb = sorted[seats.length === 2 ? 1 : 2];
  expect(hand).toMatchObject({ street: 'preflop', status: 'in_progress', dealerSeat: sorted[0], smallBlindSeat: sb, bigBlindSeat: bb, pot: 30 });
  expect(hand.players.map(p => p.seat)).toEqual(sorted);
  expect(hand.players.map(p => p.id).sort()).toEqual(admissions.map(a => a.credentials.playerId).sort());
  expect(hand.currentActorId).toBe(hand.players.find(p => p.seat === sorted[seats.length === 2 ? 0 : 3 % seats.length])!.id);
  expect(hand.playersToAct[0]).toBe(hand.currentActorId);
  for (const p of hand.players) {
    const contribution = p.seat === sb ? 10 : p.seat === bb ? 20 : 0;
    expect(p).toMatchObject({ chips: 1000 - contribution, roundCommitted: contribution, totalCommitted: contribution, folded: false, isAllIn: false });
  }
  expect(hand.players.reduce((sum, p) => sum + p.chips, hand.pot)).toBe(seats.length * 1000);
  await waitFor(() => observed.length === sockets.length);
  expect(observed.every(s => JSON.stringify(s) === JSON.stringify(state))).toBe(true);
  expect(JSON.parse(rawHand(host.room.id)!)).toMatchObject({ version: 1, status: 'hand-active', hand: { pot: 30 } });
  const json = JSON.stringify(state);
  expect(json).not.toMatch(/Token|hash|session|currentRound|handState|baseCommitted|fingerprint/);
  for (const a of admissions) expect(json).not.toContain(a.credentials.sessionToken);
});

it('preserves all-in flags produced by the engine, including an initially completed betting round', async () => {
  const { socket } = await table([4, 9], { startingChips: 20, smallBlind: 20, bigBlind: 20 });
  const state = value(await command(socket, { type: 'start-game' }));
  expect(state.game!.hand).toMatchObject({ status: 'showdown', pot: 40, currentActorId: null, playersToAct: [] });
  expect(state.game!.hand.players.every(p => p.chips === 0 && p.isAllIn)).toBe(true);
});

it.each([
  { startingChips: -1 }, { startingChips: 0 }, { startingChips: 1.5 }, { startingChips: NaN },
  { startingChips: Infinity }, { startingChips: Number.MAX_SAFE_INTEGER + 1 },
  { startingChips: Number.MAX_SAFE_INTEGER }, // Individually safe, aggregate unsafe; existing cap rejects it first.
  { startingChips: 19 }, { smallBlind: 0 }, { smallBlind: -1 }, { smallBlind: 1.5 },
  { bigBlind: 9 }, { bigBlind: Infinity }, { bigBlind: Number.MAX_SAFE_INTEGER + 1 },
])('rejects invalid financial configuration %j without creating a room', async invalid => {
  const before = app.store.db.prepare('SELECT COUNT(*) AS n FROM rooms').get();
  expect(await post('/api/rooms', { hostName: 'Host', config: { ...config, ...invalid } })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  // HTTP JSON turns non-finite numbers into null; also exercise the exact JS values at the service boundary.
  expect(() => app.rooms.create({ hostName: 'Host', config: { ...config, ...invalid } })).toThrow();
  expect(app.store.db.prepare('SELECT COUNT(*) AS n FROM rooms').get()).toEqual(before);
});

it('rejects fewer than two seated players and never includes an unseated participant', async () => {
  const { host, socket } = await table([1]);
  const extra = app.rooms.join(host.room.code, { name: 'Unseated' });
  await connect(extra.credentials);
  const before = await sync(socket);
  expect(await command(socket, { type: 'start-game' })).toMatchObject({ ok: false, error: { code: 'INSUFFICIENT_PLAYERS' } });
  expect(await sync(socket)).toEqual(before);
  const guest = app.rooms.join(host.room.code, { name: 'Seated', seat: 5 });
  await connect(guest.credentials);
  expect(value(await command(socket, { type: 'start-game' })).game!.hand.players.map(p => p.id).sort()).toEqual([host.credentials.playerId, guest.credentials.playerId].sort());
});

it('rejects an eleventh participant, duplicate seats and client-supplied roster or financial state', async () => {
  const { host, socket } = await table([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect(await post(`/api/rooms/${host.room.code}/join`, { name: 'Extra' })).toMatchObject({ ok: false, error: { code: 'ROOM_FULL' } });
  const before = await sync(socket);
  for (const payload of [{ players: before.players }, { playerId: randomUUID() }, { roomId: randomUUID() }, { dealerSeat: 5 }, { pot: 100 }, { startingChips: 100 }, { isHost: true }, { config }]) {
    expect(await command(socket, { type: 'start-game', ...payload })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  }
  expect(await sync(socket)).toEqual(before);
  const roster = before.players;
  for (const players of [[...roster, { ...roster[0], id: randomUUID() }], [roster[0], { ...roster[1], id: roster[0].id }], [roster[0], { ...roster[1], seat: roster[0].seat }]]) {
    expect(() => initializeHand(players, config)).toThrow();
  }
});

it('requires every seated participant to reconnect before starting and ignores disconnected unseated participants', async () => {
  const { host, socket, sockets, admissions } = await table();
  app.rooms.join(host.room.code, { name: 'Waiting offline' });
  sockets[1].disconnect();
  await waitFor(() => !app.rooms.state(host.room.id).players.find(p => p.id === admissions[1].credentials.playerId)!.connected);
  const before = await sync(socket);
  expect(await command(socket, { type: 'start-game' })).toMatchObject({ ok: false, error: { code: 'PLAYERS_DISCONNECTED' } });
  expect(await sync(socket)).toEqual(before);
  await connect(admissions[1].credentials);
  expect(value(await command(socket, { type: 'start-game' })).game!.hand.players).toHaveLength(2);
});

it('authorizes only the authenticated host with the administrative credential', async () => {
  const { host, socket, sockets, admissions } = await table();
  const noAdmin = await connect({ ...host.credentials, adminToken: undefined });
  const badAdmin = await connect({ ...host.credentials, adminToken: 'a'.repeat(64) });
  const guestWithAdmin = await connect({ ...admissions[1].credentials, adminToken: host.credentials.adminToken });
  const before = await sync(socket);
  for (const s of [sockets[1], noAdmin, badAdmin, guestWithAdmin]) {
    expect(await command(s, { type: 'start-game' })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  }
  expect(await sync(socket)).toEqual(before);
});

it('rejects unauthenticated, invalid and cross-room sessions before accepting commands', async () => {
  const { host, socket, admissions } = await table();
  const other = app.rooms.create({ hostName: 'Other', config });
  const before = await sync(socket);
  for (const credentials of [undefined, { ...host.credentials, sessionToken: '0'.repeat(64) }, { ...other.credentials, roomId: host.room.id }, { ...admissions[1].credentials, playerId: host.credentials.playerId }]) {
    const forged = client(credentials);
    const error = await new Promise<Error & { data?: { code: string } }>(resolve => { forged.once('connect_error', resolve); forged.connect(); });
    expect(['INVALID_INPUT', 'UNAUTHORIZED']).toContain(error.data?.code);
    forged.disconnect();
  }
  const outsider = await connect(other.credentials);
  expect(await command(outsider, { type: 'start-game', roomId: host.room.id })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  expect(await command(outsider, { type: 'start-game' })).toMatchObject({ ok: false, error: { code: 'INSUFFICIENT_PLAYERS' } });
  expect(await sync(socket)).toEqual(before);
});

it('deduplicates the same ID and rejects a second start or conflicting payload without resetting chips', async () => {
  const { socket } = await table();
  const input = { type: 'start-game', commandId: randomUUID(), expectedRevision: (await sync(socket)).revision };
  const first = value(await send(socket, input));
  expect(value(await send(socket, input))).toEqual(first);
  expect(await send(socket, { ...input, type: 'rename', name: 'Conflict' })).toMatchObject({ ok: false, error: { code: 'COMMAND_CONFLICT' } });
  expect(await command(socket, { type: 'start-game' })).toMatchObject({ ok: false, error: { code: 'GAME_ALREADY_STARTED' } });
  expect(await sync(socket)).toEqual(first);
});

it.each([false, true])('serializes simultaneous start commands from two host tabs (same ID: %s)', async sameId => {
  const { host, socket } = await table();
  const second = await connect(host.credentials), before = await sync(socket), id = randomUUID();
  const results = await Promise.all([socket, second].map((s, i) => send(s, { type: 'start-game', commandId: sameId || i === 0 ? id : randomUUID(), expectedRevision: before.revision })));
  expect(results.filter(r => r.ok)).toHaveLength(sameId ? 2 : 1);
  if (!sameId) expect(results.find(r => !r.ok)).toMatchObject({ error: { code: 'STALE_STATE' } });
  const state = await sync(socket);
  expect(state.revision).toBe(before.revision + 1);
  expect(state.game!.hand.pot).toBe(30);
});

it('locks seats, active departures and late joins while preserving original reconnectable sessions', async () => {
  const { host, socket, sockets, admissions } = await table([3, 8]);
  const unseated = app.rooms.join(host.room.code, { name: 'Waiting' });
  const waitingSocket = await connect(unseated.credentials);
  const started = value(await command(socket, { type: 'start-game' }));
  for (const s of [socket, sockets[1], waitingSocket]) for (const seat of [1, null]) {
    expect(await command(s, { type: 'select-seat', seat })).toMatchObject({ ok: false, error: { code: 'GAME_IN_PROGRESS' } });
  }
  for (const s of [socket, sockets[1]]) expect(await command(s, { type: 'leave' })).toMatchObject({ ok: false, error: { code: 'GAME_IN_PROGRESS' } });
  expect(await post(`/api/rooms/${host.room.code}/join`, { name: 'New', seat: 8 })).toMatchObject({ ok: false, error: { code: 'GAME_IN_PROGRESS' } });
  expect(await sync(socket)).toEqual(started);
  sockets[1].disconnect();
  await waitFor(() => !app.rooms.state(host.room.id).players.find(p => p.id === admissions[1].credentials.playerId)!.connected);
  expect((await sync(socket)).game).toEqual(started.game);
  const resumed = await connect(admissions[1].credentials);
  const state = await sync(resumed);
  expect(state.game).toEqual(started.game);
  expect(state.players.find(p => p.id === admissions[1].credentials.playerId)).toMatchObject({ seat: 8, connected: true });
  expect(await command(resumed, { type: 'rename', name: 'Updated' })).toMatchObject({ ok: true });
  expect(await command(waitingSocket, { type: 'leave' })).toMatchObject({ ok: true });
  // Closing archives the room, preserving its game; it does not remove or settle players.
  expect(value(await command(socket, { type: 'close-room' })).game).toEqual(started.game);
});

it.each(['game', 'deduplication', 'revision'])('rolls back all initialization effects if writing %s fails', async stage => {
  const { host, socket } = await table();
  const before = await sync(socket), count = app.store.db.prepare('SELECT COUNT(*) AS n FROM commands').get();
  const target = stage === 'game' ? 'UPDATE OF game ON rooms' : stage === 'deduplication' ? 'INSERT ON commands' : 'UPDATE OF revision ON rooms';
  app.store.db.exec(`CREATE TRIGGER fail_start BEFORE ${target} BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
  let broadcasts = 0;
  socket.on('room:state', () => broadcasts++);
  expect(await command(socket, { type: 'start-game' })).toMatchObject({ ok: false, error: { code: 'STORAGE_ERROR' } });
  expect(await sync(socket)).toEqual(before);
  expect(rawHand(host.room.id)).toBeNull();
  expect(app.store.db.prepare('SELECT COUNT(*) AS n FROM commands').get()).toEqual(count);
  expect(broadcasts).toBe(0);
  app.store.db.exec('DROP TRIGGER fail_start');
  expect(value(await command(socket, { type: 'start-game' })).game!.hand.pot).toBe(30);
});

it('automatically reconnects after SQLite recovery with preserved hand, revision and durable command IDs', async () => {
  const { host, socket } = await table([7, 2, 10]);
  const input = { type: 'start-game', commandId: randomUUID(), expectedRevision: (await sync(socket)).revision };
  const started = value(await send(socket, input)), serialized = rawHand(host.room.id), port = Number(new URL(base).port);
  await app.close();
  app = createApplication({ databasePath: join(directory, 'test.sqlite') });
  const offline = app.rooms.state(host.room.id);
  expect(offline.game).toEqual(started.game);
  expect(offline.revision).toBeGreaterThan(started.revision);
  expect(offline.players.every(p => !p.connected)).toBe(true);
  expect(rawHand(host.room.id)).toBe(serialized);
  await app.listen(port, '127.0.0.1');
  await waitFor(() => clients.every(s => s.connected));
  const recovered = await sync(socket);
  expect(recovered.game).toEqual(started.game);
  expect(recovered.players.map(p => [p.id, p.seat])).toEqual(started.players.map(p => [p.id, p.seat]));
  expect(recovered.revision).toBeGreaterThan(offline.revision);
  expect(value(await send(socket, input))).toEqual(recovered);
  expect(await command(socket, { type: 'start-game' })).toMatchObject({ ok: false, error: { code: 'GAME_ALREADY_STARTED' } });
  const decoded = decodeHand(serialized!, recovered.config, recovered.players);
  expect(Object.isFrozen(decoded)).toBe(true);
  expect(Object.isFrozen(decoded.players[0])).toBe(true);
  expect(Object.isFrozen(decoded.currentRound.players)).toBe(true);
});

it('rejects persisted blind positions inconsistent with engine rules', async () => {
  const { host, socket } = await table([1, 2, 3]);

  value(await command(socket, { type: 'start-game' }));

  const saved = JSON.parse(rawHand(host.room.id)!);
  const hand = saved.hand;

  // Corrompe a posição do SB em todas as representações internas.
  // Os valores permanecem coerentes entre si, mas violam as regras.
  const incorrectSeat = hand.dealerSeat;

  hand.smallBlindSeat = incorrectSeat;
  hand.handState.smallBlindSeat = incorrectSeat;
  hand.currentRound.smallBlindSeat = incorrectSeat;
  hand.currentRound.handState.smallBlindSeat = incorrectSeat;

  app.store.db.prepare(
    'UPDATE rooms SET game=? WHERE id=?',
  ).run(JSON.stringify(saved), host.room.id);

  const reply = await new Promise<Reply<RoomState>>(
    resolve => socket.emit('room:sync', resolve),
  );

  expect(reply).toMatchObject({
    ok: false,
    error: { code: 'STORAGE_ERROR' },
  });
});

it.each(['version', 'pot', 'chips', 'identity', 'actor', 'json'])('rejects corrupted persisted %s without recreating the hand', async field => {
  const { host, socket } = await table();
  const started = value(await command(socket, { type: 'start-game' }));
  const saved = JSON.parse(rawHand(host.room.id)!);
  if (field === 'version') saved.version = 99;
  if (field === 'pot') saved.hand.pot++;
  if (field === 'chips') saved.hand.players[0].chips++;
  if (field === 'identity') saved.hand.players[0].id = randomUUID();
  if (field === 'actor') saved.hand.currentActorId = randomUUID();
  const raw = field === 'json' ? '{invalid' : JSON.stringify(saved);
  app.store.db.prepare('UPDATE rooms SET game=? WHERE id=?').run(raw, host.room.id);
  const reply = await new Promise<Reply<RoomState>>(resolve => socket.emit('room:sync', resolve));
  expect(reply).toMatchObject({ ok: false, error: { code: 'STORAGE_ERROR' } });
  expect(rawHand(host.room.id)).toBe(raw);
  expect(app.store.db.prepare('SELECT revision FROM rooms WHERE id=?').get(host.room.id)).toMatchObject({ revision: started.revision });
});

it('migrates an existing v1 room without losing credentials, seats or deduplication', async () => {
  const host = app.rooms.create({ hostName: 'Host', config });
  const input = { type: 'select-seat', seat: 5, commandId: randomUUID(), expectedRevision: host.room.revision };
  app.rooms.command(host.credentials, input);
  app.store.db.exec('ALTER TABLE rooms DROP COLUMN game; PRAGMA user_version=1;');
  await app.close();
  app = createApplication({ databasePath: join(directory, 'test.sqlite') });
  expect(app.store.db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 2 });
  expect(app.rooms.authenticate(host.credentials)).toEqual(host.credentials);
  const recovered = app.rooms.state(host.room.id);
  expect(recovered.game).toBeNull();
  expect(recovered.players[0].seat).toBe(5);
  expect(app.rooms.command(host.credentials, input)).toEqual(recovered);
});
