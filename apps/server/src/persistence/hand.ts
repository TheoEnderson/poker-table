import { isDeepStrictEqual } from 'node:util';
import { persistedHandSchema } from './hand-schema.js';
import { verifyHandV2 } from './hand-v2.js';
import { verifyGameV3 } from './hand-v3.js';
import { startHandFlow, type HandFlowState, type SettlementResult, type PotWinnerDecision } from '@poker-table/engine';
import type { RoomConfig, BlindsTracker, PreAction } from '@poker-table/protocol';
import { RoomError } from '../errors.js';
import { normalizePreActions, verifyPersistedPreActions } from '../game/pre-actions.js';

export type StoredGame =
  | { version: 1 | 2; status: 'hand-active'; hand: HandFlowState; handNumber: 1; tableBudget: number; admittedPlayerIds?: readonly string[]; blindsTracker?: BlindsTracker; preActions?: Readonly<Record<string, PreAction>> }
  | { version: 3; status: 'hand-active'; hand: HandFlowState; handNumber: number; tableBudget: number; previousSettlement?: SettlementResult; admittedPlayerIds?: readonly string[]; blindsTracker?: BlindsTracker; preActions?: Readonly<Record<string, PreAction>> }
  | { version: 3; status: 'hand-settled'; hand: HandFlowState; settlement: SettlementResult; decisions: readonly PotWinnerDecision[]; handNumber: number; tableBudget: number; admittedPlayerIds?: readonly string[]; blindsTracker?: BlindsTracker }
  | { version: 3; status: 'game-complete'; hand: HandFlowState; settlement: SettlementResult; winnerId: string; decisions: readonly PotWinnerDecision[]; handNumber: number; tableBudget: number; admittedPlayerIds?: readonly string[]; blindsTracker?: BlindsTracker };


function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function verify(hand: HandFlowState, config: RoomConfig, participants: readonly { id: string; seat: number | null }[]) {
  const { players, handState: initialHand, currentRound: betting } = hand;
  const fail = () => { throw new Error('Invalid persisted initial hand'); };
  if (new Set(players.map(p => p.id)).size !== players.length || new Set(players.map(p => p.seat)).size !== players.length) fail();
  if (players.length > config.maxPlayers || players.some(p => p.seat > config.maxPlayers || !participants.some(q => q.id === p.id && q.seat === p.seat))) fail();
  if (hand.smallBlind !== config.smallBlind || hand.bigBlind !== config.bigBlind) fail();
  if (!isDeepStrictEqual(initialHand, betting.handState) || !isDeepStrictEqual(initialHand.players, initialHand.participatingPlayers)) fail();
  if (initialHand.players.length !== players.length || betting.players.length !== players.length) fail();
  for (const key of ['dealerSeat', 'smallBlindSeat', 'bigBlindSeat', 'smallBlind', 'bigBlind', 'pot'] as const) {
    if (hand[key] !== initialHand[key] || hand[key] !== betting[key]) fail();
  }
  for (const key of ['dealerSeat', 'smallBlindSeat', 'bigBlindSeat'] as const) if (!players.some(p => p.seat === hand[key])) fail();
  let total = 0, committed = 0;
  for (const [index, p] of players.entries()) {
    const initialPlayer = initialHand.players[index], roundPlayer = betting.players[index];
    if (p.id !== initialPlayer.id || p.id !== roundPlayer.id || p.seat !== initialPlayer.seat || p.seat !== roundPlayer.seat) fail();
    if (p.chips !== initialPlayer.chips || p.chips !== roundPlayer.chips || p.chips + p.totalCommitted !== config.startingChips) fail();
    if ([p.roundCommitted, p.committed, initialPlayer.committed, roundPlayer.committed].some(n => n !== p.totalCommitted)) fail();
    if (p.isAllIn !== (p.chips === 0) || p.isAllIn !== initialPlayer.isAllIn || p.isAllIn !== roundPlayer.isAllIn || roundPlayer.folded) fail();
    if (index > 0 && players[index - 1].seat >= p.seat) fail();
    total += p.chips + p.totalCommitted;
    committed += p.totalCommitted;
    if (!Number.isSafeInteger(total) || !Number.isSafeInteger(committed)) fail();
  }
  if (committed !== hand.pot) fail();
  for (const order of [hand.playersToAct, betting.playersToAct, initialHand.preFlopOrder, initialHand.postFlopOrder]) {
    if (new Set(order).size !== order.length || order.some(id => !players.some(p => p.id === id && !p.isAllIn))) fail();
  }
  if (!isDeepStrictEqual(initialHand.preFlopOrder, initialHand.preFlopActionOrder) || !isDeepStrictEqual(initialHand.postFlopOrder, initialHand.postFlopActionOrder)) fail();
  for (const [order, orderedPlayers] of [[initialHand.preFlopOrder, initialHand.preFlopActionPlayers], [initialHand.postFlopOrder, initialHand.postFlopActionPlayers]] as const) {
    if (!isDeepStrictEqual(order.map(id => initialHand.players.find(p => p.id === id)), orderedPlayers)) fail();
  }
  if (initialHand.currentActorId !== (initialHand.preFlopOrder[0] ?? null)) fail();
  if (betting.currentActorId !== (betting.playersToAct[0] ?? null)) fail();
  if ([betting.currentBet, betting.minRaiseIncrement, betting.lastRaiseIncrement].some(n => n !== hand.bigBlind)) fail();
  if (betting.players.some(p => p.lastActionBet !== null)) fail();
  if (betting.status === 'active') {
    if (hand.status !== 'in_progress' || betting.currentActorId === null || !isDeepStrictEqual(betting.playersToAct, initialHand.preFlopOrder)) fail();
  } else if (betting.status !== 'completed' || hand.status !== 'showdown' || betting.playersToAct.length !== 0) fail();
  if (hand.status === 'in_progress') {
    if (hand.currentActorId !== betting.currentActorId || !isDeepStrictEqual(hand.playersToAct, betting.playersToAct)) fail();
  } else if (hand.currentActorId !== null || hand.playersToAct.length !== 0 || betting.status !== 'completed') fail();

  // A versão 1 persiste exclusivamente a mão inicial.
  // Reconstrói uma referência temporária a partir dos dados autoritativos
  // da sala e compara todas as propriedades produzidas pelo motor.
  // A referência nunca substitui o estado salvo nem é persistida.
  const expected = startHandFlow({
    players: hand.players.map(p => ({
      id: p.id,
      seat: p.seat,
      chips: config.startingChips,
    })),
    blinds: {
      smallBlind: config.smallBlind,
      bigBlind: config.bigBlind,
    },
  });

  const { actions: handActions, ...handWithoutActions } = hand;
  const { actions: expectedActions, ...expectedWithoutActions } = expected;
  if (!isDeepStrictEqual(handWithoutActions, expectedWithoutActions)) fail();
  if (handActions && !isDeepStrictEqual(handActions, expectedActions)) fail();
}

export function encodeGame(game: StoredGame, config: RoomConfig, participants: readonly { id: string; seat: number | null }[]): string {
  const preActions = game.status === 'hand-active' ? normalizePreActions(game.preActions) : undefined;
  let payload: unknown;
  if (game.version === 1 || game.version === 2) {
    payload = {
      version: game.version,
      status: 'hand-active' as const,
      hand: game.hand,
      blindsTracker: game.blindsTracker,
      ...(preActions !== undefined ? { preActions } : {}),
    };
  } else if (game.status === 'hand-active') {
    payload = {
      ...game,
      preActions,
    };
  } else {
    payload = game;
  }
  const encoded = JSON.stringify(payload);
  decodeGame(encoded, config, participants); // Validate before any write is committed.
  return encoded;
}

export function encodeHand(hand: HandFlowState, config: RoomConfig, participants: readonly { id: string; seat: number | null }[], version: 1 | 2 = 1, blindsTracker?: BlindsTracker): string {
  const encoded = JSON.stringify({ version, status: 'hand-active', hand, blindsTracker });
  decodeHand(encoded, config, participants); // Validate before any write is committed.
  return encoded;
}

export function decodeGame(raw: string, config: RoomConfig, participants: readonly { id: string; seat: number | null }[]): StoredGame {
  try {
    const parsed = persistedHandSchema.parse(JSON.parse(raw));
    if (parsed.version === 1) {
      verify(parsed.hand, config, participants);
      const preActions = normalizePreActions(parsed.preActions);
      if (!verifyPersistedPreActions(parsed.hand, preActions)) throw new Error('Invalid persisted pre-actions');
      const admittedPlayerIds = parsed.hand.players.map(p => p.id);
      return freeze({
        version: 1,
        status: 'hand-active',
        hand: parsed.hand,
        handNumber: 1,
        tableBudget: config.startingChips * admittedPlayerIds.length,
        admittedPlayerIds,
        blindsTracker: parsed.blindsTracker,
        ...(preActions !== undefined ? { preActions } : {}),
      });
    }
    if (parsed.version === 2) {
      verifyHandV2(parsed.hand, config, participants);
      const preActions = normalizePreActions(parsed.preActions);
      if (!verifyPersistedPreActions(parsed.hand, preActions)) throw new Error('Invalid persisted pre-actions');
      const admittedPlayerIds = parsed.hand.players.map(p => p.id);
      return freeze({
        version: 2,
        status: 'hand-active',
        hand: parsed.hand,
        handNumber: 1,
        tableBudget: config.startingChips * admittedPlayerIds.length,
        admittedPlayerIds,
        blindsTracker: parsed.blindsTracker,
        ...(preActions !== undefined ? { preActions } : {}),
      });
    }
    verifyGameV3(parsed, config, participants);
    if (parsed.status === 'hand-active') {
      const preActions = normalizePreActions(parsed.preActions);
      if (!verifyPersistedPreActions(parsed.hand, preActions)) throw new Error('Invalid persisted pre-actions');
    }
    return freeze(parsed as StoredGame);
  } catch {
    throw new RoomError('STORAGE_ERROR', 'Estado persistido da partida inválido ou incompatível. Verifique o banco do servidor.');
  }


}

export function decodeHand(raw: string, config: RoomConfig, participants: readonly { id: string; seat: number | null }[]): HandFlowState {
  return decodeGame(raw, config, participants).hand;
}
