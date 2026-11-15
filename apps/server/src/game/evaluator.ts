import { buildPots, type HandFlowState, type PotWinnerDecision } from '@poker-table/engine';
import {
  HAND_RANK_LABELS,
  type Card,
  type HandEvaluation,
  type HandRankCategory,
  type Rank,
} from '@poker-table/protocol';

export interface DetailedHandEvaluation {
  category: HandRankCategory;
  label: string;
  score: readonly number[];
  bestFive: readonly Card[];
}

const RANK_VALUES: Record<Rank, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

const CATEGORY_STRENGTH: Record<HandRankCategory, number> = {
  high_card: 0,
  pair: 1,
  two_pair: 2,
  three_of_a_kind: 3,
  straight: 4,
  flush: 5,
  full_house: 6,
  four_of_a_kind: 7,
  straight_flush: 8,
  royal_flush: 9,
};

function makeEvaluation(
  category: HandRankCategory,
  tiebreakers: readonly number[],
  bestFive: readonly Card[],
): DetailedHandEvaluation {
  return {
    category,
    label: HAND_RANK_LABELS[category],
    score: [CATEGORY_STRENGTH[category], ...tiebreakers],
    bestFive,
  };
}

function getStraightHighCard(sortedValuesDesc: readonly number[]): number | null {
  if (sortedValuesDesc.length !== 5) return null;
  for (let i = 1; i < sortedValuesDesc.length; i += 1) {
    if (sortedValuesDesc[i] === sortedValuesDesc[i - 1]) return null;
  }
  const highest = sortedValuesDesc[0]!;
  const lowest = sortedValuesDesc[4]!;
  if (highest - lowest === 4) {
    return highest;
  }
  // Wheel straight: A-2-3-4-5 has high card 5 (beats nothing above 6-high straight).
  if (
    sortedValuesDesc[0] === 14
    && sortedValuesDesc[1] === 5
    && sortedValuesDesc[2] === 4
    && sortedValuesDesc[3] === 3
    && sortedValuesDesc[4] === 2
  ) {
    return 5;
  }
  return null;
}

export function compareScores(a: readonly number[], b: readonly number[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function compareEvaluatedHands(a: DetailedHandEvaluation, b: DetailedHandEvaluation): number {
  return compareScores(a.score, b.score);
}

export function toPublicEvaluation(evaluated: DetailedHandEvaluation): HandEvaluation {
  return {
    category: evaluated.category,
    label: evaluated.label,
  };
}

export function evaluateFiveCards(cards: readonly Card[]): DetailedHandEvaluation {
  if (cards.length !== 5) {
    throw new Error(`Expected exactly 5 cards for evaluation, got ${cards.length}.`);
  }

  const ordered = [...cards].sort((left, right) => RANK_VALUES[right.rank] - RANK_VALUES[left.rank]);
  const values = ordered.map(card => RANK_VALUES[card.rank]);
  const isFlush = ordered.every(card => card.suit === ordered[0]!.suit);
  const straightHigh = getStraightHighCard(values);

  if (isFlush && straightHigh !== null) {
    return straightHigh === 14
      ? makeEvaluation('royal_flush', [14], ordered)
      : makeEvaluation('straight_flush', [straightHigh], ordered);
  }

  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const groups = [...counts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return right[0] - left[0];
  });

  if (groups[0]![1] === 4) {
    return makeEvaluation('four_of_a_kind', [groups[0]![0], groups[1]![0]], ordered);
  }

  if (groups[0]![1] === 3 && groups[1]![1] === 2) {
    return makeEvaluation('full_house', [groups[0]![0], groups[1]![0]], ordered);
  }

  if (isFlush) {
    return makeEvaluation('flush', values, ordered);
  }

  if (straightHigh !== null) {
    return makeEvaluation('straight', [straightHigh], ordered);
  }

  if (groups[0]![1] === 3) {
    return makeEvaluation('three_of_a_kind', [groups[0]![0], groups[1]![0], groups[2]![0]], ordered);
  }

  if (groups[0]![1] === 2 && groups[1]![1] === 2) {
    return makeEvaluation('two_pair', [groups[0]![0], groups[1]![0], groups[2]![0]], ordered);
  }

  if (groups[0]![1] === 2) {
    return makeEvaluation('pair', [groups[0]![0], groups[1]![0], groups[2]![0], groups[3]![0]], ordered);
  }

  return makeEvaluation('high_card', values, ordered);
}

export function evaluateBestHand(holeCards: readonly [Card, Card], board: readonly Card[]): DetailedHandEvaluation {
  const pool = [...holeCards, ...board];
  if (pool.length === 2) {
    const ordered = [...pool].sort((left, right) => RANK_VALUES[right.rank] - RANK_VALUES[left.rank]);
    const values = ordered.map(card => RANK_VALUES[card.rank]);
    if (values[0] === values[1]) {
      return makeEvaluation('pair', [values[0]!], ordered);
    }
    return makeEvaluation('high_card', values, ordered);
  }
  if (pool.length < 5 || pool.length > 7) {
    throw new Error(`Expected 2 or between 5 and 7 cards to evaluate best hand, got ${pool.length}.`);
  }
  if (pool.length === 5) {
    return evaluateFiveCards(pool);
  }

  let best: DetailedHandEvaluation | null = null;
  for (let i = 0; i < pool.length - 4; i += 1) {
    for (let j = i + 1; j < pool.length - 3; j += 1) {
      for (let k = j + 1; k < pool.length - 2; k += 1) {
        for (let l = k + 1; l < pool.length - 1; l += 1) {
          for (let m = l + 1; m < pool.length; m += 1) {
            const candidate = evaluateFiveCards([pool[i]!, pool[j]!, pool[k]!, pool[l]!, pool[m]!]);
            if (best === null || compareEvaluatedHands(candidate, best) > 0) {
              best = candidate;
            }
          }
        }
      }
    }
  }
  return best!;
}

export function resolveVirtualShowdownDecisions(
  hand: HandFlowState,
  holeCards: Readonly<Record<string, readonly [Card, Card]>>,
  board: readonly Card[],
): {
  decisions: PotWinnerDecision[];
  evaluations: Record<string, HandEvaluation>;
} {
  if (board.length !== 5) {
    throw new Error(`Showdown evaluation requires 5 community cards, got ${board.length}.`);
  }

  const detailedByPlayer = new Map<string, DetailedHandEvaluation>();
  const evaluations: Record<string, HandEvaluation> = {};

  for (const player of hand.players) {
    if (player.folded) continue;
    const cards = holeCards[player.id];
    if (!cards) {
      throw new Error(`Missing hole cards for showdown finalist ${player.id}.`);
    }
    const evaluated = evaluateBestHand(cards, board);
    detailedByPlayer.set(player.id, evaluated);
    evaluations[player.id] = toPublicEvaluation(evaluated);
  }

  const pots = buildPots(hand);
  const decisions: PotWinnerDecision[] = pots.map(pot => {
    let bestScore: readonly number[] | null = null;
    let winners: string[] = [];

    for (const eligibleId of pot.eligiblePlayers) {
      const evaluated = detailedByPlayer.get(eligibleId);
      if (!evaluated) {
        throw new Error(`Eligible player ${eligibleId} has no evaluated showdown hand.`);
      }
      if (bestScore === null) {
        bestScore = evaluated.score;
        winners = [eligibleId];
        continue;
      }
      const comparison = compareScores(evaluated.score, bestScore);
      if (comparison > 0) {
        bestScore = evaluated.score;
        winners = [eligibleId];
      } else if (comparison === 0) {
        winners.push(eligibleId);
      }
    }

    return { potId: pot.id, winners };
  });

  return { decisions, evaluations };
}
