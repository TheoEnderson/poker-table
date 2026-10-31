import { describe, expect, it } from 'vitest';
import {
  applyAction,
  call,
  check,
  createPreFlopRound,
  EngineError,
  fold,
  initHand,
  startPreFlopRound,
  type PlayerInput,
} from '@poker-table/engine';

describe('Texas Hold\'em Engine — Controle de Turnos e Apostas Pré-Flop (Etapa 2.2A)', () => {
  const defaultBlinds = { smallBlind: 10, bigBlind: 20 };

  // 1. Fold válido e inválido
  describe('1. Fold válido e inválido', () => {
    it('executa fold válido pelo jogador da vez, preservando o pote e avançando o turno', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      const round0 = createPreFlopRound(hand);

      expect(round0.currentActorId).toBe('p1');
      const potBefore = round0.pot;

      const round1 = fold(round0, 'p1');
      const p1 = round1.players.find(p => p.id === 'p1')!;

      expect(p1.folded).toBe(true);
      expect(p1.chips).toBe(1000);
      expect(round1.pot).toBe(potBefore);
      expect(round1.currentActorId).toBe('p2');
      expect(round1.playersToAct).toEqual(['p2', 'p3']);
    });

    it('rejeita fold realizado fora da vez do jogador', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      const round = createPreFlopRound(hand);

      expect(round.currentActorId).toBe('p1');
      expect(() => fold(round, 'p2')).toThrowError(EngineError);
      expect(() => fold(round, 'p2')).toThrowError(/fora do turno/i);
    });

    it('rejeita fold de jogador inexistente', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      const round = createPreFlopRound(hand);

      expect(() => applyAction(round, { playerId: 'inexistente', type: 'fold' }))
        .toThrowError(EngineError);
    });
  });

  // 2. Check válido e inválido
  describe('2. Check válido e inválido', () => {
    it('permite check pelo Big Blind quando ninguém aumentou a aposta', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];
      // Dealer = 1, SB = 2, BB = 3. Ordem pré-flop: p1, p2, p3
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);

      round = call(round, 'p1'); // p1 paga 20
      round = call(round, 'p2'); // p2 paga 10 (total 20)

      expect(round.currentActorId).toBe('p3'); // Vez do BB
      const roundFinal = check(round, 'p3');

      expect(roundFinal.status).toBe('completed');
      expect(roundFinal.currentActorId).toBeNull();
      expect(roundFinal.playersToAct).toEqual([]);
    });

    it('rejeita check quando há valor pendente de call', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      const round = createPreFlopRound(hand);

      // p1 não colocou nenhuma ficha ainda, deve 20
      expect(() => check(round, 'p1')).toThrowError(EngineError);
      expect(() => check(round, 'p1')).toThrowError(/não é permitido dar check/i);
    });

    it('rejeita check do Small Blind quando ele deve a diferença para o Big Blind', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);
      round = call(round, 'p1');

      // Agora é a vez de p2 (SB, comprometeu 10, currentBet é 20)
      expect(round.currentActorId).toBe('p2');
      expect(() => check(round, 'p2')).toThrowError(EngineError);
      expect(() => check(round, 'p2')).toThrowError(/faltam 10 fichas/i);
    });
  });

  // 3. Call completo
  describe('3. Call completo', () => {
    it('debita o valor exato necessário para igualar a aposta atual', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 500 },
        { id: 'p2', seat: 2, chips: 500 },
        { id: 'p3', seat: 3, chips: 500 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      const round0 = createPreFlopRound(hand);

      expect(round0.pot).toBe(30); // 10 (SB) + 20 (BB)

      const round1 = call(round0, 'p1');
      const p1 = round1.players.find(p => p.id === 'p1')!;

      expect(p1.committed).toBe(20);
      expect(p1.chips).toBe(480);
      expect(p1.isAllIn).toBe(false);
      expect(round1.pot).toBe(50);
      expect(round1.currentActorId).toBe('p2');
    });

    it('SB paga somente a diferença para o BB no call', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 500 },
        { id: 'p2', seat: 2, chips: 500 },
        { id: 'p3', seat: 3, chips: 500 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);
      round = call(round, 'p1');

      // Vez de p2 (SB, já colocou 10 no início da mão)
      const roundAfterSB = call(round, 'p2');
      const p2 = roundAfterSB.players.find(p => p.id === 'p2')!;

      expect(p2.committed).toBe(20);
      expect(p2.chips).toBe(480); // Tinha 490 após o blind, pagou mais 10
      expect(roundAfterSB.pot).toBe(60);
    });
  });

  // 4. Call com stack insuficiente
  describe('4. Call com stack insuficiente', () => {
    it('vai all-in com o stack restante e não altera a aposta atual da rodada', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 12 }, // Menos que o BB (20)
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      const round0 = createPreFlopRound(hand);

      expect(round0.currentBet).toBe(20);

      const round1 = call(round0, 'p1');
      const p1 = round1.players.find(p => p.id === 'p1')!;

      expect(p1.chips).toBe(0);
      expect(p1.committed).toBe(12);
      expect(p1.isAllIn).toBe(true);
      // A aposta atual permanece 20 para os demais jogadores
      expect(round1.currentBet).toBe(20);
      expect(round1.pot).toBe(30 + 12);
      expect(round1.currentActorId).toBe('p2');
    });
  });

  // 5. Jogadores all-in excluídos das próximas ações
  describe('5. Jogadores all-in excluídos das próximas ações', () => {
    it('não inclui jogador all-in na lista de próximas ações', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 15 }, // Vai all-in no call
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);

      round = call(round, 'p1'); // p1 fica all-in
      expect(round.playersToAct).not.toContain('p1');
      expect(round.playersToAct).toEqual(['p2', 'p3']);

      round = call(round, 'p2');
      round = check(round, 'p3');

      expect(round.status).toBe('completed');
    });

    it('exclui jogador que já iniciou a rodada all-in nos blinds', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 5 }, // All-in no Small Blind
        { id: 'p3', seat: 3, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      const round = createPreFlopRound(hand);

      expect(round.players.find(p => p.id === 'p2')!.isAllIn).toBe(true);
      expect(round.playersToAct).not.toContain('p2');
      expect(round.playersToAct).toEqual(['p1', 'p3']);
    });
  });

  // 6. Ação realizada fora do turno
  describe('6. Ação realizada fora do turno', () => {
    it('rejeita check, call ou fold fora do turno do jogador', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      const round = createPreFlopRound(hand);

      expect(round.currentActorId).toBe('p1');
      expect(() => applyAction(round, { playerId: 'p2', type: 'call' }))
        .toThrowError(EngineError);
      expect(() => applyAction(round, { playerId: 'p3', type: 'fold' }))
        .toThrowError(EngineError);
    });
  });

  // 7. Encerramento por desistência de todos os adversários
  describe('7. Encerramento por desistência de todos os adversários', () => {
    it('encerra a mão imediatamente com hand_ended_by_fold quando resta apenas um jogador', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);

      round = fold(round, 'p1');
      expect(round.status).toBe('active');

      round = fold(round, 'p2');
      expect(round.status).toBe('hand_ended_by_fold');
      expect(round.currentActorId).toBeNull();
      expect(round.playersToAct).toEqual([]);
      expect(round.players.filter(p => !p.folded)).toHaveLength(1);
      expect(round.players.find(p => p.id === 'p3')!.folded).toBe(false);
    });
  });

  // 8. Conservação das fichas após sequências de ações
  describe('8. Conservação das fichas após sequências de ações', () => {
    it('mantém estritamente a soma dos stacks com o pote em múltiplos cenários', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 75 },
        { id: 'p2', seat: 2, chips: 100 },
        { id: 'p3', seat: 3, chips: 150 },
        { id: 'p4', seat: 4, chips: 200 },
      ];
      const totalChips = players.reduce((sum, p) => sum + p.chips, 0);

      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 4 });
      let round = createPreFlopRound(hand);

      const checkConservation = (r: typeof round) => {
        const sum = r.players.reduce((acc, p) => acc + p.chips, 0) + r.pot;
        expect(sum).toBe(totalChips);
      };

      checkConservation(round);

      while (round.status === 'active') {
        const actor = round.currentActorId!;
        const p = round.players.find(player => player.id === actor)!;
        if (round.currentBet === p.committed) {
          round = check(round, actor);
        } else {
          round = call(round, actor);
        }
        checkConservation(round);
      }

      expect(round.status).toBe('completed');
    });
  });

  // 9. Heads-up: small blind age primeiro e big blind mantém sua opção
  describe('9. Heads-up: small blind age primeiro e big blind mantém sua opção', () => {
    it('SB age primeiro (call), e a rodada não fecha até BB agir (check)', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);

      // p1 é Dealer e Small Blind (age primeiro no pré-flop)
      expect(round.currentActorId).toBe('p1');
      expect(round.playersToAct).toEqual(['p1', 'p2']);

      round = call(round, 'p1'); // p1 paga 10
      expect(round.status).toBe('active');
      expect(round.currentActorId).toBe('p2'); // BB mantém a opção de agir!
      expect(round.playersToAct).toEqual(['p2']);

      round = check(round, 'p2'); // BB usa sua opção de check
      expect(round.status).toBe('completed');
      expect(round.currentActorId).toBeNull();
      expect(round.playersToAct).toEqual([]);
    });

    it('em heads-up, se SB desiste, a mão é encerrada imediatamente por desistência', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      const round0 = createPreFlopRound(hand);

      const round1 = fold(round0, 'p1');
      expect(round1.status).toBe('hand_ended_by_fold');
      expect(round1.currentActorId).toBeNull();
    });
  });

  // 10. Mesa com 3 jogadores
  describe('10. Mesa com 3 jogadores', () => {
    it('respeita a ordem exata de turnos: Dealer -> SB -> BB', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);

      expect(round.currentActorId).toBe('p1'); // Dealer age primeiro pré-flop
      round = call(round, 'p1');

      expect(round.currentActorId).toBe('p2'); // SB age em segundo
      round = call(round, 'p2');

      expect(round.currentActorId).toBe('p3'); // BB age por último
      round = check(round, 'p3');

      expect(round.status).toBe('completed');
    });
  });

  // 11. Mesa com 6 jogadores
  describe('11. Mesa com 6 jogadores', () => {
    it('respeita a ordem completa de 6-max pré-flop: UTG -> UTG+1 -> Cutoff -> Button -> SB -> BB', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 }, // Dealer
        { id: 'p2', seat: 2, chips: 1000 }, // SB
        { id: 'p3', seat: 3, chips: 1000 }, // BB
        { id: 'p4', seat: 4, chips: 1000 }, // UTG
        { id: 'p5', seat: 5, chips: 1000 }, // UTG+1
        { id: 'p6', seat: 6, chips: 1000 }, // Cutoff
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);

      const expectedOrder = ['p4', 'p5', 'p6', 'p1', 'p2', 'p3'];
      expect(round.playersToAct).toEqual(expectedOrder);

      for (let i = 0; i < expectedOrder.length; i++) {
        const actor = expectedOrder[i];
        expect(round.currentActorId).toBe(actor);
        if (actor === 'p3') {
          round = check(round, actor);
        } else {
          round = call(round, actor);
        }
      }

      expect(round.status).toBe('completed');
      expect(round.pot).toBe(120); // 6 jogadores x 20
    });
  });

  // 12. Mesa com assentos vazios
  describe('12. Mesa com assentos vazios', () => {
    it('preserva a ordem horária correta entre assentos não contíguos', () => {
      const players: PlayerInput[] = [
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p5', seat: 5, chips: 1000 },
        { id: 'p8', seat: 8, chips: 1000 },
      ];
      // Dealer = 2, SB = 5, BB = 8. Pré-flop: p2 -> p5 -> p8
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 2 });
      let round = createPreFlopRound(hand);

      expect(round.currentActorId).toBe('p2');
      round = call(round, 'p2');
      expect(round.currentActorId).toBe('p5');
      round = call(round, 'p5');
      expect(round.currentActorId).toBe('p8');
      round = check(round, 'p8');

      expect(round.status).toBe('completed');
    });
  });

  // 13. Big blind com stack inferior ao blind obrigatório
  describe('13. Big blind com stack inferior ao blind obrigatório', () => {
    it('mantém o valor nominal do big blind como aposta atual e permite call pelo SB', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 }, // SB
        { id: 'p2', seat: 2, chips: 15 }, // BB com menos fichas que 20
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      const round0 = createPreFlopRound(hand);

      // p2 foi all-in nos blinds por 15
      expect(round0.players.find(p => p.id === 'p2')!.isAllIn).toBe(true);
      expect(round0.currentBet).toBe(20); // Aposta nominal a igualar

      // p1 colocou 10 no SB e precisa cobrir os 20 nominais para dar call
      expect(round0.currentActorId).toBe('p1');
      expect(round0.playersToAct).toEqual(['p1']);

      const round1 = call(round0, 'p1');
      const p1 = round1.players.find(p => p.id === 'p1')!;

      // O call nominal é 20, mas as 5 fichas não igualadas retornam.
      expect(p1.committed).toBe(15);
      expect(round1.pot).toBe(15 + 15);
      // Como p2 já estava all-in e p1 acabou de igualar, a rodada se encerra
      expect(round1.status).toBe('completed');
      expect(round1.currentActorId).toBeNull();
    });
  });

  // 14. Encerramento correto da rodada
  describe('14. Encerramento correto da rodada', () => {
    it('finaliza com status completed e limpa playersToAct e currentActorId', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 500 },
        { id: 'p2', seat: 2, chips: 500 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = startPreFlopRound(hand);

      round = call(round, 'p1');
      round = check(round, 'p2');

      expect(round.status).toBe('completed');
      expect(round.currentActorId).toBeNull();
      expect(round.playersToAct).toEqual([]);
    });

    it('encerra sem exigir apostas quando não há disputa possível entre jogadores capazes de apostar', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 5 }, // SB com 5 (all-in no blind)
        { id: 'p2', seat: 2, chips: 1000 }, // BB
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      const round = createPreFlopRound(hand);

      // p1 está all-in e p2 já tem 20 committed >= currentBet. Não há disputa possível.
      expect(round.status).toBe('completed');
      expect(round.currentActorId).toBeNull();
      expect(round.playersToAct).toEqual([]);
    });
  });

  // 15. Rejeição de ações após o encerramento
  describe('15. Rejeição de ações após o encerramento', () => {
    it('lança erro ao tentar agir em rodada completed', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 500 },
        { id: 'p2', seat: 2, chips: 500 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);
      round = call(round, 'p1');
      round = check(round, 'p2');

      expect(round.status).toBe('completed');
      expect(() => call(round, 'p1')).toThrowError(EngineError);
      expect(() => call(round, 'p1')).toThrowError(/rodada encerrada/i);
      expect(() => check(round, 'p2')).toThrowError(EngineError);
      expect(() => fold(round, 'p1')).toThrowError(EngineError);
    });

    it('lança erro ao tentar agir em rodada hand_ended_by_fold', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 500 },
        { id: 'p2', seat: 2, chips: 500 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      const round = fold(createPreFlopRound(hand), 'p1');

      expect(round.status).toBe('hand_ended_by_fold');
      expect(() => check(round, 'p2')).toThrowError(EngineError);
      expect(() => call(round, 'p2')).toThrowError(EngineError);
    });
  });

  describe('Regressões: blinds curtos e fichas não igualadas', () => {
    it('heads-up: SB iguala apenas o valor disputável do BB all-in', () => {
      const hand = initHand({
        players: [
          { id: 'sb', seat: 1, chips: 1000 },
          { id: 'bb', seat: 2, chips: 15 },
        ],
        blinds: defaultBlinds,
        dealerSeat: 1,
      });

      const initial = createPreFlopRound(hand);

      // O blind nominal continua sendo 20.
      expect(initial.currentBet).toBe(20);

      const final = call(initial, 'sb');
      const sb = final.players.find(p => p.id === 'sb')!;

      expect(sb.committed).toBe(15);
      expect(sb.chips).toBe(985);
      expect(final.pot).toBe(30);
      expect(final.status).toBe('completed');
    });

    it('devolve a parte do BB que ninguém pode igualar', () => {
      const hand = initHand({
        players: [
          { id: 'sb', seat: 1, chips: 5 },
          { id: 'bb', seat: 2, chips: 1000 },
        ],
        blinds: defaultBlinds,
        dealerSeat: 1,
      });

      const round = createPreFlopRound(hand);
      const bb = round.players.find(p => p.id === 'bb')!;

      expect(round.status).toBe('completed');
      expect(round.pot).toBe(10);
      expect(bb.committed).toBe(5);
      expect(bb.chips).toBe(995);
    });

    it('multiway: não exige fichas acima do maior all-in restante', () => {
      const hand = initHand({
        players: [
          { id: 'dealer', seat: 1, chips: 1000 },
          { id: 'sb', seat: 2, chips: 5 },
          { id: 'bb', seat: 3, chips: 15 },
        ],
        blinds: defaultBlinds,
        dealerSeat: 1,
      });

      const initial = createPreFlopRound(hand);
      const final = call(initial, 'dealer');
      const dealer = final.players.find(p => p.id === 'dealer')!;

      expect(dealer.committed).toBe(15);
      expect(dealer.chips).toBe(985);
      expect(final.pot).toBe(35);
      expect(final.status).toBe('completed');
    });
  });

  describe('Regressões adicionais: restituição', () => {
    it('não devolve fichas quando dois jogadores podem disputar o excedente', () => {
      const hand = initHand({
        players: [
          { id: 'dealer', seat: 1, chips: 1000 },
          { id: 'sb', seat: 2, chips: 1000 },
          { id: 'bb', seat: 3, chips: 15 },
        ],
        blinds: defaultBlinds,
        dealerSeat: 1,
      });

      let round = createPreFlopRound(hand);
      round = call(round, 'dealer');
      round = call(round, 'sb');

      expect(round.status).toBe('completed');
      expect(round.pot).toBe(55);
      expect(round.players.find(p => p.id === 'dealer')!.committed).toBe(20);
      expect(round.players.find(p => p.id === 'sb')!.committed).toBe(20);
      expect(round.players.find(p => p.id === 'bb')!.committed).toBe(15);
    });

    it('devolve o excedente quando ambos ficam all-in nos blinds', () => {
      const hand = initHand({
        players: [
          { id: 'sb', seat: 1, chips: 5 },
          { id: 'bb', seat: 2, chips: 15 },
        ],
        blinds: defaultBlinds,
        dealerSeat: 1,
      });

      const round = createPreFlopRound(hand);
      const bb = round.players.find(p => p.id === 'bb')!;

      expect(round.status).toBe('completed');
      expect(round.pot).toBe(10);
      expect(bb.committed).toBe(5);
      expect(bb.chips).toBe(10);
      expect(bb.isAllIn).toBe(false);
    });
  });

  // 16. Imutabilidade do estado anterior
  describe('16. Imutabilidade do estado anterior', () => {
    it('garante que o estado anterior e seus objetos não são mutados após uma ação', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 500 },
        { id: 'p2', seat: 2, chips: 500 },
        { id: 'p3', seat: 3, chips: 500 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      const round0 = createPreFlopRound(hand);

      const round1 = call(round0, 'p1');

      expect(round0.currentActorId).toBe('p1');
      expect(round0.pot).toBe(30);
      expect(round0.players.find(p => p.id === 'p1')!.chips).toBe(500);
      expect(round0.players.find(p => p.id === 'p1')!.committed).toBe(0);

      expect(round1.currentActorId).toBe('p2');
      expect(round1.pot).toBe(50);
      expect(round1.players.find(p => p.id === 'p1')!.chips).toBe(480);
      expect(round1.players.find(p => p.id === 'p1')!.committed).toBe(20);
    });
  });
});
