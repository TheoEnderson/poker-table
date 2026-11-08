import { describe, it, expect } from 'vitest';
import { decomposeAmountToChips, getChipThemeForAmount, CHIP_THEMES } from '../apps/web/src/utils/chips.js';

describe('Chip decomposition and themes', () => {
  it('returns empty array for zero or negative amounts', () => {
    expect(decomposeAmountToChips(0)).toEqual([]);
    expect(decomposeAmountToChips(-10)).toEqual([]);
    expect(decomposeAmountToChips(NaN)).toEqual([]);
  });

  it('decomposes small blinds correctly', () => {
    // SB = 10 chips: 1 blue chip (denomination 10)
    const sb = decomposeAmountToChips(10);
    expect(sb.length).toBe(1);
    expect(sb[0].denomination).toBe(10);
    expect(sb[0].color).toBe('blue');

    // BB = 20 chips: 2 blue chips (denomination 10)
    const bb = decomposeAmountToChips(20);
    expect(bb.length).toBe(2);
    expect(bb[0].denomination).toBe(10);
    expect(bb[1].denomination).toBe(10);
  });

  it('decomposes standard bets and raises', () => {
    // Bet = 60 chips: 1 green (50) or 25x2 + 10...
    // 60 / 25 = 2 (50), remainder 10 / 10 = 1 (10).
    const chips60 = decomposeAmountToChips(60);
    expect(chips60.length).toBe(3);
    // Ordered base to top: two 25s, one 10
    expect(chips60[0].denomination).toBe(25);
    expect(chips60[1].denomination).toBe(25);
    expect(chips60[2].denomination).toBe(10);
  });

  it('respects maxChips limit to prevent visual clutter', () => {
    const pot = decomposeAmountToChips(1840, 4);
    expect(pot.length).toBeLessThanOrEqual(4);
    // Base chip should be highest denomination (1000 gold)
    expect(pot[0].denomination).toBe(1000);
    expect(pot[0].color).toBe('gold');
  });

  it('handles small values below 5 gracefully', () => {
    const single = decomposeAmountToChips(3);
    expect(single.length).toBe(3);
    expect(single[0].denomination).toBe(1);
    expect(single[0].color).toBe('white');
  });

  it('getChipThemeForAmount selects the dominant theme', () => {
    expect(getChipThemeForAmount(10).color).toBe('blue');
    expect(getChipThemeForAmount(50).color).toBe('green');
    expect(getChipThemeForAmount(150).color).toBe('black');
    expect(getChipThemeForAmount(700).color).toBe('purple');
    expect(getChipThemeForAmount(2500).color).toBe('gold');
  });

  it('themes contain valid hex colors and accessible text colors', () => {
    for (const theme of CHIP_THEMES) {
      expect(theme.bg).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.edge).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.denomination).toBeGreaterThan(0);
    }
  });
});
