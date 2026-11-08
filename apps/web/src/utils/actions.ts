import type { HandAction, HandSnapshot, RoomState } from '@poker-table/protocol';

/**
 * Obtém a última ação geral realizada na mão.
 */
export function getLastAction(hand: HandSnapshot): HandAction | null {
  if (!hand.actions || hand.actions.length === 0) return null;
  return hand.actions[hand.actions.length - 1];
}

/**
 * Obtém a última ação que um jogador específico realizou na street atual.
 * Ações de streets anteriores são ignoradas para não poluir o cartão com contexto passado.
 */
export function getPlayerLastActionInStreet(hand: HandSnapshot, playerId: string): HandAction | null {
  if (!hand.actions || hand.actions.length === 0) return null;
  for (let i = hand.actions.length - 1; i >= 0; i--) {
    const action = hand.actions[i];
    if (action.playerId === playerId && action.street === hand.street) {
      return action;
    }
  }
  return null;
}

/**
 * Formata o texto e detalhes de uma tag de ação para o PlayerCard.
 */
export function formatActionTag(action: HandAction): { label: string; sub?: string; className: string } {
  switch (action.type) {
    case 'fold':
      return { label: 'FOLD', className: 'tag-fold' };
    case 'check':
      return { label: 'CHECK', className: 'tag-check' };
    case 'call':
      return action.isAllIn
        ? { label: 'CALL ALL-IN', sub: `(${action.amount})`, className: 'tag-allin' }
        : { label: `CALL +${action.amount}`, className: 'tag-call' };
    case 'bet':
      return action.isAllIn
        ? { label: 'BET ALL-IN', sub: `(${action.amount})`, className: 'tag-allin' }
        : { label: `BET ${action.amount}`, className: 'tag-bet' };
    case 'raise': {
      const target = action.raiseTarget ?? action.roundCommitted;
      return action.isAllIn
        ? { label: `ALL-IN ${target}`, sub: `(+${action.amount})`, className: 'tag-allin' }
        : { label: `RAISE ${target}`, sub: `(+${action.amount})`, className: 'tag-raise' };
    }
    case 'small_blind':
      return { label: `SB ${action.amount}`, className: 'tag-blind' };
    case 'big_blind':
      return { label: `BB ${action.amount}`, className: 'tag-blind' };
    default:
      return { label: `+${action.amount}`, className: 'tag-bet' };
  }
}

/**
 * Retorna uma descrição em português claro para uma ação da mão.
 */
export function formatActionNarrative(action: HandAction, playerName: string): string {
  switch (action.type) {
    case 'fold':
      return `${playerName} deu fold`;
    case 'check':
      return `${playerName} deu check`;
    case 'call':
      return action.isAllIn
        ? `${playerName} pagou em all-in (${action.amount})`
        : `${playerName} pagou ${action.amount}`;
    case 'bet':
      return action.isAllIn
        ? `${playerName} apostou all-in (${action.amount})`
        : `${playerName} apostou ${action.amount}`;
    case 'raise': {
      const target = action.raiseTarget ?? action.roundCommitted;
      return action.isAllIn
        ? `${playerName} aumentou all-in para ${target} (+${action.amount})`
        : `${playerName} aumentou para ${target} (+${action.amount})`;
    }
    case 'small_blind':
      return `${playerName} postou small blind (${action.amount})`;
    case 'big_blind':
      return `${playerName} postou big blind (${action.amount})`;
  }
}

const streetLabels: Record<HandAction['street'], string> = {
  preflop: 'Pré-flop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
};

export function getStreetLabel(street: HandAction['street']): string {
  return streetLabels[street] ?? street;
}

/**
 * Agrupa ações da mão por street mantendo a ordem cronológica.
 */
export function groupActionsByStreet(actions: HandAction[]): { street: HandAction['street']; label: string; actions: HandAction[] }[] {
  const groups: { street: HandAction['street']; label: string; actions: HandAction[] }[] = [];
  const map = new Map<HandAction['street'], HandAction[]>();

  const streetOrder: HandAction['street'][] = ['preflop', 'flop', 'turn', 'river'];
  for (const s of streetOrder) {
    map.set(s, []);
  }

  for (const a of actions) {
    const list = map.get(a.street);
    if (list) list.push(a);
  }

  for (const s of streetOrder) {
    const list = map.get(s)!;
    if (list.length > 0) {
      groups.push({ street: s, label: streetLabels[s], actions: list });
    }
  }

  return groups;
}

/**
 * Calcula a aposta mais alta atual na street (current bet a ser igualada).
 */
export function getCurrentStreetBet(hand: HandSnapshot): number {
  if (hand.allowedActions?.currentBet != null) {
    return hand.allowedActions.currentBet;
  }
  return Math.max(0, ...hand.players.map(p => p.roundCommitted));
}

/**
 * Retorna o nome do jogador pelo ID.
 */
export function getPlayerDisplayName(room: RoomState, playerId: string, defaultSeat?: number): string {
  const found = room.players.find(p => p.id === playerId);
  if (found) return found.name;
  return defaultSeat != null ? `Assento #${defaultSeat}` : 'Jogador';
}
