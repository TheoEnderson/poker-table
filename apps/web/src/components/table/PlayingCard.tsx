import type { Card, Rank, Suit } from '@poker-table/protocol';

interface PlayingCardProps {
  card?: Card;
  faceDown?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  highlight?: boolean;
  className?: string;
  testId?: string;
}

const SUIT_META: Record<Suit, { symbol: string; name: string; colorClass: 'is-black' | 'is-red' }> = {
  s: { symbol: '♠', name: 'Espadas', colorClass: 'is-black' },
  h: { symbol: '♥', name: 'Copas', colorClass: 'is-red' },
  d: { symbol: '♦', name: 'Ouros', colorClass: 'is-red' },
  c: { symbol: '♣', name: 'Paus', colorClass: 'is-black' },
};

const RANK_NAME: Partial<Record<Rank, string>> = {
  A: 'Ás',
  K: 'Rei',
  Q: 'Dama',
  J: 'Valete',
  T: '10',
};

function formatRankDisplay(rank: Rank): string {
  return rank === 'T' ? '10' : rank;
}

function formatRankLabel(rank: Rank): string {
  return RANK_NAME[rank] ?? rank;
}

export function PlayingCard({
  card,
  faceDown = false,
  size = 'md',
  highlight = false,
  className = '',
  testId,
}: PlayingCardProps) {
  const classes = [
    'playing-card',
    `playing-card-${size}`,
    faceDown || !card ? 'playing-card-back' : `playing-card-front ${SUIT_META[card.suit].colorClass}`,
    highlight ? 'is-highlighted' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  if (faceDown || !card) {
    return (
      <span className={classes} role="img" aria-label="Carta virada para baixo" data-testid={testId}>
        <span className="playing-card-back-pattern" aria-hidden="true" />
      </span>
    );
  }

  const suit = SUIT_META[card.suit];
  const displayRank = formatRankDisplay(card.rank);
  const label = `${formatRankLabel(card.rank)} de ${suit.name}`;

  return (
    <span className={classes} role="img" aria-label={label} data-testid={testId}>
      <span className="playing-card-rank" aria-hidden="true">
        {displayRank}
      </span>
      <span className="playing-card-suit" aria-hidden="true">
        {suit.symbol}
      </span>
    </span>
  );
}
