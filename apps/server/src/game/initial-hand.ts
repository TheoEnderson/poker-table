import { buildPots, canAdvanceStreet, EngineError, getAllowedActions, startHandFlow, type HandFlowState } from '@poker-table/engine';
import { configSchema, gameStateSchema, handSnapshotSchema, computeBlindsState, type GameState, type RoomConfig, type RoomState } from '@poker-table/protocol';
import { RoomError } from '../errors.js';
import { evaluateBestHand, toPublicEvaluation } from './evaluator.js';
import { publicSettlement } from './settlement.js';
import type { StoredGame } from '../persistence/hand.js';
import type { VirtualHandState } from '../persistence/hand-schema.js';

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

interface PublicHandProjectionOptions {
  virtual?: VirtualHandState;
  viewerId?: string;
  revealShowdown?: boolean;
}

export function publicHand(hand: HandFlowState, options?: PublicHandProjectionOptions) {
  const allowed = hand.status === 'in_progress' ? getAllowedActions(hand) : null;
  const isEndState = hand.status === 'showdown' || hand.status === 'hand_ended_by_fold';
  const pots = isEndState ? buildPots(hand) : undefined;
  const survivorId = hand.survivorId ?? (hand.status === 'hand_ended_by_fold' ? hand.players.find(p => !p.folded)?.id ?? null : null);
  const virtual = options?.virtual;
  const viewerId = options?.viewerId;
  const revealShowdown = options?.revealShowdown ?? false;

  return handSnapshotSchema.parse({
    street: hand.street, status: hand.status,
    players: hand.players.map(p => {
      if (!virtual) {
        return {
          id: p.id, seat: p.seat, chips: p.chips, roundCommitted: p.roundCommitted,
          totalCommitted: p.totalCommitted, folded: p.folded, isAllIn: p.isAllIn,
        };
      }
      const isShowdownFinalist = revealShowdown && !p.folded;
      const canSeeHoleCards = isShowdownFinalist || (viewerId !== undefined && p.id === viewerId);
      const playerHoleCards = canSeeHoleCards ? virtual.holeCards[p.id] : undefined;
      let evaluation = isShowdownFinalist ? virtual.evaluations?.[p.id] : undefined;
      if (
        evaluation === undefined
        && !revealShowdown
        && hand.status === 'in_progress'
        && viewerId !== undefined
        && p.id === viewerId
        && !p.folded
        && playerHoleCards
        && (virtual.board.length === 0 || (virtual.board.length >= 3 && virtual.board.length <= 5))
      ) {
        evaluation = toPublicEvaluation(evaluateBestHand(playerHoleCards, virtual.board));
      }
      return {
        id: p.id, seat: p.seat, chips: p.chips, roundCommitted: p.roundCommitted,
        totalCommitted: p.totalCommitted, folded: p.folded, isAllIn: p.isAllIn,
        hasCards: !p.folded,
        ...(playerHoleCards ? { holeCards: [{ ...playerHoleCards[0] }, { ...playerHoleCards[1] }] } : {}),
        ...(evaluation ? { handEvaluation: { ...evaluation } } : {}),
      };
    }),
    ...(virtual ? { board: virtual.board.map(card => ({ ...card })) } : {}),
    dealerSeat: hand.dealerSeat, smallBlindSeat: hand.smallBlindSeat, bigBlindSeat: hand.bigBlindSeat,
    smallBlind: hand.smallBlind, bigBlind: hand.bigBlind, pot: hand.pot,
    currentActorId: hand.currentActorId, playersToAct: [...hand.playersToAct],
    allowedActions: allowed,
    canAdvanceStreet: virtual ? false : canAdvanceStreet(hand),
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

export function publicGame(game: StoredGame | HandFlowState, config?: RoomConfig, viewerId?: string): GameState {
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
  const virtual = game.virtual;
  const revealShowdown = game.status !== 'hand-active' && game.hand.status === 'showdown';
  switch (game.status) {
    case 'hand-active': {
      const preActions = game.preActions && Object.keys(game.preActions).length > 0
        ? game.preActions
        : undefined;
      return gameStateSchema.parse({
        status: 'hand-active',
        hand: publicHand(game.hand, { virtual, viewerId, revealShowdown: false }),
        admittedPlayerIds: game.admittedPlayerIds ? [...game.admittedPlayerIds] : undefined,
        blindsState,
        ...(preActions !== undefined ? { preActions } : {}),
      });
    }
    case 'hand-settled':
      return gameStateSchema.parse({
        status: 'hand-settled',
        hand: publicHand(game.hand, { virtual, viewerId, revealShowdown }),
        settlement: publicSettlement(game.settlement),
        admittedPlayerIds: game.admittedPlayerIds ? [...game.admittedPlayerIds] : undefined,
        blindsState,
      });
    case 'game-complete':
      return gameStateSchema.parse({
        status: 'game-complete',
        hand: publicHand(game.hand, { virtual, viewerId, revealShowdown }),
        settlement: publicSettlement(game.settlement),
        winnerId: game.winnerId,
        admittedPlayerIds: game.admittedPlayerIds ? [...game.admittedPlayerIds] : undefined,
        blindsState,
      });
  }
}
