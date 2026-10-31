import { describe, expect, it } from 'vitest';
import {
  advanceStreet,
  applyHandAction,
  buildHandFlowPots,
  buildPots,
  canAdvanceStreet,
  EngineError,
  getHandFlowPotPlayers,
  handAllIn,
  handCall,
  handCheck,
  handFold,
  handRaise,
  initHand,
  startHandFlow,
  type PlayerInput,
} from '@poker-table/engine';

describe('Texas Hold\'em Engine — Gerenciamento das Streets e Continuidade das Apostas (Etapa 2.4A)', () => {
  const defaultBlinds = { smallBlind: 10, bigBlind: 20 };

  // 1. Inicialização no pré-flop
  describe('1. Inicialização no pré-flop', () => {
    it('inicia corretamente na street preflop com blinds postados e pote inicial', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];

      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      const state = startHandFlow(hand);

      expect(state.street).toBe('preflop');
      expect(state.status).toBe('in_progress');
      expect(state.pot).toBe(30); // 10 SB + 20 BB
      expect(state.currentRound.currentBet).toBe(20);
      expect(state.currentActorId).toBe('p1'); // UTG age primeiro
      expect(state.playersToAct).toEqual(['p1', 'p2', 'p3']);

      const sb = state.players.find(p => p.id === 'p2')!;
      const bb = state.players.find(p => p.id === 'p3')!;
      const utg = state.players.find(p => p.id === 'p1')!;

      expect(sb.chips).toBe(990);
      expect(sb.roundCommitted).toBe(10);
      expect(sb.totalCommitted).toBe(10);

      expect(bb.chips).toBe(980);
      expect(bb.roundCommitted).toBe(20);
      expect(bb.totalCommitted).toBe(20);

      expect(utg.chips).toBe(1000);
      expect(utg.roundCommitted).toBe(0);
      expect(utg.totalCommitted).toBe(0);
    });
  });

  // 2. Pré-flop → flop
  describe('2. Pré-flop → flop', () => {
    it('avança para o flop após a conclusão das apostas do pré-flop', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handCall(state, 'p1'); // paga 20
      state = handCall(state, 'p2'); // SB completa 20
      state = handCheck(state, 'p3'); // BB check

      expect(state.currentRound.status).toBe('completed');
      expect(canAdvanceStreet(state)).toBe(true);

      state = advanceStreet(state);

      expect(state.street).toBe('flop');
      expect(state.status).toBe('in_progress');
      expect(state.pot).toBe(60);
      expect(state.currentRound.currentBet).toBe(0);
      expect(state.currentRound.status).toBe('active');
    });
  });

  // 3. Flop → turn
  describe('3. Flop → turn', () => {
    it('avança para o turn após checks ou apostas igualadas no flop', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handCall(state, 'p1');
      state = handCall(state, 'p2');
      state = handCheck(state, 'p3');
      state = advanceStreet(state); // Flop

      // Todos dão check no flop
      state = handCheck(state);
      state = handCheck(state);
      state = handCheck(state);

      expect(state.currentRound.status).toBe('completed');
      state = advanceStreet(state);

      expect(state.street).toBe('turn');
      expect(state.status).toBe('in_progress');
      expect(state.pot).toBe(60);
      expect(state.currentRound.currentBet).toBe(0);
    });
  });

  // 4. Turn → river
  describe('4. Turn → river', () => {
    it('avança para o river após a conclusão das apostas do turn', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handCall(state, 'p1');
      state = handCall(state, 'p2');
      state = handCheck(state, 'p3');
      state = advanceStreet(state); // Flop

      state = handCheck(state);
      state = handCheck(state);
      state = handCheck(state);
      state = advanceStreet(state); // Turn

      // P2 aposta 50, P3 paga 50, P1 paga 50
      state = handRaise(state, 50, 'p2');
      state = handCall(state, 'p3');
      state = handCall(state, 'p1');

      expect(state.currentRound.status).toBe('completed');
      expect(state.pot).toBe(60 + 150); // 210

      state = advanceStreet(state);

      expect(state.street).toBe('river');
      expect(state.status).toBe('in_progress');
      expect(state.pot).toBe(210);
      expect(state.currentRound.currentBet).toBe(0);
    });
  });

  // 5. River → showdown
  describe('5. River → showdown', () => {
    it('marca a mão como pronta para showdown ao avançar a street após o encerramento do river', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      // Heads-up: p1 é SB/dealer, p2 é BB
      state = handCall(state, 'p1');
      state = handCheck(state, 'p2');
      state = advanceStreet(state); // Flop

      state = handCheck(state, 'p2');
      state = handCheck(state, 'p1');
      state = advanceStreet(state); // Turn

      state = handCheck(state, 'p2');
      state = handCheck(state, 'p1');
      state = advanceStreet(state); // River

      state = handCheck(state, 'p2');
      state = handCheck(state, 'p1');

      expect(state.currentRound.status).toBe('completed');

      state = advanceStreet(state); // Showdown!

      expect(state.street).toBe('river');
      expect(state.status).toBe('showdown');
      expect(state.currentActorId).toBeNull();
      expect(state.playersToAct).toHaveLength(0);
    });
  });

  // 6. Bloqueio de avanço prematuro
  describe('6. Bloqueio de avanço prematuro', () => {
    it('impede o avanço da street enquanto a rodada de apostas atual estiver ativa', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];

      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      const state = startHandFlow(hand);
      expect(state.currentRound.status).toBe('active');
      expect(canAdvanceStreet(state)).toBe(false);

      expect(() => advanceStreet(state)).toThrowError(EngineError);
    });
  });

  // 7. Zeramento das apostas da street seguinte
  describe('7. Zeramento das apostas da street seguinte', () => {
    it('inicia a street seguinte com roundCommitted e currentBet zerados para todos os jogadores', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handCall(state, 'p1');
      state = handCheck(state, 'p2');
      state = advanceStreet(state); // Flop

      expect(state.currentRound.currentBet).toBe(0);
      for (const p of state.players) {
        expect(p.roundCommitted).toBe(0);
        expect(p.committed).toBe(0);
      }
      for (const rp of state.currentRound.players) {
        expect(rp.committed).toBe(0);
      }
    });
  });

  // 8. Preservação do pote acumulado
  describe('8. Preservação do pote acumulado', () => {
    it('acumula e preserva o pote total ao longo de múltiplas rodadas de aposta', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handRaise(state, 50, 'p1');
      state = handCall(state, 'p2'); // Pote pré-flop = 100
      expect(state.pot).toBe(100);

      state = advanceStreet(state); // Flop
      expect(state.pot).toBe(100);

      state = handRaise(state, 100, 'p2');
      state = handCall(state, 'p1'); // Flop adiciona 200 -> Pote = 300
      expect(state.pot).toBe(300);

      state = advanceStreet(state); // Turn
      expect(state.pot).toBe(300);
    });
  });

  // 9. Preservação das contribuições totais
  describe('9. Preservação das contribuições totais', () => {
    it('mantém o somatório de todas as fichas comprometidas em totalCommitted', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handCall(state, 'p1'); // 20
      state = handCheck(state, 'p2'); // 20
      state = advanceStreet(state); // Flop

      state = handRaise(state, 50, 'p2'); // +50
      state = handCall(state, 'p1'); // +50
      state = advanceStreet(state); // Turn

      const p1 = state.players.find(p => p.id === 'p1')!;
      const p2 = state.players.find(p => p.id === 'p2')!;

      expect(p1.totalCommitted).toBe(70); // 20 + 50
      expect(p2.totalCommitted).toBe(70); // 20 + 50
      expect(p1.totalCommitted + p2.totalCommitted).toBe(state.pot); // 140
    });
  });

  // 10. Ordem de ação pós-flop em mesa de 3 jogadores
  describe('10. Ordem de ação pós-flop em mesa de 3 jogadores', () => {
    it('inicia no SB, seguido do BB e finaliza no Dealer', () => {
      const players: PlayerInput[] = [
        { id: 'dealer', seat: 1, chips: 1000 },
        { id: 'sb', seat: 2, chips: 1000 },
        { id: 'bb', seat: 3, chips: 1000 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handCall(state, 'dealer');
      state = handCall(state, 'sb');
      state = handCheck(state, 'bb');

      state = advanceStreet(state); // Flop

      expect(state.currentActorId).toBe('sb');
      expect(state.playersToAct).toEqual(['sb', 'bb', 'dealer']);
    });
  });

  // 11. Ordem pós-flop em heads-up
  describe('11. Ordem pós-flop em heads-up', () => {
    it('no heads-up, o BB age primeiro e o Dealer age por último no pós-flop', () => {
      const players: PlayerInput[] = [
        { id: 'dealer_sb', seat: 1, chips: 1000 },
        { id: 'bb', seat: 2, chips: 1000 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      // No pré-flop, dealer_sb agiu primeiro
      state = handCall(state, 'dealer_sb');
      state = handCheck(state, 'bb');

      state = advanceStreet(state); // Flop

      expect(state.currentActorId).toBe('bb');
      expect(state.playersToAct).toEqual(['bb', 'dealer_sb']);
    });
  });

  // 12. Jogadores folded excluídos da ação
  describe('12. Jogadores folded excluídos da ação', () => {
    it('não inclui jogadores que desistiram nas rodadas posteriores', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handFold(state, 'p1'); // p1 dá fold pré-flop
      state = handCall(state, 'p2'); // SB completa
      state = handCheck(state, 'p3'); // BB check

      state = advanceStreet(state); // Flop

      expect(state.playersToAct).toEqual(['p2', 'p3']);
      expect(state.currentActorId).toBe('p2');

      const p1 = state.players.find(p => p.id === 'p1')!;
      expect(p1.folded).toBe(true);
    });
  });

  // 13. Jogadores all-in excluídos da ação
  describe('13. Jogadores all-in excluídos da ação', () => {
    it('não concede a vez de agir a jogadores all-in no pós-flop', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 20 }, // Tem só 20 (ficará all-in no pré-flop)
        { id: 'p3', seat: 3, chips: 1000 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      // p1 paga 20, p2 (SB com 20) completa all-in 20, p3 (BB) check
      state = handCall(state, 'p1');
      state = handCall(state, 'p2'); // all-in
      state = handCheck(state, 'p3');

      state = advanceStreet(state); // Flop

      // p2 está all-in, então apenas p3 e p1 agem no flop
      expect(state.playersToAct).toEqual(['p3', 'p1']);
      expect(state.currentActorId).toBe('p3');

      const p2 = state.players.find(p => p.id === 'p2')!;
      expect(p2.isAllIn).toBe(true);
      expect(p2.chips).toBe(0);
    });
  });

  // 14. Apostas e raises no flop
  describe('14. Apostas e raises no flop', () => {
    it('executa aposta, raise e call no flop com atualização correta dos turnos', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handCall(state, 'p1');
      state = handCheck(state, 'p2');
      state = advanceStreet(state); // Flop

      state = applyHandAction(state, { playerId: 'p2', type: 'raise', amount: 50 }); // Aposta 50
      state = applyHandAction(state, { playerId: 'p1', type: 'raise', amount: 120 }); // Raise para 120 (aumento de 70)
      state = applyHandAction(state, { playerId: 'p2', type: 'call' }); // Paga 120

      expect(state.currentRound.status).toBe('completed');
      expect(state.pot).toBe(40 + 240); // 280
    });
  });

  // 15. Apostas e raises no turn
  describe('15. Apostas e raises no turn', () => {
    it('permite dinâmica completa de apostas no turn', () => {
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

      state = handRaise(state, 80, 'p2');
      state = handRaise(state, 200, 'p1');
      state = handCall(state, 'p2');

      expect(state.currentRound.status).toBe('completed');
      expect(state.pot).toBe(40 + 400); // 440
    });
  });

  // 16. Apostas e raises no river
  describe('16. Apostas e raises no river', () => {
    it('permite dinâmica completa de apostas no river', () => {
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

      state = handRaise(state, 150, 'p2');
      state = handCall(state, 'p1');

      expect(state.currentRound.status).toBe('completed');
      expect(state.pot).toBe(40 + 300); // 340
    });
  });

  // 17. Fold encerrando a mão no pré-flop
  describe('17. Fold encerrando a mão no pré-flop', () => {
    it('encerra a mão imediatamente com hand_ended_by_fold quando todos desistem pré-flop', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handFold(state, 'p1');
      state = handFold(state, 'p2');

      expect(state.status).toBe('hand_ended_by_fold');
      expect(state.survivorId).toBe('p3');
      expect(state.currentActorId).toBeNull();
      expect(state.playersToAct).toHaveLength(0);
    });
  });

  // 18. Fold encerrando a mão no flop
  describe('18. Fold encerrando a mão no flop', () => {
    it('encerra a mão imediatamente com hand_ended_by_fold quando restam apenas um jogador no flop', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handCall(state, 'p1');
      state = handCall(state, 'p2');
      state = handCheck(state, 'p3');
      state = advanceStreet(state); // Flop

      // p2 aposta, p3 fold, p1 fold
      state = handRaise(state, 50, 'p2');
      state = handFold(state, 'p3');
      state = handFold(state, 'p1');

      expect(state.status).toBe('hand_ended_by_fold');
      expect(state.survivorId).toBe('p2');
      expect(state.currentActorId).toBeNull();
    });
  });

  // 19. Encerramento antecipado de apostas após all-ins
  describe('19. Encerramento antecipado de apostas após all-ins', () => {
    it('encerra a fase de apostas e marca showdown quando não restam 2 jogadores com fichas', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 100 },
        { id: 'p2', seat: 2, chips: 100 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      // p1 vai all-in (100) e p2 paga all-in (100)
      state = handAllIn(state, 'p1');
      state = handCall(state, 'p2');

      // Ambas as partes estão all-in com 0 fichas restantes
      expect(state.status).toBe('showdown');
      expect(state.currentActorId).toBeNull();
      expect(state.pot).toBe(200);
    });
  });

  // 20. Restituição de fichas não igualadas
  describe('20. Restituição de fichas não igualadas', () => {
    it('restitui o excedente não igualado e reflete no total acumulado do jogador', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 50 }, // All-in com 50 no flop
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handCall(state, 'p1'); // 20
      state = handCheck(state, 'p2'); // 20 (restam 30 chips para p2)
      state = advanceStreet(state); // Flop

      // No flop em heads-up, p2 (BB) age primeiro e dá check
      state = handCheck(state, 'p2');
      // p1 aposta 100
      state = handRaise(state, 100, 'p1');
      // p2 só possui 30 fichas restantes e paga all-in com 30
      state = handCall(state, 'p2');

      // p1 tem 70 fichas não igualadas que são restituídas via settleUncalled
      expect(state.currentRound.status).toBe('completed');
      expect(state.status).toBe('showdown');

      const p1 = state.players.find(p => p.id === 'p1')!;
      const p2 = state.players.find(p => p.id === 'p2')!;

      // p1: 20 (pré-flop) + 30 (flop igualado) = 50 totalCommitted
      expect(p1.totalCommitted).toBe(50);
      expect(p1.chips).toBe(950);

      // p2: 20 (pré-flop) + 30 (flop) = 50 totalCommitted
      expect(p2.totalCommitted).toBe(50);
      expect(p2.chips).toBe(0);

      expect(state.pot).toBe(100);
    });
  });

  // 21. Main pot e side pots com contribuições de múltiplas streets (Cenário da Seção 9)
  describe('21. Main pot e side pots com contribuições de múltiplas streets', () => {
    it('reproduz com exatidão o cenário do enunciado: A=300, B=300, C=100 all-in -> Main 300, Side 400', () => {
      // Pré-flop: A=100, B=100, C=100 (C tem 100 fichas totais e fica all-in)
      const players: PlayerInput[] = [
        { id: 'A', seat: 1, chips: 1000 },
        { id: 'B', seat: 2, chips: 1000 },
        { id: 'C', seat: 3, chips: 100 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      // Blinds: B (SB 10), C (BB 20).
      // A (dealer/UTG) aumenta para 100
      state = handRaise(state, 100, 'A');
      // B paga 100
      state = handCall(state, 'B');
      // C paga all-in 100
      state = handCall(state, 'C');

      expect(state.currentRound.status).toBe('completed');
      expect(state.pot).toBe(300);

      state = advanceStreet(state); // Flop

      // Flop: A e B apostam mais 200 cada; C permanece all-in
      // No flop, B é o primeiro ativo (SB), dá check ou aposta
      state = handRaise(state, 200, 'B'); // B aposta 200
      state = handCall(state, 'A'); // A paga 200

      expect(state.currentRound.status).toBe('completed');
      expect(state.pot).toBe(700);

      const pA = state.players.find(p => p.id === 'A')!;
      const pB = state.players.find(p => p.id === 'B')!;
      const pC = state.players.find(p => p.id === 'C')!;

      expect(pA.totalCommitted).toBe(300);
      expect(pB.totalCommitted).toBe(300);
      expect(pC.totalCommitted).toBe(100);

      // Constrói os potes diretamente pelo adaptador de fluxo
      const pots = buildHandFlowPots(state);
      expect(pots).toHaveLength(2);

      const [mainPot, sidePot] = pots;

      // Main pot: 100 de cada um = 300 (A, B, C elegíveis)
      expect(mainPot.id).toBe('main');
      expect(mainPot.amount).toBe(300);
      expect(mainPot.eligiblePlayers).toEqual(['A', 'B', 'C']);

      // Side pot: (300 - 100) x 2 = 400 (A, B elegíveis)
      expect(sidePot.id).toBe('side-1');
      expect(sidePot.amount).toBe(400);
      expect(sidePot.eligiblePlayers).toEqual(['A', 'B']);

      // Também verifica que buildPots(state) aceita diretamente o HandFlowState
      const directPots = buildPots(state);
      expect(directPots).toEqual(pots);

      const potPlayers = getHandFlowPotPlayers(state);
      expect(potPlayers).toHaveLength(3);
    });
  });

  // 22. Conservação de fichas entre transições
  describe('22. Conservação de fichas entre transições', () => {
    it('garante que sum(chips) + pot é estritamente constante em todas as streets', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 500 },
        { id: 'p2', seat: 2, chips: 500 },
        { id: 'p3', seat: 3, chips: 500 },
      ];

      const initialTotal = 1500;
      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });

      const checkConservation = (s: typeof state) => {
        const chipsSum = s.players.reduce((sum, p) => sum + p.chips, 0);
        expect(chipsSum + s.pot).toBe(initialTotal);
      };

      checkConservation(state);

      state = handCall(state, 'p1');
      state = handCall(state, 'p2');
      state = handCheck(state, 'p3');
      checkConservation(state);

      state = advanceStreet(state); // Flop
      checkConservation(state);

      state = handRaise(state, 50, 'p2');
      state = handCall(state, 'p3');
      state = handFold(state, 'p1');
      checkConservation(state);

      state = advanceStreet(state); // Turn
      checkConservation(state);

      state = handCheck(state, 'p2');
      state = handCheck(state, 'p3');
      checkConservation(state);

      state = advanceStreet(state); // River
      checkConservation(state);

      state = handRaise(state, 100, 'p2');
      state = handCall(state, 'p3');
      checkConservation(state);

      state = advanceStreet(state); // Showdown
      checkConservation(state);
    });
  });

  describe('Regressões: integridade do fluxo', () => {
    const players: PlayerInput[] = [
      { id: 'A', seat: 1, chips: 1000 },
      { id: 'B', seat: 2, chips: 1000 },
    ];

    function completedPreflop() {
      let state = startHandFlow({
        players,
        blinds: defaultBlinds,
        dealerSeat: 1,
      });

      state = handCall(state, 'A');
      state = handCheck(state, 'B');

      expect(state.currentRound.status).toBe('completed');
      return state;
    }

    it('congela individualmente os jogadores no início do flop', () => {
      const state = advanceStreet(completedPreflop());

      expect(state.street).toBe('flop');

      for (const player of state.currentRound.players) {
        expect(Object.isFrozen(player)).toBe(true);
      }
    });

    it('não permite construir potes definitivos durante uma street ativa', () => {
      const state = advanceStreet(completedPreflop());

      expect(state.currentRound.status).toBe('active');

      expect(() => buildPots(state)).toThrowError(EngineError);
      expect(() => buildHandFlowPots(state)).toThrowError(EngineError);
    });

    it('rejeita inconsistência financeira nos dois caminhos de construção', () => {
      const state = completedPreflop();

      const inconsistent = {
        ...state,
        pot: state.pot + 1,
      };

      expect(() => buildPots(inconsistent)).toThrowError(EngineError);
      expect(() => buildHandFlowPots(inconsistent)).toThrowError(EngineError);
    });
  });

  // 23. Imutabilidade dos estados anteriores
  describe('23. Imutabilidade dos estados anteriores', () => {
    it('preserva os estados anteriores e congela todos os objetos gerados', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 500 },
        { id: 'p2', seat: 2, chips: 500 },
      ];

      const state1 = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      const potBefore = state1.pot;

      const state2 = handCall(state1, 'p1');
      expect(state1.pot).toBe(potBefore);
      expect(state2.pot).toBe(40);

      expect(Object.isFrozen(state1)).toBe(true);
      expect(Object.isFrozen(state1.players)).toBe(true);
      expect(Object.isFrozen(state2)).toBe(true);
      expect(Object.isFrozen(state2.players)).toBe(true);
    });
  });

  // 24. Inteiros seguros e entradas inválidas
  describe('24. Inteiros seguros e entradas inválidas', () => {
    it('rejeita ações e transições com tipos ou valores inválidos', () => {
      // @ts-expect-error teste de robustez em tempo de execução
      expect(() => startHandFlow(null)).toThrowError(EngineError);

      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 500 },
        { id: 'p2', seat: 2, chips: 500 },
      ];

      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      const state = startHandFlow(hand);

      // Jogador fora da vez
      expect(() => handCall(state, 'p2')).toThrowError(EngineError);

      // Jogador inexistente
      expect(() => handCall(state, 'fantasma')).toThrowError(EngineError);

      // Valor de raise negativo ou inválido
      expect(() => handRaise(state, -10, 'p1')).toThrowError(EngineError);
      expect(() => handRaise(state, 50.5, 'p1')).toThrowError(EngineError);
    });
  });

  // 25. Mesa com 6 jogadores
  describe('25. Mesa com 6 jogadores', () => {
    it('gerencia o fluxo completo de uma mesa de 6 jogadores pelas streets', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
        { id: 'p4', seat: 4, chips: 1000 },
        { id: 'p5', seat: 5, chips: 1000 },
        { id: 'p6', seat: 6, chips: 1000 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      // p1=D(1), p2=SB(2), p3=BB(3), p4=UTG(4), p5=MP(5), p6=CO(6)
      state = handCall(state, 'p4');
      state = handFold(state, 'p5');
      state = handFold(state, 'p6');
      state = handFold(state, 'p1');
      state = handCall(state, 'p2');
      state = handCheck(state, 'p3');

      expect(state.currentRound.status).toBe('completed');
      state = advanceStreet(state); // Flop: p2, p3, p4 ativos

      expect(state.street).toBe('flop');
      expect(state.currentActorId).toBe('p2');

      state = handCheck(state, 'p2');
      state = handCheck(state, 'p3');
      state = handCheck(state, 'p4');

      state = advanceStreet(state); // Turn
      expect(state.street).toBe('turn');
      expect(state.currentActorId).toBe('p2');
    });
  });

  // 26. Mesa com 10 jogadores
  describe('26. Mesa com 10 jogadores', () => {
    it('gerencia corretamente mesa cheia de 10 jogadores com múltiplos folds e calls', () => {
      const players: PlayerInput[] = Array.from({ length: 10 }, (_, i) => ({
        id: `p${i + 1}`,
        seat: i + 1,
        chips: 1000,
      }));

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      // p1=D, p2=SB, p3=BB, p4..p10 são os demais
      // p4 a p9 dão fold
      for (let i = 4; i <= 9; i++) {
        state = handFold(state, `p${i}`);
      }
      state = handCall(state, 'p10');
      state = handFold(state, 'p1');
      state = handCall(state, 'p2');
      state = handCheck(state, 'p3');

      expect(state.currentRound.status).toBe('completed');
      state = advanceStreet(state); // Flop com p2, p3, p10

      expect(state.street).toBe('flop');
      expect(state.playersToAct).toEqual(['p2', 'p3', 'p10']);
    });
  });

  // 27. Nenhuma ação permitida após showdown ou encerramento por fold
  describe('27. Nenhuma ação permitida após showdown ou encerramento por fold', () => {
    it('rejeita ações ou avanço de street após a mão alcançar o showdown', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 100 },
        { id: 'p2', seat: 2, chips: 100 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handAllIn(state, 'p1');
      state = handCall(state, 'p2');

      expect(state.status).toBe('showdown');

      expect(() => handCheck(state, 'p1')).toThrowError(EngineError);
      expect(() => advanceStreet(state)).toThrowError(EngineError);
    });

    it('rejeita ações ou avanço de street após a mão encerrar por fold', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];

      let state = startHandFlow({ players, blinds: defaultBlinds, dealerSeat: 1 });
      state = handFold(state, 'p1');

      expect(state.status).toBe('hand_ended_by_fold');

      expect(() => handCheck(state, 'p2')).toThrowError(EngineError);
      expect(() => advanceStreet(state)).toThrowError(EngineError);
    });
  });
});
