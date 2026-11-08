import { describe, it, expect } from 'vitest';
import type { HandAction, HandSnapshot, RoomState } from '@poker-table/protocol';
import {
  getLastAction,
  getPlayerLastActionInStreet,
  formatActionTag,
  formatActionNarrative,
  groupActionsByStreet,
  getCurrentStreetBet,
  getPlayerDisplayName,
} from '../apps/web/src/utils/actions.js';

describe('Web action utilities', () => {
  const p1Id = '00000000-0000-0000-0000-000000000001';
  const p2Id = '00000000-0000-0000-0000-000000000002';
  const p3Id = '00000000-0000-0000-0000-000000000003';
  const roomId = '00000000-0000-0000-0000-000000000000';

  const dummyHand: HandSnapshot = {
    smallBlind: 10,
    bigBlind: 20,
    dealerSeat: 1,
    smallBlindSeat: 1,
    bigBlindSeat: 2,
    pot: 60,
    street: 'flop',
    currentActorId: p1Id,
    playersToAct: [p1Id, p2Id],
    status: 'in_progress',
    players: [
      { id: p1Id, seat: 1, chips: 980, roundCommitted: 0, totalCommitted: 20, folded: false, isAllIn: false },
      { id: p2Id, seat: 2, chips: 960, roundCommitted: 0, totalCommitted: 20, folded: false, isAllIn: false },
    ],
    actions: [
      {
        seq: 1,
        playerId: p1Id,
        seat: 1,
        street: 'preflop',
        type: 'small_blind',
        amount: 10,
        roundCommitted: 10,
        currentBet: 10,
        isAllIn: false,
      },
      {
        seq: 2,
        playerId: p2Id,
        seat: 2,
        street: 'preflop',
        type: 'big_blind',
        amount: 20,
        roundCommitted: 20,
        currentBet: 20,
        isAllIn: false,
      },
      {
        seq: 3,
        playerId: p1Id,
        seat: 1,
        street: 'preflop',
        type: 'call',
        amount: 10,
        roundCommitted: 20,
        currentBet: 20,
        isAllIn: false,
      },
      {
        seq: 4,
        playerId: p2Id,
        seat: 2,
        street: 'preflop',
        type: 'check',
        amount: 0,
        roundCommitted: 20,
        currentBet: 20,
        isAllIn: false,
      },
      {
        seq: 5,
        playerId: p1Id,
        seat: 1,
        street: 'flop',
        type: 'bet',
        amount: 30,
        roundCommitted: 30,
        currentBet: 30,
        isAllIn: false,
      },
    ],
  };

  it('getLastAction returns null on empty actions or the last action', () => {
    expect(getLastAction({ ...dummyHand, actions: [] })).toBeNull();
    expect(getLastAction(dummyHand)?.seq).toBe(5);
  });

  it('getPlayerLastActionInStreet only considers the current street', () => {
    // On flop, p1 made action seq 5 (bet)
    const p1Flop = getPlayerLastActionInStreet(dummyHand, p1Id);
    expect(p1Flop?.seq).toBe(5);
    expect(p1Flop?.type).toBe('bet');

    // On flop, p2 has not acted yet. Preflop actions must NOT be returned
    const p2Flop = getPlayerLastActionInStreet(dummyHand, p2Id);
    expect(p2Flop).toBeNull();
  });

  it('formatActionTag formats all poker actions with appropriate CSS classes', () => {
    const foldTag = formatActionTag({
      seq: 1,
      playerId: p1Id,
      seat: 1,
      street: 'flop',
      type: 'fold',
      amount: 0,
      roundCommitted: 0,
      currentBet: 30,
      isAllIn: false,
    });
    expect(foldTag).toEqual({ label: 'FOLD', className: 'tag-fold' });

    const checkTag = formatActionTag({
      seq: 2,
      playerId: p1Id,
      seat: 1,
      street: 'flop',
      type: 'check',
      amount: 0,
      roundCommitted: 0,
      currentBet: 0,
      isAllIn: false,
    });
    expect(checkTag).toEqual({ label: 'CHECK', className: 'tag-check' });

    const callTag = formatActionTag({
      seq: 3,
      playerId: p2Id,
      seat: 2,
      street: 'flop',
      type: 'call',
      amount: 50,
      roundCommitted: 50,
      currentBet: 50,
      isAllIn: false,
    });
    expect(callTag).toEqual({ label: 'CALL +50', className: 'tag-call' });

    const callAllInTag = formatActionTag({
      seq: 4,
      playerId: p2Id,
      seat: 2,
      street: 'flop',
      type: 'call',
      amount: 50,
      roundCommitted: 50,
      currentBet: 100,
      isAllIn: true,
    });
    expect(callAllInTag).toEqual({ label: 'CALL ALL-IN', sub: '(50)', className: 'tag-allin' });

    const betTag = formatActionTag({
      seq: 5,
      playerId: p1Id,
      seat: 1,
      street: 'flop',
      type: 'bet',
      amount: 40,
      roundCommitted: 40,
      currentBet: 40,
      isAllIn: false,
    });
    expect(betTag).toEqual({ label: 'BET 40', className: 'tag-bet' });

    const raiseTag = formatActionTag({
      seq: 6,
      playerId: p2Id,
      seat: 2,
      street: 'flop',
      type: 'raise',
      amount: 80,
      roundCommitted: 120,
      currentBet: 120,
      raiseTarget: 120,
      isAllIn: false,
    });
    expect(raiseTag).toEqual({ label: 'RAISE 120', sub: '(+80)', className: 'tag-raise' });

    const raiseAllInTag = formatActionTag({
      seq: 7,
      playerId: p2Id,
      seat: 2,
      street: 'flop',
      type: 'raise',
      amount: 200,
      roundCommitted: 240,
      currentBet: 240,
      raiseTarget: 240,
      isAllIn: true,
    });
    expect(raiseAllInTag).toEqual({ label: 'ALL-IN 240', sub: '(+200)', className: 'tag-allin' });
  });

  it('formatActionNarrative returns human readable descriptions', () => {
    const act: HandAction = {
      seq: 1,
      playerId: p1Id,
      seat: 1,
      street: 'turn',
      type: 'raise',
      amount: 150,
      roundCommitted: 200,
      currentBet: 200,
      raiseTarget: 200,
      isAllIn: false,
    };
    expect(formatActionNarrative(act, 'Alice')).toBe('Alice aumentou para 200 (+150)');

    const foldAct: HandAction = { ...act, type: 'fold', amount: 0, roundCommitted: 50 };
    expect(formatActionNarrative(foldAct, 'Bob')).toBe('Bob deu fold');
  });

  it('groupActionsByStreet correctly groups actions preserving chronological order', () => {
    const groups = groupActionsByStreet(dummyHand.actions!);
    expect(groups).toHaveLength(2);
    expect(groups[0].street).toBe('preflop');
    expect(groups[0].label).toBe('Pré-flop');
    expect(groups[0].actions).toHaveLength(4);

    expect(groups[1].street).toBe('flop');
    expect(groups[1].label).toBe('Flop');
    expect(groups[1].actions).toHaveLength(1);
  });

  it('getCurrentStreetBet computes current bet correctly', () => {
    expect(getCurrentStreetBet(dummyHand)).toBe(0);

    const handWithAllowedActions: HandSnapshot = {
      ...dummyHand,
      allowedActions: {
        playerId: p1Id,
        canFold: true,
        canCheck: false,
        canCall: true,
        callAmount: 30,
        canRaise: true,
        minRaiseAmount: 60,
        maxRaiseAmount: 980,
        minRaiseIncrement: 30,
        currentBet: 30,
        canAllIn: true,
        allInAmount: 980,
        allInType: 'raise',
        actionNotReopened: false,
      },
    };
    expect(getCurrentStreetBet(handWithAllowedActions)).toBe(30);
  });

  it('getPlayerDisplayName resolves names and fallbacks gracefully', () => {
    const room: RoomState = {
      id: roomId,
      code: 'ABCD12',
      config: {
        name: 'Mesa Teste',
        maxPlayers: 6,
        startingChips: 1000,
        smallBlind: 10,
        bigBlind: 20,
      },
      revision: 1,
      closed: false,
      players: [
        { id: p1Id, name: 'Carlos', seat: 1, connected: true, isHost: true },
      ],
      game: null,
    };
    expect(getPlayerDisplayName(room, p1Id, 1)).toBe('Carlos');
    expect(getPlayerDisplayName(room, p2Id, 2)).toBe('Assento #2');
    expect(getPlayerDisplayName(room, p3Id)).toBe('Jogador');
  });
});
