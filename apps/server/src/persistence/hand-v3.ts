import { isDeepStrictEqual } from 'node:util';
import { settleHandFlow, startNextHand } from '@poker-table/engine';
import type { RoomConfig } from '@poker-table/protocol';
import type { PersistedV3Active, PersistedV3Complete, PersistedV3Settled } from './hand-schema.js';
import { verifyHandV2 } from './hand-v2.js';

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

  const seated = participants.filter(p => p.seat !== null);
  require(Number.isSafeInteger(record.tableBudget) && record.tableBudget > 0);

  // A primeira mão começa com o primeiro assento elegível.
  // Somente mãos posteriores utilizam rotação do dealer.
  if (record.handNumber === 1) {
    const firstSeat = Math.min(...record.hand.players.map(p => p.seat));
    require(record.hand.handState.dealerSeat === firstSeat);
  }

  if (record.status === 'hand-active') {
    if (record.handNumber === 1) {
      require(record.tableBudget === config.startingChips * seated.length);
      verifyHandV2(record.hand, config, participants, record.tableBudget);
    } else {
      require(record.previousSettlement !== undefined);
      const prev = record.previousSettlement!;
      require(sum(prev.players.map(p => p.chips)) === record.tableBudget);
      const expectedInitial = JSON.parse(JSON.stringify(startNextHand(prev, { blinds: config })));
      require(isDeepStrictEqual(record.hand.handState, expectedInitial.handState));
      verifyHandV2(record.hand, config, participants, record.tableBudget);
    }

    return;
  }

  // hand-settled or game-complete:
  require(record.hand.status === 'showdown' || record.hand.status === 'hand_ended_by_fold');
  verifyHandV2(record.hand, config, participants, record.tableBudget);

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
