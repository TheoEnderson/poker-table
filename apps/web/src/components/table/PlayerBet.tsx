import { useEffect, useRef, useState } from 'react';
import type { SeatPosition } from '../../utils/table-geometry';
import { ChipStack } from '../chips/ChipStack';

export interface PlayerBetProps {
  amount: number;
  zone: SeatPosition['zone'];
  isAllIn?: boolean;
  isFolded?: boolean;
  isSweeping?: boolean;
  playerName?: string;
}

export function PlayerBet({
  amount,
  zone,
  isAllIn = false,
  isFolded = false,
  isSweeping = false,
  playerName,
}: PlayerBetProps) {
  const isFirstMount = useRef(true);
  const prevAmount = useRef(amount);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }

    if (amount > prevAmount.current && !isSweeping) {
      setAnimating(true);
      const timer = setTimeout(() => setAnimating(false), 300);
      return () => clearTimeout(timer);
    }
    prevAmount.current = amount;
  }, [amount, isSweeping]);

  if (amount <= 0) {
    return null;
  }

  const badgeClasses = [
    'player-bet-badge',
    'pod-bet-badge', // Preserva classe legada para retrocompatibilidade com seletores de teste
    `zone-${zone}`,
    isAllIn ? 'bet-allin' : '',
    isFolded ? 'bet-folded' : '',
    isSweeping ? 'bet-sweeping' : '',
    animating ? 'bet-animating' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const accessibleLabel = playerName
    ? `Aposta de ${playerName}: ${amount} fichas${isFolded ? ' (Desistiu)' : ''}${isAllIn ? ' (All-in)' : ''}`
    : `Aposta: ${amount} fichas`;

  return (
    <div
      className={badgeClasses}
      role="status"
      aria-label={accessibleLabel}
      title={`Aposta na street: ${amount}${isAllIn ? ' (All-in)' : ''}${isFolded ? ' (Fold)' : ''}`}
    >
      <div className="player-bet-chips" aria-hidden="true">
        <ChipStack amount={amount} maxChips={3} size="xs" variant="stack" />
      </div>
      <span className="player-bet-amount tabular-nums">
        {amount}
      </span>
    </div>
  );
}
