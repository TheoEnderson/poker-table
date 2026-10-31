import { describe, expect, it } from 'vitest';
import {
  advanceStreet,
  EngineError,
  handAllIn,
  handCall,
  handCheck,
  handFold,
  handRaise,
  initHand,
  settleHand,
  settleHandFlow,
  startHandFlow,
  type HandFlowState,
  type PlayerInput,
  type PotWinnerDecision,
  type SettlementResult,
} from '@poker-table/engine';

describe('Texas Hold\'em Engine — Integração do Showdown e Liquidação de Mãos Completas (Etapa 2.4B)', () => {
  const defaultBlinds = { smallBlind: 10, bigBlind: 20 };

  function buildShowdownHand(): HandFlowState {
    const players: PlayerInput[] = [
      { id: 'p1', seat: 1, chips: 1000 },
      { id: 'p2', seat: 2, chips: 1000 },
      { id: 'p3', seat: 3, chips: 1000 },
    ];

    let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
    // Preflop: p1 (UTG) calls 20, p2 (SB) calls 20 (adds 10), p3 (BB) checks
    state = handCall(state, 'p1');
    state = handCall(state, 'p2');
    state = handCheck(state, 'p3');

    // Flop
    state = advanceStreet(state);
    state = handCheck(state, 'p2');
    state = handCheck(state, 'p3');
    state = handCheck(state, 'p1');

    // Turn
    state = advanceStreet(state);
    state = handCheck(state, 'p2');
    state = handCheck(state, 'p3');
    state = handCheck(state, 'p1');

    // River
    state = advanceStreet(state);
    state = handCheck(state, 'p2');
    state = handCheck(state, 'p3');
    state = handCheck(state, 'p1');

    // Showdown
    state = advanceStreet(state);
    return state;
  }

  // 1. Liquidação após river
  describe('1. Liquidação após river', () => {
    it('liquida a mão corretamente após river alcançando showdown com decisões válidas', () => {
      const state = buildShowdownHand();
      expect(state.status).toBe('showdown');
      expect(state.pot).toBe(60);

      const decisions: PotWinnerDecision[] = [
        { potId: 'main', winners: ['p1'] },
      ];

      const result = settleHandFlow(state, decisions);

      expect(result.status).toBe('settled');
      expect(result.isSettled).toBe(true);
      expect(result.pot).toBe(0);
      expect(result.originalPot).toBe(60);
      expect(result.summary.totalDistributed).toBe(60);

      const winner = result.players.find(p => p.id === 'p1')!;
      expect(winner.chips).toBe(1040); // 1000 - 20 + 60
      expect(winner.totalWon).toBe(60);
      expect(winner.committed).toBe(0);
      expect(winner.isAllIn).toBe(false);

      const p2 = result.players.find(p => p.id === 'p2')!;
      expect(p2.chips).toBe(980);
      expect(p2.totalWon).toBe(0);

      const p3 = result.players.find(p => p.id === 'p3')!;
      expect(p3.chips).toBe(980);
      expect(p3.totalWon).toBe(0);

      // Conservação de fichas
      const totalChips = result.players.reduce((sum, p) => sum + p.chips, 0);
      expect(totalChips).toBe(3000);
    });
  });

  // 2. Rejeição antes do fim do pré-flop
  describe('2. Rejeição antes do fim do pré-flop', () => {
    it('rejeita tentativa de liquidação quando o pré-flop ainda está em andamento', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];

      const state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      expect(state.status).toBe('in_progress');
      expect(state.street).toBe('preflop');

      expect(() => settleHandFlow(state, [{ potId: 'main', winners: ['p1'] }]))
        .toThrowError(EngineError);

      try {
        settleHandFlow(state, [{ potId: 'main', winners: ['p1'] }]);
      } catch (err) {
        expect((err as EngineError).code).toBe('ROUND_NOT_ACTIVE');
      }
    });
  });

  // 3. Rejeição após pré-flop concluído, mas com a mão ainda em andamento
  describe('3. Rejeição após pré-flop concluído, mas com a mão ainda em andamento', () => {
    it('rejeita liquidação quando a rodada do pré-flop completou mas a street não avançou para o fim', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handCall(state, 'p1');
      state = handCheck(state, 'p2');

      expect(state.currentRound.status).toBe('completed');
      expect(state.status).toBe('in_progress');
      expect(state.street).toBe('preflop');

      expect(() => settleHandFlow(state, [{ potId: 'main', winners: ['p1'] }]))
        .toThrowError(EngineError);

      try {
        settleHandFlow(state, [{ potId: 'main', winners: ['p1'] }]);
      } catch (err) {
        expect((err as EngineError).code).toBe('ROUND_NOT_ACTIVE');
      }
    });
  });

  // 4. Rejeição durante flop ativo
  describe('4. Rejeição durante flop ativo', () => {
    it('rejeita liquidação com o flop ativo', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handCall(state, 'p1');
      state = handCheck(state, 'p2');
      state = advanceStreet(state); // Flop

      expect(state.street).toBe('flop');
      expect(state.status).toBe('in_progress');

      expect(() => settleHandFlow(state, [{ potId: 'main', winners: ['p1'] }]))
        .toThrowError(EngineError);

      try {
        settleHandFlow(state, [{ potId: 'main', winners: ['p1'] }]);
      } catch (err) {
        expect((err as EngineError).code).toBe('ROUND_NOT_ACTIVE');
      }
    });
  });

  // 5. Rejeição durante turn ativo
  describe('5. Rejeição durante turn ativo', () => {
    it('rejeita liquidação com o turn ativo', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handCall(state, 'p1');
      state = handCheck(state, 'p2');
      state = advanceStreet(state); // Flop
      state = handCheck(state, 'p2');
      state = handCheck(state, 'p1');
      state = advanceStreet(state); // Turn

      expect(state.street).toBe('turn');
      expect(state.status).toBe('in_progress');

      expect(() => settleHandFlow(state, [{ potId: 'main', winners: ['p1'] }]))
        .toThrowError(EngineError);

      try {
        settleHandFlow(state, [{ potId: 'main', winners: ['p1'] }]);
      } catch (err) {
        expect((err as EngineError).code).toBe('ROUND_NOT_ACTIVE');
      }
    });
  });

  // 6. Rejeição durante river ativo
  describe('6. Rejeição durante river ativo', () => {
    it('rejeita liquidação com o river ativo', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handCall(state, 'p1');
      state = handCheck(state, 'p2');
      state = advanceStreet(state); // Flop
      state = handCheck(state, 'p2');
      state = handCheck(state, 'p1');
      state = advanceStreet(state); // Turn
      state = handCheck(state, 'p2');
      state = handCheck(state, 'p1');
      state = advanceStreet(state); // River

      expect(state.street).toBe('river');
      expect(state.status).toBe('in_progress');

      expect(() => settleHandFlow(state, [{ potId: 'main', winners: ['p1'] }]))
        .toThrowError(EngineError);

      try {
        settleHandFlow(state, [{ potId: 'main', winners: ['p1'] }]);
      } catch (err) {
        expect((err as EngineError).code).toBe('ROUND_NOT_ACTIVE');
      }
    });
  });

  // 7. Encerramento por fold no pré-flop
  describe('7. Encerramento por fold no pré-flop', () => {
    it('distribui automaticamente o pote para o único jogador restante após folds no pré-flop', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      // p1 fold, p2 fold -> resta apenas p3 (BB)
      state = handFold(state, 'p1');
      state = handFold(state, 'p2');

      expect(state.status).toBe('hand_ended_by_fold');
      // A porção não igualada do BB (10 fichas acima do SB de 10) foi restituída para p3
      // Restam 20 fichas no pote (10 do SB p2 + 10 igualados de p3)
      expect(state.pot).toBe(20);

      // Não necessita de decisões manuais
      const result = settleHandFlow(state);

      expect(result.status).toBe('settled');
      expect(result.pot).toBe(0);
      expect(result.summary.totalDistributed).toBe(20);

      const p3 = result.players.find(p => p.id === 'p3')!;
      // 990 (após reembolso do uncalled) + 20 (pote ganho) = 1010
      expect(p3.chips).toBe(1010);
      expect(p3.totalWon).toBe(20);

      const p2 = result.players.find(p => p.id === 'p2')!;
      expect(p2.chips).toBe(990); // 1000 - 10 SB
      expect(p2.totalWon).toBe(0);

      const p1 = result.players.find(p => p.id === 'p1')!;
      expect(p1.chips).toBe(1000);
      expect(p1.totalWon).toBe(0);

      const totalChips = result.players.reduce((sum, p) => sum + p.chips, 0);
      expect(totalChips).toBe(3000);
    });
  });

  // 8. Encerramento por fold no flop
  describe('8. Encerramento por fold no flop', () => {
    it('distribui automaticamente o pote para o único jogador restante após folds no flop', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handCall(state, 'p1');
      state = handCall(state, 'p2');
      state = handCheck(state, 'p3');
      state = advanceStreet(state); // Flop (pote = 60)

      // No flop: p2 aposta 50, p3 fold, p1 fold -> resta apenas p2
      state = handRaise(state, 50, 'p2');
      state = handFold(state, 'p3');
      state = handFold(state, 'p1');

      expect(state.status).toBe('hand_ended_by_fold');

      const result = settleHandFlow(state);
      expect(result.status).toBe('settled');

      const p2 = result.players.find(p => p.id === 'p2')!;
      // Pote era 60 do pré-flop. A aposta de 50 não igualada foi restituída para p2 durante o fold.
      // p2 ganha o pote de 60. Final chips: 1000 - 20 (preflop) + 60 (pote) = 1040.
      expect(p2.chips).toBe(1040);
      expect(p2.totalWon).toBe(60);

      const totalChips = result.players.reduce((sum, p) => sum + p.chips, 0);
      expect(totalChips).toBe(3000);
    });
  });

  // 9. Encerramento por fold no turn
  describe('9. Encerramento por fold no turn', () => {
    it('distribui automaticamente o pote para o sobrevivente após fold no turn', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handCall(state, 'p1');
      state = handCheck(state, 'p2');
      state = advanceStreet(state); // Flop
      state = handRaise(state, 40, 'p2');
      state = handCall(state, 'p1');
      state = advanceStreet(state); // Turn (pote = 120)

      // No turn: p2 aposta 50, p1 fold
      state = handRaise(state, 50, 'p2');
      state = handFold(state, 'p1');

      expect(state.status).toBe('hand_ended_by_fold');

      const result = settleHandFlow(state);
      expect(result.status).toBe('settled');

      const p2 = result.players.find(p => p.id === 'p2')!;
      // p1 contribuiu: 20 + 40 = 60. p2 ganha 120 (seu 60 + 60 de p1).
      // p2 final: 1000 - 60 + 120 = 1060.
      expect(p2.chips).toBe(1060);
      expect(p2.totalWon).toBe(120);

      const p1 = result.players.find(p => p.id === 'p1')!;
      expect(p1.chips).toBe(940);

      expect(p1.chips + p2.chips).toBe(2000);
    });
  });

  // 10. Showdown antecipado após all-ins
  describe('10. Showdown antecipado após all-ins', () => {
    it('conduz a liquidação com sucesso quando a mão vai para showdown direto por all-ins', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 100 },
        { id: 'p2', seat: 2, chips: 100 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handAllIn(state, 'p1'); // 100
      state = handCall(state, 'p2'); // 100 all-in

      expect(state.status).toBe('showdown');
      expect(state.pot).toBe(200);

      const result = settleHandFlow(state, [{ potId: 'main', winners: ['p2'] }]);

      expect(result.status).toBe('settled');
      expect(result.summary.totalDistributed).toBe(200);

      const p2 = result.players.find(p => p.id === 'p2')!;
      expect(p2.chips).toBe(200);
      expect(p2.isAllIn).toBe(false);

      const p1 = result.players.find(p => p.id === 'p1')!;
      expect(p1.chips).toBe(0);
      expect(p1.isAllIn).toBe(true);
    });
  });

  // 11. Vencedor único
  describe('11. Vencedor único', () => {
    it('atribui 100% do pote ao vencedor único informado', () => {
      const state = buildShowdownHand();
      const result = settleHandFlow(state, [{ potId: 'main', winners: ['p3'] }]);

      expect(result.potAwards[0].winners).toEqual(['p3']);
      expect(result.potAwards[0].awards).toEqual([{ playerId: 'p3', amount: 60 }]);

      const p3 = result.players.find(p => p.id === 'p3')!;
      expect(p3.chips).toBe(1040);
      expect(p3.totalWon).toBe(60);
    });
  });

  // 12. Empate com divisão exata
  describe('12. Empate com divisão exata', () => {
    it('divide o pote igualmente entre os múltiplos vencedores quando a divisão é exata', () => {
      const state = buildShowdownHand();
      // Pote de 60 dividido igualmente entre p1 e p2 -> 30 para cada
      const result = settleHandFlow(state, [{ potId: 'main', winners: ['p1', 'p2'] }]);

      const awards = result.potAwards[0].awards;
      expect(awards).toEqual([
        { playerId: 'p2', amount: 30 },
        { playerId: 'p1', amount: 30 },
      ]);
      expect(result.summary.totalDistributed).toBe(60);

      const p1 = result.players.find(p => p.id === 'p1')!;
      const p2 = result.players.find(p => p.id === 'p2')!;
      expect(p1.totalWon).toBe(30);
      expect(p2.totalWon).toBe(30);
      expect(p1.chips).toBe(1010); // 1000 - 20 + 30
      expect(p2.chips).toBe(1010); // 1000 - 20 + 30
    });
  });

  // 13. Empate com ficha excedente (TDA Regra 21 sentido horário do dealer)
  describe('13. Empate com ficha excedente (TDA Regra 21 sentido horário do dealer)', () => {
    it('aloca fichas excedentes no sentido horário a partir do dealer conforme a Regra 21 da TDA em mesa com 3 jogadores ativos', () => {
      // 4 jogadores com dealer no assento 1:
      // p1 (seat 1 / dealer), p2 (seat 2 / SB 10), p3 (seat 3 / BB 20), p4 (seat 4 / UTG)
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
        { id: 'p4', seat: 4, chips: 1000 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      // p4 (UTG) paga 20
      state = handCall(state, 'p4');
      // p1 (Dealer) paga 20
      state = handCall(state, 'p1');
      // p2 (SB) dá fold e deixa 10 fichas de SB como dead money
      state = handFold(state, 'p2');
      // p3 (BB) dá check na blind de 20
      state = handCheck(state, 'p3');

      // Pote total = 10 (p2 folded) + 20 (p3) + 20 (p4) + 20 (p1) = 70 fichas
      expect(state.pot).toBe(70);

      // Flop, turn e river todos dão check
      state = advanceStreet(state); // Flop
      state = handCheck(state, 'p3');
      state = handCheck(state, 'p4');
      state = handCheck(state, 'p1');

      state = advanceStreet(state); // Turn
      state = handCheck(state, 'p3');
      state = handCheck(state, 'p4');
      state = handCheck(state, 'p1');

      state = advanceStreet(state); // River
      state = handCheck(state, 'p3');
      state = handCheck(state, 'p4');
      state = handCheck(state, 'p1');

      state = advanceStreet(state); // Showdown
      expect(state.status).toBe('showdown');
      expect(state.pot).toBe(70);

      // Empate triplo entre os 3 participantes ativos: p1, p3, p4
      // 70 / 3 = 23 base cada um. Resto = 1 ficha excedente.
      // Sentido horário a partir do dealer (seat 1):
      // 1º elegível ativo: p3 (seat 3) -> 23 + 1 = 24
      // 2º elegível ativo: p4 (seat 4) -> 23
      // 3º elegível ativo: p1 (seat 1) -> 23
      const result = settleHandFlow(state, [
        { potId: 'main', winners: ['p1', 'p3', 'p4'] },
      ]);

      const awards = result.potAwards[0].awards;
      expect(awards).toEqual([
        { playerId: 'p3', amount: 24 },
        { playerId: 'p4', amount: 23 },
        { playerId: 'p1', amount: 23 },
      ]);
      expect(awards.reduce((sum, a) => sum + a.amount, 0)).toBe(70);
    });

    it('com dead money resultando em pote ímpar, o jogador à esquerda do dealer recebe a ficha excedente', () => {
      // 3 jogadores: dealer (seat 1), sb (seat 2), bb (seat 3).
      // Blinds SB=15, BB=30.
      // Dealer paga 30, SB fold (deixa 15 de dead money), BB checks 30.
      // Pote total = 15 + 30 + 30 = 75 fichas (ímpar).
      const p3Players: PlayerInput[] = [
        { id: 'dealer', seat: 1, chips: 1000 },
        { id: 'sb', seat: 2, chips: 1000 },
        { id: 'bb', seat: 3, chips: 1000 },
      ];
      let handState = startHandFlow({
        players: p3Players,
        blinds: { smallBlind: 15, bigBlind: 30 },
        dealerSeat: 1,
      });
      // Pré-flop: UTG é dealer (seat 1). Dealer calls 30.
      handState = handCall(handState, 'dealer');
      // sb (seat 2) dá fold! Suas 15 fichas de SB permanecem no pote como dead money.
      handState = handFold(handState, 'sb');
      // bb (seat 3) dá check na sua blind de 30.
      handState = handCheck(handState, 'bb');
      // Pote pré-flop = 15 (sb fold) + 30 (dealer) + 30 (bb) = 75!
      expect(handState.pot).toBe(75);

      // Avança flop, turn, river com checks
      handState = advanceStreet(handState); // Flop
      handState = handCheck(handState, 'bb');
      handState = handCheck(handState, 'dealer');

      handState = advanceStreet(handState); // Turn
      handState = handCheck(handState, 'bb');
      handState = handCheck(handState, 'dealer');

      handState = advanceStreet(handState); // River
      handState = handCheck(handState, 'bb');
      handState = handCheck(handState, 'dealer');

      handState = advanceStreet(handState); // Showdown
      expect(handState.status).toBe('showdown');
      expect(handState.pot).toBe(75);

      // Empate entre dealer (seat 1) e bb (seat 3).
      // Sentido horário a partir do dealer (seat 1):
      // 1º elegível ativo: bb (seat 3).
      // 2º elegível ativo: dealer (seat 1).
      // Divisão de 75 entre 2: base 37, resto 1.
      // bb (seat 3) recebe 38 fichas, dealer (seat 1) recebe 37 fichas.
      const result = settleHandFlow(handState, [
        { potId: 'main', winners: ['dealer', 'bb'] },
      ]);

      const awards = result.potAwards[0].awards;
      expect(awards).toEqual([
        { playerId: 'bb', amount: 38 },
        { playerId: 'dealer', amount: 37 },
      ]);
      expect(awards[0].amount + awards[1].amount).toBe(75);
    });
  });

  // 14. Main pot e side pot com vencedores diferentes
  describe('14. Main pot e side pot com vencedores diferentes', () => {
    it('distribui o main pot para um jogador all-in e o side pot para outro jogador ativo', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 100 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      // p1 raise 100, p2 call 100, p3 call all-in 100
      state = handRaise(state, 100, 'p1');
      state = handCall(state, 'p2');
      state = handCall(state, 'p3');

      state = advanceStreet(state); // Flop
      // Flop: p2 aposta 100, p1 paga 100
      state = handRaise(state, 100, 'p2');
      state = handCall(state, 'p1');

      state = advanceStreet(state); // Turn
      state = handCheck(state, 'p2');
      state = handCheck(state, 'p1');

      state = advanceStreet(state); // River
      state = handCheck(state, 'p2');
      state = handCheck(state, 'p1');

      state = advanceStreet(state); // Showdown
      expect(state.status).toBe('showdown');
      expect(state.pot).toBe(500); // 300 main + 200 side-1

      const decisions: PotWinnerDecision[] = [
        { potId: 'main', winners: ['p3'] },
        { potId: 'side-1', winners: ['p1'] },
      ];

      const result = settleHandFlow(state, decisions);

      expect(result.potAwards).toHaveLength(2);
      expect(result.potAwards[0].awards).toEqual([{ playerId: 'p3', amount: 300 }]);
      expect(result.potAwards[1].awards).toEqual([{ playerId: 'p1', amount: 200 }]);

      const p3 = result.players.find(p => p.id === 'p3')!;
      expect(p3.chips).toBe(300);
      expect(p3.isAllIn).toBe(false);

      const p1 = result.players.find(p => p.id === 'p1')!;
      // p1 começou com 1000, colocou 200, ganhou 200 do side pot -> 1000
      expect(p1.chips).toBe(1000);

      const p2 = result.players.find(p => p.id === 'p2')!;
      // p2 começou com 1000, colocou 200, ganhou 0 -> 800
      expect(p2.chips).toBe(800);

      const totalChips = result.players.reduce((sum, p) => sum + p.chips, 0);
      expect(totalChips).toBe(2100);
    });
  });

  // 15. Cenário obrigatório com contribuições de múltiplas streets (Seção 5)
  describe('15. Cenário obrigatório com contribuições de múltiplas streets (Seção 5)', () => {
    it('executa com fidelidade: A=300, B=300, C=100 all-in -> Main 300 (C vence), Side 400 (B vence) -> Stacks: A=700, B=1100, C=300', () => {
      // Configuração inicial rigorosa do enunciado
      const players: PlayerInput[] = [
        { id: 'A', seat: 1, chips: 1000 },
        { id: 'B', seat: 2, chips: 1000 },
        { id: 'C', seat: 3, chips: 100 },
      ];

      // Blinds SB=10, BB=20, Dealer no assento 1 (A)
      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });

      // Pré-flop: A compromete 100, B compromete 100, C compromete 100 (all-in)
      // A (Dealer/UTG) aumenta para 100
      state = handRaise(state, 100, 'A');
      // B (SB) paga 100
      state = handCall(state, 'B');
      // C (BB) paga 100 (fica all-in)
      state = handCall(state, 'C');

      expect(state.currentRound.status).toBe('completed');
      expect(state.pot).toBe(300);

      // Flop: A e B apostam mais 200 cada
      state = advanceStreet(state); // Flop
      // No flop, B é o primeiro ativo (SB), aposta 200
      state = handRaise(state, 200, 'B');
      // A paga 200
      state = handCall(state, 'A');

      expect(state.currentRound.status).toBe('completed');
      expect(state.pot).toBe(700);

      // Turn: checks
      state = advanceStreet(state); // Turn
      state = handCheck(state, 'B');
      state = handCheck(state, 'A');
      expect(state.currentRound.status).toBe('completed');

      // River: checks
      state = advanceStreet(state); // River
      state = handCheck(state, 'B');
      state = handCheck(state, 'A');
      expect(state.currentRound.status).toBe('completed');

      // Avança para Showdown
      state = advanceStreet(state);
      expect(state.status).toBe('showdown');

      // Confere os potes gerados
      expect(state.pot).toBe(700);
      const pA = state.players.find(p => p.id === 'A')!;
      const pB = state.players.find(p => p.id === 'B')!;
      const pC = state.players.find(p => p.id === 'C')!;

      expect(pA.totalCommitted).toBe(300);
      expect(pB.totalCommitted).toBe(300);
      expect(pC.totalCommitted).toBe(100);

      // Decisões: C vence o main pot (300), B vence o side pot (400)
      const decisions: PotWinnerDecision[] = [
        { potId: 'main', winners: ['C'] },
        { potId: 'side-1', winners: ['B'] },
      ];

      const result = settleHandFlow(state, decisions);

      // Verificações dos prêmios
      expect(result.status).toBe('settled');
      expect(result.pot).toBe(0);
      expect(result.summary.totalDistributed).toBe(700);
      expect(result.potAwards).toHaveLength(2);

      const mainAward = result.potAwards.find(pa => pa.potId === 'main')!;
      expect(mainAward.potAmount).toBe(300);
      expect(mainAward.winners).toEqual(['C']);
      expect(mainAward.awards).toEqual([{ playerId: 'C', amount: 300 }]);

      const sideAward = result.potAwards.find(pa => pa.potId === 'side-1')!;
      expect(sideAward.potAmount).toBe(400);
      expect(sideAward.winners).toEqual(['B']);
      expect(sideAward.awards).toEqual([{ playerId: 'B', amount: 400 }]);

      // Stacks finais especificados no enunciado: A=700, B=1100, C=300
      const settledA = result.players.find(p => p.id === 'A')!;
      const settledB = result.players.find(p => p.id === 'B')!;
      const settledC = result.players.find(p => p.id === 'C')!;

      expect(settledA.chips).toBe(700);
      expect(settledA.totalWon).toBe(0);
      expect(settledA.committed).toBe(0);

      expect(settledB.chips).toBe(1100);
      expect(settledB.totalWon).toBe(400);
      expect(settledB.committed).toBe(0);

      expect(settledC.chips).toBe(300);
      expect(settledC.totalWon).toBe(300);
      expect(settledC.committed).toBe(0);
      expect(settledC.isAllIn).toBe(false);

      // Conservação de fichas estrita: 700 + 1100 + 300 = 2100
      const totalChips = result.players.reduce((sum, p) => sum + p.chips, 0);
      expect(totalChips).toBe(2100);
    });
  });

  // 16. Jogador all-in vencendo o main pot (restaura isAllIn: false)
  describe('16. Jogador all-in vencendo o main pot (restaura isAllIn: false)', () => {
    it('restaura isAllIn para false quando o jogador all-in recebe fichas na liquidação', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 100 },
        { id: 'p2', seat: 2, chips: 100 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handAllIn(state, 'p1');
      state = handCall(state, 'p2');

      const preSettlementP1 = state.players.find(p => p.id === 'p1')!;
      expect(preSettlementP1.isAllIn).toBe(true);
      expect(preSettlementP1.chips).toBe(0);

      const result = settleHandFlow(state, [{ potId: 'main', winners: ['p1'] }]);
      const settledP1 = result.players.find(p => p.id === 'p1')!;

      expect(settledP1.chips).toBe(200);
      expect(settledP1.isAllIn).toBe(false);
    });
  });

  // 17. Jogador inelegível tentando ganhar side pot (throws INELIGIBLE_WINNER)
  describe('17. Jogador inelegível tentando ganhar side pot (throws INELIGIBLE_WINNER)', () => {
    it('dispara INELIGIBLE_WINNER ao declarar vencedor que não é elegível para o side pot', () => {
      const players: PlayerInput[] = [
        { id: 'A', seat: 1, chips: 1000 },
        { id: 'B', seat: 2, chips: 1000 },
        { id: 'C', seat: 3, chips: 100 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handRaise(state, 100, 'A');
      state = handCall(state, 'B');
      state = handCall(state, 'C'); // C all-in com 100
      state = advanceStreet(state); // Flop
      state = handRaise(state, 200, 'B');
      state = handCall(state, 'A');
      state = advanceStreet(state); // Turn
      state = handCheck(state, 'B');
      state = handCheck(state, 'A');
      state = advanceStreet(state); // River
      state = handCheck(state, 'B');
      state = handCheck(state, 'A');
      state = advanceStreet(state); // Showdown

      // C tenta ser declarado vencedor do side pot (side-1)
      const invalidDecisions: PotWinnerDecision[] = [
        { potId: 'main', winners: ['C'] },
        { potId: 'side-1', winners: ['C'] },
      ];

      expect(() => settleHandFlow(state, invalidDecisions)).toThrowError(EngineError);

      try {
        settleHandFlow(state, invalidDecisions);
      } catch (err) {
        expect((err as EngineError).code).toBe('INELIGIBLE_WINNER');
      }
    });
  });

  // 18. Jogador folded tentando receber prêmio (throws INELIGIBLE_WINNER)
  describe('18. Jogador folded tentando receber prêmio (throws INELIGIBLE_WINNER)', () => {
    it('dispara INELIGIBLE_WINNER caso uma decisão aponte um jogador que desistiu', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handFold(state, 'p1'); // p1 dá fold pré-flop
      state = handCall(state, 'p2');
      state = handCheck(state, 'p3');
      state = advanceStreet(state); // Flop
      state = handCheck(state, 'p2');
      state = handCheck(state, 'p3');
      state = advanceStreet(state); // Turn
      state = handCheck(state, 'p2');
      state = handCheck(state, 'p3');
      state = advanceStreet(state); // River
      state = handCheck(state, 'p2');
      state = handCheck(state, 'p3');
      state = advanceStreet(state); // Showdown

      const decisions: PotWinnerDecision[] = [
        { potId: 'main', winners: ['p1'] },
      ];

      expect(() => settleHandFlow(state, decisions)).toThrowError(EngineError);

      try {
        settleHandFlow(state, decisions);
      } catch (err) {
        expect((err as EngineError).code).toBe('INELIGIBLE_WINNER');
      }
    });
  });

  // 19. Restituição de apostas não igualadas sem duplicação
  describe('19. Restituição de apostas não igualadas sem duplicação', () => {
    it('garante que apostas não igualadas restituídas durante a rodada não são restituídas novamente', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 50 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handCall(state, 'p1'); // 20
      state = handCheck(state, 'p2'); // 20
      state = advanceStreet(state); // Flop

      // p2 check, p1 aposta 100, p2 paga all-in com 30 restantes
      state = handCheck(state, 'p2');
      state = handRaise(state, 100, 'p1');
      state = handCall(state, 'p2');

      // A mão vai a showdown automaticamente
      expect(state.status).toBe('showdown');
      expect(state.pot).toBe(100); // 50 de p1 + 50 de p2

      const p1Before = state.players.find(p => p.id === 'p1')!;
      // p1 já recebeu o reembolso de 70 durante a rodada: 1000 - 50 = 950
      expect(p1Before.chips).toBe(950);
      expect(p1Before.totalCommitted).toBe(50);

      const result = settleHandFlow(state, [{ potId: 'main', winners: ['p1'] }]);
      const p1After = result.players.find(p => p.id === 'p1')!;

      // p1 ganha o pote de 100: 950 + 100 = 1050
      expect(p1After.chips).toBe(1050);
      expect(p1After.totalWon).toBe(100);

      // Conservação total: 1050 + 0 = 1050 (1000 inicial de p1 + 50 inicial de p2)
      const total = result.players.reduce((sum, p) => sum + p.chips, 0);
      expect(total).toBe(1050);
    });
  });

  // 20. Conservação total das fichas
  describe('20. Conservação total das fichas', () => {
    it('mantém estritamente constante a soma de todas as fichas da mesa após liquidação', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 500 },
        { id: 'p2', seat: 2, chips: 800 },
        { id: 'p3', seat: 3, chips: 1200 },
      ];
      const initialTotal = 2500;

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handRaise(state, 60, 'p1');
      state = handCall(state, 'p2');
      state = handFold(state, 'p3');
      state = advanceStreet(state); // Flop
      state = handCheck(state, 'p2');
      state = handCheck(state, 'p1');
      state = advanceStreet(state); // Turn
      state = handCheck(state, 'p2');
      state = handCheck(state, 'p1');
      state = advanceStreet(state); // River
      state = handCheck(state, 'p2');
      state = handCheck(state, 'p1');
      state = advanceStreet(state); // Showdown

      const result = settleHandFlow(state, [{ potId: 'main', winners: ['p2'] }]);
      const finalTotal = result.players.reduce((sum, p) => sum + p.chips, 0);

      expect(finalTotal).toBe(initialTotal);
    });
  });

  // 21. Atualização dos stacks finais
  describe('21. Atualização dos stacks finais', () => {
    it('garante que todos os jogadores liquidados possuem committed = 0 e previousChips correto', () => {
      const state = buildShowdownHand();
      const p1Pre = state.players.find(p => p.id === 'p1')!;

      const result = settleHandFlow(state, [{ potId: 'main', winners: ['p1'] }]);

      for (const player of result.players) {
        expect(player.committed).toBe(0);
        expect(Number.isSafeInteger(player.chips)).toBe(true);
      }

      const p1Post = result.players.find(p => p.id === 'p1')!;
      expect(p1Post.previousChips).toBe(p1Pre.chips);
      expect(p1Post.chips).toBe(p1Pre.chips + 60);
    });
  });

  // 22. Rejeição de decisões duplicadas ou incompletas (DUPLICATE_DECISION, MISSING_DECISION)
  describe('22. Rejeição de decisões duplicadas ou incompletas', () => {
    it('dispara DUPLICATE_DECISION ao enviar decisões duplicadas para o mesmo pote', () => {
      const state = buildShowdownHand();
      const duplicateDecisions: PotWinnerDecision[] = [
        { potId: 'main', winners: ['p1'] },
        { potId: 'main', winners: ['p2'] },
      ];

      expect(() => settleHandFlow(state, duplicateDecisions)).toThrowError(EngineError);

      try {
        settleHandFlow(state, duplicateDecisions);
      } catch (err) {
        expect((err as EngineError).code).toBe('DUPLICATE_DECISION');
      }
    });

    it('dispara MISSING_DECISION ao omitir a decisão de um pote disputado por múltiplos jogadores', () => {
      const state = buildShowdownHand();

      expect(() => settleHandFlow(state, [])).toThrowError(EngineError);

      try {
        settleHandFlow(state, []);
      } catch (err) {
        expect((err as EngineError).code).toBe('MISSING_DECISION');
      }
    });
  });

  // 23. Rejeição de estados inválidos (INVALID_INPUT, INVALID_CHIPS)
  describe('23. Rejeição de estados inválidos', () => {
    it('rejeita entrada null ou objeto corrompido com INVALID_INPUT', () => {
      expect(() => settleHandFlow(null as unknown as HandFlowState)).toThrowError(EngineError);
      try {
        settleHandFlow(null as unknown as HandFlowState);
      } catch (err) {
        expect((err as EngineError).code).toBe('INVALID_INPUT');
      }
    });

    it('rejeita estado onde o pote acumulado diverge do somatório de contribuições', () => {
      const state = buildShowdownHand();
      // Simula corrupção de pote
      const corrupted = { ...state, pot: 999999 };

      expect(() => settleHandFlow(corrupted as unknown as HandFlowState)).toThrowError(EngineError);
      try {
        settleHandFlow(corrupted as unknown as HandFlowState);
      } catch (err) {
        expect((err as EngineError).code).toBe('INVALID_CHIPS');
      }
    });
  });

  describe('Regressões da auditoria 2.4B', () => {
    it('rejeita showdown com rodada interna ainda ativa', () => {
      const state = buildShowdownHand();

      const corrupted: HandFlowState = {
        ...state,
        currentRound: {
          ...state.currentRound,
          status: 'active',
        },
      };

      expect(() =>
        settleHandFlow(corrupted, [
          { potId: 'main', winners: ['p1'] },
        ]),
      ).toThrowError(EngineError);
    });

    it('rejeita showdown antecipado com jogadores capazes de apostar', () => {
      const players: PlayerInput[] = [
        { id: 'A', seat: 1, chips: 1000 },
        { id: 'B', seat: 2, chips: 1000 },
      ];

      let state = startHandFlow({
        players,
        blinds: defaultBlinds,
        dealerSeat: 1,
      });

      state = handCall(state, 'A');
      state = handCheck(state, 'B');

      const corrupted: HandFlowState = {
        ...state,
        status: 'showdown',
      };

      expect(() =>
        settleHandFlow(corrupted, [
          { potId: 'main', winners: ['A'] },
        ]),
      ).toThrowError(EngineError);
    });

    it('rejeita contribuições internas contraditórias', () => {
      const state = buildShowdownHand();

      const corrupted: HandFlowState = {
        ...state,
        players: state.players.map((player, index) =>
          index === 0
            ? {
                ...player,
                baseCommitted: player.baseCommitted + 1,
              }
            : player,
        ),
      };

      expect(() =>
        settleHandFlow(corrupted, [
          { potId: 'main', winners: ['p1'] },
        ]),
      ).toThrowError(EngineError);
    });

    it('rejeita divergência entre o pote principal e a rodada interna', () => {
      const state = buildShowdownHand();

      const corrupted: HandFlowState = {
        ...state,
        currentRound: {
          ...state.currentRound,
          pot: state.pot + 1,
        },
      };

      expect(() =>
        settleHandFlow(corrupted, [
          { potId: 'main', winners: ['p1'] },
        ]),
      ).toThrowError(EngineError);
    });
  });

  // 24. Imutabilidade dos estados anteriores (Object.isFrozen)
  describe('24. Imutabilidade dos estados anteriores', () => {
    it('garante que o estado de entrada permanece inalterado e o resultado retornado é congelado', () => {
      const state = buildShowdownHand();
      const stateSnapshot = JSON.stringify(state);

      const result = settleHandFlow(state, [{ potId: 'main', winners: ['p1'] }]);

      // Estado anterior intacto
      expect(JSON.stringify(state)).toBe(stateSnapshot);

      // Objeto de liquidação e arrays internos congelados
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.players)).toBe(true);
      expect(Object.isFrozen(result.pots)).toBe(true);
      expect(Object.isFrozen(result.potAwards)).toBe(true);
      expect(Object.isFrozen(result.summary)).toBe(true);
    });
  });

  // 25. Determinismo independentemente da ordem das decisões
  describe('25. Determinismo independentemente da ordem das decisões', () => {
    it('produz exatamente o mesmo resultado independente da ordem das decisões enviadas', () => {
      const players: PlayerInput[] = [
        { id: 'A', seat: 1, chips: 1000 },
        { id: 'B', seat: 2, chips: 1000 },
        { id: 'C', seat: 3, chips: 100 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handRaise(state, 100, 'A');
      state = handCall(state, 'B');
      state = handCall(state, 'C');
      state = advanceStreet(state); // Flop
      state = handRaise(state, 200, 'B');
      state = handCall(state, 'A');
      state = advanceStreet(state); // Turn
      state = handCheck(state, 'B');
      state = handCheck(state, 'A');
      state = advanceStreet(state); // River
      state = handCheck(state, 'B');
      state = handCheck(state, 'A');
      state = advanceStreet(state); // Showdown

      const decisionsOrder1: PotWinnerDecision[] = [
        { potId: 'main', winners: ['C'] },
        { potId: 'side-1', winners: ['B'] },
      ];

      const decisionsOrder2: PotWinnerDecision[] = [
        { potId: 'side-1', winners: ['B'] },
        { potId: 'main', winners: ['C'] },
      ];

      const res1 = settleHandFlow(state, decisionsOrder1);
      const res2 = settleHandFlow(state, decisionsOrder2);

      expect(res1).toEqual(res2);
    });
  });

  // 26. Compatibilidade com settleHand() existente
  describe('26. Compatibilidade com settleHand() existente', () => {
    it('assegura que tanto settleHand quanto settleHandFlow produzem o mesmo formato SettlementResult', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];

      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      const state = startHandFlow(hand);

      // Executa hand-flow até showdown
      const stateCalled = handCall(state, 'p1');
      const stateChecked = handCheck(stateCalled, 'p2');

      // RoundState finalizado do pré-flop
      const roundCompleted = stateChecked.currentRound;
      const resRound: SettlementResult = settleHand(roundCompleted, [{ potId: 'main', winners: ['p1'] }]);

      expect(resRound.status).toBe('settled');
      expect(resRound.isSettled).toBe(true);
      expect(resRound.summary.totalDistributed).toBe(40);

      // Agora avança hand-flow até o fim
      let flowShowdown = advanceStreet(stateChecked); // Flop
      flowShowdown = handCheck(flowShowdown, 'p2');
      flowShowdown = handCheck(flowShowdown, 'p1');
      flowShowdown = advanceStreet(flowShowdown); // Turn
      flowShowdown = handCheck(flowShowdown, 'p2');
      flowShowdown = handCheck(flowShowdown, 'p1');
      flowShowdown = advanceStreet(flowShowdown); // River
      flowShowdown = handCheck(flowShowdown, 'p2');
      flowShowdown = handCheck(flowShowdown, 'p1');
      flowShowdown = advanceStreet(flowShowdown); // Showdown

      const resFlow: SettlementResult = settleHandFlow(flowShowdown, [{ potId: 'main', winners: ['p1'] }]);

      expect(resFlow.status).toBe('settled');
      expect(resFlow.isSettled).toBe(true);
      expect(resFlow.summary.totalDistributed).toBe(40);
      expect(Object.keys(resFlow)).toEqual(Object.keys(resRound));
    });
  });

  // 27. Rejeição de tentativa de liquidar um resultado já liquidado (ALREADY_SETTLED)
  describe('27. Rejeição de tentativa de liquidar um resultado já liquidado (ALREADY_SETTLED)', () => {
    it('dispara ALREADY_SETTLED ao tentar liquidar novamente um resultado já liquidado', () => {
      const state = buildShowdownHand();
      const settled = settleHandFlow(state, [{ potId: 'main', winners: ['p1'] }]);

      expect(() => settleHandFlow(settled as unknown as HandFlowState)).toThrowError(EngineError);

      try {
        settleHandFlow(settled as unknown as HandFlowState);
      } catch (err) {
        expect((err as EngineError).code).toBe('ALREADY_SETTLED');
      }
    });
  });
});
