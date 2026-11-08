/**
 * Utilitários matemáticos para dimensionamento de apostas e aumentos
 * em conformidade com as regras oficiais de No-Limit Texas Hold'em.
 */

export interface PotTargetParams {
  /** Valor total acumulado no pote (inclui apostas ativas na street) */
  pot: number;
  /** Maior aposta ativa na street atual (0 se ninguém apostou ainda) */
  currentBet: number;
  /** Fichas que o jogador atual já comprometeu nesta street */
  playerRoundCommitted: number;
  /** Fração do pote desejada (ex: 0.5 para meio pote, 1.0 para pote completo) */
  fraction?: number;
  /** Valor total mínimo legal para aumento/aposta na street */
  minRaiseAmount: number;
  /** Valor total máximo legal disponível (all-in do jogador) */
  maxRaiseAmount: number;
}

/**
 * Calcula o valor total de aposta/aumento correspondente a uma fração do pote.
 *
 * Regra oficial do Poker (TDA/WSOP):
 * - Sem aposta anterior (Bet): aposta direta de fração do pote atual.
 * - Enfrentando aposta (Raise): valor necessário para igualar (Call) + fração
 *   do pote resultante após esse call virtual.
 *
 * O resultado é sempre estritamente limitado entre minRaiseAmount e maxRaiseAmount.
 */
export function calculatePotTarget({
  pot,
  currentBet,
  playerRoundCommitted,
  fraction = 1,
  minRaiseAmount,
  maxRaiseAmount,
}: PotTargetParams): number {
  if (maxRaiseAmount <= minRaiseAmount) {
    return maxRaiseAmount;
  }

  let target: number;
  if (currentBet === 0) {
    // Abertura de aposta (Bet)
    target = Math.round(pot * fraction);
  } else {
    // Aumento enfrentando aposta (Raise)
    const toCall = Math.max(0, currentBet - playerRoundCommitted);
    const potAfterCall = pot + toCall;
    const raiseIncrement = Math.round(potAfterCall * fraction);
    target = currentBet + raiseIncrement;
  }

  // Clamping legal e seguro
  return Math.min(maxRaiseAmount, Math.max(minRaiseAmount, target));
}

export interface BetPreset {
  id: 'min' | 'half-pot' | 'pot' | 'max';
  label: string;
  amount: number;
  isAllIn: boolean;
}

/**
 * Gera os 4 atalhos clássicos de apostas: MÍN., ½ POTE, POTE e MÁX.
 */
export function getBetPresets({
  pot,
  currentBet,
  playerRoundCommitted,
  minRaiseAmount,
  maxRaiseAmount,
}: Omit<PotTargetParams, 'fraction'>): BetPreset[] {
  const minAmount = minRaiseAmount;
  const maxAmount = maxRaiseAmount;

  const halfPotAmount = calculatePotTarget({
    pot,
    currentBet,
    playerRoundCommitted,
    fraction: 0.5,
    minRaiseAmount,
    maxRaiseAmount,
  });

  const potAmount = calculatePotTarget({
    pot,
    currentBet,
    playerRoundCommitted,
    fraction: 1.0,
    minRaiseAmount,
    maxRaiseAmount,
  });

  return [
    {
      id: 'min',
      label: 'MÍN.',
      amount: minAmount,
      isAllIn: minAmount === maxAmount,
    },
    {
      id: 'half-pot',
      label: '½ POTE',
      amount: halfPotAmount,
      isAllIn: halfPotAmount === maxAmount,
    },
    {
      id: 'pot',
      label: 'POTE',
      amount: potAmount,
      isAllIn: potAmount === maxAmount,
    },
    {
      id: 'max',
      label: 'MÁX.',
      amount: maxAmount,
      isAllIn: true,
    },
  ];
}
