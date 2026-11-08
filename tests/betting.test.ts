import { describe, it, expect } from 'vitest';
import { calculatePotTarget, getBetPresets } from '../apps/web/src/utils/betting.js';

describe('Betting calculation utilities', () => {
  describe('calculatePotTarget', () => {
    it('calculates opening bets (currentBet === 0) accurately', () => {
      // Flop: pot of 100, no previous bet, min bet 20, max stack 1000
      const halfPot = calculatePotTarget({
        pot: 100,
        currentBet: 0,
        playerRoundCommitted: 0,
        fraction: 0.5,
        minRaiseAmount: 20,
        maxRaiseAmount: 1000,
      });
      expect(halfPot).toBe(50);

      const fullPot = calculatePotTarget({
        pot: 100,
        currentBet: 0,
        playerRoundCommitted: 0,
        fraction: 1.0,
        minRaiseAmount: 20,
        maxRaiseAmount: 1000,
      });
      expect(fullPot).toBe(100);
    });

    it('calculates raises facing a bet (currentBet > 0) with standard pot formula', () => {
      // Preflop: SB 10, BB 20. Pot = 30. UTG roundCommitted = 0.
      // toCall = 20, potAfterCall = 30 + 20 = 50.
      // Pot raise: 20 + 50 = 70.
      const fullPotPreflop = calculatePotTarget({
        pot: 30,
        currentBet: 20,
        playerRoundCommitted: 0,
        fraction: 1.0,
        minRaiseAmount: 40,
        maxRaiseAmount: 1000,
      });
      expect(fullPotPreflop).toBe(70);

      // Half pot preflop: 20 + 25 = 45.
      const halfPotPreflop = calculatePotTarget({
        pot: 30,
        currentBet: 20,
        playerRoundCommitted: 0,
        fraction: 0.5,
        minRaiseAmount: 40,
        maxRaiseAmount: 1000,
      });
      expect(halfPotPreflop).toBe(45);
    });

    it('takes playerRoundCommitted into account when facing a raise (e.g. SB or re-raise)', () => {
      // Preflop: SB has committed 10. BB has committed 20.
      // Button raised to 60. Pot = 10 + 20 + 60 = 90.
      // SB (committed 10) wants to re-raise.
      // toCall for SB = 60 - 10 = 50.
      // potAfterCall = 90 + 50 = 140.
      // Full pot re-raise = currentBet (60) + 140 = 200.
      const sbPotRaise = calculatePotTarget({
        pot: 90,
        currentBet: 60,
        playerRoundCommitted: 10,
        fraction: 1.0,
        minRaiseAmount: 100,
        maxRaiseAmount: 1000,
      });
      expect(sbPotRaise).toBe(200);

      // Half pot re-raise = 60 + Math.round(140 * 0.5) = 60 + 70 = 130.
      const sbHalfPotRaise = calculatePotTarget({
        pot: 90,
        currentBet: 60,
        playerRoundCommitted: 10,
        fraction: 0.5,
        minRaiseAmount: 100,
        maxRaiseAmount: 1000,
      });
      expect(sbHalfPotRaise).toBe(130);
    });

    it('clamps properly when target is below minRaiseAmount', () => {
      // Pot is small: 10. Min raise is 20.
      // Half pot would be 5, but must clamp to minRaiseAmount (20)
      const clampedMin = calculatePotTarget({
        pot: 10,
        currentBet: 0,
        playerRoundCommitted: 0,
        fraction: 0.5,
        minRaiseAmount: 20,
        maxRaiseAmount: 1000,
      });
      expect(clampedMin).toBe(20);
    });

    it('clamps properly to maxRaiseAmount when player stack is smaller than pot target', () => {
      // Pot is 500, but player only has maxRaiseAmount of 150
      const clampedMax = calculatePotTarget({
        pot: 500,
        currentBet: 0,
        playerRoundCommitted: 0,
        fraction: 1.0,
        minRaiseAmount: 20,
        maxRaiseAmount: 150,
      });
      expect(clampedMax).toBe(150);
    });

    it('handles edge case where maxRaiseAmount <= minRaiseAmount', () => {
      const edge = calculatePotTarget({
        pot: 100,
        currentBet: 0,
        playerRoundCommitted: 0,
        fraction: 1.0,
        minRaiseAmount: 100,
        maxRaiseAmount: 100,
      });
      expect(edge).toBe(100);
    });
  });

  describe('getBetPresets', () => {
    it('returns the 4 standard presets with correct labels, values, and flags', () => {
      const presets = getBetPresets({
        pot: 100,
        currentBet: 0,
        playerRoundCommitted: 0,
        minRaiseAmount: 20,
        maxRaiseAmount: 500,
      });

      expect(presets).toHaveLength(4);
      expect(presets[0]).toEqual({
        id: 'min',
        label: 'MÍN.',
        amount: 20,
        isAllIn: false,
      });
      expect(presets[1]).toEqual({
        id: 'half-pot',
        label: '½ POTE',
        amount: 50,
        isAllIn: false,
      });
      expect(presets[2]).toEqual({
        id: 'pot',
        label: 'POTE',
        amount: 100,
        isAllIn: false,
      });
      expect(presets[3]).toEqual({
        id: 'max',
        label: 'MÁX.',
        amount: 500,
        isAllIn: true,
      });
    });

    it('flags presets as isAllIn when they reach maxRaiseAmount', () => {
      // Short stack: max is 40.
      const presets = getBetPresets({
        pot: 100,
        currentBet: 0,
        playerRoundCommitted: 0,
        minRaiseAmount: 20,
        maxRaiseAmount: 40,
      });

      expect(presets.find(p => p.id === 'min')?.isAllIn).toBe(false);
      // Half pot would be 50, clamped to 40 -> isAllIn
      expect(presets.find(p => p.id === 'half-pot')).toEqual({
        id: 'half-pot',
        label: '½ POTE',
        amount: 40,
        isAllIn: true,
      });
      // Full pot would be 100, clamped to 40 -> isAllIn
      expect(presets.find(p => p.id === 'pot')).toEqual({
        id: 'pot',
        label: 'POTE',
        amount: 40,
        isAllIn: true,
      });
      expect(presets.find(p => p.id === 'max')?.isAllIn).toBe(true);
    });

    it('calculates exact blinds 10/20 preflop scenarios for SB vs uncommitted player', () => {
      // Scenario 1: Small Blind (committed 10, faces BB 20). Pot is 30.
      const sbPresets = getBetPresets({
        pot: 30,
        currentBet: 20,
        playerRoundCommitted: 10,
        minRaiseAmount: 40,
        maxRaiseAmount: 1000,
      });

      // MÍN. is 40
      expect(sbPresets.find(p => p.id === 'min')?.amount).toBe(40);
      // ½ POTE: toCall 10, potAfterCall 40 -> increment 20 -> 20 + 20 = 40
      expect(sbPresets.find(p => p.id === 'half-pot')?.amount).toBe(40);
      // POTE: toCall 10, potAfterCall 40 -> increment 40 -> 20 + 40 = 60
      expect(sbPresets.find(p => p.id === 'pot')?.amount).toBe(60);

      // Scenario 2: Uncommitted player (committed 0, faces BB 20). Pot is 30.
      const uncommittedPresets = getBetPresets({
        pot: 30,
        currentBet: 20,
        playerRoundCommitted: 0,
        minRaiseAmount: 40,
        maxRaiseAmount: 1000,
      });

      // MÍN. is 40
      expect(uncommittedPresets.find(p => p.id === 'min')?.amount).toBe(40);
      // ½ POTE: toCall 20, potAfterCall 50 -> increment 25 -> 20 + 25 = 45
      expect(uncommittedPresets.find(p => p.id === 'half-pot')?.amount).toBe(45);
      // POTE: toCall 20, potAfterCall 50 -> increment 50 -> 20 + 50 = 70
      expect(uncommittedPresets.find(p => p.id === 'pot')?.amount).toBe(70);
    });
  });

  describe('Partial call All-in financial invariants', () => {
    it('presents callAmount as 60 (and not 100) when player has 60 chips and faces 100', async () => {
      const { initHand, createPreFlopRound, raise, getAllowedActions, applyAction } = await import(
        '@poker-table/engine'
      );

      const p1Id = '00000000-0000-0000-0000-000000000001';
      const p2Id = '00000000-0000-0000-0000-000000000002';

      // P1 has 1000 chips. P2 has 80 chips total.
      // Preflop: P1 is SB (posts 10), P2 is BB (posts 20, remaining chips: 60).
      const hand = initHand({
        players: [
          { id: p1Id, seat: 1, chips: 1000 },
          { id: p2Id, seat: 2, chips: 80 },
        ],
        blinds: { smallBlind: 10, bigBlind: 20 },
        dealerSeat: 1,
      });

      let round = createPreFlopRound(hand);
      // P1 raises to 100
      round = raise(round, 100, p1Id);

      // Action is now on P2: currentBet is 100, owes 80, but has only 60 chips remaining!
      expect(round.currentActorId).toBe(p2Id);
      expect(round.currentBet).toBe(100);

      const allowed = getAllowedActions(round, p2Id);
      expect(allowed).not.toBeNull();
      // Crucial: callAmount is 60 (clamped to player chips), NOT 100!
      expect(allowed!.callAmount).toBe(60);
      expect(allowed!.canCall).toBe(true);
      // P2 cannot raise (stack < min raise)
      expect(allowed!.canRaise).toBe(false);
      // All-in is available as a call (allInType === 'call')
      expect(allowed!.canAllIn).toBe(true);
      expect(allowed!.allInType).toBe('call');
      expect(allowed!.allInAmount).toBe(60);

      // Applying Call action
      const nextRound = applyAction(round, { type: 'call', playerId: p2Id });
      const p2After = nextRound.players.find(p => p.id === p2Id);
      expect(p2After?.chips).toBe(0);
      expect(p2After?.committed).toBe(80); // 20 blind + 60 call
      expect(p2After?.isAllIn).toBe(true);

      // Total chips conserved across players: 900 + 100 + 80 = 1080
      const totalChips = nextRound.players.reduce((sum, p) => sum + p.chips + p.committed, 0);
      expect(totalChips).toBe(1080);
    });
  });
});
