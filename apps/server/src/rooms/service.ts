import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { commandSchema, configSchema, createRoomSchema, credentialsSchema, joinRoomSchema, roomCode, type Admission, type Credentials, type RoomState } from '@poker-table/protocol';
import { Store } from '../persistence/database.js';
import { RoomError } from '../errors.js';

type RoomRow = { id: string; code: string; config: string; host_id: string; admin_hash: string; revision: number; closed: number };
type PlayerRow = { id: string; room_id: string; name: string; seat: number | null; session_hash: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('hex');
const matches = (value: string, digest: string) => timingSafeEqual(Buffer.from(hash(value), 'hex'), Buffer.from(digest, 'hex'));
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class RoomService {
  private readonly connections = new Map<string, Set<string>>();
  constructor(readonly store: Store) {}
  private row(id: string): RoomRow {
    const row = this.store.db.prepare('SELECT * FROM rooms WHERE id=?').get(id) as RoomRow | undefined;
    if (!row) throw new RoomError('NOT_FOUND', 'Mesa não encontrada. Confira o código.');
    return row;
  }
  private players(id: string) {
    return this.store.db.prepare('SELECT * FROM participants WHERE room_id=? ORDER BY joined_at, id').all(id) as PlayerRow[];
  }
  private open(row: RoomRow) { if (row.closed) throw new RoomError('ROOM_CLOSED', 'Esta mesa foi encerrada.'); }
  private bump(id: string) { this.store.db.prepare('UPDATE rooms SET revision=revision+1 WHERE id=?').run(id); }
  state(id: string): RoomState {
    const row = this.row(id);
    return {
      id: row.id, code: row.code, config: configSchema.parse(JSON.parse(row.config)), revision: row.revision, closed: !!row.closed,
      players: this.players(id).map(p => ({ id: p.id, name: p.name, seat: p.seat, connected: !!this.connections.get(p.id)?.size, isHost: p.id === row.host_id })),
    };
  }
  find(code: unknown): RoomState {
    const parsed = roomCode.parse(code);
    const row = this.store.db.prepare('SELECT id FROM rooms WHERE code=?').get(parsed) as { id: string } | undefined;
    if (!row) throw new RoomError('NOT_FOUND', 'Mesa não encontrada. Confira o código.');
    return this.state(row.id);
  }
  create(input: unknown): Admission {
    const data = createRoomSchema.parse(input);
    const id = randomUUID(), playerId = randomUUID(), sessionToken = token(), adminToken = token();
    let code: string;
    do { code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(''); }
    while (this.store.db.prepare('SELECT id FROM rooms WHERE code=?').get(code));
    this.store.transaction(() => {
      this.store.db.prepare('INSERT INTO rooms(id,code,config,host_id,admin_hash,created_at) VALUES(?,?,?,?,?,?)')
        .run(id, code, JSON.stringify(data.config), playerId, hash(adminToken), new Date().toISOString());
      this.store.db.prepare('INSERT INTO participants(id,room_id,name,session_hash,joined_at) VALUES(?,?,?,?,?)')
        .run(playerId, id, data.hostName, hash(sessionToken), new Date().toISOString());
    });
    return { credentials: { roomId: id, playerId, sessionToken, adminToken }, room: this.state(id) };
  }
  join(code: unknown, input: unknown): Admission {
    const data = joinRoomSchema.parse(input), room = this.find(code);
    const playerId = randomUUID(), sessionToken = token();
    this.store.transaction(() => {
      this.open(this.row(room.id));
      if (this.players(room.id).length >= room.config.maxPlayers) throw new RoomError('ROOM_FULL', 'A mesa está cheia. Jogadores desconectados mantêm sua vaga.');
      this.available(room.id, data.seat ?? null);
      this.store.db.prepare('INSERT INTO participants(id,room_id,name,seat,session_hash,joined_at) VALUES(?,?,?,?,?,?)')
        .run(playerId, room.id, data.name, data.seat ?? null, hash(sessionToken), new Date().toISOString());
      this.bump(room.id);
    });
    return { credentials: { roomId: room.id, playerId, sessionToken }, room: this.state(room.id) };
  }
  authenticate(input: unknown): Credentials {
    const c = credentialsSchema.parse(input);
    const p = this.store.db.prepare('SELECT * FROM participants WHERE id=? AND room_id=?').get(c.playerId, c.roomId) as PlayerRow | undefined;
    if (!p || !matches(c.sessionToken, p.session_hash)) throw new RoomError('UNAUTHORIZED', 'Sessão inválida. Entre novamente ou retome neste navegador.');
    return c;
  }
  connect(c: Credentials, connectionId: string) {
    this.authenticate(c);
    this.open(this.row(c.roomId));
    const connections = this.connections.get(c.playerId) ?? new Set<string>();
    if (connections.size === 0) this.store.transaction(() => this.bump(c.roomId));
    connections.add(connectionId);
    this.connections.set(c.playerId, connections);
    return this.state(c.roomId);
  }
  disconnect(c: Credentials, connectionId: string) {
    const connections = this.connections.get(c.playerId);
    if (!connections?.has(connectionId)) return;
    if (connections.size === 1) this.store.transaction(() => this.bump(c.roomId));
    connections.delete(connectionId);
    if (!connections.size) this.connections.delete(c.playerId);
  }
  private available(roomId: string, seat: number | null, playerId?: string) {
    if (seat === null) return;
    if (seat > this.state(roomId).config.maxPlayers) throw new RoomError('INVALID_INPUT', 'Posição fora dos limites desta mesa.');
    if (this.players(roomId).some(p => p.seat === seat && p.id !== playerId)) throw new RoomError('SEAT_TAKEN', 'Esta posição já foi ocupada. Escolha outra.');
  }
  command(credentials: Credentials, input: unknown): RoomState {
    const c = this.authenticate(credentials), command = commandSchema.parse(input);
    const { commandId, expectedRevision, ...payload } = command;
    const fingerprint = hash(JSON.stringify(payload));
    this.store.transaction(() => {
      const row = this.row(c.roomId);
      const old = this.store.db.prepare('SELECT fingerprint FROM commands WHERE room_id=? AND player_id=? AND command_id=?')
        .get(c.roomId, c.playerId, commandId) as { fingerprint: string } | undefined;
      if (old) {
        if (old.fingerprint !== fingerprint) throw new RoomError('COMMAND_CONFLICT', 'Identificador de comando já utilizado.');
        return; // Retry after a lost ACK must not apply the mutation again.
      }
      this.open(row);
      if (expectedRevision !== row.revision) throw new RoomError('STALE_STATE', 'A mesa mudou. O estado foi atualizado; confira e tente novamente.');
      switch (command.type) {
        case 'select-seat':
          this.available(c.roomId, command.seat, c.playerId);
          this.store.db.prepare('UPDATE participants SET seat=? WHERE id=?').run(command.seat, c.playerId);
          break;
        case 'rename':
          this.store.db.prepare('UPDATE participants SET name=? WHERE id=?').run(command.name, c.playerId);
          break;
        case 'leave':
          if (c.playerId === row.host_id) throw new RoomError('HOST_MUST_CLOSE', 'O anfitrião pode fechar o navegador ou encerrar a mesa para todos.');
          this.store.db.prepare('DELETE FROM participants WHERE id=?').run(c.playerId);
          break;
        case 'close-room':
          if (c.playerId !== row.host_id || !c.adminToken || !matches(c.adminToken, row.admin_hash)) throw new RoomError('FORBIDDEN', 'Somente o anfitrião com sua credencial administrativa pode encerrar a mesa.');
          this.store.db.prepare('UPDATE rooms SET closed=1 WHERE id=?').run(c.roomId);
          break;
      }
      this.store.db.prepare('INSERT INTO commands(room_id,player_id,command_id,fingerprint) VALUES(?,?,?,?)').run(c.roomId, c.playerId, commandId, fingerprint);
      this.bump(c.roomId);
    });
    return this.state(c.roomId);
  }
}
