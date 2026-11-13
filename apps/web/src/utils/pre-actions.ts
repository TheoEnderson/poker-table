import type { AllowedActions, PreActionType } from '@poker-table/protocol';

export type { PreActionType };

export interface PreActionState {
  type: PreActionType;
  street: string;
  handDealerSeat: number;
  createdCurrentBet: number;
  amount?: number;
}

export interface ResolvePreActionResult {
  actionToSend: 'check' | 'fold' | 'call' | 'all-in' | null;
  shouldCancel: boolean;
  reason?: string;
}

/**
 * Calcula o valor exato de fichas necessário para cobrir a aposta atual na pré-ação.
 */
export function computePreActionCallAmount(toCall: number, playerStack: number): number {
  if (toCall <= 0 || playerStack <= 0) return 0;
  return Math.min(toCall, playerStack);
}

/**
 * Avalia de forma segura se a intenção pré-selecionada ainda é válida
 * no momento em que o servidor concede a vez ao jogador.
 *
 * Regras:
 * 1. Check: Executa Check se canCheck for true. Se houver aposta a enfrentar, cancela
 *    sem executar ação (apresentando os controles manuais). NUNCA converte para Call.
 * 2. Call: Executa Call (ou all-in quando stack <= toCall) somente se houver aposta a pagar
 *    e o valor efetivo não tiver aumentado acima do valor visualizado ao clicar.
 * 3. Check/Fold: Se canCheck for true, executa Check. Senão, se canFold for true, executa Fold.
 *    NUNCA realiza Call automaticamente.
 * 4. Fold: Executa Fold se canFold for true.
 *
 * Em todos os casos, a intenção é consumida (shouldCancel = true).
 */
export function resolvePreAction({
  preAction,
  allowed,
  currentStreet,
  currentDealerSeat,
  playerStack,
}: {
  preAction: PreActionState;
  allowed: AllowedActions | null | undefined;
  currentStreet: string;
  currentDealerSeat: number;
  playerStack?: number;
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

    case 'call': {
      if (allowed.callAmount <= 0 || (!allowed.canCall && !allowed.canAllIn)) {
        return { actionToSend: null, shouldCancel: true, reason: 'cannot_call' };
      }
      if (preAction.amount !== undefined && allowed.callAmount !== preAction.amount) {
        return { actionToSend: null, shouldCancel: true, reason: 'bet_raised' };
      }
      const isAllInCall =
        (playerStack !== undefined && playerStack <= allowed.callAmount) ||
        (allowed.canAllIn &&
          allowed.allInType === 'call' &&
          allowed.allInAmount !== null &&
          allowed.allInAmount <= allowed.callAmount);
      return { actionToSend: isAllInCall ? 'all-in' : 'call', shouldCancel: true };
    }

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
 * Verifica se uma intenção antecipada deve ser cancelada prematuramente
 * caso outro jogador realize uma aposta ou aumento enquanto o jogador aguarda sua vez.
 */
export function shouldCancelPreActionOnBetChange({
  preAction,
  currentStreetBet,
  playerRoundCommitted,
  playerStack,
}: {
  preAction: PreActionState | null;
  currentStreetBet: number;
  playerRoundCommitted: number;
  playerStack?: number;
}): boolean {
  if (!preAction) return false;
  const toCall = Math.max(0, currentStreetBet - playerRoundCommitted);

  if (preAction.type === 'check') {
    // Se a aposta ativa na street for maior do que o montante já comprometido pelo jogador,
    // há uma aposta pendente para cobrir, invalidando a intenção de Check
    return toCall > 0;
  }

  if (preAction.type === 'call') {
    if (toCall <= 0) return true;
    if (preAction.amount !== undefined) {
      const effectiveCall = playerStack !== undefined
        ? computePreActionCallAmount(toCall, playerStack)
        : toCall;
      return effectiveCall !== preAction.amount;
    }
  }

  return false;
}

export function getPreActionLabel(type: PreActionType, callAmount?: number): string {
  switch (type) {
    case 'check':
      return 'Check';
    case 'call':
      return callAmount !== undefined ? `Call ${callAmount}` : 'Call';
    case 'check-fold':
      return 'Check / Fold';
    case 'fold':
      return 'Fold';
  }
}

export function getPreActionDescription(
  type: PreActionType,
  options?: { amount?: number; isAllIn?: boolean },
): string {
  switch (type) {
    case 'check':
      return 'Passar (Check)';
    case 'call':
      return options?.amount !== undefined
        ? `Pagar ${options.amount}${options.isAllIn ? ' (All-in)' : ''}`
        : 'Pagar (Call)';
    case 'check-fold':
      return 'Passar se possível; caso contrário, desistir.';
    case 'fold':
      return 'Desistir (Fold)';
  }
}
