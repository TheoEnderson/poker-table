import { z } from 'zod';

const chips = z.number().int().nonnegative();
const seat = z.number().int().min(1).max(10);
const ids = z.array(z.uuid()).max(10);
const player = z.strictObject({
  id: z.uuid(), seat, chips, committed: chips, isAllIn: z.boolean(),
});
const positions = { dealerSeat: seat, smallBlindSeat: seat, bigBlindSeat: seat };
const blinds = { smallBlind: chips.positive(), bigBlind: chips.positive() };
const actor = { currentActorId: z.uuid().nullable() };
const initial = z.strictObject({
  players: z.array(player).min(2).max(10), participatingPlayers: z.array(player).min(2).max(10),
  ...positions, ...blinds, pot: chips,
  preFlopOrder: ids, postFlopOrder: ids, preFlopActionOrder: ids, postFlopActionOrder: ids,
  preFlopActionPlayers: z.array(player).max(10), postFlopActionPlayers: z.array(player).max(10), ...actor,
});
const round = z.strictObject({
  players: z.array(player.extend({ folded: z.boolean(), lastActionBet: chips.nullable() })).min(2).max(10),
  currentBet: chips, minRaiseIncrement: chips.positive(), lastRaiseIncrement: chips.positive(),
  pot: chips, ...actor, playersToAct: ids, status: z.enum(['active', 'completed', 'hand_ended_by_fold']),
  ...blinds, ...positions, handState: initial,
});

export const handActionPersistenceSchema = z.strictObject({
  seq: z.number().int().positive(),
  playerId: z.uuid(),
  seat,
  street: z.enum(['preflop', 'flop', 'turn', 'river']),
  type: z.enum(['small_blind', 'big_blind', 'fold', 'check', 'call', 'bet', 'raise']),
  amount: chips,
  roundCommitted: chips,
  currentBet: chips,
  isAllIn: z.boolean(),
  raiseTarget: chips.nullable().optional(),
});

// v1 stores only an initial hand. Future network actions require an explicit format evolution.
export const persistedV1 = z.strictObject({
  version: z.literal(1), status: z.literal('hand-active'),
  hand: z.strictObject({
    street: z.literal('preflop'), currentRound: round,
    players: z.array(z.strictObject({
      id: z.uuid(), seat, chips, roundCommitted: chips, totalCommitted: chips, committed: chips,
      isAllIn: z.boolean(), folded: z.literal(false), baseCommitted: z.literal(0),
    })).min(2).max(10),
    ...positions, ...blinds, pot: chips, status: z.enum(['in_progress', 'showdown']),
    handState: initial, ...actor, playersToAct: ids, survivorId: z.null(),
    actions: z.array(handActionPersistenceSchema).optional(),
  }),
});


export const persistedV2 = z.strictObject({
  version: z.literal(2), status: z.literal('hand-active'),
  hand: persistedV1.shape.hand.extend({
    street: z.enum(['preflop', 'flop', 'turn', 'river']),
    status: z.enum(['in_progress', 'hand_ended_by_fold', 'showdown']),
    players: z.array(persistedV1.shape.hand.shape.players.element.extend({
      folded: z.boolean(), baseCommitted: chips,
    })).min(2).max(10),
    survivorId: z.uuid().nullable(),
    actions: z.array(handActionPersistenceSchema).optional(),
  }),
});

const potSchema = z.strictObject({
  id: z.string().trim().min(1),
  type: z.enum(['main', 'side']),
  index: z.number().int().nonnegative(),
  amount: chips,
  contributors: ids,
  eligiblePlayers: ids,
  contributorIds: ids.optional(),
  eligiblePlayerIds: ids.optional(),
});

const playerAwardSchema = z.strictObject({
  playerId: z.uuid(),
  amount: chips,
});

const potAwardSchema = z.strictObject({
  potId: z.string().trim().min(1),
  potType: z.enum(['main', 'side']),
  potIndex: z.number().int().nonnegative(),
  potAmount: chips,
  winners: ids,
  awards: z.array(playerAwardSchema),
});

const settledPlayerSchema = z.strictObject({
  id: z.uuid(),
  seat,
  chips,
  committed: chips,
  isAllIn: z.boolean(),
  folded: z.boolean(),
  name: z.string().optional(),
  totalWon: chips,
  previousChips: chips,
});

const settlementSummarySchema = z.strictObject({
  totalDistributed: chips,
  playerAwards: z.array(playerAwardSchema),
});

export const persistedSettlementSchema = z.strictObject({
  status: z.literal('settled'),
  isSettled: z.literal(true),
  pot: z.literal(0),
  originalPot: chips,
  players: z.array(settledPlayerSchema).min(2).max(10),
  pots: z.array(potSchema).min(1),
  potAwards: z.array(potAwardSchema),
  summary: settlementSummarySchema,
  handState: initial,
  dealerSeat: seat,
});

export const potDecisionPersistenceSchema = z.strictObject({
  potId: z.string().trim().min(1),
  winners: z.array(z.uuid()).min(1),
});

export const persistedV3Active = z.strictObject({
  version: z.literal(3),
  status: z.literal('hand-active'),
  hand: persistedV2.shape.hand,
  handNumber: z.number().int().positive(),
  tableBudget: chips.positive(),
  previousSettlement: persistedSettlementSchema.optional(),
});

export const persistedV3Settled = z.strictObject({
  version: z.literal(3),
  status: z.literal('hand-settled'),
  hand: persistedV2.shape.hand,
  settlement: persistedSettlementSchema,
  decisions: z.array(potDecisionPersistenceSchema),
  handNumber: z.number().int().positive(),
  tableBudget: chips.positive(),
});

export const persistedV3Complete = z.strictObject({
  version: z.literal(3),
  status: z.literal('game-complete'),
  hand: persistedV2.shape.hand,
  settlement: persistedSettlementSchema,
  winnerId: z.uuid(),
  decisions: z.array(potDecisionPersistenceSchema),
  handNumber: z.number().int().positive(),
  tableBudget: chips.positive(),
});

export const persistedHandSchema = z.union([
  persistedV1,
  persistedV2,
  persistedV3Active,
  persistedV3Settled,
  persistedV3Complete,
]);

export type PersistedHand = z.infer<typeof persistedHandSchema>;
export type PersistedV3Active = z.infer<typeof persistedV3Active>;
export type PersistedV3Settled = z.infer<typeof persistedV3Settled>;
export type PersistedV3Complete = z.infer<typeof persistedV3Complete>;
