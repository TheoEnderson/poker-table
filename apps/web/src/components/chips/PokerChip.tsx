import type { CSSProperties } from 'react';
import type { ChipColor } from '../../utils/chips';
import { CHIP_THEMES } from '../../utils/chips';

export interface PokerChipProps {
  color?: ChipColor;
  denomination?: number;
  size?: number | 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  style?: CSSProperties;
  'aria-hidden'?: boolean | 'true' | 'false';
}

const SIZE_MAP: Record<'xs' | 'sm' | 'md' | 'lg', number> = {
  xs: 16,
  sm: 20,
  md: 26,
  lg: 34,
};

export function PokerChip({
  color,
  denomination,
  size = 'sm',
  className = '',
  style,
  'aria-hidden': ariaHidden = true,
}: PokerChipProps) {
  const pixelSize = typeof size === 'number' ? size : SIZE_MAP[size] ?? 20;

  // Resolve o tema visual com base na cor ou denominação informada
  const theme =
    (color ? CHIP_THEMES.find(t => t.color === color) : undefined) ??
    (denomination ? CHIP_THEMES.find(t => t.denomination <= denomination) : undefined) ??
    CHIP_THEMES[CHIP_THEMES.length - 1];

  const uniqueId = `chip-grad-${theme.color}-${pixelSize}`;

  return (
    <svg
      width={pixelSize}
      height={pixelSize}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`poker-chip-svg chip-${theme.color} ${className}`}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        filter: 'drop-shadow(0 1.5px 2px rgba(0, 0, 0, 0.45))',
        flexShrink: 0,
        ...style,
      }}
      aria-hidden={ariaHidden}
    >
      <defs>
        {/* Gradiente sutil para sensação de relevo tridimensional */}
        <linearGradient id={uniqueId} x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.25" />
          <stop offset="50%" stopColor={theme.bg} />
          <stop offset="100%" stopColor={theme.accent} />
        </linearGradient>
      </defs>

      {/* 1. Borda externa e base da ficha */}
      <circle cx="16" cy="16" r="15" fill={`url(#${uniqueId})`} stroke={theme.accent} strokeWidth="0.8" />

      {/* 2. Listras perimetrais (estilo clássico cassino) */}
      <circle
        cx="16"
        cy="16"
        r="13.2"
        fill="none"
        stroke={theme.edge}
        strokeWidth="3.2"
        strokeDasharray="4 4.3"
      />

      {/* 3. Anel de costura interno */}
      <circle
        cx="16"
        cy="16"
        r="11"
        fill="none"
        stroke={theme.accent}
        strokeWidth="0.75"
        strokeDasharray="1.5 1.2"
        opacity="0.8"
      />

      {/* 4. Núcleo circular central */}
      <circle
        cx="16"
        cy="16"
        r="8.5"
        fill={theme.accent}
        fillOpacity="0.22"
        stroke={theme.edge}
        strokeWidth="0.6"
      />

      {/* 5. Emblema simbólico central (Naipe de Espadas estilizado) */}
      <path
        d="M16 10.8 C15.4 12 13 14 13 15.5 C13 16.9 14.2 17.8 15.4 17.5 C15.7 17.4 15.9 17.2 16 16.9 C16.1 17.2 16.3 17.4 16.6 17.5 C17.8 17.8 19 16.9 19 15.5 C19 14 16.6 12 16 10.8 Z M15.4 17.5 L14.8 20.2 L17.2 20.2 L16.6 17.5 Z"
        fill={theme.textColor}
        fillOpacity="0.9"
      />

      {/* 6. Brilho especular curvo superior para profundidade */}
      <path
        d="M 6 12 A 11 11 0 0 1 26 12 A 13 8 0 0 0 6 12"
        fill="#ffffff"
        fillOpacity="0.28"
      />
    </svg>
  );
}
