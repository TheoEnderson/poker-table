import { describe, it, expect } from 'vitest';
import type { AllowedActions } from '@poker-table/protocol';
import {
  resolvePreAction,
  shouldCancelPreActionOnBetChange,
  getPreActionLabel,
  getPreActionDescription,
  type PreActionState,
} from '../apps/web/src/utils/pre-actions.js';

describe('Pre-Actions logic utilities', () => {
  const dummyAllowed = (overrides?: Partial<AllowedActions>): AllowedActions => ({
    playerId: 'p1',
    canFold: true,
    canCheck: true,
    canCall: false,
    callAmount: 0,
    canRaise: true,
    minRaiseAmount: 40,
    maxRaiseAmount: 1000,
    minRaiseIncrement: 20,
    currentBet: 0,
    canAllIn: true,
    allInAmount: 1000,
    allInType: 'raise',
    actionNotReopened: false,
    ...overrides,
  });

  describe('resolvePreAction', () => {
    it('executes Check automatically when canCheck is true', () => {
      const preAction: PreActionState = {
        type: 'check',
        street: 'flop',
        handDealerSeat: 1,
        createdCurrentBet: 0,
      };

      const result = resolvePreAction({
        preAction,
        allowed: dummyAllowed({ canCheck: true }),
        currentStreet: 'flop',
        currentDealerSeat: 1,
      });

      expect(result.actionToSend).toBe('check');
      expect(result.shouldCancel).toBe(true);
    });

    it('cancels Check without executing any command when Check is not allowed (bet faced)', () => {
      const preAction: PreActionState = {
        type: 'check',
        street: 'flop',
        handDealerSeat: 1,
        createdCurrentBet: 0,
      };

      // Player faces a bet of 50
      const result = resolvePreAction({
        preAction,
        allowed: dummyAllowed({ canCheck: false, canCall: true, callAmount: 50, currentBet: 50 }),
        currentStreet: 'flop',
        currentDealerSeat: 1,
      });

      // Crucial: never converts Check to Call or Fold!
      expect(result.actionToSend).toBeNull();
      expect(result.shouldCancel).toBe(true);
      expect(result.reason).toBe('bet_faced');
    });

    it('executes Check for Check/Fold when canCheck is true', () => {
      const preAction: PreActionState = {
        type: 'check-fold',
        street: 'flop',
        handDealerSeat: 1,
        createdCurrentBet: 0,
      };

      const result = resolvePreAction({
        preAction,
        allowed: dummyAllowed({ canCheck: true, canFold: true }),
        currentStreet: 'flop',
        currentDealerSeat: 1,
      });

      expect(result.actionToSend).toBe('check');
      expect(result.shouldCancel).toBe(true);
    });

    it('executes Fold for Check/Fold when canCheck is false and canFold is true', () => {
      const preAction: PreActionState = {
        type: 'check-fold',
        street: 'flop',
        handDealerSeat: 1,
        createdCurrentBet: 0,
      };

      // Player faces bet
      const result = resolvePreAction({
        preAction,
        allowed: dummyAllowed({ canCheck: false, canFold: true, canCall: true, callAmount: 40 }),
        currentStreet: 'flop',
        currentDealerSeat: 1,
      });

      expect(result.actionToSend).toBe('fold');
      expect(result.shouldCancel).toBe(true);
    });

    it('executes Fold for Fold intention when canFold is true', () => {
      const preAction: PreActionState = {
        type: 'fold',
        street: 'preflop',
        handDealerSeat: 2,
        createdCurrentBet: 20,
      };

      const result = resolvePreAction({
        preAction,
        allowed: dummyAllowed({ canFold: true }),
        currentStreet: 'preflop',
        currentDealerSeat: 2,
      });

      expect(result.actionToSend).toBe('fold');
      expect(result.shouldCancel).toBe(true);
    });

    it('cancels without action when street changed', () => {
      const preAction: PreActionState = {
        type: 'check',
        street: 'flop',
        handDealerSeat: 1,
        createdCurrentBet: 0,
      };

      const result = resolvePreAction({
        preAction,
        allowed: dummyAllowed(),
        currentStreet: 'turn', // street advanced!
        currentDealerSeat: 1,
      });

      expect(result.actionToSend).toBeNull();
      expect(result.shouldCancel).toBe(true);
      expect(result.reason).toBe('street_or_hand_changed');
    });

    it('cancels without action when hand/dealerSeat changed', () => {
      const preAction: PreActionState = {
        type: 'fold',
        street: 'preflop',
        handDealerSeat: 1,
        createdCurrentBet: 20,
      };

      const result = resolvePreAction({
        preAction,
        allowed: dummyAllowed(),
        currentStreet: 'preflop',
        currentDealerSeat: 2, // new hand!
      });

      expect(result.actionToSend).toBeNull();
      expect(result.shouldCancel).toBe(true);
      expect(result.reason).toBe('street_or_hand_changed');
    });

    it('cancels when allowed is null', () => {
      const preAction: PreActionState = {
        type: 'check',
        street: 'flop',
        handDealerSeat: 1,
        createdCurrentBet: 0,
      };

      const result = resolvePreAction({
        preAction,
        allowed: null,
        currentStreet: 'flop',
        currentDealerSeat: 1,
      });

      expect(result.actionToSend).toBeNull();
      expect(result.shouldCancel).toBe(true);
      expect(result.reason).toBe('no_allowed_actions');
    });
  });

  describe('shouldCancelPreActionOnBetChange', () => {
    it('cancels Check if another player bets/raises before our turn', () => {
      const preAction: PreActionState = {
        type: 'check',
        street: 'flop',
        handDealerSeat: 1,
        createdCurrentBet: 0,
      };

      // Player committed 0, but current street bet is now 50
      const shouldCancel = shouldCancelPreActionOnBetChange({
        preAction,
        currentStreetBet: 50,
        playerRoundCommitted: 0,
      });

      expect(shouldCancel).toBe(true);
    });

    it('does NOT cancel Check if currentStreetBet <= playerRoundCommitted', () => {
      const preAction: PreActionState = {
        type: 'check',
        street: 'flop',
        handDealerSeat: 1,
        createdCurrentBet: 0,
      };

      const shouldCancel = shouldCancelPreActionOnBetChange({
        preAction,
        currentStreetBet: 0,
        playerRoundCommitted: 0,
      });

      expect(shouldCancel).toBe(false);
    });

    it('does NOT cancel Check/Fold when someone bets (since it folds if bet exists)', () => {
      const preAction: PreActionState = {
        type: 'check-fold',
        street: 'flop',
        handDealerSeat: 1,
        createdCurrentBet: 0,
      };

      const shouldCancel = shouldCancelPreActionOnBetChange({
        preAction,
        currentStreetBet: 50,
        playerRoundCommitted: 0,
      });

      expect(shouldCancel).toBe(false);
    });

    it('does NOT cancel Fold when someone bets', () => {
      const preAction: PreActionState = {
        type: 'fold',
        street: 'flop',
        handDealerSeat: 1,
        createdCurrentBet: 0,
      };

      const shouldCancel = shouldCancelPreActionOnBetChange({
        preAction,
        currentStreetBet: 50,
        playerRoundCommitted: 0,
      });

      expect(shouldCancel).toBe(false);
    });

    it('returns false if preAction is null', () => {
      const shouldCancel = shouldCancelPreActionOnBetChange({
        preAction: null,
        currentStreetBet: 50,
        playerRoundCommitted: 0,
      });

      expect(shouldCancel).toBe(false);
    });
  });

  describe('labels and descriptions', () => {
    it('returns clear and accurate labels', () => {
      expect(getPreActionLabel('check')).toBe('Check');
      expect(getPreActionLabel('check-fold')).toBe('Check / Fold');
      expect(getPreActionLabel('fold')).toBe('Fold');

      expect(getPreActionDescription('check')).toBe('Passar (Check)');
      expect(getPreActionDescription('check-fold')).toBe('Passar se possível; caso contrário, desistir.');
      expect(getPreActionDescription('fold')).toBe('Desistir (Fold)');
    });
  });
});
