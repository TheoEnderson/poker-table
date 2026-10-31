import { EngineError } from './errors.js';
import type { HandPositions, PlayerInput } from './types.js';

export function advanceDealer(
  eligiblePlayers: readonly PlayerInput[],
  previousDealerSeat?: number | null,
): PlayerInput {
  if (eligiblePlayers.length < 2) {
    throw new EngineError('INSUFFICIENT_PLAYERS', 'São necessários ao menos 2 jogadores elegíveis para determinar o dealer.');
  }

  const sorted = [...eligiblePlayers].sort((a, b) => a.seat - b.seat);

  if (previousDealerSeat === undefined || previousDealerSeat === null) {
    // Escolha determinística da primeira mão: primeiro assento elegível
    return sorted[0];
  }

  if (!Number.isSafeInteger(previousDealerSeat) || previousDealerSeat < 1) {
    throw new EngineError('INVALID_SEAT', 'O assento do dealer anterior deve ser um número inteiro positivo.');
  }

  // Avança no sentido horário: próximo assento maior que o anterior, ou o menor se reiniciar a volta
  const next = sorted.find(p => p.seat > previousDealerSeat);
  return next ?? sorted[0];
}

export function determineDealerPosition(
  eligiblePlayers: readonly PlayerInput[],
  previousDealerSeat?: number | null,
): number {
  return advanceDealer(eligiblePlayers, previousDealerSeat).seat;
}

export function determineBlindsPositions(
  eligiblePlayers: readonly PlayerInput[],
  dealerSeat: number,
): HandPositions {
  if (eligiblePlayers.length < 2) {
    throw new EngineError('INSUFFICIENT_PLAYERS', 'São necessários ao menos 2 jogadores elegíveis para determinar os blinds.');
  }

  const sorted = [...eligiblePlayers].sort((a, b) => a.seat - b.seat);
  const dealerIdx = sorted.findIndex(p => p.seat === dealerSeat);

  if (dealerIdx === -1) {
    throw new EngineError('INVALID_DEALER', `O assento ${dealerSeat} não corresponde a um jogador elegível para dealer.`);
  }

  const count = sorted.length;

  if (count === 2) {
    // Heads-up: o dealer é o small blind; o outro jogador é o big blind
    return {
      dealerSeat,
      smallBlindSeat: sorted[dealerIdx].seat,
      bigBlindSeat: sorted[(dealerIdx + 1) % 2].seat,
    };
  }

  // 3 ou mais jogadores: SB e BB são as duas próximas posições elegíveis à esquerda do dealer
  return {
    dealerSeat,
    smallBlindSeat: sorted[(dealerIdx + 1) % count].seat,
    bigBlindSeat: sorted[(dealerIdx + 2) % count].seat,
  };
}

