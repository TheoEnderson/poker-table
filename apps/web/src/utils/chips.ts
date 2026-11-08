export type ChipColor = 'white' | 'red' | 'blue' | 'green' | 'black' | 'purple' | 'gold';

export interface ChipTheme {
  denomination: number;
  color: ChipColor;
  bg: string;
  edge: string;
  accent: string;
  textColor: string;
}

export const CHIP_THEMES: readonly ChipTheme[] = Object.freeze([
  {
    denomination: 1000,
    color: 'gold',
    bg: '#d97706', // Amber/Gold
    edge: '#fef3c7',
    accent: '#b45309',
    textColor: '#ffffff',
  },
  {
    denomination: 500,
    color: 'purple',
    bg: '#7c3aed', // Purple
    edge: '#ede9fe',
    accent: '#5b21b6',
    textColor: '#ffffff',
  },
  {
    denomination: 100,
    color: 'black',
    bg: '#1e293b', // Dark Slate / Black
    edge: '#cbd5e1',
    accent: '#0f172a',
    textColor: '#f8fafc',
  },
  {
    denomination: 25,
    color: 'green',
    bg: '#059669', // Emerald green
    edge: '#d1fae5',
    accent: '#065f46',
    textColor: '#ffffff',
  },
  {
    denomination: 10,
    color: 'blue',
    bg: '#2563eb', // Royal blue
    edge: '#dbeafe',
    accent: '#1e40af',
    textColor: '#ffffff',
  },
  {
    denomination: 5,
    color: 'red',
    bg: '#dc2626', // Crimson red
    edge: '#fee2e2',
    accent: '#991b1b',
    textColor: '#ffffff',
  },
  {
    denomination: 1,
    color: 'white',
    bg: '#f1f5f9', // Clean light slate
    edge: '#94a3b8',
    accent: '#64748b',
    textColor: '#1e293b',
  },
]);

export interface VisualChip {
  denomination: number;
  color: ChipColor;
  bg: string;
  edge: string;
  accent: string;
  textColor: string;
}

/**
 * Decompõe um valor numérico em uma representação visual de fichas empilhadas.
 *
 * Limita a pilha a no máximo 5 fichas para manter excelente legibilidade
 * e proporção espacial no feltro mobile e desktop.
 * As fichas retornadas são ordenadas da base para o topo da pilha.
 */
export function decomposeAmountToChips(amount: number, maxChips = 5): VisualChip[] {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return [];
  }

  const chips: VisualChip[] = [];
  let remaining = amount;

  // Encontra as denominações mais adequadas para representar o valor
  for (const theme of CHIP_THEMES) {
    if (remaining <= 0) break;
    const count = Math.floor(remaining / theme.denomination);
    if (count > 0) {
      const take = Math.min(count, maxChips - chips.length);
      for (let i = 0; i < take; i++) {
        chips.push({
          denomination: theme.denomination,
          color: theme.color,
          bg: theme.bg,
          edge: theme.edge,
          accent: theme.accent,
          textColor: theme.textColor,
        });
      }
      remaining -= take * theme.denomination;
      if (chips.length >= maxChips) break;
    }
  }

  // Se o limite foi atingido mas ainda resta troco (ou para valores fracionados menores que o mínimo disponível),
  // garante ao menos 1 ficha representativa da denominação mais próxima.
  if (chips.length === 0) {
    const lowest = CHIP_THEMES[CHIP_THEMES.length - 1];
    chips.push({
      denomination: lowest.denomination,
      color: lowest.color,
      bg: lowest.bg,
      edge: lowest.edge,
      accent: lowest.accent,
      textColor: lowest.textColor,
    });
  }

  // Retorna ordenado da base (maior valor no início do array) para o topo (menor valor no final)
  return chips;
}

/**
 * Retorna o tema da ficha individual correspondente ao valor aproximado.
 */
export function getChipThemeForAmount(amount: number): ChipTheme {
  for (const theme of CHIP_THEMES) {
    if (amount >= theme.denomination) {
      return theme;
    }
  }
  return CHIP_THEMES[CHIP_THEMES.length - 1];
}
