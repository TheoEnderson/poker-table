import { randomInt } from 'node:crypto';
import { RANKS, SUITS, type Card } from '@poker-table/protocol';

export type RandomIntFn = (maxExclusive: number) => number;

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

export function shuffleDeck(cards: readonly Card[], rng: RandomIntFn = randomInt): Card[] {
  const copy = cards.map(card => ({ ...card }));
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = rng(i + 1);
    const current = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = current;
  }
  return copy;
}

export function drawCards(deck: readonly Card[], count: number): { drawn: Card[]; remaining: Card[] } {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`Invalid card draw count: ${count}`);
  }
  if (deck.length < count) {
    throw new Error(`Not enough cards remaining in deck: needed ${count}, had ${deck.length}`);
  }
  return {
    drawn: deck.slice(0, count).map(card => ({ ...card })),
    remaining: deck.slice(count).map(card => ({ ...card })),
  };
}

export function dealVirtualHandCards(
  playerIds: readonly string[],
  rng: RandomIntFn = randomInt,
): {
  deck: Card[];
  board: Card[];
  holeCards: Record<string, [Card, Card]>;
} {
  if (playerIds.length < 2 || playerIds.length > 10) {
    throw new Error(`Cannot deal virtual hand for ${playerIds.length} players.`);
  }
  const shuffled = shuffleDeck(createDeck(), rng);
  const holeCards: Record<string, [Card, Card]> = {};
  const firstPass = new Map<string, Card>();

  let index = 0;
  for (const playerId of playerIds) {
    firstPass.set(playerId, shuffled[index++]!);
  }
  for (const playerId of playerIds) {
    const second = shuffled[index++]!;
    holeCards[playerId] = [firstPass.get(playerId)!, second];
  }

  return {
    deck: shuffled.slice(index),
    board: [],
    holeCards,
  };
}
