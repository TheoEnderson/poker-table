import { z } from 'zod';

const chips = z.number().int().nonnegative();
const seat = z.number().int().min(1).max(10);

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
});

// null means preparation; a started game always carries a valid hand.
// Future settlement/transition variants must be added explicitly.
export const gameStateSchema = z.strictObject({
  status: z.literal('hand-active'), hand: handSnapshotSchema,
});
export type GameState = z.infer<typeof gameStateSchema>;
