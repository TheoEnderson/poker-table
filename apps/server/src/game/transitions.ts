import { advanceStreet, applyHandAction, canAdvanceStreet, EngineError, type EngineErrorCode, type HandFlowState } from '@poker-table/engine';
import type { CommandInput, ErrorCode } from '@poker-table/protocol';
import { RoomError } from '../errors.js';

const errors: Partial<Record<EngineErrorCode, [ErrorCode, string]>> = {
  OUT_OF_TURN: ['OUT_OF_TURN', 'Aguarde sua vez de agir.'],
  INVALID_INPUT: ['INVALID_INPUT', 'Ação ou valor inválido.'],
  INVALID_ACTION: ['INVALID_ACTION', 'Esta ação não é permitida.'],
  CANNOT_CHECK: ['CANNOT_CHECK', 'Há uma aposta pendente para igualar.'],
  CANNOT_RAISE: ['CANNOT_RAISE', 'Não há adversário apto a responder ao aumento.'],
  ACTION_NOT_REOPENED: ['ACTION_NOT_REOPENED', 'As apostas não foram reabertas para você.'],
  INVALID_RAISE_AMOUNT: ['INVALID_RAISE_AMOUNT', 'O total do raise não atende ao aumento permitido.'],
  INSUFFICIENT_CHIPS: ['INSUFFICIENT_CHIPS', 'Você não possui fichas para esse raise.'],
  ROUND_NOT_ACTIVE: ['ROUND_NOT_ACTIVE', 'Esta rodada de apostas já terminou.'],
  HAND_ALREADY_COMPLETED: ['HAND_ALREADY_COMPLETED', 'Esta mão não aceita mais apostas ou avanços.'],
  CANNOT_ADVANCE_STREET: ['CANNOT_ADVANCE_STREET', 'Ainda existem ações pendentes nesta street.'],
  PLAYER_NOT_FOUND: ['FORBIDDEN', 'Você não participa desta mão.'],
  PLAYER_FOLDED: ['INVALID_ACTION', 'Você já desistiu desta mão.'],
  PLAYER_ALL_IN: ['INVALID_ACTION', 'Você já está all-in.'],
};

export function transitionHand(hand: HandFlowState, playerId: string, command: Extract<CommandInput, { type: 'game-action' | 'advance-street' }>): HandFlowState {
  try {
    if (command.type === 'advance-street') {
      if (!canAdvanceStreet(hand)) throw new RoomError(
        hand.status === 'in_progress' ? 'CANNOT_ADVANCE_STREET' : 'HAND_ALREADY_COMPLETED',
        hand.status === 'in_progress' ? 'Ainda existem ações pendentes nesta street.' : 'Esta mão não permite novos avanços.',
      );
      return advanceStreet(hand);
    }
    if (!hand.players.some(p => p.id === playerId)) throw new RoomError('FORBIDDEN', 'Você não participa desta mão.');
    return applyHandAction(hand, {
      playerId, type: command.action,
      ...(command.action === 'raise' ? { amount: command.amount } : {}),
    });
  } catch (error) {
    if (error instanceof EngineError) {
      const mapped = errors[error.code];
      if (mapped) throw new RoomError(...mapped);
      // Unexpected engine/integrity errors are not mislabeled as a player's bad action.
      throw new RoomError('STORAGE_ERROR', 'Não foi possível validar a transição da partida.');
    }
    throw error;
  }
}
