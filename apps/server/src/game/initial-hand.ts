import { buildPots, canAdvanceStreet, EngineError, getAllowedActions, startHandFlow, type HandFlowState } from '@poker-table/engine';
import { configSchema, gameStateSchema, handSnapshotSchema, computeBlindsState, type GameState, type RoomConfig, type RoomState } from '@poker-table/protocol';
import { RoomError } from '../errors.js';
import { publicSettlement } from './settlement.js';
import type { StoredGame } from '../persistence/hand.js';

export function initializeHand(players: RoomState['players'], input: RoomConfig): HandFlowState {
  const config = configSchema.parse(input);
  const seated = players.filter(p => p.seat !== null);
  if (players.length > config.maxPlayers || seated.length > 10) throw new RoomError('INVALID_INPUT', 'Quantidade de participantes inválida.');
  if (seated.length < 2) throw new RoomError('INSUFFICIENT_PLAYERS', 'São necessários pelo menos dois participantes sentados.');
  if (seated.some(p => !p.connected)) throw new RoomError('PLAYERS_DISCONNECTED', 'Todos os participantes sentados precisam estar conectados para iniciar.');
  if (seated.some(p => p.seat! > config.maxPlayers)) throw new RoomError('INVALID_INPUT', 'Posição fora dos limites desta mesa.');
  if (config.startingChips > Math.floor(Number.MAX_SAFE_INTEGER / seated.length)) throw new RoomError('INVALID_INPUT', 'A soma das fichas excede o limite seguro.');
  try {
    return startHandFlow({
      players: seated.map(p => ({ id: p.id, seat: p.seat!, chips: config.startingChips })),
      blinds: { smallBlind: config.smallBlind, bigBlind: config.bigBlind },
    });
  } catch (error) {
    if (error instanceof EngineError) throw new RoomError('INVALID_INPUT', 'Configuração ou participantes inválidos para iniciar a mão.');
    throw error;
  }
}

export function publicHand(hand: HandFlowState) {
  const allowed = hand.status === 'in_progress' ? getAllowedActions(hand) : null;
  const isEndState = hand.status === 'showdown' || hand.status === 'hand_ended_by_fold';
  const pots = isEndState ? buildPots(hand) : undefined;
  const survivorId = hand.survivorId ?? (hand.status === 'hand_ended_by_fold' ? hand.players.find(p => !p.folded)?.id ?? null : null);

  return handSnapshotSchema.parse({
    street: hand.street, status: hand.status,
    players: hand.players.map(p => ({
      id: p.id, seat: p.seat, chips: p.chips, roundCommitted: p.roundCommitted,
      totalCommitted: p.totalCommitted, folded: p.folded, isAllIn: p.isAllIn,
    })),
    dealerSeat: hand.dealerSeat, smallBlindSeat: hand.smallBlindSeat, bigBlindSeat: hand.bigBlindSeat,
    smallBlind: hand.smallBlind, bigBlind: hand.bigBlind, pot: hand.pot,
    currentActorId: hand.currentActorId, playersToAct: [...hand.playersToAct],
    allowedActions: allowed,
    canAdvanceStreet: canAdvanceStreet(hand),
    pots: pots?.map(pot => ({
      id: pot.id,
      type: pot.type,
      index: pot.index,
      amount: pot.amount,
      eligiblePlayers: [...pot.eligiblePlayers],
    })),
    survivorId,
    actions: hand.actions ? [...hand.actions] : [],
  });
}

export function publicGame(game: StoredGame | HandFlowState, config?: RoomConfig): GameState {
  const blindsTracker = 'blindsTracker' in game ? game.blindsTracker : undefined;
  const currentHand = 'street' in game ? game : game.hand;
  const blindsState = config ? computeBlindsState(config.blindsStructure, blindsTracker, {
    smallBlind: currentHand.smallBlind,
    bigBlind: currentHand.bigBlind,
  }) : undefined;

  if ('street' in game) {
    return gameStateSchema.parse({
      status: 'hand-active',
      hand: publicHand(game),
      blindsState,
    });
  }
  switch (game.status) {
    case 'hand-active':
      return gameStateSchema.parse({
        status: 'hand-active',
        hand: publicHand(game.hand),
        admittedPlayerIds: game.admittedPlayerIds ? [...game.admittedPlayerIds] : undefined,
        blindsState,
      });
    case 'hand-settled':
      return gameStateSchema.parse({
        status: 'hand-settled',
        hand: publicHand(game.hand),
        settlement: publicSettlement(game.settlement),
        admittedPlayerIds: game.admittedPlayerIds ? [...game.admittedPlayerIds] : undefined,
        blindsState,
      });
    case 'game-complete':
      return gameStateSchema.parse({
        status: 'game-complete',
        hand: publicHand(game.hand),
        settlement: publicSettlement(game.settlement),
        winnerId: game.winnerId,
        admittedPlayerIds: game.admittedPlayerIds ? [...game.admittedPlayerIds] : undefined,
        blindsState,
      });
  }
}
