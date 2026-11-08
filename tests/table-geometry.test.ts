import { describe, it, expect } from 'vitest';
import { getSeatPosition, getRelativeSeatIndex } from '../apps/web/src/utils/table-geometry.js';

describe('Table geometry and egocentric orientation', () => {
  it('positions the self player at South (bottom) for any self index', () => {
    const total = 6;
    for (let selfIdx = 0; selfIdx < total; selfIdx++) {
      const relIdx = getRelativeSeatIndex(selfIdx, selfIdx, total);
      expect(relIdx).toBe(0);
      const pos = getSeatPosition(total, relIdx);
      expect(pos.zone).toBe('south');
      expect(pos.xPercent).toBe(50);
      expect(pos.yPercent).toBeGreaterThanOrEqual(85);
    }
  });

  it('calculates clockwise relative indices correctly around the table', () => {
    // 6 players with self player at index 2
    const total = 6;
    const selfIdx = 2;

    expect(getRelativeSeatIndex(2, selfIdx, total)).toBe(0); // Self -> South
    expect(getRelativeSeatIndex(3, selfIdx, total)).toBe(1); // Next clockwise
    expect(getRelativeSeatIndex(4, selfIdx, total)).toBe(2);
    expect(getRelativeSeatIndex(5, selfIdx, total)).toBe(3); // Opposite -> North
    expect(getRelativeSeatIndex(0, selfIdx, total)).toBe(4);
    expect(getRelativeSeatIndex(1, selfIdx, total)).toBe(5);
  });

  it('spectator mode preserves natural order starting at index 0', () => {
    const total = 6;
    const spectatorIdx = -1;
    for (let i = 0; i < total; i++) {
      expect(getRelativeSeatIndex(i, spectatorIdx, total)).toBe(i);
    }
  });

  it('guarantees valid coordinate ranges (5% to 95%) for all player counts from 2 to 10', () => {
    for (let count = 2; count <= 10; count++) {
      for (let i = 0; i < count; i++) {
        const pos = getSeatPosition(count, i);
        expect(pos.xPercent).toBeGreaterThanOrEqual(5);
        expect(pos.xPercent).toBeLessThanOrEqual(95);
        expect(pos.yPercent).toBeGreaterThanOrEqual(5);
        expect(pos.yPercent).toBeLessThanOrEqual(95);
        expect(Number.isFinite(pos.xPercent)).toBe(true);
        expect(Number.isFinite(pos.yPercent)).toBe(true);
      }
    }
  });

  it('ensures distinct non-overlapping positions for every player in 2 to 10 seat tables', () => {
    for (let count = 2; count <= 10; count++) {
      const positions = Array.from({ length: count }, (_, i) => getSeatPosition(count, i));
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          const dx = positions[i].xPercent - positions[j].xPercent;
          const dy = positions[i].yPercent - positions[j].yPercent;
          const dist = Math.hypot(dx, dy);
          // Distance in percentage points must be significant to prevent overlap
          expect(dist).toBeGreaterThanOrEqual(14);
        }
      }
    }
  });

  it('handles heads-up (2 players) strictly as North and South', () => {
    const south = getSeatPosition(2, 0);
    const north = getSeatPosition(2, 1);

    expect(south.zone).toBe('south');
    expect(south.xPercent).toBe(50);
    expect(south.yPercent).toBe(92);

    expect(north.zone).toBe('north');
    expect(north.xPercent).toBe(50);
    expect(north.yPercent).toBe(8);
  });
});
