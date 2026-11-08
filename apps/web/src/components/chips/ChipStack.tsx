import type { CSSProperties } from 'react';
import { decomposeAmountToChips } from '../../utils/chips';
import { PokerChip } from './PokerChip';

export interface ChipStackProps {
  amount: number;
  maxChips?: number;
  size?: 'xs' | 'sm' | 'md' | 'lg' | number;
  showValue?: boolean;
  className?: string;
  style?: CSSProperties;
  variant?: 'stack' | 'cluster';
}

const CHIP_PIXEL_MAP: Record<'xs' | 'sm' | 'md' | 'lg', number> = {
  xs: 16,
  sm: 20,
  md: 26,
  lg: 34,
};

const CHIP_STACK_STEPS: Record<'xs' | 'sm' | 'md' | 'lg', number> = {
  xs: 2.5,
  sm: 3,
  md: 3.5,
  lg: 4,
};

export function ChipStack({
  amount,
  maxChips = 4,
  size = 'sm',
  showValue = false,
  className = '',
  style,
  variant = 'stack',
}: ChipStackProps) {
  if (amount <= 0) {
    return null;
  }

  const pixelSize = typeof size === 'number' ? size : CHIP_PIXEL_MAP[size] ?? 20;
  const step = typeof size === 'number' ? Math.max(2, size * 0.15) : CHIP_STACK_STEPS[size] ?? 3;
  // Overlap negativo necessário para que apenas a borda (step) de cada ficha fique visível acima da anterior
  const negativeMargin = -(pixelSize - step);

  const chips = decomposeAmountToChips(amount, maxChips);
  if (chips.length === 0) {
    return null;
  }

  // Variante Cluster: agrupa fichas em mini-pilhas baixas repousadas no feltro (máximo ~22-26px de altura)
  if (variant === 'cluster') {
    // Divide as fichas em até 3 colunas baixas lado a lado com sobreposição horizontal e perspectiva
    let columns: Array<typeof chips> = [];
    if (chips.length === 1) {
      columns = [[chips[0]]];
    } else if (chips.length === 2) {
      columns = [[chips[0]], [chips[1]]];
    } else if (chips.length === 3) {
      columns = [[chips[0], chips[1]], [chips[2]]];
    } else if (chips.length === 4) {
      columns = [[chips[0], chips[1]], [chips[2], chips[3]]];
    } else {
      // 5 fichas: 2 + 2 + 1
      columns = [[chips[0], chips[1]], [chips[2], chips[3]], [chips[4]]];
    }

    const verticalOffsets = [1, -2, 2];

    return (
      <div
        className={`chip-cluster-wrapper ${className}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          lineHeight: 1,
          filter: 'drop-shadow(0 2.5px 3.5px rgba(0, 0, 0, 0.6))',
          ...style,
        }}
      >
        {columns.map((col, colIdx) => (
          <div
            key={colIdx}
            className="chip-cluster-column"
            style={{
              display: 'flex',
              flexDirection: 'column-reverse',
              alignItems: 'center',
              marginLeft: colIdx > 0 ? `-${Math.round(pixelSize * 0.42)}px` : '0px',
              transform: `translateY(${verticalOffsets[colIdx % verticalOffsets.length]}px)`,
              zIndex: colIdx + 1,
            }}
          >
            {col.map((chip, chipIdx) => (
              <div
                key={chipIdx}
                className="chip-in-stack"
                style={{
                  marginTop: chipIdx > 0 ? `${negativeMargin}px` : '0px',
                  zIndex: chipIdx + 1,
                }}
              >
                <PokerChip color={chip.color} size={size} />
              </div>
            ))}
          </div>
        ))}
        {showValue && (
          <span className="chip-stack-value tabular-nums" style={{ marginLeft: '6px' }}>
            {amount}
          </span>
        )}
      </div>
    );
  }

  // Variante Stack padrão: coluna única vertical compacta (usada nas apostas de jogadores)
  return (
    <div
      className={`chip-stack-wrapper ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        lineHeight: 1,
        ...style,
      }}
    >
      <div
        className="chip-stack-single"
        style={{
          display: 'flex',
          flexDirection: 'column-reverse',
          alignItems: 'center',
          position: 'relative',
        }}
      >
        {chips.map((chip, idx) => (
          <div
            key={idx}
            className="chip-in-stack"
            style={{
              marginTop: idx > 0 ? `${negativeMargin}px` : '0px',
              zIndex: idx + 1,
            }}
          >
            <PokerChip color={chip.color} size={size} />
          </div>
        ))}
      </div>
      {showValue && (
        <span className="chip-stack-value tabular-nums">
          {amount}
        </span>
      )}
    </div>
  );
}
