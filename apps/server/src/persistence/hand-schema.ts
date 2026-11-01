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
  }),
});
export const persistedHandSchema = z.discriminatedUnion('version', [persistedV1, persistedV2]);
