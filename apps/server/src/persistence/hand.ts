import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { startHandFlow, type HandFlowState } from '@poker-table/engine';
import type { RoomConfig } from '@poker-table/protocol';
import { RoomError } from '../errors.js';

const chips = z.number().int().nonnegative();
const seat = z.number().int().min(1).max(10);
const ids = z.array(z.uuid()).max(10);
const player = z.strictObject({
  id: z.uuid(), seat, chips, committed: chips, isAllIn: z.boolean(),
});
const positions = { dealerSeat: seat, smallBlindSeat: seat, bigBlindSeat: seat };
const blinds = { smallBlind: chips.positive(), bigBlind: chips.positive() };
const actor = { currentActorId: z.uuid().nullable() };
const initial = z.strictObject({
  players: z.array(player).min(2).max(10), participatingPlayers: z.array(player).min(2).max(10),
  ...positions, ...blinds, pot: chips,
  preFlopOrder: ids, postFlopOrder: ids, preFlopActionOrder: ids, postFlopActionOrder: ids,
  preFlopActionPlayers: z.array(player).max(10), postFlopActionPlayers: z.array(player).max(10), ...actor,
});
const round = z.strictObject({
  players: z.array(player.extend({ folded: z.boolean(), lastActionBet: chips.nullable() })).min(2).max(10),
  currentBet: chips, minRaiseIncrement: chips.positive(), lastRaiseIncrement: chips.positive(),
  pot: chips, ...actor, playersToAct: ids, status: z.enum(['active', 'completed', 'hand_ended_by_fold']),
  ...blinds, ...positions, handState: initial,
});
// v1 stores only an initial hand. Future network actions require an explicit format evolution.
const persisted = z.strictObject({
  version: z.literal(1), status: z.literal('hand-active'),
  hand: z.strictObject({
    street: z.literal('preflop'), currentRound: round,
    players: z.array(z.strictObject({
      id: z.uuid(), seat, chips, roundCommitted: chips, totalCommitted: chips, committed: chips,
      isAllIn: z.boolean(), folded: z.literal(false), baseCommitted: z.literal(0),
    })).min(2).max(10),
    ...positions, ...blinds, pot: chips, status: z.enum(['in_progress', 'showdown']),
    handState: initial, ...actor, playersToAct: ids, survivorId: z.null(),
  }),
});

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
    players: participants
      .filter(p => p.seat !== null)
      .map(p => ({
        id: p.id,
        seat: p.seat!,
        chips: config.startingChips,
      })),
    blinds: {
      smallBlind: config.smallBlind,
      bigBlind: config.bigBlind,
    },
  });

  if (!isDeepStrictEqual(hand, expected)) fail();
}

export function encodeHand(hand: HandFlowState, config: RoomConfig, participants: readonly { id: string; seat: number | null }[]): string {
  const encoded = JSON.stringify({ version: 1, status: 'hand-active', hand });
  decodeHand(encoded, config, participants); // Validate before any write is committed.
  return encoded;
}

export function decodeHand(raw: string, config: RoomConfig, participants: readonly { id: string; seat: number | null }[]): HandFlowState {
  try {
    const { hand } = persisted.parse(JSON.parse(raw));
    verify(hand, config, participants);
    // Restore immutable state without running initialization or charging blinds again.
    return freeze(hand);
  } catch {
    throw new RoomError('STORAGE_ERROR', 'Estado persistido da partida inválido ou incompatível. Verifique o banco do servidor.');
  }
}
