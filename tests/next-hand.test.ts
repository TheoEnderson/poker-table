import { describe, expect, it } from 'vitest';
import {
  advanceDealer,
  advanceStreet,
  determineNextDealerSeat,
  EngineError,
  handCall,
  handCheck,
  handFold,
  handRaise,
  initHand,
  settleHandFlow,
  startHandFlow,
  startNextHand,
  type HandFlowState,
  type PlayerInput,
  type SettlementResult,
} from '@poker-table/engine';

describe('Texas Hold\'em Engine — Início de Novas Mãos e Rotação do Dealer (Etapa 2.4C)', () => {
  const defaultBlinds = { smallBlind: 10, bigBlind: 20 };

  /**
   * Helper para jogar uma mão completa até o showdown de forma limpa.
   */
  function playHandToShowdown(players: PlayerInput[], dealerSeat: number): HandFlowState {
    let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat });

    // Preflop: todos completam/pagam
    const preflopActors = [...state.playersToAct];
    for (const actor of preflopActors) {
      if (state.currentActorId === actor && state.currentRound.status === 'active') {
        if (state.currentRound.currentBet > (state.players.find(p => p.id === actor)?.roundCommitted ?? 0)) {
          state = handCall(state, actor);
        } else {
          state = handCheck(state, actor);
        }
      }
    }

    // Pós-flop: Flop, Turn, River com checks
    for (let roundIdx = 0; roundIdx < 3; roundIdx++) {
      state = advanceStreet(state);
      const streetActors = [...state.playersToAct];
      for (const actor of streetActors) {
        if (state.currentActorId === actor && state.currentRound.status === 'active') {
          state = handCheck(state, actor);
        }
      }
    }

    // Avança para Showdown
    return advanceStreet(state);
  }

  // 1. Início de nova mão a partir de SettlementResult
  describe('1. Início de nova mão a partir de SettlementResult', () => {
    it('inicia uma nova mão válida no pré-flop a partir de um SettlementResult', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];

      const showdown = playHandToShowdown(players, 1);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p1'] }]);

      const nextHand = startNextHand(settlement);

      expect(nextHand.street).toBe('preflop');
      expect(nextHand.status).toBe('in_progress');
      expect(nextHand.currentRound.status).toBe('active');
      expect(nextHand.pot).toBe(30); // 10 SB + 20 BB
      expect(nextHand.players).toHaveLength(3);
    });
  });

  // 2. Rejeição de resultado não liquidado
  describe('2. Rejeição de resultado não liquidado', () => {
    it('rejeita objetos que não representam um SettlementResult concluído', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];

      const activeState = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });

      // Passando HandFlowState em andamento
      expect(() => startNextHand(activeState as unknown as SettlementResult))
        .toThrowError(EngineError);

      try {
        startNextHand(activeState as unknown as SettlementResult);
      } catch (err) {
        expect((err as EngineError).code).toBe('INVALID_INPUT');
      }

      // Passando objeto nulo ou corrompido
      expect(() => startNextHand(null as unknown as SettlementResult))
        .toThrowError(EngineError);

      // Passando objeto com isSettled: false
      const fakeSettlement = { status: 'settled', isSettled: false, players: [] };
      expect(() => startNextHand(fakeSettlement as unknown as SettlementResult))
        .toThrowError(EngineError);
    });
  });

  // 3. Preservação dos stacks finais
  describe('3. Preservação dos stacks finais', () => {
    it('utiliza com exclusividade os stacks finais do SettlementResult.players como base para a nova mão', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];

      const showdown = playHandToShowdown(players, 1);
      // Pote de 60 atribuído integralmente a p1
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p1'] }]);

      // Stacks após liquidação: p1 = 1040, p2 = 980, p3 = 980
      const p1Settled = settlement.players.find(p => p.id === 'p1')!;
      const p2Settled = settlement.players.find(p => p.id === 'p2')!;
      const p3Settled = settlement.players.find(p => p.id === 'p3')!;
      expect(p1Settled.chips).toBe(1040);
      expect(p2Settled.chips).toBe(980);
      expect(p3Settled.chips).toBe(980);

      // Na nova mão: dealer avança de 1 para 2. SB = 3 (p3), BB = 1 (p1).
      const nextHand = startNextHand(settlement);
      expect(nextHand.dealerSeat).toBe(2);
      expect(nextHand.smallBlindSeat).toBe(3);
      expect(nextHand.bigBlindSeat).toBe(1);

      const p1New = nextHand.players.find(p => p.id === 'p1')!;
      const p2New = nextHand.players.find(p => p.id === 'p2')!;
      const p3New = nextHand.players.find(p => p.id === 'p3')!;

      // p1 pagou 20 de BB -> 1040 - 20 = 1020
      expect(p1New.chips).toBe(1020);
      expect(p1New.roundCommitted).toBe(20);

      // p2 é dealer -> 980 - 0 = 980
      expect(p2New.chips).toBe(980);
      expect(p2New.roundCommitted).toBe(0);

      // p3 pagou 10 de SB -> 980 - 10 = 970
      expect(p3New.chips).toBe(970);
      expect(p3New.roundCommitted).toBe(10);
    });
  });

  // 4. Preservação de nomes, IDs e assentos
  describe('4. Preservação de nomes, IDs e assentos', () => {
    it('preserva os identificadores, nomes e assentos físicos dos jogadores', () => {
      const players: PlayerInput[] = [
        { id: 'alice', seat: 2, chips: 1000, name: 'Alice' },
        { id: 'bob', seat: 5, chips: 1000, name: 'Bob' },
        { id: 'carol', seat: 8, chips: 1000, name: 'Carol' },
      ];

      const showdown = playHandToShowdown(players, 2);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['alice'] }]);
      const nextHand = startNextHand(settlement);

      const alice = nextHand.players.find(p => p.id === 'alice')!;
      const bob = nextHand.players.find(p => p.id === 'bob')!;
      const carol = nextHand.players.find(p => p.id === 'carol')!;

      expect(alice.name).toBe('Alice');
      expect(alice.seat).toBe(2);

      expect(bob.name).toBe('Bob');
      expect(bob.seat).toBe(5);

      expect(carol.name).toBe('Carol');
      expect(carol.seat).toBe(8);
    });
  });

  // 5. Limpeza das contribuições anteriores
  describe('5. Limpeza das contribuições anteriores', () => {
    it('zera completamente as contribuições transitórias da mão anterior', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];

      const showdown = playHandToShowdown(players, 1);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p1'] }]);
      const nextHand = startNextHand(settlement);

      for (const p of nextHand.players) {
        expect(p.baseCommitted).toBe(0);
        expect(p.totalCommitted).toBe(p.committed);
        expect(p.roundCommitted).toBe(p.committed);
      }
    });
  });

  // 6. Nova cobrança de small blind
  describe('6. Nova cobrança de small blind', () => {
    it('debita o valor do small blind exclusivamente do assento do small blind', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];

      const showdown = playHandToShowdown(players, 1);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p1'] }]);
      // Próximo dealer: seat 2. SB: seat 3.
      const nextHand = startNextHand(settlement);

      const sb = nextHand.players.find(p => p.seat === nextHand.smallBlindSeat)!;
      expect(sb.roundCommitted).toBe(10);
      expect(sb.chips).toBe(980 - 10); // 980 anterior - 10 SB
    });
  });

  // 7. Nova cobrança de big blind
  describe('7. Nova cobrança de big blind', () => {
    it('debita o valor do big blind exclusivamente do assento do big blind', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];

      const showdown = playHandToShowdown(players, 1);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p1'] }]);
      // Próximo dealer: seat 2. SB: seat 3. BB: seat 1.
      const nextHand = startNextHand(settlement);

      const bb = nextHand.players.find(p => p.seat === nextHand.bigBlindSeat)!;
      expect(bb.roundCommitted).toBe(20);
      expect(bb.chips).toBe(1040 - 20); // 1040 anterior - 20 BB
    });
  });

  // 8. Conservação financeira após cobrança das blinds
  describe('8. Conservação financeira após cobrança das blinds', () => {
    it('mantém a soma dos stacks restantes + pote igual ao montante total da mão anterior', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 700 },
        { id: 'p2', seat: 2, chips: 1100 },
        { id: 'p3', seat: 3, chips: 300 },
      ];
      const totalChips = 2100;

      const showdown = playHandToShowdown(players, 1);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p2'] }]);
      const nextHand = startNextHand(settlement);

      const remainingChipsSum = nextHand.players.reduce((sum, p) => sum + p.chips, 0);
      expect(remainingChipsSum + nextHand.pot).toBe(totalChips);
    });
  });

  // 9. Avanço normal do dealer com 3 jogadores
  describe('9. Avanço normal do dealer com 3 jogadores', () => {
    it('avança o dealer no sentido horário entre os 3 jogadores', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];

      const showdown = playHandToShowdown(players, 1);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p1'] }]);
      const nextHand = startNextHand(settlement);

      expect(nextHand.dealerSeat).toBe(2);
    });
  });

  // 10. Avanço normal do dealer com 6 jogadores
  describe('10. Avanço normal do dealer com 6 jogadores', () => {
    it('avança o dealer no sentido horário com 6 assentos ocupados', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
        { id: 'p4', seat: 4, chips: 1000 },
        { id: 'p5', seat: 5, chips: 1000 },
        { id: 'p6', seat: 6, chips: 1000 },
      ];

      // Mão 1: dealer no seat 3 -> próximo dealer é seat 4
      const showdown = playHandToShowdown(players, 3);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p1'] }]);
      const nextHand = startNextHand(settlement);

      expect(nextHand.dealerSeat).toBe(4);

      // E do assento 6 reinicia a volta para o assento 1
      const showdown6 = playHandToShowdown(players, 6);
      const settlement6 = settleHandFlow(showdown6, [{ potId: 'main', winners: ['p1'] }]);
      const nextHand6 = startNextHand(settlement6);

      expect(nextHand6.dealerSeat).toBe(1);
    });
  });

  // 11. Avanço normal do dealer com 10 jogadores
  describe('11. Avanço normal do dealer com 10 jogadores', () => {
    it('avança o dealer no sentido horário em mesa cheia de 10 jogadores', () => {
      const players: PlayerInput[] = Array.from({ length: 10 }, (_, i) => ({
        id: `p${i + 1}`,
        seat: i + 1,
        chips: 1000,
      }));

      // Dealer no seat 9 -> avança para seat 10
      const showdown9 = playHandToShowdown(players, 9);
      const settlement9 = settleHandFlow(showdown9, [{ potId: 'main', winners: ['p1'] }]);
      expect(startNextHand(settlement9).dealerSeat).toBe(10);

      // Dealer no seat 10 -> reinicia a volta para seat 1
      const showdown10 = playHandToShowdown(players, 10);
      const settlement10 = settleHandFlow(showdown10, [{ potId: 'main', winners: ['p1'] }]);
      expect(startNextHand(settlement10).dealerSeat).toBe(1);
    });
  });

  // 12. Rotação com assentos vazios
  describe('12. Rotação com assentos vazios', () => {
    it('salta posições vagas mantendo a rotação estritamente pelos assentos ocupados', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p4', seat: 4, chips: 1000 },
        { id: 'p7', seat: 7, chips: 1000 },
        { id: 'p9', seat: 9, chips: 1000 },
      ];

      // Dealer no seat 4 -> próximo assento ocupado é seat 7
      const showdown4 = playHandToShowdown(players, 4);
      const settlement4 = settleHandFlow(showdown4, [{ potId: 'main', winners: ['p1'] }]);
      expect(startNextHand(settlement4).dealerSeat).toBe(7);

      // Dealer no seat 9 -> próximo assento ocupado reinicia para seat 1
      const showdown9 = playHandToShowdown(players, 9);
      const settlement9 = settleHandFlow(showdown9, [{ potId: 'main', winners: ['p1'] }]);
      expect(startNextHand(settlement9).dealerSeat).toBe(1);
    });
  });

  // 13. Dealer anterior eliminado
  describe('13. Dealer anterior eliminado', () => {
    it('avança o dealer a partir da posição anterior mesmo que o dealer anterior tenha sido eliminado', () => {
      // 4 jogadores: p1 (seat 1), p2 (seat 3), p3 (seat 5), p4 (seat 7).
      // Dealer foi seat 3 (p2). p2 foi all-in e perdeu todas as fichas (chips = 0).
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 3, chips: 1000 },
        { id: 'p3', seat: 5, chips: 1000 },
        { id: 'p4', seat: 7, chips: 1000 },
      ];

      const showdown = playHandToShowdown(players, 3);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p1'] }]);

      // Forçamos o stack de p2 a 0 no settlement para testar a rotação com dealer zerado
      const settledPlayers = settlement.players.map(p =>
        p.id === 'p2' ? { ...p, chips: 0 } : p,
      );
      const modifiedSettlement: SettlementResult = {
        ...settlement,
        players: Object.freeze(settledPlayers),
      };

      // Próximo dealer a partir do seat 3 deve ser o próximo assento elegível (> 3): seat 5!
      const nextHand = startNextHand(modifiedSettlement);
      expect(nextHand.dealerSeat).toBe(5);
      expect(nextHand.players.some(p => p.id === 'p2')).toBe(false);
    });
  });

  // 14. Small blind anterior eliminado
  describe('14. Small blind anterior eliminado', () => {
    it('ignora o assento do small blind eliminado e avança o dealer corretamente', () => {
      // 4 jogadores: seat 1 (D), seat 3 (SB), seat 5 (BB), seat 7 (UTG).
      // SB (seat 3) é eliminado.
      // Próximo dealer avança normalmente de seat 1 para seat 5 (já que 3 está sem fichas).
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 3, chips: 1000 },
        { id: 'p3', seat: 5, chips: 1000 },
        { id: 'p4', seat: 7, chips: 1000 },
      ];

      const showdown = playHandToShowdown(players, 1);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p1'] }]);

      const settledPlayers = settlement.players.map(p =>
        p.id === 'p2' ? { ...p, chips: 0 } : p,
      );
      const modifiedSettlement: SettlementResult = {
        ...settlement,
        players: Object.freeze(settledPlayers),
      };

      const nextHand = startNextHand(modifiedSettlement);
      // Próximo assento ocupado após 1 é 5 (pois 3 foi eliminado)
      expect(nextHand.dealerSeat).toBe(5);
    });
  });

  // 15. Big blind anterior eliminado
  describe('15. Big blind anterior eliminado', () => {
    it('avança o dealer para o próximo assento ocupado quando o big blind é eliminado em mesa de 4', () => {
      // 4 jogadores: seat 1 (D), seat 3 (SB), seat 5 (BB), seat 7 (UTG).
      // BB (seat 5) é eliminado.
      // Próximo dealer avança normalmente de seat 1 para seat 3.
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 3, chips: 1000 },
        { id: 'p3', seat: 5, chips: 1000 },
        { id: 'p4', seat: 7, chips: 1000 },
      ];

      const showdown = playHandToShowdown(players, 1);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p1'] }]);

      const settledPlayers = settlement.players.map(p =>
        p.id === 'p3' ? { ...p, chips: 0 } : p,
      );
      const modifiedSettlement: SettlementResult = {
        ...settlement,
        players: Object.freeze(settledPlayers),
      };

      const nextHand = startNextHand(modifiedSettlement);
      // De 1, o próximo assento ocupado é 3
      expect(nextHand.dealerSeat).toBe(3);
    });
  });

  // 16. Exclusão de jogadores sem fichas
  describe('16. Exclusão de jogadores sem fichas', () => {
    it('não inclui jogadores com 0 fichas nas ações, blinds ou jogadores da nova mão', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 50 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];

      const showdown = playHandToShowdown(players, 1);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p1'] }]);

      const settledWithZero = settlement.players.map(p =>
        p.id === 'p2' ? { ...p, chips: 0 } : p,
      );
      const modifiedSettlement: SettlementResult = {
        ...settlement,
        players: Object.freeze(settledWithZero),
      };

      const nextHand = startNextHand(modifiedSettlement);
      expect(nextHand.players).toHaveLength(2);
      expect(nextHand.players.some(p => p.id === 'p2')).toBe(false);
      expect(nextHand.playersToAct.includes('p2')).toBe(false);
    });
  });

  // 17. Mesa reduzida de 3 jogadores para 2
  describe('17. Mesa reduzida de 3 jogadores para 2', () => {
    it('inicia corretamente uma partida em heads-up quando 1 de 3 jogadores é eliminado', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];

      const showdown = playHandToShowdown(players, 1);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p1'] }]);

      // Elimina p1 (ou p2)
      const settled2 = settlement.players.map(p =>
        p.id === 'p1' ? { ...p, chips: 0 } : p,
      );
      const modifiedSettlement: SettlementResult = {
        ...settlement,
        players: Object.freeze(settled2),
      };

      const nextHand = startNextHand(modifiedSettlement);
      expect(nextHand.players).toHaveLength(2);
    });
  });

  // 18. Transição de 3 para 2 com dealer anterior eliminado
  describe('18. Transição de 3 para 2 com dealer anterior eliminado', () => {
    it('ao eliminar o dealer anterior, o big blind anterior torna-se dealer (Regra 36-C)', () => {
      // 3 jogadores: seat 1 (D), seat 2 (SB), seat 3 (BB).
      // Dealer (seat 1) é eliminado. Restam seat 2 (SB) e seat 3 (BB).
      // Conforme Regra 36-C, seat 3 (que foi BB) NÃO pode ser BB de novo.
      // Logo seat 3 torna-se o Dealer (SB), e seat 2 torna-se o BB.
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];

      const showdown = playHandToShowdown(players, 1);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p2'] }]);

      // Elimina o dealer anterior (seat 1)
      const settled = settlement.players.map(p =>
        p.id === 'p1' ? { ...p, chips: 0 } : p,
      );
      const modSettlement: SettlementResult = {
        ...settlement,
        players: Object.freeze(settled),
      };

      const nextHand = startNextHand(modSettlement);

      expect(nextHand.dealerSeat).toBe(3); // Anterior BB agora é Dealer
      expect(nextHand.smallBlindSeat).toBe(3); // No heads-up dealer é SB
      expect(nextHand.bigBlindSeat).toBe(2); // Anterior SB agora é BB
    });
  });

  // 19. Transição de 3 para 2 com small blind anterior eliminado
  describe('19. Transição de 3 para 2 com small blind anterior eliminado', () => {
    it('ao eliminar o small blind anterior, o big blind anterior torna-se dealer (Regra 36-C)', () => {
      // 3 jogadores: seat 1 (D), seat 2 (SB), seat 3 (BB).
      // SB (seat 2) é eliminado. Restam seat 1 (D) e seat 3 (BB).
      // Seat 3 foi BB, logo NÃO pode ser BB novamente.
      // Seat 3 torna-se Dealer (SB) e Seat 1 torna-se BB.
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];

      const showdown = playHandToShowdown(players, 1);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p1'] }]);

      // Elimina o small blind anterior (seat 2)
      const settled = settlement.players.map(p =>
        p.id === 'p2' ? { ...p, chips: 0 } : p,
      );
      const modSettlement: SettlementResult = {
        ...settlement,
        players: Object.freeze(settled),
      };

      const nextHand = startNextHand(modSettlement);

      expect(nextHand.dealerSeat).toBe(3); // Anterior BB agora é Dealer
      expect(nextHand.smallBlindSeat).toBe(3); // No heads-up dealer é SB
      expect(nextHand.bigBlindSeat).toBe(1); // Anterior Dealer agora é BB
    });
  });

  // 20. Transição de 3 para 2 com big blind anterior eliminado
  describe('20. Transição de 3 para 2 com big blind anterior eliminado', () => {
    it('ao eliminar o big blind anterior, o small blind anterior progride para o big blind', () => {
      // 3 jogadores: seat 1 (D), seat 2 (SB), seat 3 (BB).
      // BB (seat 3) é eliminado. Restam seat 1 (D) e seat 2 (SB).
      // BB anterior foi eliminado. O SB anterior (seat 2) progride para BB.
      // O outro jogador (seat 1) torna-se Dealer (SB).
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];

      const showdown = playHandToShowdown(players, 1);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p1'] }]);

      // Elimina o big blind anterior (seat 3)
      const settled = settlement.players.map(p =>
        p.id === 'p3' ? { ...p, chips: 0 } : p,
      );
      const modSettlement: SettlementResult = {
        ...settlement,
        players: Object.freeze(settled),
      };

      const nextHand = startNextHand(modSettlement);

      expect(nextHand.dealerSeat).toBe(1); // Anterior Dealer permanece/torna-se Dealer
      expect(nextHand.smallBlindSeat).toBe(1); // Dealer é SB
      expect(nextHand.bigBlindSeat).toBe(2); // Anterior SB progride para BB
    });
  });

  // 21. Prevenção de big blind consecutivo na entrada do heads-up
  describe('21. Prevenção de big blind consecutivo na entrada do heads-up', () => {
    it('garante que o jogador que pagou big blind na mão anterior nunca pague big blind na entrada do heads-up', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];

      const showdown = playHandToShowdown(players, 1);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p1'] }]);

      // Teste com eliminação do dealer (p1 eliminado -> restam p2 e p3)
      const mod1 = {
        ...settlement,
        players: Object.freeze(settlement.players.map(p => p.id === 'p1' ? { ...p, chips: 0 } : p)),
      };
      const hand1 = startNextHand(mod1);
      expect(hand1.bigBlindSeat).not.toBe(settlement.handState.bigBlindSeat);

      // Teste com eliminação do SB (p2 eliminado -> restam p1 e p3)
      const mod2 = {
        ...settlement,
        players: Object.freeze(settlement.players.map(p => p.id === 'p2' ? { ...p, chips: 0 } : p)),
      };
      const hand2 = startNextHand(mod2);
      expect(hand2.bigBlindSeat).not.toBe(settlement.handState.bigBlindSeat);
    });
  });

  // 22. Alternância de dealer em heads-up
  describe('22. Alternância de dealer em heads-up', () => {
    it('alterna o botão e as blinds continuamente quando a mesa já se encontra em heads-up', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];

      // Mão 1: dealer no seat 1
      const showdown1 = playHandToShowdown(players, 1);
      const settlement1 = settleHandFlow(showdown1, [{ potId: 'main', winners: ['p1'] }]);

      // Mão 2: deve ser dealer no seat 2
      const hand2 = startNextHand(settlement1);
      expect(hand2.dealerSeat).toBe(2);

      // Joga a mão 2 até o fim
      let state2 = handCall(hand2, 'p2'); // dealer age primeiro
      state2 = handCheck(state2, 'p1');
      state2 = advanceStreet(state2); // Flop
      state2 = handCheck(state2, 'p1'); // BB age primeiro
      state2 = handCheck(state2, 'p2');
      state2 = advanceStreet(state2); // Turn
      state2 = handCheck(state2, 'p1');
      state2 = handCheck(state2, 'p2');
      state2 = advanceStreet(state2); // River
      state2 = handCheck(state2, 'p1');
      state2 = handCheck(state2, 'p2');
      state2 = advanceStreet(state2); // Showdown

      const settlement2 = settleHandFlow(state2, [{ potId: 'main', winners: ['p2'] }]);

      // Mão 3: deve alternar de volta para seat 1
      const hand3 = startNextHand(settlement2);
      expect(hand3.dealerSeat).toBe(1);
    });
  });

  // 23. Ordem de ação pré-flop em heads-up
  describe('23. Ordem de ação pré-flop em heads-up', () => {
    it('inicia a ação pré-flop com o dealer (small blind)', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];

      const showdown = playHandToShowdown(players, 1);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p1'] }]);
      // Próxima mão: dealer é seat 2 (p2)
      const nextHand = startNextHand(settlement);

      expect(nextHand.dealerSeat).toBe(2);
      expect(nextHand.currentActorId).toBe('p2');
    });
  });

  // 24. Ordem pós-flop em heads-up
  describe('24. Ordem pós-flop em heads-up', () => {
    it('inicia a ação pós-flop com o big blind, e o dealer age por último', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];

      const showdown = playHandToShowdown(players, 1);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p1'] }]);
      // Próxima mão: dealer é seat 2 (p2 / SB), BB é seat 1 (p1 / BB)
      let nextHand = startNextHand(settlement);

      nextHand = handCall(nextHand, 'p2');
      nextHand = handCheck(nextHand, 'p1');
      nextHand = advanceStreet(nextHand); // Flop

      expect(nextHand.street).toBe('flop');
      expect(nextHand.currentActorId).toBe('p1'); // BB age primeiro pós-flop
    });
  });

  // 25. Jogador pagando blind com stack insuficiente
  describe('25. Jogador pagando blind com stack insuficiente', () => {
    it('permite que um jogador pague a blind com menos fichas que o valor nominal e vá all-in', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];

      const showdown = playHandToShowdown(players, 1);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p1'] }]);

      // Modifica settlement para p3 ter apenas 15 fichas
      const settledPlayers = settlement.players.map(p =>
        p.id === 'p3' ? { ...p, chips: 15 } : p,
      );
      const modSettlement: SettlementResult = {
        ...settlement,
        players: Object.freeze(settledPlayers),
      };

      // Próximo dealer: seat 2. SB: seat 3 (10). BB: seat 1 (20).
      // Para p3 cair no BB: dealer deve ser seat 1 (assim SB=2, BB=3).
      // Se a mão anterior teve dealer 3 -> próximo dealer é 1.
      const modSettlementDealer3: SettlementResult = {
        ...modSettlement,
        dealerSeat: 3,
        handState: { ...modSettlement.handState, dealerSeat: 3 },
      };

      const nextHand = startNextHand(modSettlementDealer3);
      expect(nextHand.dealerSeat).toBe(1);
      expect(nextHand.bigBlindSeat).toBe(3);

      const p3 = nextHand.players.find(p => p.id === 'p3')!;
      expect(p3.chips).toBe(0);
      expect(p3.roundCommitted).toBe(15);
      expect(p3.isAllIn).toBe(true);
    });
  });

  // 26. Jogador ficando all-in ao pagar a blind
  describe('26. Jogador ficando all-in ao pagar a blind', () => {
    it('identifica corretamente isAllIn: true quando o stack é exatamente igual à blind', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];

      const showdown = playHandToShowdown(players, 1);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p1'] }]);

      // Modifica settlement: p2 tem exatamente 10 fichas.
      // Se dealer anterior foi seat 1 -> próximo dealer é 2 (p2 é dealer, não SB).
      // Se dealer anterior foi seat 3 -> próximo dealer é 1 -> SB é seat 2!
      const modSettlement: SettlementResult = {
        ...settlement,
        dealerSeat: 3,
        players: Object.freeze(settlement.players.map(p => p.id === 'p2' ? { ...p, chips: 10 } : p)),
        handState: { ...settlement.handState, dealerSeat: 3 },
      };

      const nextHand = startNextHand(modSettlement);
      expect(nextHand.smallBlindSeat).toBe(2);

      const p2 = nextHand.players.find(p => p.id === 'p2')!;
      expect(p2.chips).toBe(0);
      expect(p2.roundCommitted).toBe(10);
      expect(p2.isAllIn).toBe(true);
    });
  });

  // 27. Rejeição de mesa com apenas um jogador elegível
  describe('27. Rejeição de mesa com apenas um jogador elegível', () => {
    it('dispara INSUFFICIENT_PLAYERS quando apenas 1 jogador possui fichas', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];

      const showdown = playHandToShowdown(players, 1);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p1'] }]);

      // Elimina p2 (resta apenas p1 com fichas)
      const mod = {
        ...settlement,
        players: Object.freeze(settlement.players.map(p => p.id === 'p2' ? { ...p, chips: 0 } : p)),
      };

      expect(() => startNextHand(mod)).toThrowError(EngineError);

      try {
        startNextHand(mod);
      } catch (err) {
        expect((err as EngineError).code).toBe('INSUFFICIENT_PLAYERS');
      }
    });
  });

  // 28. Rejeição de mesa sem jogadores elegíveis
  describe('28. Rejeição de mesa sem jogadores elegíveis', () => {
    it('dispara INSUFFICIENT_PLAYERS quando nenhum jogador possui fichas', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];

      const showdown = playHandToShowdown(players, 1);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p1'] }]);

      const mod = {
        ...settlement,
        players: Object.freeze(settlement.players.map(p => ({ ...p, chips: 0 }))),
      };

      expect(() => startNextHand(mod)).toThrowError(EngineError);

      try {
        startNextHand(mod);
      } catch (err) {
        expect((err as EngineError).code).toBe('INSUFFICIENT_PLAYERS');
      }
    });
  });

  // 29. Rejeição de stacks negativos, fracionários ou inseguros
  describe('29. Rejeição de stacks negativos, fracionários ou inseguros', () => {
    it('rejeita stacks negativos ou decimais com INVALID_CHIPS', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];

      const showdown = playHandToShowdown(players, 1);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p1'] }]);

      // Stack negativo
      const negativeStackMod = {
        ...settlement,
        players: Object.freeze(settlement.players.map(p => p.id === 'p1' ? { ...p, chips: -50 } : p)),
      };
      expect(() => startNextHand(negativeStackMod)).toThrowError(EngineError);
      try {
        startNextHand(negativeStackMod);
      } catch (err) {
        expect((err as EngineError).code).toBe('INVALID_CHIPS');
      }

      // Stack decimal
      const decimalStackMod = {
        ...settlement,
        players: Object.freeze(settlement.players.map(p => p.id === 'p1' ? { ...p, chips: 500.5 } : p)),
      };
      expect(() => startNextHand(decimalStackMod)).toThrowError(EngineError);
      try {
        startNextHand(decimalStackMod);
      } catch (err) {
        expect((err as EngineError).code).toBe('INVALID_CHIPS');
      }

      // Stack inseguro (> MAX_SAFE_INTEGER)
      const unsafeStackMod = {
        ...settlement,
        players: Object.freeze(settlement.players.map(p => p.id === 'p1' ? { ...p, chips: Number.MAX_SAFE_INTEGER + 10 } : p)),
      };
      expect(() => startNextHand(unsafeStackMod)).toThrowError(EngineError);
      try {
        startNextHand(unsafeStackMod);
      } catch (err) {
        expect((err as EngineError).code).toBe('INVALID_CHIPS');
      }
    });
  });

  // 30. Imutabilidade do resultado anterior
  describe('30. Imutabilidade do resultado anterior', () => {
    it('garante que o SettlementResult de entrada não sofre nenhuma mutação', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];

      const showdown = playHandToShowdown(players, 1);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p1'] }]);
      const snapshot = JSON.stringify(settlement);

      const nextHand = startNextHand(settlement);

      expect(JSON.stringify(settlement)).toBe(snapshot);
      expect(Object.isFrozen(nextHand)).toBe(true);
      expect(Object.isFrozen(nextHand.players)).toBe(true);
    });
  });

  // 31. Determinismo com jogadores apresentados em ordem diferente
  describe('31. Determinismo com jogadores apresentados em ordem diferente', () => {
    it('produz exatamente o mesmo estado inicial independentemente da ordenação do array de jogadores', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];

      const showdown = playHandToShowdown(players, 1);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p1'] }]);

      const reversedPlayers = [...settlement.players].reverse();
      const reversedSettlement: SettlementResult = {
        ...settlement,
        players: Object.freeze(reversedPlayers),
      };

      const res1 = startNextHand(settlement);
      const res2 = startNextHand(reversedSettlement);

      expect(res1).toEqual(res2);
    });
  });

  // 32. Conservação de fichas durante três mãos consecutivas
  describe('32. Conservação de fichas durante três mãos consecutivas', () => {
    it('executa 3 mãos completas consecutivas mantendo a conservação total estrita de fichas', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];
      const initialTotal = 3000;

      // ==========================================
      // MÃO 1: Dealer no assento 1
      // ==========================================
      let h1 = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      expect(h1.dealerSeat).toBe(1);
      // UTG é p1
      h1 = handCall(h1, 'p1');
      h1 = handCall(h1, 'p2');
      h1 = handCheck(h1, 'p3');

      // Flop
      h1 = advanceStreet(h1);
      h1 = handRaise(h1, 50, 'p2');
      h1 = handCall(h1, 'p3');
      h1 = handFold(h1, 'p1');

      // Turn
      h1 = advanceStreet(h1);
      h1 = handCheck(h1, 'p2');
      h1 = handCheck(h1, 'p3');

      // River
      h1 = advanceStreet(h1);
      h1 = handCheck(h1, 'p2');
      h1 = handCheck(h1, 'p3');

      // Showdown
      h1 = advanceStreet(h1);
      const s1 = settleHandFlow(h1, [{ potId: 'main', winners: ['p3'] }]);
      expect(s1.status).toBe('settled');

      const totalAfterHand1 = s1.players.reduce((sum, p) => sum + p.chips, 0);
      expect(totalAfterHand1).toBe(initialTotal);

      // ==========================================
      // MÃO 2: Iniciada a partir da liquidação 1
      // ==========================================
      let h2 = startNextHand(s1);
      expect(h2.dealerSeat).toBe(2); // Dealer avançou de 1 para 2!
      const totalStartHand2 = h2.players.reduce((sum, p) => sum + p.chips, 0) + h2.pot;
      expect(totalStartHand2).toBe(initialTotal);

      // Pré-flop: UTG é p2 (dealer)
      h2 = handCall(h2, 'p2');
      h2 = handCall(h2, 'p3');
      h2 = handCheck(h2, 'p1');

      // Flop
      h2 = advanceStreet(h2);
      h2 = handCheck(h2, 'p3');
      h2 = handCheck(h2, 'p1');
      h2 = handCheck(h2, 'p2');

      // Turn
      h2 = advanceStreet(h2);
      h2 = handCheck(h2, 'p3');
      h2 = handCheck(h2, 'p1');
      h2 = handCheck(h2, 'p2');

      // River
      h2 = advanceStreet(h2);
      h2 = handCheck(h2, 'p3');
      h2 = handCheck(h2, 'p1');
      h2 = handCheck(h2, 'p2');

      // Showdown
      h2 = advanceStreet(h2);
      const s2 = settleHandFlow(h2, [{ potId: 'main', winners: ['p1'] }]);
      const totalAfterHand2 = s2.players.reduce((sum, p) => sum + p.chips, 0);
      expect(totalAfterHand2).toBe(initialTotal);

      // ==========================================
      // MÃO 3: Iniciada a partir da liquidação 2
      // ==========================================
      let h3 = startNextHand(s2);
      expect(h3.dealerSeat).toBe(3); // Dealer avançou de 2 para 3!
      const totalStartHand3 = h3.players.reduce((sum, p) => sum + p.chips, 0) + h3.pot;
      expect(totalStartHand3).toBe(initialTotal);

      // Pré-flop: UTG é p3 (dealer)
      h3 = handCall(h3, 'p3');
      h3 = handCall(h3, 'p1');
      h3 = handCheck(h3, 'p2');

      // Flop: p1 aposta 100, p2 e p3 desistem -> encerramento por fold
      h3 = advanceStreet(h3);
      h3 = handRaise(h3, 100, 'p1');
      h3 = handFold(h3, 'p2');
      h3 = handFold(h3, 'p3');

      expect(h3.status).toBe('hand_ended_by_fold');
      const s3 = settleHandFlow(h3); // Auto-award para p1

      const totalAfterHand3 = s3.players.reduce((sum, p) => sum + p.chips, 0);
      expect(totalAfterHand3).toBe(initialTotal);
    });
  });

  // 33. Impossibilidade de reutilizar contribuições antigas
  describe('33. Impossibilidade de reutilizar contribuições antigas', () => {
    it('garante que nenhum valor de committed da mão anterior vaza para a nova mão', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handRaise(state, 200, 'p1');
      state = handCall(state, 'p2');
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

      const settlement = settleHandFlow(state, [{ potId: 'main', winners: ['p1'] }]);
      const nextHand = startNextHand(settlement);

      for (const p of nextHand.players) {
        expect(p.baseCommitted).toBe(0);
        // committed na nova mão é apenas o blind
        expect(p.totalCommitted).toBe(p.committed);
      }
    });
  });

  describe('Regressões da auditoria 2.4C', () => {
    function settleRealElimination(eliminatedId: string): SettlementResult {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: eliminatedId === 'p1' ? 20 : 1000 },
        { id: 'p2', seat: 2, chips: eliminatedId === 'p2' ? 20 : 1000 },
        { id: 'p3', seat: 3, chips: eliminatedId === 'p3' ? 20 : 1000 },
      ];

      let state = startHandFlow({
        players,
        blinds: defaultBlinds,
        dealerSeat: 1,
      });

      // Completa todas as streets usando ações reais do motor.
      // O jogador com 20 fichas fica all-in no pré-flop.
      for (let step = 0; step < 32 && state.status === 'in_progress'; step++) {
        if (state.currentRound.status === 'completed') {
          state = advanceStreet(state);
          continue;
        }

        const actor = state.currentActorId;
        if (!actor) {
          throw new Error('Rodada ativa sem jogador autorizado a agir.');
        }

        const roundPlayer = state.currentRound.players.find(
          player => player.id === actor,
        );

        if (!roundPlayer) {
          throw new Error('Jogador da rodada não encontrado.');
        }

        state = roundPlayer.committed < state.currentRound.currentBet
          ? handCall(state, actor)
          : handCheck(state, actor);
      }

      expect(state.status).toBe('showdown');

      const winner = eliminatedId === 'p1' ? 'p2' : 'p1';

      const settlement = settleHandFlow(state, [
        { potId: 'main', winners: [winner] },
      ]);

      expect(
        settlement.players.find(player => player.id === eliminatedId)?.chips,
      ).toBe(0);

      expect(
        settlement.players.reduce((total, player) => total + player.chips, 0),
      ).toBe(2020);

      return settlement;
    }

    const eliminationCases = [
      { eliminated: 'p1', dealer: 3, bigBlind: 2 },
      { eliminated: 'p2', dealer: 3, bigBlind: 1 },
      { eliminated: 'p3', dealer: 1, bigBlind: 2 },
    ] as const;

    for (const scenario of eliminationCases) {
      it(`mantém a integridade ao eliminar realmente ${scenario.eliminated}`, () => {
        const settlement = settleRealElimination(scenario.eliminated);
        const nextHand = startNextHand(settlement);

        expect(nextHand.players).toHaveLength(2);
        expect(nextHand.dealerSeat).toBe(scenario.dealer);
        expect(nextHand.smallBlindSeat).toBe(scenario.dealer);
        expect(nextHand.bigBlindSeat).toBe(scenario.bigBlind);

        expect(
          nextHand.players.some(player => player.id === scenario.eliminated),
        ).toBe(false);

        const total = nextHand.players.reduce(
          (sum, player) => sum + player.chips,
          nextHand.pot,
        );

        expect(total).toBe(2020);
      });
    }

    it('rejeita resultado liquidado com pote não zerado', () => {
      const settlement = settleRealElimination('p1');

      const corrupted = {
        ...settlement,
        pot: 1,
      } as unknown as SettlementResult;

      expect(() => startNextHand(corrupted)).toThrowError(EngineError);
    });

    it('rejeita contribuições pendentes após a liquidação', () => {
      const settlement = settleRealElimination('p1');

      const corrupted: SettlementResult = {
        ...settlement,
        players: settlement.players.map((player, index) =>
          index === 0
            ? { ...player, committed: 1 }
            : player,
        ),
      };

      expect(() => startNextHand(corrupted)).toThrowError(EngineError);
    });
  });

  // 34. Compatibilidade com as APIs anteriores do motor
  describe('34. Compatibilidade com as APIs anteriores do motor', () => {
    it('assegura que advanceDealer, determineNextDealerSeat e initHand continuam operando harmoniosamente', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];

      // advanceDealer
      const dealer = advanceDealer(players, 1);
      expect(dealer.seat).toBe(2);

      // initHand
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 2 });
      expect(hand.dealerSeat).toBe(2);
      expect(hand.smallBlindSeat).toBe(2);
      expect(hand.bigBlindSeat).toBe(1);

      // startHandFlow
      const flow = startHandFlow(hand);
      expect(flow.dealerSeat).toBe(2);
      expect(flow.status).toBe('in_progress');

      // determineNextDealerSeat
      const showdown = playHandToShowdown(players, 1);
      const settlement = settleHandFlow(showdown, [{ potId: 'main', winners: ['p1'] }]);
      const nextSeat = determineNextDealerSeat(settlement, players);
      expect(nextSeat).toBe(2);
    });
  });
});
