import { isDeepStrictEqual } from 'node:util';
import { persistedHandSchema } from './hand-schema.js';
import { verifyHandV2 } from './hand-v2.js';
import { startHandFlow, type HandFlowState } from '@poker-table/engine';
import type { RoomConfig } from '@poker-table/protocol';
import { RoomError } from '../errors.js';


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

export function encodeHand(hand: HandFlowState, config: RoomConfig, participants: readonly { id: string; seat: number | null }[], version: 1 | 2 = 1): string {
  const encoded = JSON.stringify({ version, status: 'hand-active', hand });
  decodeHand(encoded, config, participants); // Validate before any write is committed.
  return encoded;
}

export function decodeHand(raw: string, config: RoomConfig, participants: readonly { id: string; seat: number | null }[]): HandFlowState {
  try {
    const { version, hand } = persistedHandSchema.parse(JSON.parse(raw));
    if (version === 1) verify(hand, config, participants);
    else verifyHandV2(hand, config, participants);
    // Restore immutable state without running initialization or charging blinds again.
    return freeze(hand);
  } catch {
    throw new RoomError('STORAGE_ERROR', 'Estado persistido da partida inválido ou incompatível. Verifique o banco do servidor.');
  }
}
