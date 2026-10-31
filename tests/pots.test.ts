import { describe, expect, it } from 'vitest';
import {
  allIn,
  buildPots,
  call,
  createPreFlopRound,
  EngineError,
  fold,
  initHand,
  raise,
  type PlayerInput,
} from '@poker-table/engine';

describe('Texas Hold\'em Engine — Construção de Main Pot e Side Pots (Etapa 2.3A)', () => {
  const defaultBlinds = { smallBlind: 10, bigBlind: 20 };

  // 1. Pote único sem all-ins
  describe('1. Pote único sem all-ins', () => {
    it('cria apenas um main pot quando todos os jogadores ativos igualam a mesma aposta', () => {
      const players = [
        { id: 'p1', committed: 100, folded: false },
        { id: 'p2', committed: 100, folded: false },
        { id: 'p3', committed: 100, folded: false },
      ];

      const pots = buildPots(players);
      expect(pots).toHaveLength(1);

      const main = pots[0];
      expect(main.id).toBe('main');
      expect(main.type).toBe('main');
      expect(main.index).toBe(0);
      expect(main.amount).toBe(300);
      expect(main.contributors).toEqual(['p1', 'p2', 'p3']);
      expect(main.eligiblePlayers).toEqual(['p1', 'p2', 'p3']);
      expect(main.contributorIds).toEqual(['p1', 'p2', 'p3']);
      expect(main.eligiblePlayerIds).toEqual(['p1', 'p2', 'p3']);
    });
  });

  // 2. Pote único com jogador que deu fold (Cenário Obrigatório 5)
  describe('2. Pote único com jogador que deu fold (Cenário Obrigatório 5)', () => {
    it('incorpora fichas do jogador que desistiu sem criar side pot desnecessário', () => {
      // Cenário do enunciado:
      // A: committed = 100, ativo.
      // B: committed = 20, folded.
      // C: committed = 100, ativo.
      const players = [
        { id: 'A', committed: 100, folded: false },
        { id: 'B', committed: 20, folded: true },
        { id: 'C', committed: 100, folded: false },
      ];

      const pots = buildPots(players);
      expect(pots).toHaveLength(1);

      const pot = pots[0];
      expect(pot.id).toBe('main');
      expect(pot.type).toBe('main');
      expect(pot.amount).toBe(220); // 100 + 20 + 100
      expect(pot.contributors).toEqual(['A', 'B', 'C']);
      expect(pot.eligiblePlayers).toEqual(['A', 'C']); // B não pode ganhar
    });
  });

  // 3. Um side pot (Cenário Obrigatório 4)
  describe('3. Um side pot (Cenário Obrigatório 4)', () => {
    it('constrói corretamente main pot e um side pot com dois níveis de aposta', () => {
      // Cenário do enunciado:
      // A: committed = 120, ativo.
      // B: committed = 0, folded.
      // C: committed = 60, all-in.
      // D: committed = 120, all-in.
      const players = [
        { id: 'A', committed: 120, folded: false },
        { id: 'B', committed: 0, folded: true },
        { id: 'C', committed: 60, folded: false },
        { id: 'D', committed: 120, folded: false },
      ];

      const pots = buildPots(players);
      expect(pots).toHaveLength(2);

      const [main, side] = pots;

      // Main pot: 60 x 3 = 180. Elegíveis: A, C, D
      expect(main.id).toBe('main');
      expect(main.type).toBe('main');
      expect(main.amount).toBe(180);
      expect(main.eligiblePlayers).toEqual(['A', 'C', 'D']);
      expect(main.contributors).toEqual(['A', 'C', 'D']);

      // Side pot: (120 - 60) x 2 = 120. Elegíveis: A, D
      expect(side.id).toBe('side-1');
      expect(side.type).toBe('side');
      expect(side.amount).toBe(120);
      expect(side.eligiblePlayers).toEqual(['A', 'D']);
      expect(side.contributors).toEqual(['A', 'D']);

      // Total = 300
      expect(main.amount + side.amount).toBe(300);
    });
  });

  // 4. Dois side pots (Cenário Obrigatório 6)
  describe('4. Dois side pots (Cenário Obrigatório 6)', () => {
    it('constrói corretamente main pot e dois side pots para múltiplos all-ins', () => {
      // Cenário do enunciado:
      // A: committed = 300, ativo.
      // B: committed = 100, all-in.
      // C: committed = 200, all-in.
      // D: committed = 300, ativo.
      const players = [
        { id: 'A', committed: 300, folded: false },
        { id: 'B', committed: 100, folded: false },
        { id: 'C', committed: 200, folded: false },
        { id: 'D', committed: 300, folded: false },
      ];

      const pots = buildPots(players);
      expect(pots).toHaveLength(3);

      const [main, side1, side2] = pots;

      // Main pot: 100 x 4 = 400. Elegíveis: A, B, C, D
      expect(main.id).toBe('main');
      expect(main.type).toBe('main');
      expect(main.amount).toBe(400);
      expect(main.eligiblePlayers).toEqual(['A', 'B', 'C', 'D']);

      // Side pot 1: (200 - 100) x 3 = 300. Elegíveis: A, C, D
      expect(side1.id).toBe('side-1');
      expect(side1.type).toBe('side');
      expect(side1.amount).toBe(300);
      expect(side1.eligiblePlayers).toEqual(['A', 'C', 'D']);

      // Side pot 2: (300 - 200) x 2 = 200. Elegíveis: A, D
      expect(side2.id).toBe('side-2');
      expect(side2.type).toBe('side');
      expect(side2.amount).toBe(200);
      expect(side2.eligiblePlayers).toEqual(['A', 'D']);

      // Total = 900
      expect(main.amount + side1.amount + side2.amount).toBe(900);
    });
  });

  // 5. Vários jogadores all-in com valores diferentes
  describe('5. Vários jogadores all-in com valores diferentes', () => {
    it('cria potes escalonados com elegibilidade em cascata para 4 all-ins distintos', () => {
      const players = [
        { id: 'p1', committed: 50, folded: false },
        { id: 'p2', committed: 100, folded: false },
        { id: 'p3', committed: 150, folded: false },
        { id: 'p4', committed: 200, folded: false },
        { id: 'p5', committed: 200, folded: false },
      ];

      const pots = buildPots(players);
      expect(pots).toHaveLength(4);

      // Main: 50 x 5 = 250 (p1, p2, p3, p4, p5)
      expect(pots[0].amount).toBe(250);
      expect(pots[0].eligiblePlayers).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);

      // Side 1: 50 x 4 = 200 (p2, p3, p4, p5)
      expect(pots[1].amount).toBe(200);
      expect(pots[1].eligiblePlayers).toEqual(['p2', 'p3', 'p4', 'p5']);

      // Side 2: 50 x 3 = 150 (p3, p4, p5)
      expect(pots[2].amount).toBe(150);
      expect(pots[2].eligiblePlayers).toEqual(['p3', 'p4', 'p5']);

      // Side 3: 50 x 2 = 100 (p4, p5)
      expect(pots[3].amount).toBe(100);
      expect(pots[3].eligiblePlayers).toEqual(['p4', 'p5']);

      const total = pots.reduce((sum, p) => sum + p.amount, 0);
      expect(total).toBe(50 + 100 + 150 + 200 + 200);
    });
  });

  // 6. Jogadores all-in com contribuições iguais
  describe('6. Jogadores all-in com contribuições iguais', () => {
    it('não divide potes entre jogadores que colocaram o mesmo valor all-in', () => {
      const players = [
        { id: 'p1', committed: 100, folded: false },
        { id: 'p2', committed: 100, folded: false },
        { id: 'p3', committed: 250, folded: false },
        { id: 'p4', committed: 250, folded: false },
      ];

      const pots = buildPots(players);
      expect(pots).toHaveLength(2);

      // Main pot: 100 x 4 = 400 (todos os 4 elegíveis)
      expect(pots[0].id).toBe('main');
      expect(pots[0].amount).toBe(400);
      expect(pots[0].eligiblePlayers).toEqual(['p1', 'p2', 'p3', 'p4']);

      // Side pot: (250 - 100) x 2 = 300 (p3, p4 elegíveis)
      expect(pots[1].id).toBe('side-1');
      expect(pots[1].amount).toBe(300);
      expect(pots[1].eligiblePlayers).toEqual(['p3', 'p4']);
    });
  });

  // 7. Jogador que deu fold após contribuir
  describe('7. Jogador que deu fold após contribuir', () => {
    it('mantém o valor do jogador desistente como dead money sem conceder elegibilidade', () => {
      const players = [
        { id: 'A', committed: 300, folded: false },
        { id: 'B', committed: 80, folded: true },
        { id: 'C', committed: 300, folded: false },
      ];

      const pots = buildPots(players);
      expect(pots).toHaveLength(1);
      expect(pots[0].amount).toBe(680); // 300 + 80 + 300
      expect(pots[0].eligiblePlayers).toEqual(['A', 'C']);
      expect(pots[0].contributors).toEqual(['A', 'B', 'C']);
    });
  });

  // 8. Fold com contribuição intermediária entre níveis de all-in
  describe('8. Fold com contribuição intermediária entre níveis de all-in', () => {
    it('funde slices que compartilham a mesma lista de jogadores elegíveis', () => {
      // p1 all-in 50
      // p2 fold com 120
      // p3 e p4 cobrem 200
      const players = [
        { id: 'p1', committed: 50, folded: false },
        { id: 'p2', committed: 120, folded: true },
        { id: 'p3', committed: 200, folded: false },
        { id: 'p4', committed: 200, folded: false },
      ];

      const pots = buildPots(players);
      // Main pot: até 50 -> 50 x 4 = 200 (p1, p3, p4 elegíveis)
      // 50 a 120: p2, p3, p4 pagam 70 -> 210 (p3, p4 elegíveis)
      // 120 a 200: p3, p4 pagam 80 -> 160 (p3, p4 elegíveis)
      // Como 50-120 e 120-200 têm exatamente os mesmos elegíveis (p3, p4), fundem-se em 370!
      expect(pots).toHaveLength(2);

      expect(pots[0].id).toBe('main');
      expect(pots[0].amount).toBe(200);
      expect(pots[0].eligiblePlayers).toEqual(['p1', 'p3', 'p4']);

      expect(pots[1].id).toBe('side-1');
      expect(pots[1].amount).toBe(370);
      expect(pots[1].eligiblePlayers).toEqual(['p3', 'p4']);

      expect(pots[0].amount + pots[1].amount).toBe(50 + 120 + 200 + 200);
    });
  });

  // 9. Contribuições regularizadas
  describe('9. Contribuições regularizadas', () => {
    it('rejeita listas com fichas não igualadas', () => {
      expect(() => buildPots([
        { id: 'p1', committed: 500, folded: false },
        { id: 'p2', committed: 100, folded: false },
      ])).toThrowError(EngineError);
    });

    it('aceita uma rodada já regularizada pelo motor', () => {
      const hand = initHand({
        players: [
          { id: 'sb', seat: 1, chips: 1000 },
          { id: 'bb', seat: 2, chips: 15 },
        ],
        blinds: defaultBlinds,
        dealerSeat: 1,
      });

      const round = call(createPreFlopRound(hand), 'sb');

      expect(round.status).toBe('completed');
      expect(round.pot).toBe(30);

      const pots = buildPots(round);

      expect(pots).toHaveLength(1);
      expect(pots[0].amount).toBe(30);
      expect(pots[0].eligiblePlayers).toEqual(['bb', 'sb']);
    });
  });

  // 10. Heads-up com all-in
  describe('10. Heads-up com all-in', () => {
    it('cria pote único quando as contribuições estão igualadas', () => {
      const pots = buildPots([
        { id: 'sb', committed: 75, folded: false },
        { id: 'bb', committed: 75, folded: false },
      ]);

      expect(pots).toHaveLength(1);
      expect(pots[0].amount).toBe(150);
      expect(pots[0].eligiblePlayers).toEqual(['bb', 'sb']);
    });

    it('rejeita heads-up com contribuição excedente não restituída', () => {
      expect(() => buildPots([
        { id: 'sb', committed: 40, folded: false },
        { id: 'bb', committed: 100, folded: false },
      ])).toThrowError(EngineError);
    });
  });

  // 11. Mesa com 6 jogadores integrado com RoundState
  describe('11. Mesa com 6 jogadores', () => {
    it('integra perfeitamente com um RoundState finalizado de 6 jogadores', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
        { id: 'p4', seat: 4, chips: 50 },  // All-in curto
        { id: 'p5', seat: 5, chips: 150 }, // All-in médio
        { id: 'p6', seat: 6, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);

      // Ordem pré-flop: p4 -> p5 -> p6 -> p1 -> p2 -> p3
      round = allIn(round, 'p4'); // all-in 50
      round = allIn(round, 'p5'); // all-in 150
      round = call(round, 'p6');  // paga 150
      round = fold(round, 'p1');  // fold
      round = fold(round, 'p2');  // fold (tinha 10 no SB)
      round = call(round, 'p3');  // paga 150 (tinha 20 no BB)

      expect(round.status).toBe('completed');

      const pots = buildPots(round);
      // Contribuições:
      // p4: 50 (all-in)
      // p5: 150 (all-in)
      // p6: 150 (ativo)
      // p1: 0 (folded)
      // p2: 10 (folded)
      // p3: 150 (ativo)

      // Main pot: até 50.
      // p4(50), p5(50), p6(50), p2(10), p3(50) = 210.
      // Elegíveis: p3, p4, p5, p6 (p2 folded).
      expect(pots[0].id).toBe('main');
      expect(pots[0].amount).toBe(210);
      expect(pots[0].eligiblePlayers).toEqual(['p3', 'p4', 'p5', 'p6']);

      // Side pot: 50 a 150 (delta 100).
      // p5(100), p6(100), p3(100) = 300.
      // Elegíveis: p3, p5, p6.
      expect(pots[1].id).toBe('side-1');
      expect(pots[1].amount).toBe(300);
      expect(pots[1].eligiblePlayers).toEqual(['p3', 'p5', 'p6']);

      expect(pots).toHaveLength(2);
      expect(pots[0].amount + pots[1].amount).toBe(round.pot);
    });
  });

  // 12. Mesa com 10 jogadores
  describe('12. Mesa com 10 jogadores', () => {
    it('calcula potes corretamente para mesa full ring com múltiplos potes paralelos', () => {
      const players = [
        { id: 'p1', committed: 20, folded: true },
        { id: 'p2', committed: 20, folded: true },
        { id: 'p3', committed: 50, folded: false }, // all-in 50
        { id: 'p4', committed: 100, folded: false }, // all-in 100
        { id: 'p5', committed: 20, folded: true },
        { id: 'p6', committed: 200, folded: false }, // all-in 200
        { id: 'p7', committed: 300, folded: false }, // call 300
        { id: 'p8', committed: 300, folded: false }, // call 300
        { id: 'p9', committed: 0, folded: true },
        { id: 'p10', committed: 20, folded: true },
      ];

      const pots = buildPots(players);
      const totalPotsAmount = pots.reduce((acc, p) => acc + p.amount, 0);
      const totalCommitted = players.reduce((acc, p) => acc + p.committed, 0);

      expect(totalPotsAmount).toBe(totalCommitted);
      expect(pots.length).toBeGreaterThanOrEqual(3);
    });
  });

  // 13. Conservação do valor total dos potes
  describe('13. Conservação do valor total dos potes', () => {
    it('garante que a soma de todos os potes é exatamente igual ao pote total da rodada', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 80 },
        { id: 'p2', seat: 2, chips: 160 },
        { id: 'p3', seat: 3, chips: 300 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);

      round = allIn(round, 'p1');  // all-in 80
      round = raise(round, 160, 'p2'); // raise 160 (p2 tem 160, all-in)
      round = call(round, 'p3');   // p3 paga 160

      expect(round.status).toBe('completed');

      const pots = buildPots(round);
      const sumPots = pots.reduce((sum, p) => sum + p.amount, 0);

      expect(sumPots).toBe(round.pot);
    });
  });

  describe('Regressões da auditoria dos potes', () => {
    it('rejeita construção definitiva durante rodada ativa', () => {
      const hand = initHand({
        players: [
          { id: 'A', seat: 1, chips: 1000 },
          { id: 'B', seat: 2, chips: 1000 },
          { id: 'C', seat: 3, chips: 1000 },
        ],
        blinds: defaultBlinds,
        dealerSeat: 1,
      });

      const round = createPreFlopRound(hand);

      expect(round.status).toBe('active');
      expect(() => buildPots(round)).toThrowError(EngineError);
    });

    it('rejeita IDs duplicados na lista de contribuições', () => {
      const players = [
        { id: 'A', committed: 100, folded: false },
        { id: 'A', committed: 100, folded: false },
      ];

      expect(() => buildPots(players)).toThrowError(EngineError);
    });

    it('rejeita quando a soma excede MAX_SAFE_INTEGER', () => {
      const players = [
        {
          id: 'A',
          committed: Number.MAX_SAFE_INTEGER,
          folded: false,
        },
        {
          id: 'B',
          committed: Number.MAX_SAFE_INTEGER,
          folded: false,
        },
      ];

      expect(() => buildPots(players)).toThrowError(EngineError);
    });

    it('rejeita inconsistência entre pot e contribuições', () => {
      const hand = initHand({
        players: [
          { id: 'A', seat: 1, chips: 1000 },
          { id: 'B', seat: 2, chips: 1000 },
        ],
        blinds: defaultBlinds,
        dealerSeat: 1,
      });

      const round = fold(createPreFlopRound(hand), 'A');

      expect(round.status).toBe('hand_ended_by_fold');

      const inconsistent = {
        ...round,
        pot: round.pot + 1,
      };

      expect(() => buildPots(inconsistent)).toThrowError(EngineError);
    });
  });

  // 14. Inteiros seguros e valores inválidos
  describe('14. Inteiros seguros e valores inválidos', () => {
    it('rejeita valores negativos, fracionários, IDs vazios ou tipos inválidos', () => {
      // @ts-expect-error teste de robustez em tempo de execução
      expect(() => buildPots(null)).toThrowError(EngineError);
      // @ts-expect-error teste de robustez em tempo de execução
      expect(() => buildPots(123)).toThrowError(EngineError);

      expect(() =>
        buildPots([{ id: 'p1', committed: -50, folded: false }]),
      ).toThrowError(EngineError);

      expect(() =>
        buildPots([{ id: 'p1', committed: 50.5, folded: false }]),
      ).toThrowError(EngineError);

      expect(() =>
        buildPots([{ id: '', committed: 50, folded: false }]),
      ).toThrowError(EngineError);
    });
  });

  // 15. Imutabilidade do estado
  describe('15. Imutabilidade do estado', () => {
    it('não mutaciona a lista ou objetos passados como entrada e congela os potes gerados', () => {
      const p1 = Object.freeze({ id: 'p1', committed: 100, folded: false });
      const p2 = Object.freeze({ id: 'p2', committed: 100, folded: false });
      const input = Object.freeze([p1, p2]);

      const pots = buildPots(input);

      expect(pots).toBeDefined();
      expect(Object.isFrozen(pots)).toBe(true);
      expect(Object.isFrozen(pots[0])).toBe(true);
      expect(Object.isFrozen(pots[0].eligiblePlayers)).toBe(true);
      expect(Object.isFrozen(pots[0].contributors)).toBe(true);

      // Tentativa de mutação deve falhar
      expect(() => {
        // @ts-expect-error tentativa proposital de mutação
        pots[0].amount = 999;
      }).toThrow();
    });
  });

  // 16. Resultado determinístico independentemente da ordem dos jogadores na entrada
  describe('16. Resultado determinístico independentemente da ordem dos jogadores na entrada', () => {
    it('produz exatamente os mesmos potes e elegibilidades independentemente da ordem de entrada', () => {
      const order1 = [
        { id: 'A', committed: 120, folded: false },
        { id: 'B', committed: 0, folded: true },
        { id: 'C', committed: 60, folded: false },
        { id: 'D', committed: 120, folded: false },
      ];

      const order2 = [
        { id: 'D', committed: 120, folded: false },
        { id: 'C', committed: 60, folded: false },
        { id: 'B', committed: 0, folded: true },
        { id: 'A', committed: 120, folded: false },
      ];

      const pots1 = buildPots(order1);
      const pots2 = buildPots(order2);

      expect(pots1).toEqual(pots2);
    });
  });

  // Potes consecutivos com mesmo conjunto de elegíveis não são divididos
  describe('Potes consecutivos com mesmo conjunto de elegíveis não são divididos', () => {
    it('garante que potes com os mesmos elegíveis são unificados', () => {
      const players = [
        { id: 'A', committed: 30, folded: true },
        { id: 'B', committed: 70, folded: true },
        { id: 'C', committed: 200, folded: false },
        { id: 'D', committed: 200, folded: false },
      ];

      const pots = buildPots(players);
      // Elegíveis em 0-30: C, D
      // Elegíveis em 30-70: C, D
      // Elegíveis em 70-200: C, D
      // Todos têm exatamente os mesmos elegíveis [C, D], logo deve ser apenas 1 pote!
      expect(pots).toHaveLength(1);
      expect(pots[0].amount).toBe(30 + 70 + 200 + 200);
      expect(pots[0].eligiblePlayers).toEqual(['C', 'D']);
      expect(pots[0].contributors).toEqual(['A', 'B', 'C', 'D']);
    });
  });
});
