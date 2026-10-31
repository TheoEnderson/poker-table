import { EngineError } from './errors.js';
import { initHand } from './hand.js';
import { buildPots } from './pot.js';
import { applyAction, createPreFlopRound } from './round.js';
import { getClockwiseOrderFromDealer } from './settlement.js';
import type {
  HandFlowPlayer,
  HandFlowState,
  HandFlowStatus,
  HandState,
  InitHandParams,
  PlayerAction,
  Pot,
  PotPlayerInput,
  RoundPlayer,
  RoundState,
  RoundStatus,
  Street,
} from './types.js';

/**
 * Cria uma rodada de apostas pós-flop (flop, turn ou river).
 *
 * Regras:
 * - currentBet começa em 0.
 * - minRaiseIncrement começa no valor nominal do big blind.
 * - Nenhuma nova blind é cobrada.
 * - O primeiro jogador elegível a agir é o primeiro ativo à esquerda do dealer, no sentido horário.
 * - Jogadores que deram fold ou estão all-in não participam das ações.
 */
function createPostFlopRound(
  state: HandFlowState,
): RoundState {
  const roundPlayers: RoundPlayer[] = state.players.map(p => Object.freeze({
    id: p.id,
    seat: p.seat,
    chips: p.chips,
    committed: 0,
    isAllIn: p.isAllIn,
    folded: p.folded,
    lastActionBet: null,
    ...(p.name !== undefined ? { name: p.name } : {}),
  }));

  const clockwisePlayers = getClockwiseOrderFromDealer(roundPlayers, state.dealerSeat);
  const postFlopActors = clockwisePlayers
    .filter(p => !p.folded && !p.isAllIn && p.chips > 0)
    .map(p => p.id);

  const activePlayers = roundPlayers.filter(p => !p.folded);
  const activeWithChips = activePlayers.filter(p => p.chips > 0);

  let roundStatus: RoundStatus = 'active';
  let playersToAct: string[] = postFlopActors;
  let currentActorId: string | null = postFlopActors[0] ?? null;

  if (activePlayers.length <= 1) {
    roundStatus = 'hand_ended_by_fold';
    playersToAct = [];
    currentActorId = null;
  } else if (activeWithChips.length <= 1 || postFlopActors.length === 0) {
    roundStatus = 'completed';
    playersToAct = [];
    currentActorId = null;
  }

  const roundState: RoundState = {
    players: Object.freeze(roundPlayers),
    currentBet: 0,
    minRaiseIncrement: state.bigBlind,
    lastRaiseIncrement: state.bigBlind,
    pot: state.pot,
    currentActorId,
    playersToAct: Object.freeze(playersToAct),
    status: roundStatus,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    dealerSeat: state.dealerSeat,
    smallBlindSeat: state.smallBlindSeat,
    bigBlindSeat: state.bigBlindSeat,
    handState: state.handState,
  };

  return Object.freeze(roundState);
}

/**
 * Inicializa a coordenação do fluxo de uma mão de Texas Hold'em a partir
 * dos parâmetros iniciais da mesa ou de um HandState já configurado.
 */
export function startHandFlow(input: InitHandParams | HandState): HandFlowState {
  if (typeof input !== 'object' || input === null) {
    throw new EngineError('INVALID_INPUT', 'Configuração da mão inválida.');
  }

  const handState: HandState = 'preFlopOrder' in input ? input : initHand(input);
  const currentRound = createPreFlopRound(handState);

  const players: HandFlowPlayer[] = handState.players.map(p => {
    const roundPlayer = currentRound.players.find(rp => rp.id === p.id)!;
    return Object.freeze({
      id: p.id,
      seat: p.seat,
      chips: roundPlayer.chips,
      roundCommitted: roundPlayer.committed,
      totalCommitted: roundPlayer.committed,
      committed: roundPlayer.committed,
      isAllIn: roundPlayer.isAllIn,
      folded: roundPlayer.folded,
      baseCommitted: 0,
      ...(p.name !== undefined ? { name: p.name } : {}),
    });
  });

  const activePlayers = players.filter(p => !p.folded);
  const activeWithChips = activePlayers.filter(p => p.chips > 0);

  let status: HandFlowStatus = 'in_progress';
  let survivorId: string | null = null;

  if (activePlayers.length <= 1) {
    status = 'hand_ended_by_fold';
    survivorId = activePlayers[0]?.id ?? null;
  } else if (currentRound.status === 'completed' && activeWithChips.length <= 1) {
    status = 'showdown';
  }

  return Object.freeze({
    street: 'preflop',
    currentRound,
    players: Object.freeze(players),
    dealerSeat: handState.dealerSeat,
    smallBlindSeat: handState.smallBlindSeat,
    bigBlindSeat: handState.bigBlindSeat,
    smallBlind: handState.smallBlind,
    bigBlind: handState.bigBlind,
    pot: currentRound.pot,
    status,
    handState,
    currentActorId: status === 'in_progress' ? currentRound.currentActorId : null,
    playersToAct: status === 'in_progress' ? currentRound.playersToAct : Object.freeze([]),
    survivorId,
  });
}

/**
 * Aplica uma ação de aposta à street atual da mão e sincroniza as
 * contribuições e pilhas acumuladas.
 */
export function applyHandAction(
  state: HandFlowState,
  action: PlayerAction,
): HandFlowState {
  if (typeof state !== 'object' || state === null) {
    throw new EngineError('INVALID_INPUT', 'Estado da mão inválido.');
  }

  if (state.status === 'hand_ended_by_fold') {
    throw new EngineError(
      'HAND_ALREADY_COMPLETED',
      'A mão já foi encerrada por fold e não aceita mais ações.',
    );
  }

  if (state.status === 'showdown') {
    throw new EngineError(
      'HAND_ALREADY_COMPLETED',
      'A mão já alcançou o showdown e não aceita mais ações.',
    );
  }

  if (state.currentRound.status !== 'active') {
    throw new EngineError(
      'ROUND_NOT_ACTIVE',
      `A rodada de apostas de ${state.street} não está ativa.`,
    );
  }

  const normalizedAction: PlayerAction =
    (action.type as string) === 'bet'
      ? { ...action, type: 'raise' }
      : action;

  const nextRound = applyAction(state.currentRound, normalizedAction);

  const updatedPlayers: HandFlowPlayer[] = state.players.map(p => {
    const roundPlayer = nextRound.players.find(rp => rp.id === p.id);
    if (!roundPlayer) return p;

    const roundCommitted = roundPlayer.committed;
    const totalCommitted = p.baseCommitted + roundCommitted;

    return Object.freeze({
      id: p.id,
      seat: p.seat,
      chips: roundPlayer.chips,
      roundCommitted,
      totalCommitted,
      committed: roundCommitted,
      isAllIn: roundPlayer.isAllIn,
      folded: roundPlayer.folded,
      baseCommitted: p.baseCommitted,
      ...(p.name !== undefined ? { name: p.name } : {}),
    });
  });

  const activePlayers = updatedPlayers.filter(p => !p.folded);
  const activeWithChips = activePlayers.filter(p => p.chips > 0);

  let nextStatus: HandFlowStatus = 'in_progress';
  let survivorId: string | null = state.survivorId ?? null;

  if (nextRound.status === 'hand_ended_by_fold' || activePlayers.length <= 1) {
    nextStatus = 'hand_ended_by_fold';
    survivorId = activePlayers[0]?.id ?? null;
  } else if (nextRound.status === 'completed' && activeWithChips.length <= 1) {
    nextStatus = 'showdown';
  }

  return Object.freeze({
    street: state.street,
    currentRound: nextRound,
    players: Object.freeze(updatedPlayers),
    dealerSeat: state.dealerSeat,
    smallBlindSeat: state.smallBlindSeat,
    bigBlindSeat: state.bigBlindSeat,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    pot: nextRound.pot,
    status: nextStatus,
    handState: state.handState,
    currentActorId: nextStatus === 'in_progress' ? nextRound.currentActorId : null,
    playersToAct: nextStatus === 'in_progress' ? nextRound.playersToAct : Object.freeze([]),
    survivorId,
  });
}

/**
 * Informa se a street atual está pronta para ser avançada.
 */
export function canAdvanceStreet(state: HandFlowState): boolean {
  if (state.status !== 'in_progress') return false;
  return state.currentRound.status === 'completed';
}

/**
 * Avança o fluxo da mão para a próxima street (pré-flop -> flop -> turn -> river -> showdown).
 */
export function advanceStreet(state: HandFlowState): HandFlowState {
  if (typeof state !== 'object' || state === null) {
    throw new EngineError('INVALID_INPUT', 'Estado da mão inválido.');
  }

  if (state.status === 'hand_ended_by_fold') {
    throw new EngineError(
      'HAND_ALREADY_COMPLETED',
      'A mão já foi encerrada por desistência dos adversários.',
    );
  }

  if (state.status === 'showdown') {
    throw new EngineError(
      'HAND_ALREADY_COMPLETED',
      'A mão já alcançou o showdown e não permite novos avanços de street.',
    );
  }

  if (state.currentRound.status === 'active') {
    throw new EngineError(
      'CANNOT_ADVANCE_STREET',
      `Não é possível avançar a street: a rodada de ${state.street} ainda está ativa com apostas pendentes.`,
    );
  }

  // Se restam menos de 2 jogadores com fichas para apostar, avança diretamente ao showdown
  const activePlayers = state.players.filter(p => !p.folded);
  const activeWithChips = activePlayers.filter(p => p.chips > 0);
  if (activeWithChips.length <= 1) {
    return Object.freeze({
      ...state,
      status: 'showdown',
      currentActorId: null,
      playersToAct: Object.freeze([]),
    });
  }

  let nextStreet: Street;
  if (state.street === 'preflop') {
    nextStreet = 'flop';
  } else if (state.street === 'flop') {
    nextStreet = 'turn';
  } else if (state.street === 'turn') {
    nextStreet = 'river';
  } else if (state.street === 'river') {
    return Object.freeze({
      ...state,
      status: 'showdown',
      currentActorId: null,
      playersToAct: Object.freeze([]),
    });
  } else {
    throw new EngineError('INVALID_STREET', `Street inválida: ${String(state.street)}.`);
  }

  const nextRound = createPostFlopRound(state);

  const updatedPlayers: HandFlowPlayer[] = state.players.map(p => {
    const rPlayer = nextRound.players.find(rp => rp.id === p.id)!;
    return Object.freeze({
      id: p.id,
      seat: p.seat,
      chips: rPlayer.chips,
      roundCommitted: 0,
      totalCommitted: p.totalCommitted,
      committed: 0,
      isAllIn: rPlayer.isAllIn,
      folded: p.folded,
      baseCommitted: p.totalCommitted,
      ...(p.name !== undefined ? { name: p.name } : {}),
    });
  });

  const nextActive = updatedPlayers.filter(p => !p.folded);
  const nextActiveWithChips = nextActive.filter(p => p.chips > 0);

  let nextStatus: HandFlowStatus = 'in_progress';
  if (nextRound.status === 'completed' && nextActiveWithChips.length <= 1) {
    nextStatus = 'showdown';
  }

  return Object.freeze({
    street: nextStreet,
    currentRound: nextRound,
    players: Object.freeze(updatedPlayers),
    dealerSeat: state.dealerSeat,
    smallBlindSeat: state.smallBlindSeat,
    bigBlindSeat: state.bigBlindSeat,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    pot: nextRound.pot,
    status: nextStatus,
    handState: state.handState,
    currentActorId: nextStatus === 'in_progress' ? nextRound.currentActorId : null,
    playersToAct: nextStatus === 'in_progress' ? nextRound.playersToAct : Object.freeze([]),
    survivorId: state.survivorId ?? null,
  });
}

/**
 * Adaptador para extrair jogadores com contribuição total acumulada
 * no formato esperado por buildPots.
 */
export function getHandFlowPotPlayers(state: HandFlowState): readonly PotPlayerInput[] {
  return Object.freeze(
    state.players.map(p =>
      Object.freeze({
        id: p.id,
        committed: p.totalCommitted,
        folded: p.folded,
      }),
    ),
  );
}

/**
 * Constrói os potes principais e paralelos a partir do estado acumulado de toda a mão.
 */
export function buildHandFlowPots(state: HandFlowState): readonly Pot[] {
  return buildPots(state);
}

// Funções de conveniência para ações de aposta
export function handFold(state: HandFlowState, playerId?: string): HandFlowState {
  const actor = playerId ?? state.currentActorId;
  if (!actor) {
    throw new EngineError('ROUND_NOT_ACTIVE', 'Não há jogador autorizado a agir.');
  }
  return applyHandAction(state, { playerId: actor, type: 'fold' });
}

export function handCheck(state: HandFlowState, playerId?: string): HandFlowState {
  const actor = playerId ?? state.currentActorId;
  if (!actor) {
    throw new EngineError('ROUND_NOT_ACTIVE', 'Não há jogador autorizado a agir.');
  }
  return applyHandAction(state, { playerId: actor, type: 'check' });
}

export function handCall(state: HandFlowState, playerId?: string): HandFlowState {
  const actor = playerId ?? state.currentActorId;
  if (!actor) {
    throw new EngineError('ROUND_NOT_ACTIVE', 'Não há jogador autorizado a agir.');
  }
  return applyHandAction(state, { playerId: actor, type: 'call' });
}

export function handRaise(state: HandFlowState, amount: number, playerId?: string): HandFlowState {
  const actor = playerId ?? state.currentActorId;
  if (!actor) {
    throw new EngineError('ROUND_NOT_ACTIVE', 'Não há jogador autorizado a agir.');
  }
  return applyHandAction(state, { playerId: actor, type: 'raise', amount });
}

export function handAllIn(state: HandFlowState, playerId?: string): HandFlowState {
  const actor = playerId ?? state.currentActorId;
  if (!actor) {
    throw new EngineError('ROUND_NOT_ACTIVE', 'Não há jogador autorizado a agir.');
  }
  return applyHandAction(state, { playerId: actor, type: 'all-in' });
}
