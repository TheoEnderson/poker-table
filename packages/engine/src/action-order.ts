import { EngineError } from './errors.js';

export interface BasePlayerForAction {
  readonly id: string;
  readonly seat: number;
  readonly chips: number;
  readonly isAllIn?: boolean;
}

export function calculatePreFlopActionOrder<T extends BasePlayerForAction>(
  players: readonly T[],
  dealerSeat: number,
): T[] {
  if (players.length < 2) {
    throw new EngineError('INSUFFICIENT_PLAYERS', 'São necessários ao menos 2 jogadores para calcular a ordem de ação.');
  }

  const sorted = [...players].sort((a, b) => a.seat - b.seat);
  const dealerIdx = sorted.findIndex(p => p.seat === dealerSeat);

  if (dealerIdx === -1) {
    throw new EngineError('INVALID_DEALER', `O assento ${dealerSeat} não corresponde a um jogador na mão.`);
  }

  const count = sorted.length;

  // No heads-up (2 jogadores), o dealer é o SB e age primeiro no pré-flop.
  // Em mesas com 3 ou mais jogadores, a ação pré-flop começa à esquerda do big blind (índice dealer + 3).
  const startIdx = count === 2 ? dealerIdx : (dealerIdx + 3) % count;

  const circularOrder: T[] = [];
  for (let i = 0; i < count; i++) {
    circularOrder.push(sorted[(startIdx + i) % count]);
  }

  // Jogadores all-in não podem receber a vez de agir
  return circularOrder.filter(p => !p.isAllIn && p.chips > 0);
}

export function calculatePostFlopActionOrder<T extends BasePlayerForAction>(
  players: readonly T[],
  dealerSeat: number,
): T[] {
  if (players.length < 2) {
    throw new EngineError('INSUFFICIENT_PLAYERS', 'São necessários ao menos 2 jogadores para calcular a ordem de ação.');
  }

  const sorted = [...players].sort((a, b) => a.seat - b.seat);
  const dealerIdx = sorted.findIndex(p => p.seat === dealerSeat);

  if (dealerIdx === -1) {
    throw new EngineError('INVALID_DEALER', `O assento ${dealerSeat} não corresponde a um jogador na mão.`);
  }

  const count = sorted.length;

  // No pós-flop, a ação sempre começa à esquerda do dealer:
  // - Em heads-up, é o big blind (dealer + 1), e o dealer age por último.
  // - Em 3 ou mais, é o small blind (dealer + 1), e o dealer age por último.
  const startIdx = (dealerIdx + 1) % count;

  const circularOrder: T[] = [];
  for (let i = 0; i < count; i++) {
    circularOrder.push(sorted[(startIdx + i) % count]);
  }

  // Jogadores all-in não podem receber a vez de agir
  return circularOrder.filter(p => !p.isAllIn && p.chips > 0);
}

export function calculatePreFlopActionOrderIds(
  players: readonly BasePlayerForAction[],
  dealerSeat: number,
): string[] {
  return calculatePreFlopActionOrder(players, dealerSeat).map(p => p.id);
}

export function calculatePostFlopActionOrderIds(
  players: readonly BasePlayerForAction[],
  dealerSeat: number,
): string[] {
  return calculatePostFlopActionOrder(players, dealerSeat).map(p => p.id);
}

