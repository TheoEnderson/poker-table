import type { HandFlowState } from '@poker-table/engine';
import type { Command, PreAction } from '@poker-table/protocol';
import { RoomError } from '../errors.js';
import { transitionHand } from './transitions.js';

export type PreActionRecord = Readonly<Record<string, PreAction>>;

export interface PlayerToCallInfo {
  readonly toCall: number;
  readonly effectiveCallAmount: number;
  readonly chips: number;
}

/**
 * Normaliza o mapa de pré-ações, retornando undefined quando vazio
 * para evitar gravar propriedades supérfluas no JSON persistido.
 */
export function normalizePreActions(
  preActions?: PreActionRecord,
): Record<string, PreAction> | undefined {
  if (!preActions) return undefined;
  const normalized: Record<string, PreAction> = {};
  for (const [playerId, action] of Object.entries(preActions)) {
    normalized[playerId] = action;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/**
 * Remove a pré-ação pendente de um jogador específico, caso exista.
 */
export function removePlayerPreAction(
  preActions: PreActionRecord | undefined,
  playerId: string,
): Record<string, PreAction> | undefined {
  if (!preActions || !(playerId in preActions)) {
    return normalizePreActions(preActions);
  }
  const next: Record<string, PreAction> = { ...preActions };
  delete next[playerId];
  return normalizePreActions(next);
}

/**
 * Calcula o valor nominal a cobrir (toCall) e o valor efetivo pagável min(toCall, chips).
 */
export function getPlayerToCallInfo(
  hand: HandFlowState,
  playerId: string,
): PlayerToCallInfo | null {
  const player = hand.players.find(p => p.id === playerId);
  if (!player) return null;
  const toCall = Math.max(0, hand.currentRound.currentBet - player.roundCommitted);
  const effectiveCallAmount = Math.min(toCall, player.chips);
  return {
    toCall,
    effectiveCallAmount,
    chips: player.chips,
  };
}

/**
 * Valida se o jogador está elegível e se a pré-ação solicitada é consistente
 * com o estado atual da mesa (especialmente o valor exato visto no Call).
 */
export function validateSetPreAction(
  hand: HandFlowState,
  playerId: string,
  preAction: PreAction,
): void {
  if (hand.status !== 'in_progress') {
    throw new RoomError('HAND_ALREADY_COMPLETED', 'Esta mão já foi encerrada e não aceita pré-ações.');
  }
  if (hand.currentRound.status !== 'active') {
    throw new RoomError('ROUND_NOT_ACTIVE', 'A rodada de apostas atual foi concluída.');
  }

  const player = hand.players.find(p => p.id === playerId);
  if (!player) {
    throw new RoomError('FORBIDDEN', 'Você não está participando desta mão.');
  }
  if (player.folded) {
    throw new RoomError('INVALID_ACTION', 'Jogadores que desistiram não podem agendar pré-ações.');
  }
  if (player.isAllIn || player.chips <= 0) {
    throw new RoomError('INVALID_ACTION', 'Jogadores em all-in não podem agendar pré-ações.');
  }
  if (hand.currentActorId === playerId) {
    throw new RoomError('INVALID_ACTION', 'Já é a sua vez de agir; use os controles principais.');
  }

  const info = getPlayerToCallInfo(hand, playerId)!;

  if (preAction.type === 'check' && info.toCall > 0) {
    throw new RoomError('CANNOT_CHECK', 'Não é possível selecionar Check enquanto há aposta a pagar.');
  }

  if (preAction.type === 'call') {
    if (info.toCall <= 0 || info.effectiveCallAmount <= 0) {
      throw new RoomError('STALE_STATE', 'Não há aposta a cobrir no momento. O estado da mesa foi atualizado.');
    }
    if (preAction.amount !== info.effectiveCallAmount) {
      throw new RoomError('STALE_STATE', 'O valor do Call mudou. Confira o novo valor antes de confirmar.');
    }
  }
}

function isPreActionStillValidForHand(
  hand: HandFlowState,
  playerId: string,
  preAction: PreAction,
): boolean {
  const player = hand.players.find(p => p.id === playerId);
  if (!player || player.folded || player.isAllIn || player.chips <= 0) {
    return false;
  }

  const toCall = Math.max(0, hand.currentRound.currentBet - player.roundCommitted);
  const effectiveCallAmount = Math.min(toCall, player.chips);

  switch (preAction.type) {
    case 'check':
      return toCall === 0;
    case 'call':
      // Invalida se não houver aposta ou se o valor efetivo min(toCall, stack) mudou após um raise.
      return toCall > 0 && effectiveCallAmount === preAction.amount;
    case 'check-fold':
    case 'fold':
      return true;
  }
}

/**
 * Reconcilia as pré-ações pendentes após qualquer transição de estado da mão,
 * invalidando automaticamente intenções que ficaram obsoletas (ex.: Check ou Call X após raise).
 */
export function reconcilePreActions(
  hand: HandFlowState,
  preActions?: PreActionRecord,
): Record<string, PreAction> | undefined {
  if (!preActions) return undefined;
  if (hand.status !== 'in_progress' || hand.currentRound.status !== 'active') {
    return undefined;
  }

  const next: Record<string, PreAction> = {};
  for (const [playerId, preAction] of Object.entries(preActions)) {
    if (isPreActionStillValidForHand(hand, playerId, preAction)) {
      next[playerId] = preAction;
    }
  }
  return normalizePreActions(next);
}

/**
 * Verifica integridade das pré-ações recuperadas do SQLite durante decodeGame.
 */
export function verifyPersistedPreActions(
  hand: HandFlowState,
  preActions?: PreActionRecord,
): boolean {
  if (!preActions) return true;
  const entries = Object.entries(preActions);
  if (entries.length === 0) return true;
  if (hand.status !== 'in_progress' || hand.currentRound.status !== 'active') {
    return false;
  }
  for (const [playerId, preAction] of entries) {
    if (hand.currentActorId === playerId) return false;
    if (!isPreActionStillValidForHand(hand, playerId, preAction)) {
      return false;
    }
  }
  return true;
}

/**
 * Aplica uma ação de jogo ou avanço de street, reconcilia pré-ações pendentes
 * e executa em cadeia todas as pré-ações válidas cujo turno tenha chegado.
 */
export function applyActionAndPreActions(
  initialHand: HandFlowState,
  actorId: string,
  command: Extract<Command, { type: 'game-action' | 'advance-street' }>,
  initialPreActions?: PreActionRecord,
): { hand: HandFlowState; preActions: Record<string, PreAction> | undefined } {
  let hand = transitionHand(initialHand, actorId, command);
  let preActions: Record<string, PreAction> = initialPreActions ? { ...initialPreActions } : {};
  delete preActions[actorId];
  preActions = reconcilePreActions(hand, preActions) ?? {};

  if (command.type === 'game-action') {
    // Limite seguro baseado no número de jogadores da mão (cada execução consome a pré-ação do ator).
    let steps = 0;
    while (
      steps < hand.players.length &&
      hand.status === 'in_progress' &&
      hand.currentRound.status === 'active' &&
      hand.currentActorId !== null &&
      preActions[hand.currentActorId] !== undefined
    ) {
      steps++;
      const nextActorId = hand.currentActorId;
      const preAction = preActions[nextActorId];
      delete preActions[nextActorId];

      const nextActor = hand.players.find(p => p.id === nextActorId);
      if (!nextActor) break;

      const toCall = Math.max(0, hand.currentRound.currentBet - nextActor.roundCommitted);
      let autoAction: 'fold' | 'check' | 'call' | 'all-in';

      if (preAction.type === 'fold') {
        autoAction = 'fold';
      } else if (preAction.type === 'check-fold') {
        autoAction = toCall === 0 ? 'check' : 'fold';
      } else if (preAction.type === 'check') {
        if (toCall !== 0) break;
        autoAction = 'check';
      } else {
        const effectiveCall = Math.min(toCall, nextActor.chips);
        if (toCall <= 0 || effectiveCall !== preAction.amount) break;
        autoAction = nextActor.chips <= toCall ? 'all-in' : 'call';
      }

      hand = transitionHand(hand, nextActorId, {
        type: 'game-action',
        action: autoAction,
      });
      preActions = reconcilePreActions(hand, preActions) ?? {};
    }
  }

  return {
    hand,
    preActions: normalizePreActions(preActions),
  };
}
