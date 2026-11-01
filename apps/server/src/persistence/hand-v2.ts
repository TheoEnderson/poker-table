import { isDeepStrictEqual } from 'node:util';
import { createInitialHand, type HandFlowState } from '@poker-table/engine';
import type { RoomConfig } from '@poker-table/protocol';

// Snapshot invariants, not a replay/proof of betting history. See docs/etapa-3b.md.
export function verifyHandV2(hand: HandFlowState, config: RoomConfig, participants: readonly { id: string; seat: number | null }[]) {
  const require = (condition: boolean) => { if (!condition) throw new Error('Invalid persisted hand'); };
  const sum = (values: readonly number[]) => values.reduce((total, n) => {
    require(Number.isSafeInteger(n) && n >= 0 && total <= Number.MAX_SAFE_INTEGER - n);
    return total + n;
  }, 0);
  const { players, currentRound: round, handState: initial } = hand;
  const seated = participants.filter(p => p.seat !== null);
  require(players.length === seated.length && players.length <= config.maxPlayers);
  require(new Set(players.map(p => p.id)).size === players.length && new Set(players.map(p => p.seat)).size === players.length);
  require(players.every((p, i) => p.seat <= config.maxPlayers && seated.some(q => q.id === p.id && q.seat === p.seat) && (i === 0 || players[i - 1].seat < p.seat)));
  require(initial.players.length === players.length && round.players.length === players.length);
  require(hand.smallBlind === config.smallBlind && hand.bigBlind === config.bigBlind);

  // Validate the immutable origin using engine rules, never reconstruct the evolved hand.
  // Individual initial stacks come from the origin snapshot; their aggregate must match the room budget.
  const originPlayers = initial.players.map(p => ({ id: p.id, seat: p.seat, chips: sum([p.chips, p.committed]) }));
  const budget = config.startingChips * players.length;
  require(Number.isSafeInteger(budget) && sum(originPlayers.map(p => p.chips)) === budget);
  require(isDeepStrictEqual(initial, createInitialHand({ players: originPlayers, blinds: { smallBlind: config.smallBlind, bigBlind: config.bigBlind } })));
  require(isDeepStrictEqual(initial, round.handState));
  for (const key of ['dealerSeat', 'smallBlindSeat', 'bigBlindSeat', 'smallBlind', 'bigBlind'] as const) {
    require(hand[key] === initial[key] && hand[key] === round[key]);
  }
  require(hand.pot === round.pot && sum(players.map(p => p.totalCommitted)) === hand.pot);
  require(sum([...players.map(p => p.chips), hand.pot]) === budget);
  for (const [i, p] of players.entries()) {
    const r = round.players[i], origin = originPlayers[i];
    require(p.id === r.id && p.id === origin.id && p.seat === r.seat && p.seat === origin.seat);
    require(p.chips === r.chips && p.roundCommitted === r.committed && p.committed === r.committed);
    require(p.totalCommitted === sum([p.baseCommitted, p.roundCommitted]));
    require(sum([p.chips, p.totalCommitted]) === origin.chips);
    require(p.folded === r.folded && p.isAllIn === r.isAllIn && p.isAllIn === (p.chips === 0));
    require(!(p.folded && p.isAllIn));
    require(r.committed <= round.currentBet && (r.lastActionBet === null || r.lastActionBet <= round.currentBet));
    if (hand.street === 'preflop') require(p.baseCommitted === 0);
    else require(p.baseCommitted >= initial.players[i].committed);
  }
  require(round.minRaiseIncrement === round.lastRaiseIncrement && round.minRaiseIncrement >= hand.bigBlind);
  require(round.currentBet <= budget && round.minRaiseIncrement <= budget);
  if (hand.street === 'preflop') require(round.currentBet >= hand.bigBlind);
  const pending = round.playersToAct;
  require(new Set(pending).size === pending.length);
  require(pending.every(id => players.some(p => p.id === id && !p.folded && !p.isAllIn)));
  require(round.currentActorId === (pending[0] ?? null));
  const active = players.filter(p => !p.folded), able = active.filter(p => !p.isAllIn);
  if (round.status === 'active') {
    require(hand.status === 'in_progress' && active.length >= 2 && pending.length > 0);
    // Every player still owing chips must appear in the pending queue, including after a short raise.
    require(able.every(p => p.roundCommitted >= round.currentBet || pending.includes(p.id)));
  } else {
    require(pending.length === 0 && round.currentActorId === null);
    if (round.status === 'completed') {
      require(active.length >= 2);
      // currentBet can exceed commitments after an uncalled refund; compare active contributions instead.
      const highest = Math.max(...active.map(p => p.roundCommitted));
      require(able.every(p => p.roundCommitted === highest));
    }
  }
  if (hand.status === 'hand_ended_by_fold') {
    require(round.status === 'hand_ended_by_fold' && active.length === 1 && hand.survivorId === active[0].id);
  } else {
    require(hand.survivorId === null && round.status !== 'hand_ended_by_fold');
    if (hand.status === 'showdown') require(round.status === 'completed' && (hand.street === 'river' || able.length <= 1));
    else require(round.status === 'active' || able.length >= 2);
  }
  require(isDeepStrictEqual(hand.playersToAct, round.playersToAct) && hand.currentActorId === round.currentActorId);
}
