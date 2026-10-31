import { EngineError } from './errors.js';
import type {
  HandState,
  PlayerAction,
  RoundPlayer,
  RoundState,
  RoundStatus,
} from './types.js';

/**
 * Devolve a parcela de uma contribuição que nenhum outro jogador igualou.
 * Executada somente quando a rodada termina.
 */
function settleUncalled(state: RoundState): RoundState {
  if (state.status === 'active') return state;

  const ordered = [...state.players].sort(
    (a, b) => b.committed - a.committed,
  );

  const highest = ordered[0];
  const second = ordered[1];

  if (
    !highest ||
    !second ||
    highest.folded ||
    highest.committed <= second.committed
  ) {
    return state;
  }

  const refund = highest.committed - second.committed;

  return {
    ...state,
    pot: state.pot - refund,
    players: state.players.map(player =>
      player.id === highest.id
        ? {
            ...player,
            chips: player.chips + refund,
            committed: player.committed - refund,
            isAllIn: false,
          }
        : player,
    ),
  };
}

function freezeRoundState(state: RoundState): RoundState {
  const settled = settleUncalled(state);

  for (const p of settled.players) {
    Object.freeze(p);
  }

  Object.freeze(settled.players);
  Object.freeze(settled.playersToAct);

  return Object.freeze(settled);
}

export function canPlayerRaise(state: RoundState, playerId: string): boolean {
  if (state.status !== 'active') return false;
  const player = state.players.find(p => p.id === playerId);
  if (!player || player.folded || player.isAllIn || player.chips <= 0) return false;

  // Não há raise possível se nenhum adversário puder responder.
  const hasOpponentWithChips = state.players.some(
    opponent =>
      opponent.id !== playerId &&
      !opponent.folded &&
      !opponent.isAllIn &&
      opponent.chips > 0,
  );

  if (!hasOpponentWithChips) return false;

  // Se o jogador ainda não agiu no pré-flop, tem direito total a raise
  if (player.lastActionBet === null) return true;

  // Regra 49 Poker TDA 2026: a ação é reaberta se o aumento acumulado desde a última ação for >= minRaiseIncrement
  return state.currentBet - player.lastActionBet >= state.minRaiseIncrement;
}

export function getMinRaiseAmount(state: RoundState): number {
  return state.currentBet + state.minRaiseIncrement;
}

export function createPreFlopRound(handState: HandState): RoundState {
  if (typeof handState !== 'object' || handState === null) {
    throw new EngineError('INVALID_INPUT', 'Estado da mão inicial inválido.');
  }

  const players: RoundPlayer[] = handState.players.map(p => ({
    id: p.id,
    seat: p.seat,
    chips: p.chips,
    committed: p.committed,
    isAllIn: p.isAllIn,
    folded: false,
    lastActionBet: null,
    ...(p.name !== undefined ? { name: p.name } : {}),
  }));

  // No pré-flop, a aposta inicial a igualar considera o valor nominal do big blind,
  // inclusive quando o BB possui fichas insuficientes para pagá-lo integralmente.
  const currentBet = handState.bigBlind;
  const minRaiseIncrement = handState.bigBlind;
  const pot = handState.pot;

  // Candidatos a agir na ordem circular pré-flop: apenas jogadores que possuem fichas e não estão all-in
  const preFlopCandidates = handState.preFlopOrder.filter(id => {
    const p = players.find(player => player.id === id);
    return p !== undefined && !p.isAllIn && p.chips > 0;
  });

  const activePlayersWithChips = players.filter(p => !p.folded && p.chips > 0);

  const lonePlayer = activePlayersWithChips.length === 1
    ? activePlayersWithChips[0]
    : undefined;

  const highestOpponentCommitment = lonePlayer
    ? players.reduce(
        (max, opponent) =>
          opponent.id !== lonePlayer.id && !opponent.folded
            ? Math.max(max, opponent.committed)
            : max,
        0,
      )
    : 0;

  let status: RoundStatus = 'active';
  let playersToAct: string[] = [];
  let currentActorId: string | null = null;

  // Regra: "Não exigir apostas adicionais quando não houver possibilidade de disputa entre jogadores capazes de apostar."
  if (activePlayersWithChips.length === 0) {
    // Todos os jogadores na mesa estão all-in desde os blinds
    status = 'completed';
    playersToAct = [];
    currentActorId = null;
  } else if (
    lonePlayer !== undefined &&
    lonePlayer.committed >= highestOpponentCommitment
  ) {
    // Apenas 1 jogador possui fichas e já cobriu a aposta; adversários estão todos all-in
    status = 'completed';
    playersToAct = [];
    currentActorId = null;
  } else {
    playersToAct = preFlopCandidates;
    currentActorId = playersToAct[0] ?? null;
    if (playersToAct.length === 0) {
      status = 'completed';
      currentActorId = null;
    }
  }

  return freezeRoundState({
    players,
    currentBet,
    minRaiseIncrement,
    lastRaiseIncrement: minRaiseIncrement,
    pot,
    currentActorId,
    playersToAct,
    status,
    smallBlind: handState.smallBlind,
    bigBlind: handState.bigBlind,
    dealerSeat: handState.dealerSeat,
    smallBlindSeat: handState.smallBlindSeat,
    bigBlindSeat: handState.bigBlindSeat,
    handState,
  });
}

export const startPreFlopRound = createPreFlopRound;

export function applyAction(state: RoundState, action: PlayerAction): RoundState {
  if (state.status !== 'active') {
    throw new EngineError(
      'ROUND_NOT_ACTIVE',
      'Não é possível realizar ações em uma rodada encerrada.',
    );
  }

  if (typeof action !== 'object' || action === null) {
    throw new EngineError('INVALID_INPUT', 'Ação inválida.');
  }

  if (action.playerId !== state.currentActorId) {
    throw new EngineError(
      'OUT_OF_TURN',
      `Ação fora do turno. É a vez do jogador ${state.currentActorId}.`,
    );
  }

  const playerIndex = state.players.findIndex(p => p.id === action.playerId);
  if (playerIndex === -1) {
    throw new EngineError(
      'PLAYER_NOT_FOUND',
      `Jogador ${action.playerId} não encontrado na rodada.`,
    );
  }

  const player = state.players[playerIndex];

  if (player.folded) {
    throw new EngineError(
      'PLAYER_FOLDED',
      `Jogador ${action.playerId} já desistiu desta mão.`,
    );
  }

  if (player.isAllIn) {
    throw new EngineError(
      'PLAYER_ALL_IN',
      `Jogador ${action.playerId} está all-in e não pode receber a vez de agir.`,
    );
  }

  if (action.type === 'fold') {
    const updatedPlayer: RoundPlayer = {
      ...player,
      folded: true,
    };

    const updatedPlayers = state.players.map((p, idx) =>
      idx === playerIndex ? updatedPlayer : p,
    );

    const activePlayers = updatedPlayers.filter(p => !p.folded);

    // Se apenas um jogador continuar na mão, a mão é encerrada por desistência dos adversários
    if (activePlayers.length <= 1) {
      return freezeRoundState({
        ...state,
        players: updatedPlayers,
        currentActorId: null,
        playersToAct: [],
        status: 'hand_ended_by_fold',
      });
    }

    const nextPlayersToAct = state.playersToAct.filter(id => id !== action.playerId);
    const activeWithChips = activePlayers.filter(p => p.chips > 0);

    // Encerra a rodada se não houver mais possibilidade de disputa
    if (activeWithChips.length === 0) {
      return freezeRoundState({
        ...state,
        players: updatedPlayers,
        currentActorId: null,
        playersToAct: [],
        status: 'completed',
      });
    }

    if (
      activeWithChips.length === 1 &&
      activeWithChips[0].committed >= state.currentBet
    ) {
      return freezeRoundState({
        ...state,
        players: updatedPlayers,
        currentActorId: null,
        playersToAct: [],
        status: 'completed',
      });
    }

    if (nextPlayersToAct.length === 0) {
      return freezeRoundState({
        ...state,
        players: updatedPlayers,
        currentActorId: null,
        playersToAct: [],
        status: 'completed',
      });
    }

    return freezeRoundState({
      ...state,
      players: updatedPlayers,
      currentActorId: nextPlayersToAct[0],
      playersToAct: nextPlayersToAct,
      status: 'active',
    });
  }

  if (action.type === 'check') {
    const amountOwed = state.currentBet - player.committed;
    if (amountOwed > 0) {
      throw new EngineError(
        'CANNOT_CHECK',
        `Não é permitido dar check quando há aposta pendente a igualar (faltam ${amountOwed} fichas).`,
      );
    }

    const updatedPlayer: RoundPlayer = {
      ...player,
      lastActionBet: state.currentBet,
    };

    const updatedPlayers = state.players.map((p, idx) =>
      idx === playerIndex ? updatedPlayer : p,
    );

    const nextPlayersToAct = state.playersToAct.filter(id => id !== action.playerId);

    if (nextPlayersToAct.length === 0) {
      return freezeRoundState({
        ...state,
        players: updatedPlayers,
        currentActorId: null,
        playersToAct: [],
        status: 'completed',
      });
    }

    return freezeRoundState({
      ...state,
      players: updatedPlayers,
      currentActorId: nextPlayersToAct[0],
      playersToAct: nextPlayersToAct,
      status: 'active',
    });
  }

  if (action.type === 'call') {
    const callAmount = Math.max(0, state.currentBet - player.committed);
    const payment = Math.min(player.chips, callAmount);
    const remainingChips = player.chips - payment;
    const newCommitted = player.committed + payment;
    const isAllIn = remainingChips === 0 && player.chips > 0;

    if (!Number.isSafeInteger(payment) || payment < 0) {
      throw new EngineError('INVALID_INPUT', 'Valor de aposta inválido.');
    }

    const updatedPlayer: RoundPlayer = {
      ...player,
      chips: remainingChips,
      committed: newCommitted,
      isAllIn: player.isAllIn || isAllIn,
      lastActionBet: state.currentBet,
    };

    const updatedPlayers = state.players.map((p, idx) =>
      idx === playerIndex ? updatedPlayer : p,
    );

    const updatedPot = state.pot + payment;

    const nextPlayersToAct = state.playersToAct.filter(id => id !== action.playerId);
    const activePlayers = updatedPlayers.filter(p => !p.folded);
    const activeWithChips = activePlayers.filter(p => p.chips > 0);

    if (activeWithChips.length === 0) {
      return freezeRoundState({
        ...state,
        players: updatedPlayers,
        pot: updatedPot,
        currentActorId: null,
        playersToAct: [],
        status: 'completed',
      });
    }

    if (
      activeWithChips.length === 1 &&
      activeWithChips[0].committed >= state.currentBet
    ) {
      return freezeRoundState({
        ...state,
        players: updatedPlayers,
        pot: updatedPot,
        currentActorId: null,
        playersToAct: [],
        status: 'completed',
      });
    }

    if (nextPlayersToAct.length === 0) {
      return freezeRoundState({
        ...state,
        players: updatedPlayers,
        pot: updatedPot,
        currentActorId: null,
        playersToAct: [],
        status: 'completed',
      });
    }

    return freezeRoundState({
      ...state,
      players: updatedPlayers,
      pot: updatedPot,
      currentActorId: nextPlayersToAct[0],
      playersToAct: nextPlayersToAct,
      status: 'active',
    });
  }

  if (action.type === 'raise') {
    if (typeof action.amount !== 'number' || !Number.isSafeInteger(action.amount) || action.amount <= 0) {
      throw new EngineError('INVALID_INPUT', 'Valor de raise inválido.');
    }

    if (!canPlayerRaise(state, player.id)) {
      const hasOpponentWithChips = state.players.some(
        opponent =>
          opponent.id !== player.id &&
          !opponent.folded &&
          !opponent.isAllIn &&
          opponent.chips > 0,
      );

      throw new EngineError(
        hasOpponentWithChips ? 'ACTION_NOT_REOPENED' : 'CANNOT_RAISE',
        hasOpponentWithChips
          ? 'A ação não foi reaberta para este jogador realizar outro aumento.'
          : 'Não há adversário com fichas para responder ao aumento.',
      );
    }

    const targetTotal = action.amount;
    const needed = targetTotal - player.committed;

    if (needed <= 0 || targetTotal <= state.currentBet) {
      throw new EngineError(
        'INVALID_RAISE_AMOUNT',
        `O valor do raise (${targetTotal}) deve ser superior à aposta atual (${state.currentBet}).`,
      );
    }

    if (needed > player.chips) {
      throw new EngineError(
        'INSUFFICIENT_CHIPS',
        `Fichas insuficientes para o raise. Necessário: ${needed}, disponível: ${player.chips}.`,
      );
    }

    const minRaiseTotal = state.currentBet + state.minRaiseIncrement;
    const isAllIn = needed === player.chips;

    if (targetTotal < minRaiseTotal && !isAllIn) {
      throw new EngineError(
        'INVALID_RAISE_AMOUNT',
        `Aumento abaixo do mínimo permitido (${minRaiseTotal}).`,
      );
    }

    const payment = needed;
    const remainingChips = player.chips - payment;
    const newCommitted = targetTotal;
    const increment = targetTotal - state.currentBet;
    const isFullRaise = increment >= state.minRaiseIncrement;
    const nextMinRaiseIncrement = isFullRaise ? increment : state.minRaiseIncrement;

    const updatedPlayer: RoundPlayer = {
      ...player,
      chips: remainingChips,
      committed: newCommitted,
      isAllIn: player.isAllIn || isAllIn,
      lastActionBet: targetTotal,
    };

    const updatedPlayers = state.players.map((p, idx) =>
      idx === playerIndex ? updatedPlayer : p,
    );

    const updatedPot = state.pot + payment;

    // Reconstrói a fila circular de jogadores que ainda precisam responder ao aumento
    const count = updatedPlayers.length;
    const circularQueue: string[] = [];
    for (let i = 1; i < count; i++) {
      const candidate = updatedPlayers[(playerIndex + i) % count];
      if (!candidate.folded && candidate.chips > 0) {
        circularQueue.push(candidate.id);
      }
    }

    if (circularQueue.length === 0) {
      return freezeRoundState({
        ...state,
        players: updatedPlayers,
        currentBet: targetTotal,
        minRaiseIncrement: nextMinRaiseIncrement,
        lastRaiseIncrement: nextMinRaiseIncrement,
        pot: updatedPot,
        currentActorId: null,
        playersToAct: [],
        status: 'completed',
      });
    }

    return freezeRoundState({
      ...state,
      players: updatedPlayers,
      currentBet: targetTotal,
      minRaiseIncrement: nextMinRaiseIncrement,
      lastRaiseIncrement: nextMinRaiseIncrement,
      pot: updatedPot,
      currentActorId: circularQueue[0],
      playersToAct: circularQueue,
      status: 'active',
    });
  }

  if (action.type === 'all-in' || action.type === 'allIn') {
    const totalPossible = player.committed + player.chips;

    if (totalPossible <= state.currentBet) {
      // All-in que constitui call (incompleto ou exato)
      return applyAction(state, { playerId: action.playerId, type: 'call' });
    }

    // All-in que constitui raise (completo ou incompleto)
    return applyAction(state, {
      playerId: action.playerId,
      type: 'raise',
      amount: totalPossible,
    });
  }

  throw new EngineError(
    'INVALID_ACTION',
    `Ação não reconhecida: ${(action as { type: string }).type}. Permitidos apenas fold, check, call, raise e all-in.`,
  );
}

export function fold(state: RoundState, playerId?: string): RoundState {
  const actor = playerId ?? state.currentActorId;
  if (!actor) {
    throw new EngineError('ROUND_NOT_ACTIVE', 'Não há jogador autorizado a agir.');
  }
  return applyAction(state, { playerId: actor, type: 'fold' });
}

export function check(state: RoundState, playerId?: string): RoundState {
  const actor = playerId ?? state.currentActorId;
  if (!actor) {
    throw new EngineError('ROUND_NOT_ACTIVE', 'Não há jogador autorizado a agir.');
  }
  return applyAction(state, { playerId: actor, type: 'check' });
}

export function call(state: RoundState, playerId?: string): RoundState {
  const actor = playerId ?? state.currentActorId;
  if (!actor) {
    throw new EngineError('ROUND_NOT_ACTIVE', 'Não há jogador autorizado a agir.');
  }
  return applyAction(state, { playerId: actor, type: 'call' });
}

export function raise(state: RoundState, amount: number, playerId?: string): RoundState {
  const actor = playerId ?? state.currentActorId;
  if (!actor) {
    throw new EngineError('ROUND_NOT_ACTIVE', 'Não há jogador autorizado a agir.');
  }
  return applyAction(state, { playerId: actor, type: 'raise', amount });
}

export function allIn(state: RoundState, playerId?: string): RoundState {
  const actor = playerId ?? state.currentActorId;
  if (!actor) {
    throw new EngineError('ROUND_NOT_ACTIVE', 'Não há jogador autorizado a agir.');
  }
  return applyAction(state, { playerId: actor, type: 'all-in' });
}

export const allin = allIn;
