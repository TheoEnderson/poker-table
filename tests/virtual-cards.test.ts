import { randomUUID } from 'node:crypto';
import { expect, describe, it } from 'vitest';
import {
  HAND_RANK_LABELS,
  resetGameConfigSchema,
  roomConfigSchema,
  roomStateSchema,
  type Card,
  type RoomState,
} from '@poker-table/protocol';
import { applyHandAction, startHandFlow } from '@poker-table/engine';
import { createDeck, dealVirtualHandCards, shuffleDeck } from '../apps/server/src/game/deck.js';
import {
  compareEvaluatedHands,
  evaluateBestHand,
  evaluateFiveCards,
  resolveVirtualShowdownDecisions,
} from '../apps/server/src/game/evaluator.js';
import { ok, useLanGame, waitFor } from './support/lan-game.js';

function c(notation: string): Card {
  if (notation.length !== 2) throw new Error(`Invalid notation: ${notation}`);
  return {
    rank: notation[0] as Card['rank'],
    suit: notation[1] as Card['suit'],
  };
}

function cards(list: string[]): Card[] {
  return list.map(c);
}

describe('protocol deckMode defaults and validation', () => {
  it('defaults omitted deckMode to physical while supporting virtual', () => {
    const legacy = roomConfigSchema.parse({
      name: 'Mesa Clássica',
      maxPlayers: 6,
      startingChips: 1000,
      smallBlind: 10,
      bigBlind: 20,
    });
    expect(legacy.deckMode).toBe('physical');

    const virtualCfg = roomConfigSchema.parse({
      name: 'Mesa Virtual',
      maxPlayers: 6,
      startingChips: 1000,
      smallBlind: 10,
      bigBlind: 20,
      deckMode: 'virtual',
    });
    expect(virtualCfg.deckMode).toBe('virtual');

    const legacyReset = resetGameConfigSchema.parse({
      startingChips: 500,
      smallBlind: 5,
      bigBlind: 10,
    });
    expect(legacyReset.deckMode).toBe('physical');
    expect(() =>
      roomConfigSchema.parse({
        name: 'Inválida',
        maxPlayers: 6,
        startingChips: 1000,
        smallBlind: 10,
        bigBlind: 20,
        deckMode: 'auto',
      }),
    ).toThrow();
  });
});

describe('virtual deck shuffling and dealing', () => {
  it('shuffles 52 distinct cards and deals non-overlapping hole cards', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map(card => `${card.rank}${card.suit}`)).size).toBe(52);

    const shuffled = shuffleDeck(deck);
    expect(shuffled).toHaveLength(52);
    expect(new Set(shuffled.map(card => `${card.rank}${card.suit}`)).size).toBe(52);

    const dealt = dealVirtualHandCards(['p1', 'p2', 'p3', 'p4']);
    expect(dealt.board).toEqual([]);
    expect(dealt.deck).toHaveLength(52 - 8);
    const seen = new Set<string>();
    for (const card of dealt.deck) seen.add(`${card.rank}${card.suit}`);
    for (const pair of Object.values(dealt.holeCards)) {
      expect(pair).toHaveLength(2);
      seen.add(`${pair[0].rank}${pair[0].suit}`);
      seen.add(`${pair[1].rank}${pair[1].suit}`);
    }
    expect(seen.size).toBe(52);
  });
});

describe('7-card Texas Holdem evaluator', () => {
  it('ranks all 10 hand categories cleanly with Portuguese labels', () => {
    const samples: [Card[], keyof typeof HAND_RANK_LABELS][] = [
      [cards(['2c', '7d', '9s', 'Jh', 'Kc']), 'high_card'],
      [cards(['Ac', 'Ad', '5s', '8h', 'Kc']), 'pair'],
      [cards(['Kc', 'Kd', '5s', '5h', 'Ac']), 'two_pair'],
      [cards(['Qc', 'Qd', 'Qs', '4h', '9c']), 'three_of_a_kind'],
      [cards(['9c', 'Td', 'Js', 'Qh', 'Kc']), 'straight'],
      [cards(['2h', '6h', '9h', 'Jh', 'Ah']), 'flush'],
      [cards(['Jc', 'Jd', 'Js', '4h', '4c']), 'full_house'],
      [cards(['8c', '8d', '8s', '8h', '2c']), 'four_of_a_kind'],
      [cards(['5s', '6s', '7s', '8s', '9s']), 'straight_flush'],
      [cards(['Th', 'Jh', 'Qh', 'Kh', 'Ah']), 'royal_flush'],
    ];

    const evaluated = samples.map(([hand, expectedCategory]) => {
      const result = evaluateFiveCards(hand);
      expect(result.category).toBe(expectedCategory);
      expect(result.label).toBe(HAND_RANK_LABELS[expectedCategory]);
      return result;
    });

    for (let i = 1; i < evaluated.length; i += 1) {
      expect(compareEvaluatedHands(evaluated[i]!, evaluated[i - 1]!)).toBeGreaterThan(0);
    }
  });

  it('handles A-2-3-4-5 wheel straight and kicker tie-breakers accurately', () => {
    const wheel = evaluateBestHand([c('Ac'), c('2d')], cards(['3s', '4h', '5c', 'Ks', '9d']));
    const sixHigh = evaluateBestHand([c('6c'), c('2d')], cards(['3s', '4h', '5c', 'Ks', '9d']));
    const trips = evaluateBestHand([c('Ks'), c('Kd')], cards(['Kh', '2c', '7d', '9s', '4h']));
    expect(wheel.category).toBe('straight');
    expect(compareEvaluatedHands(sixHigh, wheel)).toBeGreaterThan(0);
    expect(compareEvaluatedHands(wheel, trips)).toBeGreaterThan(0);

    const acePairKingKicker = evaluateBestHand([c('Ac'), c('Kd')], cards(['As', '7h', '4c', '3d', '2s']));
    const acePairQueenKicker = evaluateBestHand([c('Ah'), c('Qd')], cards(['As', '7h', '4c', '3d', '2s']));
    expect(compareEvaluatedHands(acePairKingKicker, acePairQueenKicker)).toBeGreaterThan(0);

    const boardFlush = cards(['Ah', 'Kh', 'Qh', 'Jh', '2h']);
    const p1 = evaluateBestHand([c('3c'), c('4d')], boardFlush);
    const p2 = evaluateBestHand([c('5s'), c('6c')], boardFlush);
    expect(compareEvaluatedHands(p1, p2)).toBe(0);
  });

  it('evaluates 2-card preflop hands and 5/6-card postflop boards accurately', () => {
    const pocketAces = evaluateBestHand([c('As'), c('Ah')], []);
    const pocketKings = evaluateBestHand([c('Ks'), c('Kh')], []);
    const aceKing = evaluateBestHand([c('Ad'), c('Kc')], []);
    const aceQueen = evaluateBestHand([c('Ac'), c('Qd')], []);

    expect(pocketAces.category).toBe('pair');
    expect(pocketAces.label).toBe('Par');
    expect(aceKing.category).toBe('high_card');
    expect(aceKing.label).toBe('Carta Alta');
    expect(compareEvaluatedHands(pocketAces, pocketKings)).toBeGreaterThan(0);
    expect(compareEvaluatedHands(pocketKings, aceKing)).toBeGreaterThan(0);
    expect(compareEvaluatedHands(aceKing, aceQueen)).toBeGreaterThan(0);

    // Flop (3 community cards -> 5 cards total)
    const flopEval = evaluateBestHand([c('Ah'), c('Kd')], cards(['As', 'Ad', '7c']));
    expect(flopEval.category).toBe('three_of_a_kind');
    expect(flopEval.label).toBe('Trinca');

    // Turn (4 community cards -> 6 cards total)
    const turnEval = evaluateBestHand([c('Ah'), c('Kd')], cards(['As', 'Ad', '7c', 'Ks']));
    expect(turnEval.category).toBe('full_house');
    expect(turnEval.label).toBe('Full House');
  });

  it('resolves main pot and side pot winners accurately in showdown', () => {
    const p1 = randomUUID();
    const p2 = randomUUID();
    const p3 = randomUUID();
    let hand = startHandFlow({
      players: [
        { id: p1, seat: 1, chips: 100 },
        { id: p2, seat: 2, chips: 500 },
        { id: p3, seat: 3, chips: 500 },
      ],
      blinds: { smallBlind: 10, bigBlind: 20 },
    });
    // p1 (dealer/SB in 3p? No: seat 1=dealer, seat 2=SB, seat 3=BB) -> preflop actor order p1 first
    hand = applyHandAction(hand, { playerId: p1, type: 'all-in' });
    hand = applyHandAction(hand, { playerId: p2, type: 'all-in' });
    hand = applyHandAction(hand, { playerId: p3, type: 'call' });
    expect(hand.status).toBe('showdown');

    const board = cards(['Ad', '7c', '2s', '9h', 'Jd']);
    const { decisions, evaluations } = resolveVirtualShowdownDecisions(
      hand,
      {
        [p1]: [c('Ah'), c('As')], // Three Aces -> wins main pot (300)
        [p2]: [c('Kh'), c('Kd')], // Pair of Kings -> wins side pot (800)
        [p3]: [c('Qh'), c('Qd')], // Pair of Queens -> loses both
      },
      board,
    );

    expect(evaluations[p1]!.category).toBe('three_of_a_kind');
    expect(evaluations[p2]!.category).toBe('pair');
    expect(decisions).toHaveLength(2);
    expect(decisions[0]!.winners).toEqual([p1]);
    expect(decisions[1]!.winners).toEqual([p2]);
  });
});

describe('virtual cards multiplayer server flow and anti-cheat projection', () => {
  const g = useLanGame();

  async function setupVirtual(playerCount = 2, startingChips = 1000) {
    const host = g.app.rooms.create({
      hostName: 'Anfitrião',
      config: {
        name: 'Mesa Virtual',
        maxPlayers: 6,
        startingChips,
        smallBlind: 10,
        bigBlind: 20,
        deckMode: 'virtual',
      },
    });
    g.admissions.push(host);
    const hostSocket = await g.connect(host.credentials);
    g.sockets.push(hostSocket);
    ok(await g.command(0, { type: 'select-seat', seat: 1 }));

    for (let i = 1; i < playerCount; i += 1) {
      const guest = g.app.rooms.join(host.room.code, { name: `Jogador ${i}`, seat: i + 1 });
      g.admissions.push(guest);
      const guestSocket = await g.connect(guest.credentials);
      g.sockets.push(guestSocket);
    }

    ok(await g.command(0, { type: 'start-game' }));
    return {
      code: host.room.code,
      hostId: host.credentials.playerId,
    };
  }

  it('filters hidden hole cards per client and blocks manual street/settle commands', async () => {
    const { code } = await setupVirtual(2);

    const p0State = await g.sync(g.sockets[0]);
    const p1State = await g.sync(g.sockets[1]);
    expect(p0State.config.deckMode).toBe('virtual');
    expect(p0State.game?.status).toBe('hand-active');
    expect(p0State.game?.hand.board).toEqual([]);

    const p0Id = g.admissions[0]!.credentials.playerId;
    const p1Id = g.admissions[1]!.credentials.playerId;

    // Anti-cheat: P0 sees only own hole cards; P1 sees only own hole cards.
    expect(p0State.game!.hand.players.find(p => p.id === p0Id)!.holeCards).toHaveLength(2);
    expect(p0State.game!.hand.players.find(p => p.id === p1Id)!.holeCards).toBeUndefined();
    expect(p0State.game!.hand.players.find(p => p.id === p1Id)!.hasCards).toBe(true);

    expect(p1State.game!.hand.players.find(p => p.id === p1Id)!.holeCards).toHaveLength(2);
    expect(p1State.game!.hand.players.find(p => p.id === p0Id)!.holeCards).toBeUndefined();
    expect((p0State.game!.hand as Record<string, unknown>).deck).toBeUndefined();

    // Unauthenticated spectator endpoint exposes no hole cards
    const httpReply = await fetch(`${g.base}/api/rooms/${code}`).then(r => r.json()) as { ok: boolean; data: RoomState };
    expect(httpReply.ok).toBe(true);
    for (const player of httpReply.data.game!.hand.players) {
      expect(player.holeCards).toBeUndefined();
      expect(player.hasCards).toBe(true);
    }

    // Rejects manual advance-street and settle-hand in virtual mode
    const manualAdvance = await g.command(0, { type: 'advance-street' });
    expect(manualAdvance.ok).toBe(false);
    if (!manualAdvance.ok) expect(manualAdvance.error.code).toBe('INVALID_ACTION');

    const manualSettle = await g.command(0, { type: 'settle-hand', decisions: [] });
    expect(manualSettle.ok).toBe(false);
    if (!manualSettle.ok) expect(manualSettle.error.code).toBe('INVALID_ACTION');
  });

  it('auto-advances streets, survives SQLite restart mid-hand, and settles showdown automatically', async () => {
    await setupVirtual(2);

    // Complete preflop -> auto-advances to Flop with 3 cards
    await g.act('call');
    const flopState = await g.act('check');
    expect(flopState.game?.status).toBe('hand-active');
    expect(flopState.game?.hand.street).toBe('flop');
    expect(flopState.game?.hand.board).toHaveLength(3);

    const p0FlopCards = (await g.sync(g.sockets[0])).game!.hand.players[0]!.holeCards;
    const p1FlopSeenByP1 = (await g.sync(g.sockets[1])).game!.hand.players[1]!.holeCards;
    expect(p0FlopCards).toHaveLength(2);
    expect(p1FlopSeenByP1).toHaveLength(2);

    // Server restart preserves exact board and hole cards
    const restarted = await g.restart();
    expect(restarted.game?.status).toBe('hand-active');
    expect(restarted.game?.hand.street).toBe('flop');
    expect(restarted.game?.hand.board).toEqual(flopState.game?.hand.board);
    expect(restarted.game!.hand.players[0]!.holeCards).toEqual(p0FlopCards);
    expect((await g.sync(g.sockets[1])).game!.hand.players[1]!.holeCards).toEqual(p1FlopSeenByP1);

    // Flop checks -> Turn (4 cards)
    await g.act('check');
    const turnState = await g.act('check');
    expect(turnState.game?.hand.street).toBe('turn');
    expect(turnState.game?.hand.board).toHaveLength(4);

    // Turn checks -> River (5 cards)
    await g.act('check');
    const riverState = await g.act('check');
    expect(riverState.game?.hand.street).toBe('river');
    expect(riverState.game?.hand.board).toHaveLength(5);

    // River check + check -> Auto showdown and settlement!
    const receivedByP1: RoomState[] = [];
    g.sockets[1]!.on('room:state', state => receivedByP1.push(state));

    await g.act('check');
    const finalState = await g.act('check');
    expect(finalState.game?.status).toBe('hand-settled');
    expect(finalState.game?.hand.board).toHaveLength(5);

    // Both finalists reveal holeCards & handEvaluation on both peers' payloads
    for (const hp of finalState.game!.hand.players) {
      expect(hp.holeCards).toHaveLength(2);
      expect(hp.handEvaluation?.label).toBeTruthy();
      expect(Object.values(HAND_RANK_LABELS)).toContain(hp.handEvaluation!.label);
    }

    await waitFor(() => receivedByP1.some(s => s.revision === finalState.revision));
    const p1Broadcast = receivedByP1.find(s => s.revision === finalState.revision)!;
    const parsed = roomStateSchema.parse(p1Broadcast);
    expect(parsed.game?.status).toBe('hand-settled');
    expect(parsed.game!.hand.players.every(p => p.holeCards?.length === 2)).toBe(true);

    // Total chips conserved
    expect(finalState.game?.status).toBe('hand-settled');
    if (finalState.game?.status === 'hand-settled') {
      expect(finalState.game.settlement.players.reduce((s, p) => s + p.chips, 0)).toBe(2000);
    }

    // Host advances to next hand -> fresh hole cards & empty board
    const nextHand = await g.nextHand();
    expect(nextHand.game?.status).toBe('hand-active');
    expect(nextHand.game?.hand.street).toBe('preflop');
    expect(nextHand.game?.hand.board).toEqual([]);
  });

  it('runs out 5 board cards on early preflop all-in and hides winner cards on fold wins', async () => {
    await setupVirtual(2);

    // Preflop fold: settles without exposing survivor cards to folder
    const folded = await g.act('fold');
    expect(folded.game?.status).toBe('hand-settled');
    expect(folded.game?.hand.status).toBe('hand_ended_by_fold');

    const p0State = await g.sync(g.sockets[0]);
    const p1State = await g.sync(g.sockets[1]);
    const p0Id = g.admissions[0]!.credentials.playerId;
    const p1Id = g.admissions[1]!.credentials.playerId;

    // P0 folded: P0 must NOT see P1's winning hole cards!
    expect(p0State.game!.hand.players.find(p => p.id === p1Id)!.holeCards).toBeUndefined();
    expect(p0State.game!.hand.players.find(p => p.id === p1Id)!.handEvaluation).toBeUndefined();
    // P1 still sees P1's own hole cards
    expect(p1State.game!.hand.players.find(p => p.id === p1Id)!.holeCards).toHaveLength(2);
    expect(p1State.game!.hand.players.find(p => p.id === p0Id)!.holeCards).toBeUndefined();

    // Next hand: preflop all-in runout completes all 5 cards immediately -> game-complete or split hand-settled
    await g.nextHand();
    await g.act('all-in');
    const afterAllIn = await g.act('call');
    expect(['hand-settled', 'game-complete']).toContain(afterAllIn.game?.status);
    expect(afterAllIn.game?.hand.status).toBe('showdown');
    expect(afterAllIn.game?.hand.board).toHaveLength(5);
    expect(afterAllIn.game!.hand.players.every(p => p.holeCards?.length === 2 && p.handEvaluation !== undefined)).toBe(true);
  });

  it('projects live handEvaluation per active viewer across preflop, flop, turn, river and hides after fold', async () => {
    const { code } = await setupVirtual(3);
    const ids = g.admissions.map(a => a.credentials.playerId);

    const assertViewerProjection = async (viewerIdx: number, expectedBoardLen: number) => {
      const state = await g.sync(g.sockets[viewerIdx]);
      const hand = state.game!.hand;
      expect(hand.board).toHaveLength(expectedBoardLen);
      const viewerId = ids[viewerIdx]!;
      for (const p of hand.players) {
        if (p.id === viewerId && !p.folded) {
          expect(p.holeCards).toHaveLength(2);
          const expected = evaluateBestHand(p.holeCards as [Card, Card], hand.board ?? []);
          expect(p.handEvaluation).toEqual({
            category: expected.category,
            label: expected.label,
          });
        } else {
          expect(p.handEvaluation).toBeUndefined();
        }
      }
    };

    // Preflop: all 3 active players see only their own 2-card handEvaluation; HTTP spectator sees none
    for (let i = 0; i < 3; i += 1) {
      await assertViewerProjection(i, 0);
    }
    const spectator = await fetch(`${g.base}/api/rooms/${code}`).then(r => r.json()) as { ok: boolean; data: RoomState };
    expect(spectator.data.game!.hand.players.every(p => p.handEvaluation === undefined)).toBe(true);

    // P0 folds preflop: P0 loses handEvaluation (folded), P1 & P2 keep theirs
    await g.act('fold');
    await assertViewerProjection(0, 0);
    expect((await g.sync(g.sockets[0])).game!.hand.players.find(p => p.id === ids[0])!.handEvaluation).toBeUndefined();
    await assertViewerProjection(1, 0);

    // Complete preflop -> Flop (3 board cards)
    await g.act('call');
    await g.act('check');
    await assertViewerProjection(1, 3);
    await assertViewerProjection(2, 3);
    await assertViewerProjection(0, 3);

    // Flop -> Turn (4 board cards)
    await g.act('check');
    await g.act('check');
    await assertViewerProjection(1, 4);
    await assertViewerProjection(2, 4);

    // Turn -> River (5 board cards)
    await g.act('check');
    await g.act('check');
    await assertViewerProjection(1, 5);
    await assertViewerProjection(2, 5);
  });

  it('supports switching deckMode via reset-game', async () => {
    await setupVirtual(2);
    await g.act('fold');

    const resetToPhysical = ok(
      await g.command(0, {
        type: 'reset-game',
        config: {
          startingChips: 500,
          smallBlind: 5,
          bigBlind: 10,
          deckMode: 'physical',
        },
      }),
    );
    expect(resetToPhysical.config.deckMode).toBe('physical');
    expect(resetToPhysical.game).toBeNull();

    const physicalStarted = ok(await g.command(0, { type: 'start-game' }));
    expect(physicalStarted.game?.hand.board).toBeUndefined();
    expect(physicalStarted.game?.hand.players[0]?.holeCards).toBeUndefined();
  });
});
