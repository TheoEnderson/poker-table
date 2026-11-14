import { z } from 'zod';

export const deckModeSchema = z.enum(['physical', 'virtual']);
export type DeckMode = z.infer<typeof deckModeSchema>;

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
export const SUITS = ['s', 'h', 'd', 'c'] as const;

export const rankSchema = z.enum(RANKS);
export const suitSchema = z.enum(SUITS);

export const cardSchema = z.strictObject({
  rank: rankSchema,
  suit: suitSchema,
});

export const HAND_RANK_CATEGORIES = [
  'high_card',
  'pair',
  'two_pair',
  'three_of_a_kind',
  'straight',
  'flush',
  'full_house',
  'four_of_a_kind',
  'straight_flush',
  'royal_flush',
] as const;

export const handRankCategorySchema = z.enum(HAND_RANK_CATEGORIES);
export type HandRankCategory = z.infer<typeof handRankCategorySchema>;

export const HAND_RANK_LABELS: Record<HandRankCategory, string> = {
  high_card: 'Carta Alta',
  pair: 'Par',
  two_pair: 'Dois Pares',
  three_of_a_kind: 'Trinca',
  straight: 'Sequência',
  flush: 'Flush',
  full_house: 'Full House',
  four_of_a_kind: 'Quadra',
  straight_flush: 'Straight Flush',
  royal_flush: 'Royal Flush',
};

export const handEvaluationSchema = z.strictObject({
  category: handRankCategorySchema,
  label: z.string().min(1).max(40),
});

export type Rank = z.infer<typeof rankSchema>;
export type Suit = z.infer<typeof suitSchema>;
export type Card = z.infer<typeof cardSchema>;
export type HandEvaluation = z.infer<typeof handEvaluationSchema>;
