import type { AllowedActions } from '@poker-table/protocol';

export type PreActionType = 'check' | 'check-fold' | 'fold';

export interface PreActionState {
  type: PreActionType;
  street: string;
  handDealerSeat: number;
  createdCurrentBet: number;
}

export interface ResolvePreActionResult {
  actionToSend: 'check' | 'fold' | null;
  shouldCancel: boolean;
  reason?: string;
}

/**
 * Avalia de forma segura se a intenção pré-selecionada ainda é válida
 * no momento em que o servidor concede a vez ao jogador.
 *
 * Regras:
 * 1. Check: Executa Check se canCheck for true. Se houver aposta a enfrentar, cancela
 *    sem executar ação (apresentando os controles manuais). NUNCA converte para Call.
 * 2. Check/Fold: Se canCheck for true, executa Check. Senão, se canFold for true, executa Fold.
 *    NUNCA realiza Call automaticamente.
 * 3. Fold: Executa Fold se canFold for true.
 *
 * Em todos os casos, a intenção é consumida (shouldCancel = true).
 */
export function resolvePreAction({
  preAction,
  allowed,
  currentStreet,
  currentDealerSeat,
}: {
  preAction: PreActionState;
  allowed: AllowedActions | null | undefined;
  currentStreet: string;
  currentDealerSeat: number;
}): ResolvePreActionResult {
  if (!allowed) {
    return { actionToSend: null, shouldCancel: true, reason: 'no_allowed_actions' };
  }

  // Se a street ou a mão avançou, a intenção prévia perdeu a validade
  if (
    preAction.street !== currentStreet ||
    preAction.handDealerSeat !== currentDealerSeat
  ) {
    return { actionToSend: null, shouldCancel: true, reason: 'street_or_hand_changed' };
  }

  switch (preAction.type) {
    case 'check':
      if (allowed.canCheck) {
        return { actionToSend: 'check', shouldCancel: true };
      }
      // Se outro jogador apostou, Check não é mais permitido: cancela a seleção
      // e apresenta controles normais (nunca converte em Call ou Fold)
      return { actionToSend: null, shouldCancel: true, reason: 'bet_faced' };

    case 'check-fold':
      if (allowed.canCheck) {
        return { actionToSend: 'check', shouldCancel: true };
      }
      if (allowed.canFold) {
        return { actionToSend: 'fold', shouldCancel: true };
      }
      return { actionToSend: null, shouldCancel: true, reason: 'cannot_check_or_fold' };

    case 'fold':
      if (allowed.canFold) {
        return { actionToSend: 'fold', shouldCancel: true };
      }
      return { actionToSend: null, shouldCancel: true, reason: 'cannot_fold' };

    default:
      return { actionToSend: null, shouldCancel: true, reason: 'unknown_type' };
  }
}

/**
 * Verifica se uma intenção antecipada de 'check' deve ser cancelada prematuramente
 * caso outro jogador realize uma aposta enquanto o jogador aguarda sua vez.
 */
export function shouldCancelPreActionOnBetChange({
  preAction,
  currentStreetBet,
  playerRoundCommitted,
}: {
  preAction: PreActionState | null;
  currentStreetBet: number;
  playerRoundCommitted: number;
}): boolean {
  if (!preAction) return false;
  if (preAction.type === 'check') {
    // Se a aposta ativa na street for maior do que o montante já comprometido pelo jogador,
    // há uma aposta pendente para cobrir, invalidando a intenção de Check
    return currentStreetBet > playerRoundCommitted;
  }
  return false;
}

export function getPreActionLabel(type: PreActionType): string {
  switch (type) {
    case 'check':
      return 'Check';
    case 'check-fold':
      return 'Check / Fold';
    case 'fold':
      return 'Fold';
  }
}

export function getPreActionDescription(type: PreActionType): string {
  switch (type) {
    case 'check':
      return 'Passar (Check)';
    case 'check-fold':
      return 'Passar se possível; caso contrário, desistir.';
    case 'fold':
      return 'Desistir (Fold)';
  }
}
