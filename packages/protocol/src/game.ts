import { z } from 'zod';

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
});
export type HandSnapshot = z.infer<typeof handSnapshotSchema>;

export const potSnapshotSchema = z.strictObject({
  id: z.string().trim().min(1),
  type: z.enum(['main', 'side']),
  index: z.number().int().nonnegative(),
  amount: chips,
  eligiblePlayers: z.array(z.uuid()),
});

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

export const gameStateSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('hand-active'),
    hand: handSnapshotSchema,
  }),
  z.strictObject({
    status: z.literal('hand-settled'),
    hand: handSnapshotSchema,
    settlement: settlementSnapshotSchema,
  }),
  z.strictObject({
    status: z.literal('game-complete'),
    hand: handSnapshotSchema,
    settlement: settlementSnapshotSchema,
    winnerId: z.uuid(),
  }),
]);
export type GameState = z.infer<typeof gameStateSchema>;
