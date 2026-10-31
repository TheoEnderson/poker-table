import { describe, expect, it } from 'vitest';
import {
  allIn,
  call,
  createPreFlopRound,
  EngineError,
  fold,
  getPotsRequiringDecision,
  getPotsWithSingleEligible,
  initHand,
  raise,
  requiresDecision,
  settleHand,
  type PlayerInput,
  type PotWinnerDecision,
  type RoundPlayer,
  type RoundState,
  type RoundStatus,
} from '@poker-table/engine';

describe('Texas Hold\'em Engine — Distribuição manual dos prêmios (Etapa 2.3B)', () => {
  const defaultBlinds = { smallBlind: 10, bigBlind: 20 };

  /**
   * Helper para construir um RoundState customizado para testes específicos
   */
  function createCustomRoundState(params: {
    players: {
      id: string;
      seat: number;
      chips: number;
      committed: number;
      isAllIn?: boolean;
      folded?: boolean;
    }[];
    pot: number;
    dealerSeat: number;
    status?: RoundStatus;
    smallBlind?: number;
    bigBlind?: number;
  }): RoundState {
    const sb = params.smallBlind ?? 10;
    const bb = params.bigBlind ?? 20;
    const status = params.status ?? 'completed';

    const roundPlayers: RoundPlayer[] = params.players.map(p => ({
      id: p.id,
      seat: p.seat,
      chips: p.chips,
      committed: p.committed,
      isAllIn: p.isAllIn ?? p.chips === 0,
      folded: p.folded ?? false,
      lastActionBet: p.committed,
    }));

    const handPlayers = roundPlayers.map(p => ({
      id: p.id,
      seat: p.seat,
      chips: p.chips,
      committed: p.committed,
      isAllIn: p.isAllIn,
    }));

    const handState = {
      players: Object.freeze(handPlayers),
      participatingPlayers: Object.freeze(handPlayers),
      dealerSeat: params.dealerSeat,
      smallBlindSeat: params.dealerSeat,
      bigBlindSeat: params.dealerSeat,
      pot: params.pot,
      smallBlind: sb,
      bigBlind: bb,
      preFlopOrder: Object.freeze(roundPlayers.map(p => p.id)),
      postFlopOrder: Object.freeze(roundPlayers.map(p => p.id)),
      preFlopActionOrder: Object.freeze(roundPlayers.map(p => p.id)),
      postFlopActionOrder: Object.freeze(roundPlayers.map(p => p.id)),
      preFlopActionPlayers: Object.freeze(handPlayers),
      postFlopActionPlayers: Object.freeze(handPlayers),
      currentActorId: null,
    };

    return Object.freeze({
      players: Object.freeze(roundPlayers),
      currentBet: Math.max(...roundPlayers.map(p => p.committed)),
      minRaiseIncrement: bb,
      lastRaiseIncrement: bb,
      pot: params.pot,
      currentActorId: null,
      playersToAct: Object.freeze([]),
      status,
      smallBlind: sb,
      bigBlind: bb,
      dealerSeat: params.dealerSeat,
      smallBlindSeat: params.dealerSeat,
      bigBlindSeat: params.dealerSeat,
      handState: Object.freeze(handState),
    });
  }

  // 1. Vencedor único do main pot
  describe('1. Vencedor único do main pot', () => {
    it('credita integralmente o pote ao vencedor único informado', () => {
      const players: PlayerInput[] = [
        { id: 'A', seat: 1, chips: 500 },
        { id: 'B', seat: 2, chips: 500 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);
      // A (SB/dealer): call 20, B (BB): check -> pote 40
      round = call(round, 'A');
      round = call(round, 'B'); // check

      expect(round.status).toBe('completed');
      expect(round.pot).toBe(40);

      const decision: PotWinnerDecision = { potId: 'main', winners: ['B'] };
      const settled = settleHand(round, [decision]);

      expect(settled.status).toBe('settled');
      expect(settled.isSettled).toBe(true);
      expect(settled.pot).toBe(0);
      expect(settled.originalPot).toBe(40);

      const playerA = settled.players.find(p => p.id === 'A')!;
      const playerB = settled.players.find(p => p.id === 'B')!;

      // A começou com 500, colocou 20, sobrou 480
      expect(playerA.chips).toBe(480);
      expect(playerA.totalWon).toBe(0);
      expect(playerA.committed).toBe(0);

      // B começou com 500, colocou 20 (480) e ganhou o pote de 40 -> 520
      expect(playerB.chips).toBe(520);
      expect(playerB.totalWon).toBe(40);
      expect(playerB.committed).toBe(0);

      expect(settled.potAwards).toHaveLength(1);
      expect(settled.potAwards[0].potId).toBe('main');
      expect(settled.potAwards[0].potAmount).toBe(40);
      expect(settled.potAwards[0].awards).toEqual([{ playerId: 'B', amount: 40 }]);
    });
  });

  // 2. Vencedor único do side pot
  describe('2. Vencedor único do side pot', () => {
    it('distribui corretamente quando há um vencedor distinto no side pot', () => {
      // A all-in 60, B e C cobrem 120
      const round = createCustomRoundState({
        players: [
          { id: 'A', seat: 1, chips: 0, committed: 60, isAllIn: true },
          { id: 'B', seat: 2, chips: 380, committed: 120 },
          { id: 'C', seat: 3, chips: 380, committed: 120 },
        ],
        pot: 300,
        dealerSeat: 1,
      });

      // Main pot: 180 (A, B, C)
      // Side pot: 120 (B, C)
      const decisions: PotWinnerDecision[] = [
        { potId: 'main', winners: ['A'] },
        { potId: 'side-1', winners: ['B'] },
      ];

      const settled = settleHand(round, decisions);

      expect(settled.potAwards).toHaveLength(2);
      expect(settled.potAwards[0].potAmount).toBe(180);
      expect(settled.potAwards[0].awards).toEqual([{ playerId: 'A', amount: 180 }]);

      expect(settled.potAwards[1].potAmount).toBe(120);
      expect(settled.potAwards[1].awards).toEqual([{ playerId: 'B', amount: 120 }]);

      const pA = settled.players.find(p => p.id === 'A')!;
      const pB = settled.players.find(p => p.id === 'B')!;
      const pC = settled.players.find(p => p.id === 'C')!;

      expect(pA.chips).toBe(180);
      expect(pA.isAllIn).toBe(false); // Recuperou fichas, não está mais all-in
      expect(pB.chips).toBe(380 + 120); // 500
      expect(pC.chips).toBe(380);
    });
  });

  // 3. Um jogador vencendo vários potes
  describe('3. Um jogador vencendo vários potes', () => {
    it('permite que o mesmo jogador vença tanto o main pot quanto os side pots', () => {
      const round = createCustomRoundState({
        players: [
          { id: 'A', seat: 1, chips: 0, committed: 60, isAllIn: true },
          { id: 'B', seat: 2, chips: 200, committed: 120 },
          { id: 'C', seat: 3, chips: 200, committed: 120 },
        ],
        pot: 300,
        dealerSeat: 1,
      });

      const decisions: PotWinnerDecision[] = [
        { potId: 'main', winners: ['B'] },
        { potId: 'side-1', winners: ['B'] },
      ];

      const settled = settleHand(round, decisions);

      const pB = settled.players.find(p => p.id === 'B')!;
      expect(pB.totalWon).toBe(300); // 180 + 120
      expect(pB.chips).toBe(200 + 300); // 500
    });
  });

  // 4. Vencedores diferentes no main pot e side pot
  describe('4. Vencedores diferentes no main pot e side pot', () => {
    it('distribui prêmios de forma totalmente independente entre os potes', () => {
      const round = createCustomRoundState({
        players: [
          { id: 'A', seat: 1, chips: 0, committed: 100, isAllIn: true },
          { id: 'B', seat: 2, chips: 100, committed: 300 },
          { id: 'C', seat: 3, chips: 100, committed: 300 },
        ],
        pot: 700,
        dealerSeat: 1,
      });

      // Main pot = 300 (A, B, C)
      // Side pot = 400 (B, C)
      const decisions: PotWinnerDecision[] = [
        { potId: 'main', winners: ['A'] },
        { potId: 'side-1', winners: ['C'] },
      ];

      const settled = settleHand(round, decisions);

      const pA = settled.players.find(p => p.id === 'A')!;
      const pB = settled.players.find(p => p.id === 'B')!;
      const pC = settled.players.find(p => p.id === 'C')!;

      expect(pA.chips).toBe(300);
      expect(pB.chips).toBe(100); // Não ganhou nada
      expect(pC.chips).toBe(100 + 400); // 500
    });
  });

  // 5. Empate com divisão exata
  describe('5. Empate com divisão exata', () => {
    it('divide o pote igualmente em partes inteiras entre os vencedores', () => {
      const round = createCustomRoundState({
        players: [
          { id: 'A', seat: 1, chips: 150, committed: 150 },
          { id: 'B', seat: 2, chips: 150, committed: 150 },
        ],
        pot: 300,
        dealerSeat: 1,
      });

      const decisions: PotWinnerDecision[] = [
        { potId: 'main', winners: ['A', 'B'] },
      ];

      const settled = settleHand(round, decisions);

      expect(settled.potAwards[0].awards).toEqual([
        { playerId: 'B', amount: 150 },
        { playerId: 'A', amount: 150 },
      ]);

      const pA = settled.players.find(p => p.id === 'A')!;
      const pB = settled.players.find(p => p.id === 'B')!;

      expect(pA.chips).toBe(300);
      expect(pB.chips).toBe(300);
    });
  });

  // 6. Empate com ficha excedente
  describe('6. Empate com ficha excedente', () => {
    it('divide a parcela inteira e distribui a ficha restante respeitando a menor unidade', () => {
      const round = createCustomRoundState({
        players: [
          { id: 'A', seat: 1, chips: 0, committed: 50 },
          { id: 'B', seat: 2, chips: 0, committed: 50 },
          { id: 'C', seat: 3, chips: 0, committed: 1, folded: true },
        ],
        pot: 101,
        dealerSeat: 1,
      });

      const decisions: PotWinnerDecision[] = [
        { potId: 'main', winners: ['A', 'B'] },
      ];

      const settled = settleHand(round, decisions);

      // Pote 101 entre 2 jogadores: 50 para cada + 1 excedente
      const awards = settled.potAwards[0].awards;
      expect(awards).toHaveLength(2);

      const amounts = awards.map(a => a.amount).sort((x, y) => x - y);
      expect(amounts).toEqual([50, 51]);
    });
  });

  // 7. Ficha excedente atribuída corretamente a partir do dealer
  describe('7. Ficha excedente atribuída corretamente a partir do dealer', () => {
    it('atribui a ficha excedente ao primeiro vencedor à esquerda do dealer (Poker TDA Regra 21)', () => {
      // Dealer no seat 2. A no seat 1, B no seat 3.
      // Ordem horária à esquerda do dealer (seat 2): B (seat 3) vem primeiro, depois A (seat 1).
      const round = createCustomRoundState({
        players: [
          { id: 'A', seat: 1, chips: 0, committed: 50 },
          { id: 'D', seat: 2, chips: 0, committed: 1, folded: true }, // dealer
          { id: 'B', seat: 3, chips: 0, committed: 50 },
        ],
        pot: 101,
        dealerSeat: 2,
      });

      const decisions: PotWinnerDecision[] = [
        { potId: 'main', winners: ['A', 'B'] },
      ];

      const settled = settleHand(round, decisions);
      const awards = settled.potAwards[0].awards;

      // B está no assento 3 (à esquerda do dealer seat 2) -> ganha a ficha excedente (51)
      // A está no assento 1 -> recebe 50
      expect(awards).toEqual([
        { playerId: 'B', amount: 51 },
        { playerId: 'A', amount: 50 },
      ]);
    });
  });

  // 8. Ficha excedente com assentos vazios
  describe('8. Ficha excedente com assentos vazios', () => {
    it('considera corretamente assentos vazios e avança para o próximo ocupado no sentido horário', () => {
      // Dealer no assento 1.
      // Assentos ocupados: A no assento 3, C no assento 5 (desistiu com 1 dead chip), B no assento 8.
      // Assentos vazios: 2, 4, 6, 7, 9, 10.
      // Sentido horário a partir de 1: o primeiro ocupado elegível é o assento 3 (A).
      const round = createCustomRoundState({
        players: [
          { id: 'A', seat: 3, chips: 0, committed: 50 },
          { id: 'C', seat: 5, chips: 0, committed: 1, folded: true },
          { id: 'B', seat: 8, chips: 0, committed: 50 },
        ],
        pot: 101,
        dealerSeat: 1, // Dealer num assento virtual ou do botão anterior
      });

      const decisions: PotWinnerDecision[] = [
        { potId: 'main', winners: ['A', 'B'] },
      ];

      const settled = settleHand(round, decisions);
      const awards = settled.potAwards[0].awards;

      expect(awards).toEqual([
        { playerId: 'A', amount: 51 },
        { playerId: 'B', amount: 50 },
      ]);
    });
  });

  // 9. Empate entre três jogadores
  describe('9. Empate entre três jogadores', () => {
    it('distribui a quantidade base igualmente e aloca as fichas excedentes na ordem horária a partir do dealer', () => {
      // Dealer no seat 4 (B).
      // Jogadores ativos: A (seat 1, 33), B (seat 4, 33), C (seat 7, 33).
      // Jogador D (seat 2, desistiu com 2 fichas de dead money).
      // Pote total = 33*3 + 2 = 101.
      // 101 / 3 = 33 base cada um. Resto = 2 fichas excedentes.
      // Sentido horário a partir do dealer B (seat 4):
      // 1ª prioridade: C (seat 7) -> 33 + 1 = 34
      // 2ª prioridade: A (seat 1) -> 33 + 1 = 34
      // 3ª prioridade: B (seat 4) -> 33
      const round = createCustomRoundState({
        players: [
          { id: 'A', seat: 1, chips: 0, committed: 33 },
          { id: 'D', seat: 2, chips: 0, committed: 2, folded: true },
          { id: 'B', seat: 4, chips: 0, committed: 33 },
          { id: 'C', seat: 7, chips: 0, committed: 33 },
        ],
        pot: 101,
        dealerSeat: 4,
      });

      const decisions: PotWinnerDecision[] = [
        { potId: 'main', winners: ['A', 'B', 'C'] },
      ];

      const settled = settleHand(round, decisions);
      const awards = settled.potAwards[0].awards;

      expect(awards).toEqual([
        { playerId: 'C', amount: 34 },
        { playerId: 'A', amount: 34 },
        { playerId: 'B', amount: 33 },
      ]);
      expect(awards.reduce((sum, a) => sum + a.amount, 0)).toBe(101);
    });
  });

  // 10. Jogador inelegível tentando ganhar side pot
  describe('10. Jogador inelegível tentando ganhar side pot', () => {
    it('rejeita jogador que não possui elegibilidade para determinado side pot', () => {
      // A comprometeu 50; B e C comprometeram 100
      const round = createCustomRoundState({
        players: [
          { id: 'A', seat: 1, chips: 0, committed: 50, isAllIn: true },
          { id: 'B', seat: 2, chips: 100, committed: 100 },
          { id: 'C', seat: 3, chips: 100, committed: 100 },
        ],
        pot: 250,
        dealerSeat: 1,
      });

      // Tentativa de atribuir side-1 (disputado entre B e C) a A
      const decisions: PotWinnerDecision[] = [
        { potId: 'main', winners: ['A'] },
        { potId: 'side-1', winners: ['A'] },
      ];

      expect(() => settleHand(round, decisions)).toThrowError(EngineError);
    });
  });

  // 11. Jogador que deu fold tentando ganhar um pote
  describe('11. Jogador que deu fold tentando ganhar um pote', () => {
    it('rejeita declaração de jogador desistente como vencedor', () => {
      const round = createCustomRoundState({
        players: [
          { id: 'A', seat: 1, chips: 100, committed: 100, folded: false },
          { id: 'B', seat: 2, chips: 100, committed: 50, folded: true },
        ],
        pot: 150,
        dealerSeat: 1,
      });

      const decisions: PotWinnerDecision[] = [
        { potId: 'main', winners: ['B'] },
      ];

      expect(() => settleHand(round, decisions)).toThrowError(EngineError);
    });
  });

  // 12. Jogador inexistente declarado vencedor
  describe('12. Jogador inexistente declarado vencedor', () => {
    it('rejeita decisão com jogador não cadastrado na mesa', () => {
      const round = createCustomRoundState({
        players: [
          { id: 'A', seat: 1, chips: 100, committed: 100 },
          { id: 'B', seat: 2, chips: 100, committed: 100 },
        ],
        pot: 200,
        dealerSeat: 1,
      });

      const decisions: PotWinnerDecision[] = [
        { potId: 'main', winners: ['jogador_fantasma'] },
      ];

      expect(() => settleHand(round, decisions)).toThrowError(EngineError);
    });
  });

  // 13. Identificadores duplicados
  describe('13. Identificadores duplicados', () => {
    it('rejeita vencedor duplicado na lista de vencedores do mesmo pote', () => {
      const round = createCustomRoundState({
        players: [
          { id: 'A', seat: 1, chips: 100, committed: 100 },
          { id: 'B', seat: 2, chips: 100, committed: 100 },
        ],
        pot: 200,
        dealerSeat: 1,
      });

      const decisions: PotWinnerDecision[] = [
        { potId: 'main', winners: ['A', 'A'] },
      ];

      expect(() => settleHand(round, decisions)).toThrowError(EngineError);
    });

    it('rejeita múltiplas decisões concorrentes para o mesmo pote', () => {
      const round = createCustomRoundState({
        players: [
          { id: 'A', seat: 1, chips: 100, committed: 100 },
          { id: 'B', seat: 2, chips: 100, committed: 100 },
        ],
        pot: 200,
        dealerSeat: 1,
      });

      const decisions: PotWinnerDecision[] = [
        { potId: 'main', winners: ['A'] },
        { potId: 'main', winners: ['B'] },
      ];

      expect(() => settleHand(round, decisions)).toThrowError(EngineError);
    });
  });

  // 14. Pote inexistente
  describe('14. Pote inexistente', () => {
    it('rejeita decisão direcionada a um potId inexistente', () => {
      const round = createCustomRoundState({
        players: [
          { id: 'A', seat: 1, chips: 100, committed: 100 },
          { id: 'B', seat: 2, chips: 100, committed: 100 },
        ],
        pot: 200,
        dealerSeat: 1,
      });

      const decisions: PotWinnerDecision[] = [
        { potId: 'side-99', winners: ['A'] },
      ];

      expect(() => settleHand(round, decisions)).toThrowError(EngineError);
    });
  });

  // 15. Decisão ausente para pote disputado
  describe('15. Decisão ausente para pote disputado', () => {
    it('rejeita liquidação quando há potes disputados sem decisão de vencedor', () => {
      const round = createCustomRoundState({
        players: [
          { id: 'A', seat: 1, chips: 100, committed: 100 },
          { id: 'B', seat: 2, chips: 100, committed: 100 },
        ],
        pot: 200,
        dealerSeat: 1,
      });

      // Pote disputado sem decisões fornecidas
      expect(() => settleHand(round, [])).toThrowError(EngineError);
    });
  });

  // 16. Pote com apenas um elegível atribuído automaticamente
  describe('16. Pote com apenas um elegível atribuído automaticamente', () => {
    it('atribui automaticamente pote com único elegível sem requerer decisão manual', () => {
      // p1 all-in 50, p2 e p3 comprometem 100, mas p2 dá fold com 100!
      // Main pot: 50 de cada (p1, p2, p3) = 150 (elegíveis: p1, p3)
      // Side pot: 50 a 100 de p2 (fold) e p3 (ativo) = 100 (único elegível: p3)
      const round = createCustomRoundState({
        players: [
          { id: 'p1', seat: 1, chips: 0, committed: 50, isAllIn: true },
          { id: 'p2', seat: 2, chips: 0, committed: 100, folded: true },
          { id: 'p3', seat: 3, chips: 100, committed: 100 },
        ],
        pot: 250,
        dealerSeat: 1,
      });

      // Apenas decidimos o main pot (disputado entre p1 e p3)
      // O side-1 (onde só p3 é elegível) é atribuído automaticamente a p3!
      const decisions: PotWinnerDecision[] = [
        { potId: 'main', winners: ['p1'] },
      ];

      const settled = settleHand(round, decisions);

      expect(settled.potAwards).toHaveLength(2);
      expect(settled.potAwards[0].awards).toEqual([{ playerId: 'p1', amount: 150 }]);
      expect(settled.potAwards[1].awards).toEqual([{ playerId: 'p3', amount: 100 }]);

      const p1 = settled.players.find(p => p.id === 'p1')!;
      const p3 = settled.players.find(p => p.id === 'p3')!;

      expect(p1.chips).toBe(150);
      expect(p3.chips).toBe(100 + 100); // 200
    });
  });

  // 17. Encerramento automático por fold
  describe('17. Encerramento automático por fold', () => {
    it('atribui automaticamente todo o pote ao único jogador ativo sem necessidade de decisões', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
        { id: 'p3', seat: 3, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);

      // p1 é UTG -> fold, p2 (SB) -> fold. p3 (BB) vence por fold!
      round = fold(round, 'p1');
      round = fold(round, 'p2');

      expect(round.status).toBe('hand_ended_by_fold');
      // O excesso do BB (10 fichas) não igualado por p2 (que só colocou 10 no SB)
      // é restituído para p3 via settleUncalled, deixando pote = 20.
      expect(round.pot).toBe(20);

      const settled = settleHand(round); // Sem decisões manuais!

      expect(settled.status).toBe('settled');
      const p3 = settled.players.find(p => p.id === 'p3')!;
      // p3 tinha 990 (após débito do BB e restituição de 10) e recebeu as 20 do pote -> 1010
      expect(p3.chips).toBe(1010);
      expect(p3.totalWon).toBe(20);

      const p2 = settled.players.find(p => p.id === 'p2')!;
      expect(p2.chips).toBe(990);
    });

    it('rejeita decisão manual que tenta dar o prêmio a um jogador que deu fold', () => {
      const round = createCustomRoundState({
        players: [
          { id: 'A', seat: 1, chips: 100, committed: 100, folded: false },
          { id: 'B', seat: 2, chips: 0, committed: 100, folded: true },
        ],
        pot: 200,
        dealerSeat: 1,
        status: 'hand_ended_by_fold',
      });

      const decisions: PotWinnerDecision[] = [
        { potId: 'main', winners: ['B'] },
      ];

      expect(() => settleHand(round, decisions)).toThrowError(EngineError);
    });
  });

  // 18. Rejeição de rodada ativa
  describe('18. Rejeição de rodada ativa', () => {
    it('rejeita tentativa de liquidar rodada que ainda está com apostas em andamento', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 1000 },
        { id: 'p2', seat: 2, chips: 1000 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      const round = createPreFlopRound(hand);

      expect(round.status).toBe('active');
      expect(() => settleHand(round, [{ potId: 'main', winners: ['p1'] }])).toThrowError(
        EngineError,
      );
    });
  });

  // 19. Conservação de fichas
  describe('19. Conservação de fichas', () => {
    it('garante que nenhuma ficha é criada ou destruída na mesa após a liquidação', () => {
      const players: PlayerInput[] = [
        { id: 'p1', seat: 1, chips: 100 },
        { id: 'p2', seat: 2, chips: 200 },
        { id: 'p3', seat: 3, chips: 300 },
      ];
      const hand = initHand({ players, blinds: defaultBlinds, dealerSeat: 1 });
      let round = createPreFlopRound(hand);

      round = allIn(round, 'p1'); // 100
      round = raise(round, 200, 'p2'); // 200
      round = call(round, 'p3'); // 200

      expect(round.status).toBe('completed');
      expect(round.pot).toBe(500);

      const totalInitialChips = 100 + 200 + 300;

      const decisions: PotWinnerDecision[] = [
        { potId: 'main', winners: ['p1'] },
        { potId: 'side-1', winners: ['p2', 'p3'] },
      ];

      const settled = settleHand(round, decisions);

      const totalFinalChips = settled.players.reduce((sum, p) => sum + p.chips, 0);
      expect(totalFinalChips).toBe(totalInitialChips);

      const totalAwards = settled.potAwards.reduce((sum, pa) => sum + pa.potAmount, 0);
      expect(totalAwards).toBe(round.pot);
    });
  });

  describe('Regressões de integridade da auditoria', () => {
    it('rejeita stack negativo mesmo quando o prêmio o tornaria positivo', () => {
      const round = createCustomRoundState({
        players: [
          { id: 'A', seat: 1, chips: -1, committed: 100 },
          { id: 'B', seat: 2, chips: 100, committed: 100 },
        ],
        pot: 200,
        dealerSeat: 1,
      });

      expect(() =>
        settleHand(round, [{ potId: 'main', winners: ['A'] }]),
      ).toThrowError(EngineError);
    });

    it('rejeita total da mesa acima de MAX_SAFE_INTEGER', () => {
      const huge = Number.MAX_SAFE_INTEGER - 500;

      const round = createCustomRoundState({
        players: [
          { id: 'A', seat: 1, chips: huge, committed: 100 },
          { id: 'B', seat: 2, chips: huge, committed: 100 },
        ],
        pot: 200,
        dealerSeat: 1,
      });

      expect(() =>
        settleHand(round, [{ potId: 'main', winners: ['A'] }]),
      ).toThrowError(EngineError);
    });

    it('rejeita campos conflitantes winners e winnerIds', () => {
      const round = createCustomRoundState({
        players: [
          { id: 'A', seat: 1, chips: 100, committed: 100 },
          { id: 'B', seat: 2, chips: 100, committed: 100 },
        ],
        pot: 200,
        dealerSeat: 1,
      });

      expect(() =>
        settleHand(round, [
          {
            potId: 'main',
            winners: ['A'],
            winnerIds: ['B'],
          },
        ]),
      ).toThrowError(EngineError);
    });
  });

  // 20. Inteiros seguros
  describe('20. Inteiros seguros', () => {
    it('opera estritamente com números inteiros seguros e rejeita entradas inválidas', () => {
      const round = createCustomRoundState({
        players: [
          { id: 'A', seat: 1, chips: 100, committed: 100 },
          { id: 'B', seat: 2, chips: 100, committed: 100 },
        ],
        pot: 200,
        dealerSeat: 1,
      });

      // Decisão com tipo inválido
      // @ts-expect-error teste de robustez em tempo de execução
      expect(() => settleHand(round, null)).toThrowError(EngineError);
      // @ts-expect-error teste de robustez em tempo de execução
      expect(() => settleHand(round, [{ potId: 123, winners: ['A'] }])).toThrowError(
        EngineError,
      );
      expect(() => settleHand(round, [{ potId: 'main', winners: [] }])).toThrowError(
        EngineError,
      );
    });
  });

  // 21. Imutabilidade do estado original
  describe('21. Imutabilidade do estado original', () => {
    it('não mutaciona o RoundState e congela profundamente o SettlementResult', () => {
      const round = createCustomRoundState({
        players: [
          { id: 'A', seat: 1, chips: 100, committed: 100 },
          { id: 'B', seat: 2, chips: 100, committed: 100 },
        ],
        pot: 200,
        dealerSeat: 1,
      });

      const initialChipsA = round.players[0].chips;
      const initialPot = round.pot;

      const settled = settleHand(round, [{ potId: 'main', winners: ['A'] }]);

      // Estado de entrada inalterado
      expect(round.players[0].chips).toBe(initialChipsA);
      expect(round.pot).toBe(initialPot);

      // Objeto de saída congelado
      expect(Object.isFrozen(settled)).toBe(true);
      expect(Object.isFrozen(settled.players)).toBe(true);
      expect(Object.isFrozen(settled.players[0])).toBe(true);
      expect(Object.isFrozen(settled.potAwards)).toBe(true);
      expect(Object.isFrozen(settled.summary)).toBe(true);
    });
  });

  // 22. Determinismo independentemente da ordem das decisões
  describe('22. Determinismo independentemente da ordem das decisões', () => {
    it('produz exatamente os mesmos pagamentos independente da ordem dos potes ou vencedores', () => {
      const round = createCustomRoundState({
        players: [
          { id: 'A', seat: 1, chips: 0, committed: 50, isAllIn: true },
          { id: 'B', seat: 2, chips: 0, committed: 101 },
          { id: 'C', seat: 3, chips: 0, committed: 101 },
        ],
        pot: 252, // Main: 150 (A,B,C), Side: 102 (B,C)
        dealerSeat: 1,
      });

      // Ordem 1: Main pot depois Side pot; Vencedores ['B', 'C']
      const decisions1: PotWinnerDecision[] = [
        { potId: 'side-1', winners: ['B', 'C'] },
        { potId: 'main', winners: ['C', 'A'] },
      ];

      // Ordem 2: Main pot primeiro; Vencedores com ordem invertida
      const decisions2: PotWinnerDecision[] = [
        { potId: 'main', winners: ['A', 'C'] },
        { potId: 'side-1', winners: ['C', 'B'] },
      ];

      const res1 = settleHand(round, decisions1);
      const res2 = settleHand(round, decisions2);

      expect(res1.players).toEqual(res2.players);
      expect(res1.summary).toEqual(res2.summary);
      expect(res1.potAwards).toEqual(res2.potAwards);
    });
  });

  // 23. Rejeição de tentativa de liquidar um resultado já liquidado
  describe('23. Rejeição de tentativa de liquidar um resultado já liquidado', () => {
    it('dispara EngineError com ALREADY_SETTLED se tentar liquidar novamente', () => {
      const round = createCustomRoundState({
        players: [
          { id: 'A', seat: 1, chips: 100, committed: 100 },
          { id: 'B', seat: 2, chips: 100, committed: 100 },
        ],
        pot: 200,
        dealerSeat: 1,
      });

      const settled = settleHand(round, [{ potId: 'main', winners: ['A'] }]);

      // @ts-expect-error teste de robustez em tempo de execução
      expect(() => settleHand(settled, [{ potId: 'main', winners: ['A'] }])).toThrowError(
        EngineError,
      );
    });
  });

  // 24. Atualização correta de stacks anteriormente zerados por all-in
  describe('24. Atualização correta de stacks anteriormente zerados por all-in', () => {
    it('reabilita o status isAllIn para false quando o jogador vence fichas no showdown', () => {
      const round = createCustomRoundState({
        players: [
          { id: 'A', seat: 1, chips: 0, committed: 100, isAllIn: true },
          { id: 'B', seat: 2, chips: 400, committed: 100 },
        ],
        pot: 200,
        dealerSeat: 1,
      });

      const settled = settleHand(round, [{ potId: 'main', winners: ['A'] }]);

      const playerA = settled.players.find(p => p.id === 'A')!;
      expect(playerA.chips).toBe(200);
      expect(playerA.isAllIn).toBe(false); // Agora tem fichas!
      expect(playerA.committed).toBe(0);

      const playerB = settled.players.find(p => p.id === 'B')!;
      expect(playerB.chips).toBe(400);
      expect(playerB.isAllIn).toBe(false);
      expect(playerB.committed).toBe(0);
    });

    it('mantém isAllIn como true se o jogador all-in não receber nenhuma ficha', () => {
      const round = createCustomRoundState({
        players: [
          { id: 'A', seat: 1, chips: 0, committed: 100, isAllIn: true },
          { id: 'B', seat: 2, chips: 400, committed: 100 },
        ],
        pot: 200,
        dealerSeat: 1,
      });

      const settled = settleHand(round, [{ potId: 'main', winners: ['B'] }]);

      const playerA = settled.players.find(p => p.id === 'A')!;
      expect(playerA.chips).toBe(0);
      expect(playerA.isAllIn).toBe(true); // Continua zerado/eliminado
    });
  });

  // Funções utilitárias auxiliares
  describe('Funções utilitárias auxiliares', () => {
    it('getPotsRequiringDecision identifica apenas potes contestados', () => {
      const pots = [
        {
          id: 'main',
          type: 'main' as const,
          index: 0,
          amount: 150,
          contributors: ['p1', 'p2'],
          eligiblePlayers: ['p1', 'p2'],
        },
        {
          id: 'side-1',
          type: 'side' as const,
          index: 1,
          amount: 50,
          contributors: ['p2'],
          eligiblePlayers: ['p2'],
        },
      ];

      expect(requiresDecision(pots[0])).toBe(true);
      expect(requiresDecision(pots[1])).toBe(false);

      const requiring = getPotsRequiringDecision(pots);
      expect(requiring).toHaveLength(1);
      expect(requiring[0].id).toBe('main');

      const single = getPotsWithSingleEligible(pots);
      expect(single).toHaveLength(1);
      expect(single[0].id).toBe('side-1');
    });
  });
});
