import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RoomService } from '../apps/server/src/rooms/service.js';
import { Store } from '../apps/server/src/persistence/database.js';
import type { CommandInput, Credentials } from '@poker-table/protocol';

const config = { name: 'Mesa de sábado', maxPlayers: 3, startingChips: 1000, smallBlind: 10, bigBlind: 20 };
let store: Store, rooms: RoomService;
beforeEach(() => { store = new Store(':memory:'); rooms = new RoomService(store); });
afterEach(() => store.close());
const create = () => rooms.create({ config, hostName: 'Ana' });
const act = (c: Credentials, input: CommandInput) => rooms.command(c, { ...input, commandId: randomUUID(), expectedRevision: rooms.state(c.roomId).revision });

describe('rooms and durable authority', () => {
  it('creates stable identities, separate credentials and no public secrets', () => {
    const { room, credentials } = create();
    expect(room.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(room.players[0]).toMatchObject({ name: 'Ana', seat: null, isHost: true, connected: false });
    expect(credentials.sessionToken).not.toBe(credentials.adminToken);
    expect(JSON.stringify(room)).not.toMatch(/Token|hash/);
    const rows = store.db.prepare('SELECT session_hash FROM participants').get();
    expect(JSON.stringify(rows)).not.toContain(credentials.sessionToken);
    expect(rooms.find(room.code.toLowerCase()).id).toBe(room.id);
  });
  it.each([
    { maxPlayers: 1 }, { maxPlayers: 11 }, { startingChips: -1 }, { startingChips: 1.2 },
    { smallBlind: 0 }, { bigBlind: 9 }, { startingChips: 19 }, { startingChips: Number.MAX_SAFE_INTEGER }, { name: ' ' },
  ])('rejects invalid configuration %j', invalid => {
    expect(() => rooms.create({ hostName: 'Ana', config: { ...config, ...invalid } })).toThrow();
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM rooms').get()).toMatchObject({ n: 0 });
  });
  it('enforces capacity even for disconnected participants', () => {
    const { room } = create();
    rooms.join(room.code, { name: 'Bia' }); rooms.join(room.code, { name: 'Caio' });
    expect(() => rooms.join(room.code, { name: 'Dora' })).toThrow(/cheia/);
  });
  it('supports ten participants and rejects an eleventh', () => {
    const { room } = rooms.create({ config: { ...config, maxPlayers: 10 }, hostName: 'Host' });
    for (let i = 1; i < 10; i++) rooms.join(room.code, { name: `P${i}`, seat: i });
    expect(rooms.state(room.id).players).toHaveLength(10);
    expect(() => rooms.join(room.code, { name: 'Extra' })).toThrow(/cheia/);
  });
  it('selects, moves and releases positions; never overwrites another participant', () => {
    const host = create(), guest = rooms.join(host.room.code, { name: 'Bia', seat: 2 });
    act(host.credentials, { type: 'select-seat', seat: 1 });
    expect(() => act(host.credentials, { type: 'select-seat', seat: 2 })).toThrow(/ocupada/);
    expect(() => act(host.credentials, { type: 'select-seat', seat: 4 })).toThrow(/limites/);
    act(host.credentials, { type: 'select-seat', seat: 3 });
    act(guest.credentials, { type: 'select-seat', seat: null });
    expect(rooms.state(host.room.id).players.find(p => p.id === host.credentials.playerId)?.seat).toBe(3);
    expect(rooms.state(host.room.id).players.find(p => p.id === guest.credentials.playerId)?.seat).toBeNull();
  });
  it('rejects joins to occupied seats without reserving another participant', () => {
    const host = create(); act(host.credentials, { type: 'select-seat', seat: 1 });
    expect(() => rooms.join(host.room.code, { name: 'Bia', seat: 1 })).toThrow(/ocupada/);
    expect(rooms.state(host.room.id).players).toHaveLength(1);
  });
  it('protects sessions even when names and public IDs are known', () => {
    const host = create(), guest = rooms.join(host.room.code, { name: 'Ana' });
    expect(guest.credentials.playerId).not.toBe(host.credentials.playerId);
    expect(() => rooms.authenticate({ ...guest.credentials, playerId: host.credentials.playerId })).toThrow(/Sessão inválida/);
    expect(() => rooms.join(host.room.code, { name: 'Ana', playerId: host.credentials.playerId })).toThrow();
  });
  it('requires both host identity and separate administrative credential', () => {
    const host = create(), guest = rooms.join(host.room.code, { name: 'Bia' });
    expect(() => act(guest.credentials, { type: 'close-room' })).toThrow(/Somente/);
    expect(() => act({ ...guest.credentials, adminToken: host.credentials.adminToken }, { type: 'close-room' })).toThrow(/Somente/);
    expect(() => act({ ...host.credentials, adminToken: undefined }, { type: 'close-room' })).toThrow(/Somente/);
    expect(act(host.credentials, { type: 'close-room' }).closed).toBe(true);
    expect(() => rooms.join(host.room.code, { name: 'Novo' })).toThrow(/encerrada/);
  });
  it('revokes a definitive departure and frees its seat and capacity', () => {
    const host = create(), guest = rooms.join(host.room.code, { name: 'Bia', seat: 2 });
    act(guest.credentials, { type: 'leave' });
    expect(() => rooms.authenticate(guest.credentials)).toThrow();
    expect(rooms.join(host.room.code, { name: 'Caio', seat: 2 }).room.players).toHaveLength(2);
    expect(() => act(host.credentials, { type: 'leave' })).toThrow(/anfitrião/);
  });
  it('deduplicates an acknowledged command before checking an old revision', () => {
    const host = create();
    const command = { type: 'rename', name: 'Ana Nova', commandId: randomUUID(), expectedRevision: host.room.revision };
    const first = rooms.command(host.credentials, command), retry = rooms.command(host.credentials, command);
    expect(retry.revision).toBe(first.revision);
    expect(() => rooms.command(host.credentials, { ...command, name: 'Outro' })).toThrow(/já utilizado/);
    expect(() => rooms.command(host.credentials, { ...command, commandId: randomUUID() })).toThrow(/mudou/);
  });
  it('validates commands and rejects forged player targets and unknown operations', () => {
    const host = create(), base = { commandId: randomUUID(), expectedRevision: host.room.revision };
    for (const payload of [{ type: 'select-seat', seat: 1.5 }, { type: 'raise', amount: 10 }, { type: 'rename', name: ' ' }, { type: 'rename', name: 'X', playerId: randomUUID() }]) {
      expect(() => rooms.command(host.credentials, { ...base, ...payload })).toThrow();
    }
    expect(rooms.state(host.room.id).revision).toBe(host.room.revision);
  });
  it('rolls back a rejected write without publishing a successful revision', () => {
    const host = create();
    store.db.exec('PRAGMA query_only=ON');
    expect(() => act(host.credentials, { type: 'rename', name: 'Changed' })).toThrow();
    store.db.exec('PRAGMA query_only=OFF');
    expect(rooms.state(host.room.id)).toEqual(host.room);
    expect(store.db.prepare('SELECT COUNT(*) as n FROM commands').get()).toMatchObject({ n: 0 });
  });
  it('keeps presence until the last tab disconnects and preserves the seat', () => {
    const host = create(); act(host.credentials, { type: 'select-seat', seat: 1 });
    rooms.connect(host.credentials, 'tab1'); rooms.connect(host.credentials, 'tab2');
    rooms.disconnect(host.credentials, 'tab1'); expect(rooms.state(host.room.id).players[0].connected).toBe(true);
    rooms.disconnect(host.credentials, 'tab2'); expect(rooms.state(host.room.id).players[0]).toMatchObject({ connected: false, seat: 1 });
    rooms.connect(host.credentials, 'tab3'); expect(rooms.state(host.room.id).players[0]).toMatchObject({ connected: true, seat: 1 });
  });
  it('recovers SQLite state, credentials and deduplication after reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poker-db-')), path = join(dir, 'table.sqlite');
    try {
      const a = new Store(path), first = new RoomService(a), host = first.create({ config, hostName: 'Ana' });
      const command = { type: 'select-seat', seat: 3, commandId: randomUUID(), expectedRevision: host.room.revision };
      first.command(host.credentials, command); first.connect(host.credentials, 'socket');
      const revision = first.state(host.room.id).revision; a.close();
      const b = new Store(path), restored = new RoomService(b);
      try {
        expect(restored.authenticate(host.credentials)).toEqual(host.credentials);
        expect(restored.state(host.room.id).players[0]).toMatchObject({ seat: 3, connected: false });
        expect(restored.state(host.room.id).revision).toBeGreaterThan(revision);
        expect(restored.command(host.credentials, command).players[0].seat).toBe(3);
        expect(readFileSync(path).includes(Buffer.from(host.credentials.sessionToken))).toBe(false);
      } finally { b.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
