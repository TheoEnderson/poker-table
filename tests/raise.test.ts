import { describe, expect, it } from 'vitest';
import {
  allIn,
  allin,
  applyAction,
  call,
  canPlayerRaise,
  createPreFlopRound,
  EngineError,
  fold,
  getMinRaiseAmount,
  initHand,
  raise,
  type PlayerInput,
} from '@poker-table/engine';

describe('Texas Hold\'em Engine — Raises e All-ins no Pré-Flop (Etapa 2.2B)', () => {
  const defaultBlinds = { smallBlind: 10, bigBlind: 20 };

  // 1. Raise mínimo válido
  describe('1. Raise mínimo válido', () => {
    it('permite raise mínimo para o dobro do Big Blind (incremento nominal)', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      const round0 = createPreFlopRound(hand);

      expect(round0.currentBet).toBe(20);
      expect(round0.minRaiseIncrement).toBe(20);
      expect(getMinRaiseAmount(round0)).toBe(40);

      const round1 = applyAction(round0, { playerId: 'p1', type: 'raise', amount: 40 });
      const p1 = round1.players.find(p => p.id === 'p1')!;

      expect(p1.committed).toBe(40);
      expect(p1.chips).toBe(960);
      expect(round1.currentBet).toBe(40);
      expect(round1.minRaiseIncrement).toBe(20);
      expect(round1.pot).toBe(70); // 10 (SB) + 20 (BB) + 40 (p1)
    });

    it('calcula o próximo raise mínimo após um aumento maior', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);

      // p1 aumenta para 100 (incremento de 80 acima de 20)
      round = raise(round, 100, 'p1');
      expect(round.currentBet).toBe(100);
      expect(round.minRaiseIncrement).toBe(80);
      expect(getMinRaiseAmount(round)).toBe(180);

      // p2 reraise mínimo para 180 (100 + 80)
      round = raise(round, 180, 'p2');
      expect(round.currentBet).toBe(180);
      expect(round.minRaiseIncrement).toBe(80);
      expect(getMinRaiseAmount(round)).toBe(260);
    });
  });

  // 2. Raise abaixo do mínimo rejeitado
  describe('2. Raise abaixo do mínimo rejeitado', () => {
    it('rejeita aumento voluntário abaixo do mínimo permitido no pré-flop', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      const round = createPreFlopRound(hand);

      // Mínimo é 40 (20 + 20). Tentativa de raise para 30
      expect(() => raise(round, 30, 'p1')).toThrowError(EngineError);
      expect(() => raise(round, 30, 'p1')).toThrowError(/abaixo do mínimo/i);
    });

    it('rejeita aumento voluntário inferior ao último incremento válido', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);
      round = raise(round, 100, 'p1'); // Incremento de 80

      // Mínimo é 180. Tentativa de aumentar para 150
      expect(() => raise(round, 150, 'p2')).toThrowError(EngineError);
      expect(() => raise(round, 150, 'p2')).toThrowError(/abaixo do mínimo/i);
    });
  });

  // 3. Raise acima do stack rejeitado
  describe('3. Raise acima do stack rejeitado', () => {
    it('rejeita raise com valor superior às fichas disponíveis do jogador', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 200 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      const round = createPreFlopRound(hand);

      expect(() => raise(round, 300, 'p1')).toThrowError(EngineError);
      expect(() => raise(round, 300, 'p1')).toThrowError(/fichas insuficientes/i);
    });
  });

  // 4. Raise completo atualizando a fila
  describe('4. Raise completo atualizando a fila', () => {
    it('recoloca todos os jogadores ativos com fichas na fila em ordem circular horária', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 }, // Dealer
        { id: 'p2', seat: 2, chips: 1000 }, // SB
        { id: 'p3', seat: 3, chips: 1000 }, // BB
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);

      // p1 aumenta para 60
      round = raise(round, 60, 'p1');
      expect(round.playersToAct).toEqual(['p2', 'p3']);
      expect(round.currentActorId).toBe('p2');

      // p2 dá call de 60
      round = call(round, 'p2');
      expect(round.playersToAct).toEqual(['p3']);
      expect(round.currentActorId).toBe('p3');

      // p3 dá call de 60
      round = call(round, 'p3');
      expect(round.playersToAct).toEqual([]);
      expect(round.status).toBe('completed');
    });
  });

  // 5. All-in equivalente a call
  describe('5. All-in equivalente a call', () => {
    it('trata all-in que iguala a aposta atual como call sem alterar currentBet', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 100 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);

      round = raise(round, 100, 'p1');
      // p2 tinha 100 fichas no total (colocou 10 no SB, restam 90). Total possível é 100.
      expect(round.players.find(p => p.id === 'p2')!.chips).toBe(90);

      round = allIn(round, 'p2'); // Total committed = 10 + 90 = 100 === currentBet
      const p2 = round.players.find(p => p.id === 'p2')!;

      expect(p2.committed).toBe(100);
      expect(p2.chips).toBe(0);
      expect(p2.isAllIn).toBe(true);
      expect(round.currentBet).toBe(100);
      expect(round.currentActorId).toBe('p3');
    });

    it('trata all-in com menos fichas que a aposta atual como call incompleto', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 60 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);

      round = raise(round, 100, 'p1');
      round = allIn(round, 'p2'); // p2 tem 50 restantes (total 60 < 100)
      const p2 = round.players.find(p => p.id === 'p2')!;

      expect(p2.committed).toBe(60);
      expect(p2.chips).toBe(0);
      expect(p2.isAllIn).toBe(true);
      expect(round.currentBet).toBe(100);
      expect(round.currentActorId).toBe('p3');
    });
  });

  // 6. All-in que constitui raise completo
  describe('6. All-in que constitui raise completo', () => {
    it('atualiza currentBet e minRaiseIncrement quando all-in é maior ou igual ao raise mínimo', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 150 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);

      // p1 vai all-in para 150 (incremento de 130 acima de 20 >= 20)
      round = allIn(round, 'p1');
      const p1 = round.players.find(p => p.id === 'p1')!;

      expect(p1.committed).toBe(150);
      expect(p1.isAllIn).toBe(true);
      expect(round.currentBet).toBe(150);
      expect(round.minRaiseIncrement).toBe(130);
      expect(round.playersToAct).toEqual(['p2', 'p3']);
    });
  });

  // 7. All-in com aumento incompleto
  describe('7. All-in com aumento incompleto', () => {
    it('aceita aumento all-in abaixo do mínimo sem alterar minRaiseIncrement', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 130 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);

      // p1 aumenta para 100 (incremento 80, min raise 80)
      round = raise(round, 100, 'p1');

      // p2 vai all-in para 130 (incremento de apenas 30 < 80)
      round = allin(round, 'p2');
      const p2 = round.players.find(p => p.id === 'p2')!;

      expect(p2.committed).toBe(130);
      expect(p2.isAllIn).toBe(true);
      expect(round.currentBet).toBe(130);
      // minRaiseIncrement deve continuar sendo 80
      expect(round.minRaiseIncrement).toBe(80);
    });
  });

  // 8. Aumento incompleto que não reabre a ação
  describe('8. Aumento incompleto que não reabre a ação (Poker TDA 2026 Regra 49)', () => {
    it('impede novo raise dos jogadores que já agiram quando o all-in não atinge o incremento mínimo', () => {
      const players: PlayerInput[] = [
        { id: 'A', seat: 1, chips: 1000 },
        { id: 'B', seat: 2, chips: 1000 },
        { id: 'C', seat: 3, chips: 130 },
      ];
      // A (seat 1), B (seat 2 / SB), C (seat 3 / BB)
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);

      // A aumenta para 100 (incremento 80)
      round = raise(round, 100, 'A');
      // B dá call de 100
      round = call(round, 'B');

      // C vai all-in para 130 (incremento de apenas 30 < 80)
      round = allIn(round, 'C');
      expect(round.currentBet).toBe(130);
      expect(round.minRaiseIncrement).toBe(80);

      // Ação volta para A
      expect(round.currentActorId).toBe('A');
      expect(canPlayerRaise(round, 'A')).toBe(false);

      // A tenta aumentar para 210 e deve ser rejeitado!
      expect(() => raise(round, 210, 'A')).toThrowError(EngineError);
      expect(() => raise(round, 210, 'A')).toThrowError(/ação não foi reaberta/i);

      // A paga 130 (call de 30)
      round = call(round, 'A');

      // Ação passa para B
      expect(round.currentActorId).toBe('B');
      expect(canPlayerRaise(round, 'B')).toBe(false);

      // B tenta aumentar e deve ser rejeitado!
      expect(() => raise(round, 210, 'B')).toThrowError(EngineError);

      // B paga 130
      round = call(round, 'B');

      expect(round.status).toBe('completed');
    });
  });

  // 9. Múltiplos all-ins curtos que reabrem a ação cumulativamente
  describe('9. Múltiplos all-ins curtos que reabrem a ação cumulativamente (Poker TDA 2026 Regra 49)', () => {
    it('reabre a ação para os jogadores anteriores quando múltiplos all-ins atingem o incremento mínimo', () => {
      const players: PlayerInput[] = [
        { id: 'A', seat: 1, chips: 1000 },
        { id: 'B', seat: 2, chips: 1000 },
        { id: 'C', seat: 3, chips: 130 },
        { id: 'D', seat: 4, chips: 190 },
      ];
      // Dealer = B (2), SB = C (3), BB = D (4). Ordem pré-flop: A -> B -> C -> D
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 2 });
      let round = createPreFlopRound(hand);

      // A aumenta para 100 (incremento 80)
      round = raise(round, 100, 'A');
      // B paga 100
      round = call(round, 'B');

      // C vai all-in para 130 (+30)
      round = allIn(round, 'C');

      // D vai all-in para 190 (+60, aumento acumulado de 90 acima de 100 >= 80)
      round = allIn(round, 'D');
      expect(round.currentBet).toBe(190);

      // Ação volta para A
      expect(round.currentActorId).toBe('A');
      expect(canPlayerRaise(round, 'A')).toBe(true);

      // A re-aumenta para 270 (190 + 80)
      round = raise(round, 270, 'A');
      expect(round.currentBet).toBe(270);
      expect(round.playersToAct).toEqual(['B']);

      // B também tem direito a agir e dá call
      round = call(round, 'B');
      expect(round.status).toBe('completed');
    });
  });

  // 10. Jogador que ainda não agiu e pode aumentar
  describe('10. Jogador que ainda não agiu e pode aumentar', () => {
    it('permite raise completo a um jogador que ainda não agiu após um all-in incompleto', () => {
      const players: PlayerInput[] = [
        { id: 'A', seat: 1, chips: 1000 },
        { id: 'B', seat: 2, chips: 130 },
        { id: 'C', seat: 3, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);

      // A aumenta para 100 (incremento 80)
      round = raise(round, 100, 'A');

      // B vai all-in para 130 (+30)
      round = allIn(round, 'B');

      // C ainda não agiu na rodada
      expect(round.currentActorId).toBe('C');
      expect(canPlayerRaise(round, 'C')).toBe(true);

      // C aumenta para 210 (130 + 80)
      round = raise(round, 210, 'C');
      expect(round.currentBet).toBe(210);
      expect(round.playersToAct).toEqual(['A']);
    });
  });

  // 11. Heads-up com raise e resposta
  describe('11. Heads-up com raise e resposta', () => {
    it('permite raise pelo SB e reraise pelo BB em heads-up', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 }, // SB / Dealer
        { id: 'p2', seat: 2, chips: 1000 }, // BB
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);

      expect(round.currentActorId).toBe('p1');
      round = raise(round, 60, 'p1'); // SB aumenta para 60

      expect(round.currentActorId).toBe('p2');
      round = raise(round, 140, 'p2'); // BB reraise para 140 (min 100)

      expect(round.currentActorId).toBe('p1');
      round = call(round, 'p1'); // SB paga 140

      expect(round.status).toBe('completed');
      expect(round.pot).toBe(280);
    });
  });

  // 12. Mesa com 3 ou mais jogadores
  describe('12. Mesa com 3 ou mais jogadores', () => {
    it('gerencia múltiplos aumentos e calls em mesa com 4 jogadores', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
        { id: 'p4', seat: 4, chips: 1000 },
      ];
      // Dealer = p2 (2), SB = p3 (3), BB = p4 (4). Ordem pré-flop: p1 -> p2 -> p3 -> p4
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 2 });
      let round = createPreFlopRound(hand);

      // p1 aumenta para 50
      round = raise(round, 50, 'p1');
      // p2 aumenta para 100
      round = raise(round, 100, 'p2');
      // p3 (SB) paga 100
      round = call(round, 'p3');
      // p4 (BB) desiste
      round = fold(round, 'p4');
      // p1 paga 100
      round = call(round, 'p1');

      expect(round.status).toBe('completed');
      expect(round.players.find(p => p.id === 'p4')!.folded).toBe(true);
      expect(round.pot).toBe(320); // 100 + 100 + 100 + 20 (BB que desistiu)
    });
  });

  // 13. Fold após raise
  describe('13. Fold após raise', () => {
    it('elimina jogadores que desistem após um aumento e preserva suas fichas no pote', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);

      round = raise(round, 100, 'p1');
      round = fold(round, 'p2');
      round = call(round, 'p3');

      expect(round.status).toBe('completed');
      expect(round.players.find(p => p.id === 'p2')!.folded).toBe(true);
      expect(round.players.find(p => p.id === 'p2')!.committed).toBe(10);
      expect(round.pot).toBe(210); // 100 (p1) + 10 (p2) + 100 (p3)
    });
  });

  // 14. Encerramento correto após sequência de aumentos
  describe('14. Encerramento correto após sequência de aumentos', () => {
    it('finaliza com status completed e sem jogadores pendentes quando todos igualam', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 500 },
        { id: 'p2', seat: 2, chips: 500 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);

      round = raise(round, 50, 'p1');
      round = raise(round, 120, 'p2');
      round = call(round, 'p1');

      expect(round.status).toBe('completed');
      expect(round.currentActorId).toBeNull();
      expect(round.playersToAct).toEqual([]);
    });
  });

  // 15. Devolução de fichas não igualadas
  describe('15. Devolução de fichas não igualadas', () => {
    it('devolve o excedente não igualado ao raiser quando todos desistem', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);

      round = raise(round, 200, 'p1');
      round = fold(round, 'p2');
      round = fold(round, 'p3');

      expect(round.status).toBe('hand_ended_by_fold');
      const p1 = round.players.find(p => p.id === 'p1')!;
      // p3 colocou 20 no BB. p1 só precisa arriscar 20 contra o maior adversário restante
      expect(p1.committed).toBe(20);
      expect(p1.chips).toBe(980);
      expect(round.pot).toBe(50); // 10 (p2) + 20 (p3) + 20 (p1)
    });

    it('devolve o excedente ao raiser quando adversário paga all-in por menos', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 100 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);

      round = raise(round, 300, 'p1');
      round = allIn(round, 'p2'); // p2 all-in para 100

      expect(round.status).toBe('completed');
      const p1 = round.players.find(p => p.id === 'p1')!;
      expect(p1.committed).toBe(100);
      expect(p1.chips).toBe(900);
      expect(round.pot).toBe(200);
    });
  });

  // 16. Conservação das fichas
  describe('16. Conservação das fichas', () => {
    it('garante que a soma total de fichas permanece invariante após raises e all-ins', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 300 },
        { id: 'p2', seat: 2, chips: 400 },
        { id: 'p3', seat: 3, chips: 500 },
      ];
      const totalChips = 300 + 400 + 500;
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);

      round = raise(round, 80, 'p1');
      round = raise(round, 200, 'p2');
      round = fold(round, 'p3');
      round = call(round, 'p1');

      const sum = round.players.reduce((acc, p) => acc + p.chips, 0) + round.pot;
      expect(sum).toBe(totalChips);
    });
  });

  // 17. Rejeição de entradas inválidas
  describe('17. Rejeição de entradas inválidas', () => {
    it('rejeita valores negativos, fracionários e não numéricos de raise', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      const round = createPreFlopRound(hand);

      expect(() => raise(round, -50, 'p1')).toThrowError(EngineError);
      expect(() => raise(round, 50.5, 'p1')).toThrowError(EngineError);
      // @ts-expect-error teste de robustez em tempo de execução
      expect(() => raise(round, '100', 'p1')).toThrowError(EngineError);
    });

    it('rejeita raise fora do turno ou em rodada finalizada', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);

      expect(() => raise(round, 60, 'p2')).toThrowError(EngineError);
      expect(() => raise(round, 60, 'p2')).toThrowError(/fora do turno/i);

      round = fold(round, 'p1');
      expect(() => raise(round, 60, 'p2')).toThrowError(EngineError);
      expect(() => raise(round, 60, 'p2')).toThrowError(/rodada encerrada/i);
    });
  });

  describe('Regressões: apostas contra adversários all-in', () => {
    it('impede raise quando o único adversário está all-in', () => {
      const hand = initHand({
        players: [
          { id: 'sb', seat: 1, chips: 1000 },
          { id: 'bb', seat: 2, chips: 15 },
        ],
        blinds: defaultBlinds,
        dealerSeat: 1,
      });

      const round = createPreFlopRound(hand);

      expect(round.status).toBe('active');
      expect(round.currentActorId).toBe('sb');
      expect(canPlayerRaise(round, 'sb')).toBe(false);

      expect(() => raise(round, 100, 'sb')).toThrowError(EngineError);
      expect(() => allIn(round, 'sb')).toThrowError(EngineError);

      const final = call(round, 'sb');

      expect(final.status).toBe('completed');
      expect(final.pot).toBe(30);
      expect(final.players.find(p => p.id === 'sb')!.committed).toBe(15);
    });

    it('encerra automaticamente se o SB já cobriu o BB all-in', () => {
      const hand = initHand({
        players: [
          { id: 'sb', seat: 1, chips: 1000 },
          { id: 'bb', seat: 2, chips: 5 },
        ],
        blinds: defaultBlinds,
        dealerSeat: 1,
      });

      const round = createPreFlopRound(hand);
      const sb = round.players.find(p => p.id === 'sb')!;

      expect(round.status).toBe('completed');
      expect(round.currentActorId).toBeNull();
      expect(round.playersToAct).toEqual([]);

      expect(round.pot).toBe(10);
      expect(sb.committed).toBe(5);
      expect(sb.chips).toBe(995);
    });
  });

  describe('Regressão: múltiplos all-ins e restituição', () => {
    it('devolve somente a parcela não igualada após dois all-ins', () => {
      const hand = initHand({
        players: [
          { id: 'A', seat: 1, chips: 1000 },
          { id: 'B', seat: 2, chips: 1000 },
          { id: 'C', seat: 3, chips: 60 },
          { id: 'D', seat: 4, chips: 120 },
        ],
        blinds: defaultBlinds,
        dealerSeat: 2,
      });

      let round = createPreFlopRound(hand);

      expect(round.currentActorId).toBe('A');

      round = raise(round, 200, 'A');
      round = fold(round, 'B');
      round = allIn(round, 'C');
      round = allIn(round, 'D');

      expect(round.status).toBe('completed');
      expect(round.pot).toBe(300);

      const a = round.players.find(p => p.id === 'A')!;
      const b = round.players.find(p => p.id === 'B')!;
      const c = round.players.find(p => p.id === 'C')!;
      const d = round.players.find(p => p.id === 'D')!;

      expect(a.committed).toBe(120);
      expect(a.chips).toBe(880);

      expect(b.folded).toBe(true);
      expect(b.committed).toBe(0);

      expect(c.committed).toBe(60);
      expect(d.committed).toBe(120);

      const total = round.players.reduce(
        (sum, player) => sum + player.chips,
        round.pot,
      );

      expect(total).toBe(2180);
    });
  });

  // 18. Imutabilidade dos estados
  describe('18. Imutabilidade dos estados', () => {
    it('não mutaciona estados e arrays anteriores após operações de raise e all-in', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      const round0 = createPreFlopRound(hand);

      const round1 = raise(round0, 80, 'p1');

      expect(round0.currentBet).toBe(20);
      expect(round0.pot).toBe(30);
      expect(round0.players.find(p => p.id === 'p1')!.chips).toBe(990);
      expect(round0.players.find(p => p.id === 'p1')!.committed).toBe(10);

      expect(round1.currentBet).toBe(80);
      expect(round1.pot).toBe(100);
      expect(round1.players.find(p => p.id === 'p1')!.chips).toBe(920);
      expect(round1.players.find(p => p.id === 'p1')!.committed).toBe(80);
    });
  });
});
