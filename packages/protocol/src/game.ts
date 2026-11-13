import { z } from 'zod';
import { blindsProgressionStateSchema } from './blinds.js';

const chips = z.number().int().nonnegative();
const seat = z.number().int().min(1).max(10);

export const allowedActionsSchema = z.strictObject({
  playerId: z.uuid(),
  canFold: z.boolean(),
  canCheck: z.boolean(),
  canCall: z.boolean(),
  callAmount: chips,
  canRaise: z.boolean(),
  minRaiseAmount: chips.nullable(),
  maxRaiseAmount: chips.nullable(),
  minRaiseIncrement: chips.nullable(),
  currentBet: chips.nullable(),
  canAllIn: z.boolean(),
  allInAmount: chips.nullable(),
  allInType: z.enum(['call', 'raise']).nullable(),
  actionNotReopened: z.boolean(),
});
export type AllowedActions = z.infer<typeof allowedActionsSchema>;

export const potSnapshotSchema = z.strictObject({
  id: z.string().trim().min(1),
  type: z.enum(['main', 'side']),
  index: z.number().int().nonnegative(),
  amount: chips,
  eligiblePlayers: z.array(z.uuid()),
});
export type PotSnapshot = z.infer<typeof potSnapshotSchema>;

export const handActionTypeSchema = z.enum([
  'small_blind',
  'big_blind',
  'fold',
  'check',
  'call',
  'bet',
  'raise',
]);
export type HandActionType = z.infer<typeof handActionTypeSchema>;

export const handActionSchema = z.strictObject({
  seq: z.number().int().positive(),
  playerId: z.uuid(),
  seat,
  street: z.enum(['preflop', 'flop', 'turn', 'river']),
  type: handActionTypeSchema,
  amount: chips,
  roundCommitted: chips,
  currentBet: chips,
  isAllIn: z.boolean(),
  raiseTarget: chips.nullable().optional(),
});
export type HandAction = z.infer<typeof handActionSchema>;

// Public projection only. Engine bookkeeping and credentials never cross this boundary.
export const handSnapshotSchema = z.strictObject({
  street: z.enum(['preflop', 'flop', 'turn', 'river']),
  status: z.enum(['in_progress', 'hand_ended_by_fold', 'showdown']),
  players: z.array(z.strictObject({
    id: z.uuid(), seat, chips, roundCommitted: chips, totalCommitted: chips,
    folded: z.boolean(), isAllIn: z.boolean(),
  })).min(2).max(10),
  dealerSeat: seat, smallBlindSeat: seat, bigBlindSeat: seat,
  smallBlind: chips.positive(), bigBlind: chips.positive(), pot: chips,
  currentActorId: z.uuid().nullable(), playersToAct: z.array(z.uuid()).max(10),
  allowedActions: allowedActionsSchema.nullable().optional(),
  canAdvanceStreet: z.boolean().optional(),
  pots: z.array(potSnapshotSchema).optional(),
  survivorId: z.uuid().nullable().optional(),
  actions: z.array(handActionSchema).optional().default([]),
});
export type HandSnapshot = z.infer<typeof handSnapshotSchema>;

export const playerPotAwardSnapshotSchema = z.strictObject({
  playerId: z.uuid(),
  amount: chips,
});

export const potAwardSnapshotSchema = z.strictObject({
  potId: z.string().trim().min(1),
  potType: z.enum(['main', 'side']),
  potIndex: z.number().int().nonnegative(),
  potAmount: chips,
  winners: z.array(z.uuid()),
  awards: z.array(playerPotAwardSnapshotSchema),
});

export const settledPlayerSnapshotSchema = z.strictObject({
  id: z.uuid(),
  seat,
  chips,
  folded: z.boolean(),
  isAllIn: z.boolean(),
  totalWon: chips,
  previousChips: chips,
});

export const settlementSnapshotSchema = z.strictObject({
  originalPot: chips,
  dealerSeat: seat,
  players: z.array(settledPlayerSnapshotSchema).min(2).max(10),
  pots: z.array(potSnapshotSchema),
  potAwards: z.array(potAwardSnapshotSchema),
  summary: z.strictObject({
    totalDistributed: chips,
    playerAwards: z.array(playerPotAwardSnapshotSchema),
  }),
});
export type SettlementSnapshot = z.infer<typeof settlementSnapshotSchema>;

export const preActionTypeSchema = z.enum(['check', 'check-fold', 'fold', 'call']);
export type PreActionType = z.infer<typeof preActionTypeSchema>;

export const preActionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('check') }),
  z.strictObject({ type: z.literal('check-fold') }),
  z.strictObject({ type: z.literal('fold') }),
  z.strictObject({ type: z.literal('call'), amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
]);
export type PreAction = z.infer<typeof preActionSchema>;

export const preActionsSchema = z.record(z.uuid(), preActionSchema);
export type PreActionsMap = z.infer<typeof preActionsSchema>;

export const gameStateSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('hand-active'),
    hand: handSnapshotSchema,
    admittedPlayerIds: z.array(z.uuid()).optional(),
    blindsState: blindsProgressionStateSchema.optional(),
    preActions: preActionsSchema.optional(),
  }),
  z.strictObject({
    status: z.literal('hand-settled'),
    hand: handSnapshotSchema,
    settlement: settlementSnapshotSchema,
    admittedPlayerIds: z.array(z.uuid()).optional(),
    blindsState: blindsProgressionStateSchema.optional(),
  }),
  z.strictObject({
    status: z.literal('game-complete'),
    hand: handSnapshotSchema,
    settlement: settlementSnapshotSchema,
    winnerId: z.uuid(),
    admittedPlayerIds: z.array(z.uuid()).optional(),
    blindsState: blindsProgressionStateSchema.optional(),
  }),
]);
export type GameState = z.infer<typeof gameStateSchema>;
