import { advanceStreet, type HandFlowState, type PotWinnerDecision, type SettlementResult } from '@poker-table/engine';
import type { BlindsTracker, PreAction } from '@poker-table/protocol';
import type { StoredGame } from '../persistence/hand.js';
import type { VirtualHandState } from '../persistence/hand-schema.js';
import { dealVirtualHandCards, drawCards, type RandomIntFn } from './deck.js';
import { resolveVirtualShowdownDecisions } from './evaluator.js';
import { settleGameHand } from './settlement.js';

const STREET_BOARD_LENGTH = {
  preflop: 0,
  flop: 3,
  turn: 4,
  river: 5,
} as const;

type ActiveV3Game = Extract<StoredGame, { version: 3; status: 'hand-active' }>;

function clockwiseDealOrder(
  players: readonly { id: string; seat: number }[],
  dealerSeat: number,
): string[] {
  const sorted = [...players].sort((left, right) => left.seat - right.seat);
  const afterDealer = sorted.filter(player => player.seat > dealerSeat);
  const upToDealer = sorted.filter(player => player.seat <= dealerSeat);
  return [...afterDealer, ...upToDealer].map(player => player.id);
}

export function resolveVirtualProgression(game: ActiveV3Game): StoredGame {
  if (!game.virtual) {
    throw new Error('Cannot resolve virtual progression without virtual deck state.');
  }

  let hand = game.hand;
  let deck = [...game.virtual.deck];
  const board = [...game.virtual.board];
  const holeCards = game.virtual.holeCards;
  const startingStreet = hand.street;

  while (hand.status === 'in_progress' && hand.currentRound.status === 'completed') {
    hand = advanceStreet(hand);
    const targetBoardLength = STREET_BOARD_LENGTH[hand.street];
    const missing = targetBoardLength - board.length;
    if (missing > 0) {
      const { drawn, remaining } = drawCards(deck, missing);
      board.push(...drawn);
      deck = remaining;
    }
  }

  if (hand.status === 'in_progress') {
    const { preActions: previousPreActions, ...restGame } = game;
    const nextPreActions: Readonly<Record<string, PreAction>> | undefined =
      hand.street === startingStreet ? previousPreActions : undefined;
    return {
      ...restGame,
      hand,
      ...(nextPreActions !== undefined ? { preActions: nextPreActions } : {}),
      virtual: {
        deck,
        board,
        holeCards,
      },
    };
  }

function buildSettledVirtualGame(
  game: ActiveV3Game,
  hand: HandFlowState,
  decisions: readonly PotWinnerDecision[],
  virtual: VirtualHandState,
): StoredGame {
  const settlement = settleGameHand(hand, decisions);
  const survivors = settlement.players.filter(player => player.chips > 0);
  const common = {
    version: 3 as const,
    hand,
    settlement,
    decisions,
    handNumber: game.handNumber,
    tableBudget: game.tableBudget,
    ...(game.admittedPlayerIds ? { admittedPlayerIds: game.admittedPlayerIds } : {}),
    ...(game.blindsTracker ? { blindsTracker: game.blindsTracker } : {}),
    virtual,
  };

  if (survivors.length <= 1) {
    return {
      ...common,
      status: 'game-complete',
      winnerId: survivors[0]?.id ?? settlement.players[0]!.id,
    };
  }

  return {
    ...common,
    status: 'hand-settled',
  };
}

  if (hand.status === 'hand_ended_by_fold') {
    return buildSettledVirtualGame(game, hand, [], { deck, board, holeCards });
  }

  // Showdown reached (either after river betting or via early all-in runout).
  const missingBoard = 5 - board.length;
  if (missingBoard > 0) {
    const { drawn, remaining } = drawCards(deck, missingBoard);
    board.push(...drawn);
    deck = remaining;
  }

  const { decisions, evaluations } = resolveVirtualShowdownDecisions(hand, holeCards, board);
  return buildSettledVirtualGame(game, hand, decisions, {
    deck,
    board,
    holeCards,
    evaluations,
  });
}

export function startVirtualGame(
  hand: HandFlowState,
  tableBudget: number,
  admittedPlayerIds: readonly string[],
  blindsTracker?: BlindsTracker,
  rng?: RandomIntFn,
): StoredGame {
  const orderedIds = clockwiseDealOrder(hand.players, hand.dealerSeat);
  const dealt = dealVirtualHandCards(orderedIds, rng);
  return resolveVirtualProgression({
    version: 3,
    status: 'hand-active',
    hand,
    handNumber: 1,
    tableBudget,
    admittedPlayerIds,
    ...(blindsTracker ? { blindsTracker } : {}),
    virtual: dealt,
  });
}

export function advanceVirtualNextHand(
  hand: HandFlowState,
  handNumber: number,
  tableBudget: number,
  admittedPlayerIds: readonly string[],
  previousSettlement: SettlementResult,
  blindsTracker?: BlindsTracker,
  rng?: RandomIntFn,
): StoredGame {
  const orderedIds = clockwiseDealOrder(hand.players, hand.dealerSeat);
  const dealt = dealVirtualHandCards(orderedIds, rng);
  return resolveVirtualProgression({
    version: 3,
    status: 'hand-active',
    hand,
    handNumber,
    tableBudget,
    previousSettlement,
    admittedPlayerIds,
    ...(blindsTracker ? { blindsTracker } : {}),
    virtual: dealt,
  });
}
