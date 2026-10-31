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
    ...(p.name !== undefined ? { name: p.name } : {}),
  }));

  // No pré-flop, a aposta inicial a igualar considera o valor nominal do big blind,
  // inclusive quando o BB possui fichas insuficientes para pagá-lo integralmente.
  const currentBet = handState.bigBlind;
  const pot = handState.pot;

  // Candidatos a agir na ordem circular pré-flop: apenas jogadores que possuem fichas e não estão all-in
  const preFlopCandidates = handState.preFlopOrder.filter(id => {
    const p = players.find(player => player.id === id);
    return p !== undefined && !p.isAllIn && p.chips > 0;
  });

  const activePlayersWithChips = players.filter(p => !p.folded && p.chips > 0);

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
    activePlayersWithChips.length === 1 &&
    activePlayersWithChips[0].committed >= currentBet
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

    const nextPlayersToAct = state.playersToAct.filter(id => id !== action.playerId);

    if (nextPlayersToAct.length === 0) {
      return freezeRoundState({
        ...state,
        currentActorId: null,
        playersToAct: [],
        status: 'completed',
      });
    }

    return freezeRoundState({
      ...state,
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

  throw new EngineError(
    'INVALID_ACTION',
    `Ação não reconhecida: ${(action as { type: string }).type}. Permitidos apenas fold, check e call.`,
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
