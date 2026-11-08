import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { commandSchema, configSchema, createRoomSchema, credentialsSchema, joinRoomSchema, roomCode, type Admission, type Credentials, type RoomState } from '@poker-table/protocol';
import { EngineError, startNextHand, type HandFlowState } from '@poker-table/engine';
import { Store } from '../persistence/database.js';
import { RoomError } from '../errors.js';
import { initializeHand, publicGame } from '../game/initial-hand.js';
import { decodeGame, encodeGame, encodeHand, type StoredGame } from '../persistence/hand.js';
import { transitionHand } from '../game/transitions.js';
import { settleGameHand } from '../game/settlement.js';

type RoomRow = { id: string; code: string; config: string; host_id: string; admin_hash: string; revision: number; closed: number; game: string | null };
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
  private preparing(row: RoomRow) { if (row.game !== null) throw new RoomError('GAME_IN_PROGRESS', 'A partida já começou. Os participantes e assentos da mão estão reservados.'); }
  private admin(c: Credentials, row: RoomRow) {
    if (c.playerId !== row.host_id || !c.adminToken || !matches(c.adminToken, row.admin_hash)) throw new RoomError('FORBIDDEN', 'Somente o anfitrião com sua credencial administrativa pode executar esta operação.');
  }
  private bump(id: string) { this.store.db.prepare('UPDATE rooms SET revision=revision+1 WHERE id=?').run(id); }
  private config(row: RoomRow) {
    try { return configSchema.parse(JSON.parse(row.config)); }
    catch { throw new RoomError('STORAGE_ERROR', 'Configuração persistida da mesa inválida. Verifique o banco do servidor.'); }
  }
  state(id: string): RoomState {
    const row = this.row(id);
    const config = this.config(row), players = this.players(id);
    return {
      id: row.id, code: row.code, config, revision: row.revision, closed: !!row.closed,
      players: players.map(p => ({ id: p.id, name: p.name, seat: p.seat, connected: !!this.connections.get(p.id)?.size, isHost: p.id === row.host_id })),
      game: row.game === null ? null : publicGame(decodeGame(row.game, config, players)),
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
      const row = this.row(room.id);
      this.open(row);
      this.preparing(row);
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
          this.preparing(row);
          this.available(c.roomId, command.seat, c.playerId);
          this.store.db.prepare('UPDATE participants SET seat=? WHERE id=?').run(command.seat, c.playerId);
          break;
        case 'rename':
          this.store.db.prepare('UPDATE participants SET name=? WHERE id=?').run(command.name, c.playerId);
          break;
        case 'leave':
          if (row.game !== null && this.state(c.roomId).game!.hand.players.some(p => p.id === c.playerId)) this.preparing(row);
          if (c.playerId === row.host_id) throw new RoomError('HOST_MUST_CLOSE', 'O anfitrião pode fechar o navegador ou encerrar a mesa para todos.');
          this.store.db.prepare('DELETE FROM participants WHERE id=?').run(c.playerId);
          break;
        case 'close-room':
          this.admin(c, row);
          this.store.db.prepare('UPDATE rooms SET closed=1 WHERE id=?').run(c.roomId);
          break;
        case 'start-game': {
          this.admin(c, row);
          if (row.game !== null) throw new RoomError('GAME_ALREADY_STARTED', 'Esta sala já possui uma partida iniciada.');
          const state = this.state(c.roomId);
          const hand = initializeHand(state.players, state.config);
          this.store.db.prepare('UPDATE rooms SET game=? WHERE id=?').run(encodeHand(hand, state.config, state.players), c.roomId);
          break;
        }
        case 'game-action':
        case 'advance-street': {
          if (command.type === 'advance-street') this.admin(c, row);
          if (row.game === null) throw new RoomError('GAME_NOT_STARTED', 'A partida ainda não foi iniciada.');
          const config = this.config(row), players = this.players(c.roomId);
          const stored = decodeGame(row.game, config, players);
          if (stored.status !== 'hand-active') throw new RoomError('HAND_ALREADY_COMPLETED', 'Esta mão não aceita mais apostas ou avanços.');
          const next = transitionHand(stored.hand, c.playerId, command);
          if (stored.version === 3) {
            const nextGame: StoredGame = {
              version: 3,
              status: 'hand-active',
              hand: next,
              handNumber: stored.handNumber,
              tableBudget: stored.tableBudget,
              previousSettlement: stored.previousSettlement,
            };
            this.store.db.prepare('UPDATE rooms SET game=? WHERE id=?').run(encodeGame(nextGame, config, players), c.roomId);
          } else {
            this.store.db.prepare('UPDATE rooms SET game=? WHERE id=?').run(encodeHand(next, config, players, 2), c.roomId);
          }
          break;
        }
        case 'settle-hand': {
          this.admin(c, row);
          if (row.game === null) throw new RoomError('GAME_NOT_STARTED', 'A partida ainda não foi iniciada.');
          const config = this.config(row), players = this.players(c.roomId);
          const stored = decodeGame(row.game, config, players);
          if (stored.status !== 'hand-active') throw new RoomError('ALREADY_SETTLED', 'Esta mão já foi liquidada.');
          const settlement = settleGameHand(stored.hand, command.decisions);
          const survivors = settlement.players.filter(p => p.chips > 0);
          const decisions = command.decisions.map(d => ({ potId: d.potId, winners: [...d.winners] }));
          let settledGame: StoredGame;
          if (survivors.length <= 1) {
            settledGame = {
              version: 3,
              status: 'game-complete',
              hand: stored.hand,
              settlement,
              winnerId: survivors[0]?.id ?? settlement.players[0].id,
              decisions,
              handNumber: stored.handNumber,
              tableBudget: stored.tableBudget,
            };
          } else {
            settledGame = {
              version: 3,
              status: 'hand-settled',
              hand: stored.hand,
              settlement,
              decisions,
              handNumber: stored.handNumber,
              tableBudget: stored.tableBudget,
            };
          }
          this.store.db.prepare('UPDATE rooms SET game=? WHERE id=?').run(encodeGame(settledGame, config, players), c.roomId);
          break;
        }
        case 'next-hand': {
          this.admin(c, row);
          if (row.game === null) throw new RoomError('GAME_NOT_STARTED', 'A partida ainda não foi iniciada.');
          const config = this.config(row), players = this.players(c.roomId);
          const stored = decodeGame(row.game, config, players);
          if (stored.status === 'game-complete') throw new RoomError('GAME_OVER', 'A partida já foi concluída com um vencedor final.');
          if (stored.status === 'hand-active') throw new RoomError('INVALID_ACTION', 'A mão atual ainda não foi liquidada.');
          let nextHandState: HandFlowState;
          try {
            nextHandState = startNextHand(stored.settlement, { blinds: config });
          } catch (error) {
            if (error instanceof EngineError) {
              if (error.code === 'INSUFFICIENT_PLAYERS') throw new RoomError('GAME_OVER', 'Não há jogadores suficientes com fichas para iniciar uma nova mão.');
              throw new RoomError('INVALID_INPUT', error.message);
            }
            throw error;
          }
          const nextActiveGame: StoredGame = {
            version: 3,
            status: 'hand-active',
            hand: nextHandState,
            handNumber: stored.handNumber + 1,
            tableBudget: stored.tableBudget,
            previousSettlement: stored.settlement,
          };
          this.store.db.prepare('UPDATE rooms SET game=? WHERE id=?').run(encodeGame(nextActiveGame, config, players), c.roomId);
          break;
        }
        case 'reset-game': {
          this.admin(c, row);
          if (row.game === null) throw new RoomError('GAME_NOT_STARTED', 'A partida ainda não foi iniciada.');
          const config = this.config(row), players = this.players(c.roomId);
          const stored = decodeGame(row.game, config, players);
          if (stored.status === 'hand-active') {
            throw new RoomError('GAME_IN_PROGRESS', 'Não é possível reiniciar a partida durante uma mão em andamento. Conclua ou liquide a mão antes de reiniciar.');
          }
          this.store.db.prepare('UPDATE rooms SET game=NULL WHERE id=?').run(c.roomId);
          break;
        }

      }
      this.store.db.prepare('INSERT INTO commands(room_id,player_id,command_id,fingerprint) VALUES(?,?,?,?)').run(c.roomId, c.playerId, commandId, fingerprint);
      this.bump(c.roomId);
    });
    return this.state(c.roomId);
  }
}
