import { z } from 'zod';
import { gameStateSchema } from './game.js';
export {
  gameStateSchema,
  handSnapshotSchema,
  allowedActionsSchema,
  settlementSnapshotSchema,
  potSnapshotSchema,
  potAwardSnapshotSchema,
  playerPotAwardSnapshotSchema,
  settledPlayerSnapshotSchema,
  type GameState,
  type HandSnapshot,
  type AllowedActions,
  type SettlementSnapshot,
  type PotSnapshot,
} from './game.js';

export const PROTOCOL_VERSION = 1 as const;
// eslint-disable-next-line no-control-regex -- Rejeita caracteres de controle nos nomes dos jogadores.
export const displayName = z.string().trim().min(1, 'Informe um nome.').max(32, 'Use até 32 caracteres.').regex(/^[^\u0000-\u001f\u007f]+$/, 'Nome inválido.');
export const roomCode = z.string().trim().toUpperCase().regex(/^[A-HJ-NP-Z2-9]{6}$/, 'O código tem seis letras ou números.');
const chips = z.number().int().min(1).max(1_000_000);
export const configSchema = z.strictObject({
  name: displayName,
  maxPlayers: z.number().int().min(2).max(10),
  startingChips: chips,
  smallBlind: chips,
  bigBlind: chips,
}).refine(c => c.bigBlind >= c.smallBlind, { message: 'O big blind deve ser igual ou maior que o small blind.', path: ['bigBlind'] })
  .refine(c => c.startingChips >= c.bigBlind, { message: 'As fichas iniciais devem cobrir o big blind.', path: ['startingChips'] });
export const createRoomSchema = z.strictObject({ config: configSchema, hostName: displayName });
export const joinRoomSchema = z.strictObject({ name: displayName, seat: z.number().int().min(1).max(10).nullable().optional() });
export const credentialsSchema = z.strictObject({
  roomId: z.uuid(), playerId: z.uuid(), sessionToken: z.string().regex(/^[a-f0-9]{64}$/),
  adminToken: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});
export const authSchema = z.strictObject({ protocol: z.literal(PROTOCOL_VERSION), credentials: credentialsSchema });
const commandBase = { commandId: z.uuid(), expectedRevision: z.number().int().nonnegative() };
const actionBase = { ...commandBase, type: z.literal('game-action') };
export const gameActionCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...actionBase, action: z.literal('fold') }),
  z.strictObject({ ...actionBase, action: z.literal('check') }),
  z.strictObject({ ...actionBase, action: z.literal('call') }),
  z.strictObject({ ...actionBase, action: z.literal('raise'), amount: z.number().int().positive() }),
  z.strictObject({ ...actionBase, action: z.literal('all-in') }),
]);
export const potDecisionSchema = z.strictObject({
  potId: z.string().trim().min(1),
  winners: z.array(z.uuid()).min(1),
});
export const settleHandCommandSchema = z.strictObject({
  ...commandBase,
  type: z.literal('settle-hand'),
  decisions: z.array(potDecisionSchema).optional().default([]),
});
export const nextHandCommandSchema = z.strictObject({
  ...commandBase,
  type: z.literal('next-hand'),
});
export const commandSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...commandBase, type: z.literal('select-seat'), seat: z.number().int().min(1).max(10).nullable() }),
  z.strictObject({ ...commandBase, type: z.literal('rename'), name: displayName }),
  z.strictObject({ ...commandBase, type: z.literal('leave') }),
  z.strictObject({ ...commandBase, type: z.literal('close-room') }),
  // Uses the host's already validated room configuration, never client-supplied players.
  z.strictObject({ ...commandBase, type: z.literal('start-game') }),
  gameActionCommandSchema,
  z.strictObject({ ...commandBase, type: z.literal('advance-street') }),
  settleHandCommandSchema,
  nextHandCommandSchema,
]);

export const participantSchema = z.strictObject({ id: z.uuid(), name: displayName, seat: z.number().int().nullable(), connected: z.boolean(), isHost: z.boolean() });
export const roomStateSchema = z.strictObject({
  id: z.uuid(), code: roomCode, config: configSchema, revision: z.number().int().nonnegative(),
  closed: z.boolean(), players: z.array(participantSchema), game: gameStateSchema.nullable(),
});
export type RoomConfig = z.infer<typeof configSchema>;
export type Credentials = z.infer<typeof credentialsSchema>;
export type RoomState = z.infer<typeof roomStateSchema>;
export type Command = z.infer<typeof commandSchema>;
type WithoutEnvelope<T> = T extends unknown ? Omit<T, 'commandId' | 'expectedRevision'> : never;
export type CommandInput = WithoutEnvelope<Command>;
export type GameErrorCode =
  | 'GAME_NOT_STARTED'
  | 'OUT_OF_TURN'
  | 'INVALID_ACTION'
  | 'CANNOT_CHECK'
  | 'CANNOT_RAISE'
  | 'ACTION_NOT_REOPENED'
  | 'INVALID_RAISE_AMOUNT'
  | 'INSUFFICIENT_CHIPS'
  | 'ROUND_NOT_ACTIVE'
  | 'HAND_ALREADY_COMPLETED'
  | 'CANNOT_ADVANCE_STREET'
  | 'MISSING_DECISION'
  | 'DUPLICATE_DECISION'
  | 'INELIGIBLE_WINNER'
  | 'INVALID_POT'
  | 'ALREADY_SETTLED'
  | 'HAND_NOT_ENDED'
  | 'GAME_OVER';
export type ErrorCode = GameErrorCode | 'INVALID_INPUT' | 'NOT_FOUND' | 'ROOM_FULL' | 'SEAT_TAKEN' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'STALE_STATE' | 'ROOM_CLOSED' | 'HOST_MUST_CLOSE' | 'STORAGE_ERROR' | 'RATE_LIMITED' | 'COMMAND_CONFLICT' | 'GAME_ALREADY_STARTED' | 'GAME_IN_PROGRESS' | 'INSUFFICIENT_PLAYERS' | 'PLAYERS_DISCONNECTED';

export type Failure = { ok: false; error: { code: ErrorCode; message: string } };
export type Reply<T> = { ok: true; data: T } | Failure;
export type Admission = { credentials: Credentials; room: RoomState };
export type NetworkAddress = { name: string; address: string; url: string; isVirtual?: boolean };
export type NetworkInfo = { port: number; addresses: NetworkAddress[] };
export interface ServerEvents { 'room:state': (state: RoomState) => void; 'session:ended': (reason: string) => void }
export interface ClientEvents {
  'room:command': (command: Command, ack: (reply: Reply<RoomState>) => void) => void;
  'room:sync': (ack: (reply: Reply<RoomState>) => void) => void;
}
