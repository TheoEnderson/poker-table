import { describe, expect, it } from 'vitest';
import {
  advanceDealer,
  calculatePostFlopActionOrder,
  calculatePostFlopActionOrderIds,
  calculatePreFlopActionOrder,
  calculatePreFlopActionOrderIds,
  createInitialHand,
  determineBlindsPositions,
  determineDealerPosition,
  EngineError,
  getEligiblePlayers,
  initHand,
  postBlinds,
  type PlayerInput,
} from '@poker-table/engine';

describe('Texas Hold\'em Engine — Núcleo Inicial (Etapa 2.1)', () => {
  const defaultBlinds = { smallBlind: 10, bigBlind: 20 };

  describe('Heads-up (2 jogadores)', () => {
    const players: PlayerInput[] = [
      { id: 'p1', seat: 1, chips: 1000, name: 'Alice' },
      { id: 'p2', seat: 2, chips: 1000, name: 'Bob' },
    ];

    it('define o dealer como Small Blind e o oponente como Big Blind', () => {
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      expect(hand.dealerSeat).toBe(1);
      expect(hand.smallBlindSeat).toBe(1);
      expect(hand.bigBlindSeat).toBe(2);

      const p1 = hand.players.find(p => p.id === 'p1')!;
      const p2 = hand.players.find(p => p.id === 'p2')!;

      expect(p1.committed).toBe(10);
      expect(p1.chips).toBe(990);
      expect(p2.committed).toBe(20);
      expect(p2.chips).toBe(980);
      expect(hand.pot).toBe(30);
    });

    it('no pré-flop, o dealer (SB) age primeiro e o BB age por último', () => {
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      expect(hand.preFlopOrder).toEqual(['p1', 'p2']);
      expect(hand.currentActorId).toBe('p1');
    });

    it('no pós-flop, o BB age primeiro e o dealer (SB) age por último', () => {
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      expect(hand.postFlopOrder).toEqual(['p2', 'p1']);
    });

    it('alterna o botão e inverte as ordens na mão seguinte', () => {
      const hand1 = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      const nextDealerSeat = advanceDealer(getEligiblePlayers(players), hand1.dealerSeat).seat;
      expect(nextDealerSeat).toBe(2);

      const hand2 = initHand({ players, blinds: defaultBlinds, dealerSeat: nextDealerSeat });
      expect(hand2.dealerSeat).toBe(2);
      expect(hand2.smallBlindSeat).toBe(2);
      expect(hand2.bigBlindSeat).toBe(1);
      expect(hand2.preFlopOrder).toEqual(['p2', 'p1']);
      expect(hand2.postFlopOrder).toEqual(['p1', 'p2']);
    });

    it('funciona corretamente com assentos não consecutivos', () => {
      const gapPlayers: PlayerInput[] = [
        { id: 'p3', seat: 3, chips: 500 },
        { id: 'p8', seat: 8, chips: 500 },
      ];
      const hand = initHand({ players: gapPlayers, blinds: defaultBlinds, dealerSeat: 3 });
      expect(hand.dealerSeat).toBe(3);
      expect(hand.smallBlindSeat).toBe(3);
      expect(hand.bigBlindSeat).toBe(8);
      expect(hand.preFlopOrder).toEqual(['p3', 'p8']);
      expect(hand.postFlopOrder).toEqual(['p8', 'p3']);
    });
  });

  describe('Mesas com 3, 6 e 10 jogadores', () => {
    it('com 3 jogadores: SB e BB à esquerda do dealer, pré-flop começa no dealer', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });

      expect(hand.dealerSeat).toBe(1);
      expect(hand.smallBlindSeat).toBe(2);
      expect(hand.bigBlindSeat).toBe(3);

      // Pré-flop: à esquerda do BB (p3) é o dealer (p1)
      expect(hand.preFlopOrder).toEqual(['p1', 'p2', 'p3']);
      // Pós-flop: à esquerda do dealer (p1) é o SB (p2), dealer age por último
      expect(hand.postFlopOrder).toEqual(['p2', 'p3', 'p1']);
    });

    it('com 6 jogadores: SB (seat 2), BB (seat 3), pré-flop começa no UTG (seat 4)', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
        { id: 'p4', seat: 4, chips: 1000 },
        { id: 'p5', seat: 5, chips: 1000 },
        { id: 'p6', seat: 6, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });

      expect(hand.dealerSeat).toBe(1);
      expect(hand.smallBlindSeat).toBe(2);
      expect(hand.bigBlindSeat).toBe(3);

      // Pré-flop: 4, 5, 6, 1 (dealer), 2 (SB), 3 (BB)
      expect(hand.preFlopOrder).toEqual(['p4', 'p5', 'p6', 'p1', 'p2', 'p3']);
      // Pós-flop: 2 (SB), 3 (BB), 4, 5, 6, 1 (dealer)
      expect(hand.postFlopOrder).toEqual(['p2', 'p3', 'p4', 'p5', 'p6', 'p1']);
    });

    it('com 10 jogadores: ordem correta completa e rotação do botão', () => {
      const players: PlayerInput[] = Array.from({ length: 10 }, (_, i) => ({
        id: `p${i + 1}`,
        seat: i + 1,
        chips: 1000,
      }));

      // Dealer no assento 1
      const hand1 = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      expect(hand1.dealerSeat).toBe(1);
      expect(hand1.smallBlindSeat).toBe(2);
      expect(hand1.bigBlindSeat).toBe(3);
      expect(hand1.preFlopOrder).toEqual(['p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p1', 'p2', 'p3']);
      expect(hand1.postFlopOrder).toEqual(['p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p1']);

      // Dealer no assento 8 (wrap-around de assentos)
      const hand8 = initHand({ players, blinds: defaultBlinds, dealerSeat: 8 });
      expect(hand8.dealerSeat).toBe(8);
      expect(hand8.smallBlindSeat).toBe(9);
      expect(hand8.bigBlindSeat).toBe(10);
      expect(hand8.preFlopOrder).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10']);
      expect(hand8.postFlopOrder).toEqual(['p9', 'p10', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
    });
  });

  describe('Posições vazias entre jogadores', () => {
    it('ignora assentos vazios e preserva a ordem horária', () => {
      // Assentos ocupados: 2, 5, 9 (1, 3, 4, 6, 7, 8, 10 vazios)
      const players: PlayerInput[] = [
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p5', seat: 5, chips: 1000 },
        { id: 'p9', seat: 9, chips: 1000 },
      ];

      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 2 });
      expect(hand.dealerSeat).toBe(2);
      expect(hand.smallBlindSeat).toBe(5);
      expect(hand.bigBlindSeat).toBe(9);

      // Pré-flop: à esquerda de p9 é p2
      expect(hand.preFlopOrder).toEqual(['p2', 'p5', 'p9']);
      // Pós-flop: à esquerda de p2 é p5
      expect(hand.postFlopOrder).toEqual(['p5', 'p9', 'p2']);
    });

    it('respeita a ordem dos assentos independentemente da ordem do array de entrada', () => {
      // Array desordenado: assento 7, depois 2, depois 4
      const unorderedPlayers: PlayerInput[] = [
        { id: 'p7', seat: 7, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p4', seat: 4, chips: 1000 },
      ];

      const hand = initHand({ players: unorderedPlayers, blinds: defaultBlinds, dealerSeat: 2 });
      expect(hand.dealerSeat).toBe(2);
      expect(hand.smallBlindSeat).toBe(4);
      expect(hand.bigBlindSeat).toBe(7);
      expect(hand.preFlopOrder).toEqual(['p2', 'p4', 'p7']);
      expect(hand.postFlopOrder).toEqual(['p4', 'p7', 'p2']);
    });
  });

  describe('Rotação do dealer', () => {
    const players: PlayerInput[] = [
      { id: 'p2', seat: 2, chips: 1000 },
      { id: 'p5', seat: 5, chips: 1000 },
      { id: 'p8', seat: 8, chips: 1000 },
    ];

    it('avança deterministicamente entre assentos elegíveis', () => {
      const eligible = getEligiblePlayers(players);

      expect(advanceDealer(eligible, null).seat).toBe(2);
      expect(advanceDealer(eligible, 2).seat).toBe(5);
      expect(advanceDealer(eligible, 5).seat).toBe(8);
      expect(advanceDealer(eligible, 8).seat).toBe(2);
      expect(determineDealerPosition(eligible, 8)).toBe(2);
    });

    it('avança corretamente mesmo quando o assento anterior foi desocupado ou eliminado', () => {
      // O dealer anterior era o assento 3 (que não existe mais)
      const eligible = getEligiblePlayers(players);
      expect(advanceDealer(eligible, 3).seat).toBe(5);

      // O dealer anterior era o assento 9 (maior que todos)
      expect(advanceDealer(eligible, 9).seat).toBe(2);
    });

    it('avança automaticamente usando previousDealerSeat no initHand', () => {
      const hand1 = initHand({ players, blinds: defaultBlinds });
      expect(hand1.dealerSeat).toBe(2);

      const hand2 = initHand({ players, blinds: defaultBlinds, previousDealerSeat: hand1.dealerSeat });
      expect(hand2.dealerSeat).toBe(5);

      const hand3 = initHand({ players, blinds: defaultBlinds, previousDealerSeat: hand2.dealerSeat });
      expect(hand3.dealerSeat).toBe(8);

      const hand4 = initHand({ players, blinds: defaultBlinds, previousDealerSeat: hand3.dealerSeat });
      expect(hand4.dealerSeat).toBe(2);
    });
  });

  describe('Exclusão de jogadores sem fichas', () => {
    it('ignora jogadores com 0 fichas ao determinar posições e ordem', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 0 }, // Busted
        { id: 'p3', seat: 3, chips: 1000 },
        { id: 'p4', seat: 4, chips: 0 }, // Busted
        { id: 'p5', seat: 5, chips: 1000 },
      ];

      const eligible = getEligiblePlayers(players);
      expect(eligible.map(p => p.id)).toEqual(['p1', 'p3', 'p5']);

      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      expect(hand.dealerSeat).toBe(1);
      expect(hand.smallBlindSeat).toBe(3);
      expect(hand.bigBlindSeat).toBe(5);

      // p2 e p4 não estão no jogo ativo
      expect(hand.players.map(p => p.id)).toEqual(['p1', 'p3', 'p5']);
      expect(hand.preFlopOrder).toEqual(['p1', 'p3', 'p5']);
      expect(hand.postFlopOrder).toEqual(['p3', 'p5', 'p1']);
    });

    it('rejeita início de mão se houver menos de 2 jogadores com fichas', () => {
      const onlyOneWithChips: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 0 },
      ];

      expect(() => initHand({ players: onlyOneWithChips, blinds: defaultBlinds }))
        .toThrowError(EngineError);
      expect(() => initHand({ players: onlyOneWithChips, blinds: defaultBlinds }))
        .toThrowError(/ao menos 2 jogadores com fichas/i);
    });
  });

  describe('Small blind e big blind corretos', () => {
    it('debita corretamente os valores obrigatórios dos stacks', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 500 },
        { id: 'p2', seat: 2, chips: 400 },
        { id: 'p3', seat: 3, chips: 300 },
      ];
      const blinds = { smallBlind: 25, bigBlind: 50 };
      const hand = initHand({ players, blinds, dealerSeat: 1 });

      const p1 = hand.players.find(p => p.id === 'p1')!;
      const p2 = hand.players.find(p => p.id === 'p2')!;
      const p3 = hand.players.find(p => p.id === 'p3')!;

      // p1 é dealer: não paga blind
      expect(p1.committed).toBe(0);
      expect(p1.chips).toBe(500);

      // p2 é SB (25)
      expect(p2.committed).toBe(25);
      expect(p2.chips).toBe(375);

      // p3 é BB (50)
      expect(p3.committed).toBe(50);
      expect(p3.chips).toBe(250);

      expect(hand.pot).toBe(75);
    });

    it('permite que funções puras auxiliares sejam chamadas isoladamente', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 100 },
        { id: 'p2', seat: 2, chips: 100 },
      ];
      const positions = determineBlindsPositions(players, 1);
      expect(positions).toEqual({ dealerSeat: 1, smallBlindSeat: 1, bigBlindSeat: 2 });

      const playersWithBlinds = postBlinds(players, positions, { smallBlind: 15, bigBlind: 30 });
      expect(playersWithBlinds[0].committed).toBe(15);
      expect(playersWithBlinds[0].chips).toBe(85);
      expect(playersWithBlinds[1].committed).toBe(30);
      expect(playersWithBlinds[1].chips).toBe(70);
    });
  });

  describe('Jogadores com stack inferior ao blind obrigatório (All-in)', () => {
    it('trata SB com fichas insuficientes e o marca como all-in', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 8 }, // Menos que SB (10)
        { id: 'p3', seat: 3, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });

      const p2 = hand.players.find(p => p.id === 'p2')!;
      expect(p2.committed).toBe(8);
      expect(p2.chips).toBe(0);
      expect(p2.isAllIn).toBe(true);
      expect(hand.pot).toBe(28); // 8 (SB) + 20 (BB)

      // Jogador all-in não recebe a vez de agir!
      expect(hand.preFlopOrder).not.toContain('p2');
      expect(hand.preFlopOrder).toEqual(['p1', 'p3']);
      expect(hand.postFlopOrder).not.toContain('p2');
      expect(hand.postFlopOrder).toEqual(['p3', 'p1']);
    });

    it('trata BB com fichas insuficientes e o marca como all-in', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 15 }, // Menos que BB (20)
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });

      const p3 = hand.players.find(p => p.id === 'p3')!;
      expect(p3.committed).toBe(15);
      expect(p3.chips).toBe(0);
      expect(p3.isAllIn).toBe(true);
      expect(hand.pot).toBe(25); // 10 (SB) + 15 (BB)

      expect(hand.preFlopOrder).not.toContain('p3');
      expect(hand.preFlopOrder).toEqual(['p1', 'p2']);
      expect(hand.postFlopOrder).not.toContain('p3');
      expect(hand.postFlopOrder).toEqual(['p2', 'p1']);
    });

    it('em heads-up com ambos all-in nos blinds, a ordem de ação fica vazia', () => {
      const shortHeadsUp: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 5 }, // SB paga 5 de 10 e fica all-in
        { id: 'p2', seat: 2, chips: 15 }, // BB paga 15 de 20 e fica all-in
      ];
      const hand = initHand({ players: shortHeadsUp, blinds: defaultBlinds, dealerSeat: 1 });

      expect(hand.pot).toBe(20);
      expect(hand.players[0].isAllIn).toBe(true);
      expect(hand.players[1].isAllIn).toBe(true);
      expect(hand.preFlopOrder).toEqual([]);
      expect(hand.postFlopOrder).toEqual([]);
      expect(hand.currentActorId).toBeNull();
    });

    it('testa cálculo isolado de ordem com jogadores all-in', () => {
      const players = [
        { id: 'p1', seat: 1, chips: 100, isAllIn: false },
        { id: 'p2', seat: 2, chips: 0, isAllIn: true },
        { id: 'p3', seat: 3, chips: 100, isAllIn: false },
      ];
      expect(calculatePreFlopActionOrder(players, 1).map(p => p.id)).toEqual(['p1', 'p3']);
      expect(calculatePostFlopActionOrder(players, 1).map(p => p.id)).toEqual(['p3', 'p1']);
      expect(calculatePreFlopActionOrderIds(players, 1)).toEqual(['p1', 'p3']);
      expect(calculatePostFlopActionOrderIds(players, 1)).toEqual(['p3', 'p1']);
    });
  });

  describe('Conservação das fichas', () => {
    it('garante que a soma total das fichas permanece estritamente invariante', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 7 },
        { id: 'p2', seat: 2, chips: 13 },
        { id: 'p3', seat: 3, chips: 100 },
        { id: 'p4', seat: 4, chips: 250 },
      ];
      const totalChipsBefore = players.reduce((acc, p) => acc + p.chips, 0);

      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 4 });

      const totalChipsAfter = hand.players.reduce((acc, p) => acc + p.chips, 0) + hand.pot;
      expect(totalChipsAfter).toBe(totalChipsBefore);
    });

    it('não cria nem destrói fichas em partidas heads-up', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 15 },
        { id: 'p2', seat: 2, chips: 50 },
      ];
      const totalBefore = 15 + 50;

      const hand = createInitialHand({ players, blinds: { smallBlind: 10, bigBlind: 20 }, dealerSeat: 1 });
      const totalAfter = hand.players.reduce((acc, p) => acc + p.chips, 0) + hand.pot;
      expect(totalAfter).toBe(totalBefore);
      expect(hand.pot).toBe(30);
    });
  });

  describe('Rejeição de entradas inválidas', () => {
    it('rejeita fichas negativas, não inteiras ou inválidas', () => {
      expect(() => getEligiblePlayers([{ id: 'p1', seat: 1, chips: -10 }]))
        .toThrowError(EngineError);
      expect(() => getEligiblePlayers([{ id: 'p1', seat: 1, chips: 10.5 }]))
        .toThrowError(EngineError);
      expect(() => getEligiblePlayers([{ id: 'p1', seat: 1, chips: NaN }]))
        .toThrowError(EngineError);
    });

    it('rejeita assentos duplicados na mesa', () => {
      const duplicateSeats: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 100 },
        { id: 'p2', seat: 1, chips: 100 },
      ];
      expect(() => initHand({ players: duplicateSeats, blinds: defaultBlinds }))
        .toThrowError(EngineError);
      expect(() => initHand({ players: duplicateSeats, blinds: defaultBlinds }))
        .toThrowError(/Assento duplicado/);
    });

    it('rejeita IDs duplicados de jogadores', () => {
      const duplicateIds: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 100 },
        { id: 'p1', seat: 2, chips: 100 },
      ];
      expect(() => initHand({ players: duplicateIds, blinds: defaultBlinds }))
        .toThrowError(EngineError);
      expect(() => initHand({ players: duplicateIds, blinds: defaultBlinds }))
        .toThrowError(/ID de jogador duplicado/);
    });

    it('rejeita assentos inválidos (não inteiros ou menores que 1)', () => {
      expect(() => getEligiblePlayers([{ id: 'p1', seat: 0, chips: 100 }]))
        .toThrowError(EngineError);
      expect(() => getEligiblePlayers([{ id: 'p1', seat: 1.5, chips: 100 }]))
        .toThrowError(EngineError);
    });

    it('rejeita blinds inválidos (zero, negativos, float ou BB < SB)', () => {
      const validPlayers: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 100 },
        { id: 'p2', seat: 2, chips: 100 },
      ];

      expect(() => initHand({ players: validPlayers, blinds: { smallBlind: 0, bigBlind: 20 } }))
        .toThrowError(EngineError);
      expect(() => initHand({ players: validPlayers, blinds: { smallBlind: 10, bigBlind: -5 } }))
        .toThrowError(EngineError);
      expect(() => initHand({ players: validPlayers, blinds: { smallBlind: 10.5, bigBlind: 20 } }))
        .toThrowError(EngineError);
      expect(() => initHand({ players: validPlayers, blinds: { smallBlind: 50, bigBlind: 20 } }))
        .toThrowError(EngineError);
    });

    it('rejeita dealerSeat inexistente ou pertencente a jogador sem fichas', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 100 },
        { id: 'p2', seat: 2, chips: 0 },
        { id: 'p3', seat: 3, chips: 100 },
      ];

      // Assento 9 não existe
      expect(() => initHand({ players, blinds: defaultBlinds, dealerSeat: 9 }))
        .toThrowError(EngineError);

      // Assento 2 não tem fichas (não elegível)
      expect(() => initHand({ players, blinds: defaultBlinds, dealerSeat: 2 }))
        .toThrowError(EngineError);
    });

    it('rejeita entradas que não sejam arrays para players', () => {
      // @ts-expect-error teste de robustez em tempo de execução
      expect(() => getEligiblePlayers(null)).toThrowError(EngineError);
      // @ts-expect-error teste de robustez em tempo de execução
      expect(() => getEligiblePlayers('invalid')).toThrowError(EngineError);
    });
  });

  describe('Segurança numérica', () => {
    const blinds = { smallBlind: 10, bigBlind: 20 };

    it('rejeita valores acima do limite seguro de inteiros', () => {
      const unsafe = Number.MAX_SAFE_INTEGER + 1;

      expect(() => getEligiblePlayers([
        { id: 'p1', seat: 1, chips: unsafe },
      ])).toThrowError(EngineError);

      expect(() => getEligiblePlayers([
        { id: 'p1', seat: unsafe, chips: 100 },
      ])).toThrowError(EngineError);

      expect(() => initHand({
        players: [
          { id: 'p1', seat: 1, chips: 100 },
          { id: 'p2', seat: 2, chips: 100 },
        ],
        blinds: { smallBlind: 10, bigBlind: unsafe },
      })).toThrowError(EngineError);
    });

    it('rejeita mesas cuja soma das fichas ultrapassa o limite seguro', () => {
      expect(() => initHand({
        players: [
          { id: 'p1', seat: 1, chips: Number.MAX_SAFE_INTEGER },
          { id: 'p2', seat: 2, chips: 1 },
        ],
        blinds,
        dealerSeat: 1,
      })).toThrowError(EngineError);
    });

    it('preserva corretamente o total no limite máximo seguro', () => {
      const hand = initHand({
        players: [
          { id: 'p1', seat: 1, chips: Number.MAX_SAFE_INTEGER - 100 },
          { id: 'p2', seat: 2, chips: 100 },
        ],
        blinds,
        dealerSeat: 1,
      });

      const total = hand.players.reduce(
        (sum, player) => sum + player.chips,
        0,
      ) + hand.pot;

      expect(total).toBe(Number.MAX_SAFE_INTEGER);
    });
  });

  describe('Pureza e Imutabilidade', () => {
    it('congela o estado e os objetos individuais dos jogadores', () => {
      const hand = initHand({
        players: [
          { id: 'p1', seat: 1, chips: 100 },
          { id: 'p2', seat: 2, chips: 100 },
        ],
        blinds: defaultBlinds,
        dealerSeat: 1,
      });

      expect(Object.isFrozen(hand)).toBe(true);
      expect(Object.isFrozen(hand.players)).toBe(true);
      expect(hand.players.every(player => Object.isFrozen(player))).toBe(true);
    });


    it('não mutaciona o array ou os objetos de entrada recebidos', () => {
      const p1: PlayerInput = Object.freeze({ id: 'p1', seat: 1, chips: 500, name: 'Alice' });
      const p2: PlayerInput = Object.freeze({ id: 'p2', seat: 2, chips: 500, name: 'Bob' });
      const inputList = Object.freeze([p1, p2]);

      expect(() => {
        initHand({ players: inputList, blinds: defaultBlinds, dealerSeat: 1 });
      }).not.toThrow();

      // Confirma que os valores originais não foram alterados
      expect(p1.chips).toBe(500);
      expect(p2.chips).toBe(500);
      // @ts-expect-error verificação em tempo de execução
      expect(p1.committed).toBeUndefined();
    });
  });
});
