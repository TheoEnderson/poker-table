import { afterEach, beforeEach, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../apps/server/src/http/app.js';
import type { Admission, ClientEvents, Command, Credentials, Reply, RoomState, ServerEvents } from '@poker-table/protocol';

let app: ReturnType<typeof createApplication>, base: string, dir: string;
const clients: Socket<ServerEvents, ClientEvents>[] = [];
const config = { name: 'Multiplayer', maxPlayers: 10, startingChips: 1000, smallBlind: 10, bigBlind: 20 };
beforeEach(async () => { dir = mkdtempSync(join(tmpdir(), 'poker-integration-')); app = createApplication({ databasePath: join(dir, 'test.sqlite') }); base = `http://127.0.0.1:${await app.listen(0, '127.0.0.1')}`; });
afterEach(async () => { clients.splice(0).forEach(c => c.disconnect()); await app.close(); rmSync(dir, { recursive: true, force: true }); });
async function post<T>(path: string, data: unknown) {
  return await (await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })).json() as Reply<T>;
}
async function admit(path: string, data: unknown) { const reply = await post<Admission>(path, data); if (!reply.ok) throw Error(reply.error.message); return reply.data; }
function client(credentials: Credentials) {
  const socket: Socket<ServerEvents, ClientEvents> = io(base, { auth: { protocol: 1, credentials }, transports: ['websocket'], autoConnect: false, reconnectionDelay: 50 });
  clients.push(socket); return socket;
}
async function connect(credentials: Credentials) {
  const socket = client(credentials);
  await new Promise<void>((resolve, reject) => { socket.once('room:state', () => resolve()); socket.once('connect_error', reject); socket.connect(); });
  return socket;
}
const sync = (socket: Socket<ServerEvents, ClientEvents>) => new Promise<RoomState>((resolve, reject) => socket.emit('room:sync', reply => reply.ok ? resolve(reply.data) : reject(Error(reply.error.message))));
const send = (socket: Socket<ServerEvents, ClientEvents>, command: unknown) => new Promise<Reply<RoomState>>(resolve => socket.emit('room:command', command as Command, resolve));
const host = () => admit('/api/rooms', { config, hostName: 'Ana' });
const waitFor = async (condition: () => boolean) => { await expect.poll(condition, { timeout: 5000 }).toBe(true); };

it('synchronizes ten simultaneous clients, seat changes, names and explicit resync', async () => {
  const h = await host(), admissions = [h];
  for (let i = 1; i < 10; i++) admissions.push(await admit(`/api/rooms/${h.room.code}/join`, { name: `P${i}` }));
  const sockets = await Promise.all(admissions.map(a => connect(a.credentials)));
  const observed = new Map<string, RoomState>();
  for (const s of sockets) s.on('room:state', state => observed.set(s.id!, state));
  const state = await sync(sockets[0]);
  expect(state.players.filter(p => p.connected)).toHaveLength(10);
  const result = await send(sockets[0], { type: 'select-seat', seat: 1, commandId: randomUUID(), expectedRevision: state.revision });
  expect(result.ok).toBe(true);
  await waitFor(() => observed.size === 10 && [...observed.values()].every(r => r.players.find(p => p.id === h.credentials.playerId)?.seat === 1));
  const named = await send(sockets[1], { type: 'rename', name: 'Bia Nova', commandId: randomUUID(), expectedRevision: (await sync(sockets[1])).revision });
  expect(named.ok).toBe(true);
  await waitFor(() => [...observed.values()].every(r => r.players.some(p => p.name === 'Bia Nova')));
  expect(await sync(sockets[7])).toEqual(await sync(sockets[0]));
});

it('serializes racing seat selections and rejects occupied/stale positions', async () => {
  const h = await host(), g = await admit(`/api/rooms/${h.room.code}/join`, { name: 'Bia' });
  const a = await connect(h.credentials), b = await connect(g.credentials), revision = (await sync(a)).revision;
  const results = await Promise.all([a, b].map(s => send(s, { type: 'select-seat', seat: 2, commandId: randomUUID(), expectedRevision: revision })));
  expect(results.filter(r => r.ok)).toHaveLength(1);
  const loser = results[0].ok ? b : a;
  const rejected = await send(loser, { type: 'select-seat', seat: 2, commandId: randomUUID(), expectedRevision: (await sync(loser)).revision });
  expect(rejected).toMatchObject({ ok: false, error: { code: 'SEAT_TAKEN' } });
  expect((await sync(a)).players.filter(p => p.seat === 2)).toHaveLength(1);
});

it('reconnects with the same identity/seat, including a closed host browser', async () => {
  const h = await host(), g = await admit(`/api/rooms/${h.room.code}/join`, { name: 'Bia', seat: 2 });
  const a = await connect(h.credentials), b = await connect(g.credentials);
  b.disconnect();
  await waitFor(() => !app.rooms.state(h.room.id).players.find(p => p.id === g.credentials.playerId)!.connected);
  expect((await sync(a)).players.find(p => p.id === g.credentials.playerId)?.seat).toBe(2);
  await new Promise<void>(resolve => { b.once('room:state', () => resolve()); b.connect(); });
  expect((await sync(b)).players.find(p => p.id === g.credentials.playerId)).toMatchObject({ seat: 2, connected: true });
  a.disconnect();
  await waitFor(() => !app.rooms.state(h.room.id).players.find(p => p.id === h.credentials.playerId)!.connected);
  const update = await send(b, { type: 'rename', name: 'Bia online', commandId: randomUUID(), expectedRevision: (await sync(b)).revision });
  expect(update.ok).toBe(true);
});

it('denies impersonation, admin commands, malformed commands and client state injection', async () => {
  const h = await host(), g = await admit(`/api/rooms/${h.room.code}/join`, { name: 'Ana' });
  const b = await connect(g.credentials);
  const forged = client({ ...g.credentials, playerId: h.credentials.playerId });
  const failure = await new Promise<Error & { data?: { code: string } }>(resolve => { forged.once('connect_error', resolve); forged.connect(); });
  expect(failure.data?.code).toBe('UNAUTHORIZED');
  const revision = (await sync(b)).revision;
  expect(await send(b, { type: 'close-room', commandId: randomUUID(), expectedRevision: revision })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  expect(await send(b, { type: 'select-seat', seat: 1, playerId: h.credentials.playerId, commandId: randomUUID(), expectedRevision: revision })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  expect(await send(b, { type: 'raise', amount: 100 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  expect((await sync(b)).revision).toBe(revision);
});

it('revokes a participant on definitive leave and broadcasts the freed seat', async () => {
  const h = await host(), g = await admit(`/api/rooms/${h.room.code}/join`, { name: 'Bia', seat: 2 });
  const a = await connect(h.credentials), b = await connect(g.credentials);
  expect(await send(b, { type: 'leave', commandId: randomUUID(), expectedRevision: (await sync(b)).revision })).toMatchObject({ ok: true });
  await waitFor(() => !b.connected);
  expect((await sync(a)).players).toHaveLength(1);
  const again = client(g.credentials);
  const rejected = await new Promise<Error>(resolve => { again.once('connect_error', resolve); again.connect(); });
  expect(rejected.message).toMatch(/Sessão inválida/);
});

it('automatically reconnects to a restarted server using persisted SQLite credentials', async () => {
  const h = await host(), g = await admit(`/api/rooms/${h.room.code}/join`, { name: 'Bia', seat: 2 });
  const socket = await connect(g.credentials), port = Number(new URL(base).port);
  await app.close();
  app = createApplication({ databasePath: join(dir, 'test.sqlite') });
  await app.listen(port, '127.0.0.1');
  await waitFor(() => socket.connected);
  expect((await sync(socket)).players.find(p => p.id === g.credentials.playerId)).toMatchObject({ name: 'Bia', seat: 2, connected: true });
  const admin = await connect(h.credentials);
  expect(await send(admin, { type: 'close-room', commandId: randomUUID(), expectedRevision: (await sync(admin)).revision })).toMatchObject({ ok: true });
});

it('serves health and rejects malformed JSON, cross-origin and oversized HTTP requests', async () => {
  expect(await (await fetch(base + '/health')).json()).toMatchObject({ status: 'ok' });
  const bad = await fetch(base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  expect(await bad.json()).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  const origin = await fetch(base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://external.invalid' }, body: '{}' });
  expect(origin.status).toBe(403);
  const large = await post('/api/rooms', { text: 'x'.repeat(9000) });
  expect(large).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});
