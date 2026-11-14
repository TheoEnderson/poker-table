import { isDeepStrictEqual } from 'node:util';
import { settleHandFlow, startNextHand, type PotWinnerDecision } from '@poker-table/engine';
import type { RoomConfig } from '@poker-table/protocol';
import type { PersistedV3Active, PersistedV3Complete, PersistedV3Settled, VirtualHandState } from './hand-schema.js';
import { resolveVirtualShowdownDecisions } from '../game/evaluator.js';
import { verifyHandV2 } from './hand-v2.js';

const STREET_BOARD_LENGTH = {
  preflop: 0,
  flop: 3,
  turn: 4,
  river: 5,
} as const;

function normalizeDecisions(decisions: readonly PotWinnerDecision[]) {
  return [...decisions]
    .map(decision => ({
      potId: decision.potId,
      winners: [...(decision.winners ?? decision.winnerIds ?? [])].sort(),
    }))
    .sort((left, right) => left.potId.localeCompare(right.potId));
}

function verifyVirtualState(
  virtual: VirtualHandState,
  record: PersistedV3Active | PersistedV3Settled | PersistedV3Complete,
  require: (condition: boolean) => void,
) {
  const holeKeys = Object.keys(virtual.holeCards);
  require(holeKeys.length === record.hand.players.length);
  for (const player of record.hand.players) {
    require(virtual.holeCards[player.id] !== undefined);
  }

  const allCards = [
    ...virtual.deck,
    ...virtual.board,
    ...Object.values(virtual.holeCards).flat(),
  ];
  require(allCards.length === 52);
  const uniqueCards = new Set(allCards.map(card => `${card.rank}${card.suit}`));
  require(uniqueCards.size === 52);

  if (record.hand.status === 'showdown') {
    require(virtual.board.length === 5);
  } else {
    require(virtual.board.length === STREET_BOARD_LENGTH[record.hand.street]);
  }

  if (record.status === 'hand-active') {
    require(record.hand.status === 'in_progress');
    require(virtual.evaluations === undefined);
    return;
  }

  if (record.hand.status === 'showdown') {
    const expected = resolveVirtualShowdownDecisions(record.hand, virtual.holeCards, virtual.board);
    require(isDeepStrictEqual(normalizeDecisions(record.decisions), normalizeDecisions(expected.decisions)));
    require(isDeepStrictEqual(virtual.evaluations, expected.evaluations));
  } else {
    require(virtual.evaluations === undefined);
    require(record.decisions.length === 0);
  }
}

export function verifyGameV3(
  record: PersistedV3Active | PersistedV3Settled | PersistedV3Complete,
  config: RoomConfig,
  participants: readonly { id: string; seat: number | null }[],
) {
  const require = (condition: boolean) => { if (!condition) throw new Error('Invalid persisted v3 game'); };
  const sum = (values: readonly number[]) => values.reduce((total, n) => {
    require(Number.isSafeInteger(n) && n >= 0 && total <= Number.MAX_SAFE_INTEGER - n);
    return total + n;
  }, 0);

  require(Number.isSafeInteger(record.tableBudget) && record.tableBudget > 0);
  const isVirtualMode = (config.deckMode ?? 'physical') === 'virtual';
  require(isVirtualMode ? record.virtual !== undefined : record.virtual === undefined);

  // A primeira mão começa com o primeiro assento elegível.
  // Somente mãos posteriores utilizam rotação do dealer.
  if (record.handNumber === 1) {
    const firstSeat = Math.min(...record.hand.players.map(p => p.seat));
    require(record.hand.handState.dealerSeat === firstSeat);
  }

  if (record.admittedPlayerIds !== undefined) {
    require(record.tableBudget === record.admittedPlayerIds.length * config.startingChips);
  }

  if (record.status === 'hand-active') {
    const handBlinds = { smallBlind: record.hand.smallBlind, bigBlind: record.hand.bigBlind };
    if (record.handNumber === 1) {
      const handInitialCount = record.admittedPlayerIds?.length ?? record.hand.players.length;
      require(record.tableBudget === config.startingChips * handInitialCount);
      verifyHandV2(record.hand, config, participants, record.tableBudget, handBlinds);
    } else {
      require(record.previousSettlement !== undefined);
      const prev = record.previousSettlement!;
      const newPlayers = record.hand.players
        .filter(p => !prev.players.some(prevP => prevP.id === p.id))
        .map(p => ({
          id: p.id,
          seat: p.seat,
          chips: config.startingChips,
        }));
      const newPlayersBudget = newPlayers.length * config.startingChips;
      require(sum(prev.players.map(p => p.chips)) + newPlayersBudget === record.tableBudget);
      const expectedInitial = JSON.parse(JSON.stringify(startNextHand(prev, {
        blinds: handBlinds,
        newPlayers: newPlayers.length > 0 ? newPlayers : undefined,
      })));
      require(isDeepStrictEqual(record.hand.handState, expectedInitial.handState));
      verifyHandV2(record.hand, config, participants, record.tableBudget, handBlinds);
    }

    if (record.virtual) verifyVirtualState(record.virtual, record, require);
    return;
  }

  // hand-settled or game-complete:
  require(record.hand.status === 'showdown' || record.hand.status === 'hand_ended_by_fold');
  verifyHandV2(record.hand, config, participants, record.tableBudget, {
    smallBlind: record.hand.smallBlind,
    bigBlind: record.hand.bigBlind,
  });
  if (record.virtual) verifyVirtualState(record.virtual, record, require);

  // Validate settlement calculation using pure engine
  const calculated = JSON.parse(JSON.stringify(settleHandFlow(record.hand, record.decisions)));
  require(isDeepStrictEqual(calculated, record.settlement));
  require(sum(record.settlement.players.map(p => p.chips)) === record.tableBudget);

  const survivors = record.settlement.players.filter(p => p.chips > 0);

  if (record.status === 'hand-settled') {
    require(survivors.length >= 2);
  } else if (record.status === 'game-complete') {
    require(survivors.length <= 1);
    if (survivors.length === 1) {
      require(record.winnerId === survivors[0].id);
      require(participants.some(p => p.id === record.winnerId));
    }
  }
}
