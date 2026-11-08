import { describe, expect, it } from 'vitest';
import { advanceStreet, applyHandAction, startHandFlow } from '@poker-table/engine';
import { useLanGame, ok } from './support/lan-game.js';

describe('Hand actions history and semantics', () => {
  const players = [
    { id: 'p1', seat: 1, chips: 1000 },
    { id: 'p2', seat: 2, chips: 1000 },
    { id: 'p3', seat: 3, chips: 500 },
  ];
  const blinds = { smallBlind: 10, bigBlind: 20 };

  it('records automatic blinds with sequence numbers at start of hand', () => {
    const hand = startHandFlow({ players, blinds, dealerSeat: 1 });
    expect(hand.actions).toBeDefined();
    expect(hand.actions?.length).toBe(2);

    const [sb, bb] = hand.actions!;
    expect(sb).toMatchObject({
      seq: 1,
      playerId: 'p2',
      seat: 2,
      street: 'preflop',
      type: 'small_blind',
      amount: 10,
      roundCommitted: 10,
      currentBet: 10,
      isAllIn: false,
    });
    expect(bb).toMatchObject({
      seq: 2,
      playerId: 'p3',
      seat: 3,
      street: 'preflop',
      type: 'big_blind',
      amount: 20,
      roundCommitted: 20,
      currentBet: 20,
      isAllIn: false,
    });
  });

  it('records call, raise, fold, check and differentiates bet vs raise', () => {
    let hand = startHandFlow({ players, blinds, dealerSeat: 1 });
    // Preflop: actor is p1 (dealer/BTN in 3-handed)
    expect(hand.currentActorId).toBe('p1');

    // p1 raises to 60 (+60)
    hand = applyHandAction(hand, { playerId: 'p1', type: 'raise', amount: 60 });
    const raiseAct = hand.actions![hand.actions!.length - 1];
    expect(raiseAct).toMatchObject({
      seq: 3,
      playerId: 'p1',
      seat: 1,
      street: 'preflop',
      type: 'raise',
      amount: 60,
      roundCommitted: 60,
      currentBet: 60,
      raiseTarget: 60,
      isAllIn: false,
    });

    // p2 calls: needs 50 more (already put 10 as SB)
    expect(hand.currentActorId).toBe('p2');
    hand = applyHandAction(hand, { playerId: 'p2', type: 'call' });
    const callAct = hand.actions![hand.actions!.length - 1];
    expect(callAct).toMatchObject({
      seq: 4,
      playerId: 'p2',
      seat: 2,
      street: 'preflop',
      type: 'call',
      amount: 50,
      roundCommitted: 60,
      currentBet: 60,
      isAllIn: false,
    });

    // p3 folds
    expect(hand.currentActorId).toBe('p3');
    hand = applyHandAction(hand, { playerId: 'p3', type: 'fold' });
    const foldAct = hand.actions![hand.actions!.length - 1];
    expect(foldAct).toMatchObject({
      seq: 5,
      playerId: 'p3',
      seat: 3,
      street: 'preflop',
      type: 'fold',
      amount: 0,
      roundCommitted: 20,
      isAllIn: false,
    });

    // Betting round is now complete. Advance to Flop
    expect(hand.currentRound.status).toBe('completed');
    hand = advanceStreet(hand);
    expect(hand.street).toBe('flop');
    expect(hand.actions?.length).toBe(5); // Preserved

    // Flop: p2 acts first (SB). currentBet is 0. p2 checks.
    expect(hand.currentActorId).toBe('p2');
    hand = applyHandAction(hand, { playerId: 'p2', type: 'check' });
    const checkAct = hand.actions![hand.actions!.length - 1];
    expect(checkAct).toMatchObject({
      seq: 6,
      playerId: 'p2',
      seat: 2,
      street: 'flop',
      type: 'check',
      amount: 0,
      roundCommitted: 0,
      currentBet: 0,
      isAllIn: false,
    });

    // p1 acts on flop. Since currentBet is 0, a raise action represents a BET!
    expect(hand.currentActorId).toBe('p1');
    hand = applyHandAction(hand, { playerId: 'p1', type: 'raise', amount: 100 });
    const betAct = hand.actions![hand.actions!.length - 1];
    expect(betAct).toMatchObject({
      seq: 7,
      playerId: 'p1',
      seat: 1,
      street: 'flop',
      type: 'bet', // Correctly classified as bet!
      amount: 100,
      roundCommitted: 100,
      currentBet: 100,
      raiseTarget: 100,
      isAllIn: false,
    });

    // p2 raises to 300 (currentBet was 100, committed 0). Needs +300.
    expect(hand.currentActorId).toBe('p2');
    hand = applyHandAction(hand, { playerId: 'p2', type: 'raise', amount: 300 });
    const flopRaiseAct = hand.actions![hand.actions!.length - 1];
    expect(flopRaiseAct).toMatchObject({
      seq: 8,
      playerId: 'p2',
      seat: 2,
      street: 'flop',
      type: 'raise', // Over an existing bet -> raise!
      amount: 300,
      roundCommitted: 300,
      currentBet: 300,
      raiseTarget: 300,
      isAllIn: false,
    });
  });

  it('correctly identifies call all-in vs raise all-in', () => {
    // p3 only has 50 chips
    const shortStackPlayers = [
      { id: 'p1', seat: 1, chips: 1000 },
      { id: 'p2', seat: 2, chips: 1000 },
      { id: 'p3', seat: 3, chips: 50 },
    ];
    let hand = startHandFlow({ players: shortStackPlayers, blinds, dealerSeat: 1 });
    // p1 raises to 100
    hand = applyHandAction(hand, { playerId: 'p1', type: 'raise', amount: 100 });
    // p2 folds
    hand = applyHandAction(hand, { playerId: 'p2', type: 'fold' });
    // p3 already put 20 as BB, has 30 chips left. Total possible: 50 <= currentBet (100).
    // This is an all-in CALL!
    expect(hand.currentActorId).toBe('p3');
    hand = applyHandAction(hand, { playerId: 'p3', type: 'all-in' });
    const p3Act = hand.actions![hand.actions!.length - 1];
    expect(p3Act).toMatchObject({
      type: 'call',
      amount: 30,
      roundCommitted: 50,
      isAllIn: true,
    });
  });
});

describe('Multiplayer action history sync and recovery', () => {
  const g = useLanGame();

  it('broadcasts action history to all clients and preserves it across restart', async () => {
    await g.setup(3);
    const initialSync = await g.sync();
    expect(initialSync.game?.hand.actions).toBeDefined();
    expect(initialSync.game?.hand.actions?.length).toBe(2); // SB + BB

    // Player 1 (BTN/actor 0) raises to 60
    const actorSocket = g.sockets[g.actorIndex()];
    const raiseCmd = await g.envelope({ type: 'game-action', action: 'raise', amount: 60 }, actorSocket);
    const reply = ok(await g.send(actorSocket, raiseCmd));

    expect(reply.game?.hand.actions?.length).toBe(3);
    const last = reply.game?.hand.actions![2];
    expect(last?.type).toBe('raise');
    expect(last?.amount).toBe(60);

    // Restart server: SQLite persistence test
    const resumed = await g.restart();
    expect(resumed.game?.hand.actions).toBeDefined();
    expect(resumed.game?.hand.actions?.length).toBe(3);
    expect(resumed.game?.hand.actions).toEqual(reply.game?.hand.actions);
  });
});
