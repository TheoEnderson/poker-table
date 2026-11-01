import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ok, useLanGame } from './support/lan-game.js';

const g = useLanGame();

describe('Etapa 4D: Liquidação de Mãos, Distribuição de Potes e Próximas Mãos', () => {
  // 1. Liquidação por Fold
  it('liquida corretamente mão encerrada por fold com decisões vazias', async () => {
    await g.setup(2);
    // P0 é SB (assento 1), P1 é BB (assento 2)
    // P0 dá fold -> mão encerra imediatamente por fold
    await g.act('fold');

    const state = g.state();
    expect(state.game?.status).toBe('hand-active');
    expect(state.game?.hand.status).toBe('hand_ended_by_fold');
    expect(state.game?.hand.survivorId).toBe(g.admissions[1].credentials.playerId);
    expect(state.game?.hand.pots).toHaveLength(1);
    // Com o fold do SB (10), 10 fichas do BB (20) são restituídas (uncalled), restando 20 no pote disputado
    expect(state.game?.hand.pots?.[0].amount).toBe(20);

    // Host liquida a mão
    const settled = await g.settle([]);
    expect(settled.game?.status).toBe('hand-settled');
    if (settled.game?.status === 'hand-settled') {
      expect(settled.game.settlement.summary.totalDistributed).toBe(20);
      const winner = settled.game.settlement.players.find(p => p.id === g.admissions[1].credentials.playerId)!;
      // P1 começou com 1000, postou 20 BB, 10 restituídos + 20 do pote = 1010
      expect(winner.chips).toBe(1010);
      expect(winner.totalWon).toBe(20);

      const loser = settled.game.settlement.players.find(p => p.id === g.admissions[0].credentials.playerId)!;
      // P0 postou 10 SB, deu fold -> 990
      expect(loser.chips).toBe(990);
    }
  });

  // 2. Liquidação de showdown com vencedor único
  it('liquida showdown com vencedor único informado pelo anfitrião', async () => {
    await g.setup(2);
    // Preflop: SB calls 20, BB checks 20
    await g.act('call');
    await g.act('check');
    await g.advance(); // Flop
    await g.act('check');
    await g.act('check');
    await g.advance(); // Turn
    await g.act('check');
    await g.act('check');
    await g.advance(); // River
    await g.act('check');
    await g.act('check');
    await g.advance(); // Showdown

    const showdownState = g.state();
    expect(showdownState.game?.hand.status).toBe('showdown');
    expect(showdownState.game?.hand.pots).toHaveLength(1);
    const mainPot = showdownState.game!.hand.pots![0];
    expect(mainPot.id).toBe('main');
    expect(mainPot.amount).toBe(40);
    expect(mainPot.eligiblePlayers).toHaveLength(2);

    const p0Id = g.admissions[0].credentials.playerId;
    const settled = await g.settle([{ potId: 'main', winners: [p0Id] }]);
    expect(settled.game?.status).toBe('hand-settled');
    if (settled.game?.status === 'hand-settled') {
      const winner = settled.game.settlement.players.find(p => p.id === p0Id)!;
      expect(winner.chips).toBe(1020);
      expect(winner.totalWon).toBe(40);
    }
  });

  // 3. Empate (split pot)
  it('distribui igualmente fichas do pote quando houver empate entre múltiplos vencedores', async () => {
    await g.setup(2);
    await g.act('call');
    await g.act('check');
    await g.advance(); // Flop
    await g.act('check');
    await g.act('check');
    await g.advance(); // Turn
    await g.act('check');
    await g.act('check');
    await g.advance(); // River
    await g.act('check');
    await g.act('check');
    await g.advance(); // Showdown

    const p0Id = g.admissions[0].credentials.playerId;
    const p1Id = g.admissions[1].credentials.playerId;

    // Host informa empate
    const settled = await g.settle([{ potId: 'main', winners: [p0Id, p1Id] }]);
    expect(settled.game?.status).toBe('hand-settled');
    if (settled.game?.status === 'hand-settled') {
      const s0 = settled.game.settlement.players.find(p => p.id === p0Id)!;
      const s1 = settled.game.settlement.players.find(p => p.id === p1Id)!;
      // 40 dividido por 2 = 20 cada (retornam para 1000)
      expect(s0.chips).toBe(1000);
      expect(s1.chips).toBe(1000);
      expect(s0.totalWon).toBe(20);
      expect(s1.totalWon).toBe(20);
    }
  });

  // 4. Side pots e elegibilidade com All-in e contribuições desiguais
  it('projeta potes paralelos e permite liquidação independente de cada pote', async () => {
    // 3 jogadores: P0 (host, assento 1), P1 (assento 2), P2 (assento 3)
    await g.setup(3);
    const p0Id = g.admissions[0].credentials.playerId;
    const p1Id = g.admissions[1].credentials.playerId;
    const p2Id = g.admissions[2].credentials.playerId;

    // Mão 1: reduzimos o stack de P2 para 200 de forma legítima
    // P0 (botão) raises 800, P1 folds, P2 calls 800
    await g.act('raise', 800);
    await g.act('fold');
    await g.act('call');
    await g.advance(); // Flop
    await g.act('fold'); // P2 folds no flop -> P0 vence a Mão 1
    await g.settle([]); // Liquida mão 1
    await g.nextHand(); // Inicia Mão 2

    // Na Mão 2:
    // Dealer é P1 (assento 2). P2 (assento 3) tem stack 200 (postou SB 10 -> resta 190).
    // P0 (assento 1) tem stack 1810 (postou BB 20 -> resta 1790).
    // P1 tem stack 990 (postou 0).
    // Preflop: P1 (botão) raises 500
    await g.act('raise', 500);
    // P2 vai All-in de 190 restantes (total 200)
    await g.act('all-in');
    // P0 calls 500
    await g.act('call');

    // Avança streets até Showdown
    await g.advance(); // Flop
    await g.act('check');
    await g.act('check');
    await g.advance(); // Turn
    await g.act('check');
    await g.act('check');
    await g.advance(); // River
    await g.act('check');
    await g.act('check');
    await g.advance(); // Showdown

    const state = g.state();
    expect(state.game?.hand.status).toBe('showdown');
    expect(state.game?.hand.pot).toBe(1200);

    // Validação estrita de potes múltiplos calculados pelo motor:
    const pots = state.game?.hand.pots;
    expect(pots).toHaveLength(2);

    // Pote Principal: 200 * 3 = 600
    const mainPot = pots![0];
    expect(mainPot.id).toBe('main');
    expect(mainPot.type).toBe('main');
    expect(mainPot.amount).toBe(600);
    expect(mainPot.eligiblePlayers).toHaveLength(3);
    expect(mainPot.eligiblePlayers).toContain(p0Id);
    expect(mainPot.eligiblePlayers).toContain(p1Id);
    expect(mainPot.eligiblePlayers).toContain(p2Id);

    // Pote Secundário 1: (500 - 200) * 2 = 600
    const sidePot = pots![1];
    expect(sidePot.id).toBe('side-1');
    expect(sidePot.type).toBe('side');
    expect(sidePot.amount).toBe(600);
    expect(sidePot.eligiblePlayers).toHaveLength(2);
    expect(sidePot.eligiblePlayers).toContain(p0Id);
    expect(sidePot.eligiblePlayers).toContain(p1Id);
    // P2 NÃO é elegível para side-1
    expect(sidePot.eligiblePlayers).not.toContain(p2Id);

    // Rejeição de participante inelegível para o side pot
    const invalidRes = await g.command(0, {
      type: 'settle-hand',
      decisions: [
        { potId: 'main', winners: [p2Id] },
        { potId: 'side-1', winners: [p2Id] }, // P2 é inelegível!
      ],
    });
    expect(invalidRes).toMatchObject({
      ok: false,
      error: { code: 'INELIGIBLE_WINNER' },
    });

    // Liquidação válida com vencedores distintos por pote:
    // P2 vence o Main Pot (600), P0 vence o Side Pot 1 (600)
    const settled = await g.settle([
      { potId: 'main', winners: [p2Id] },
      { potId: 'side-1', winners: [p0Id] },
    ]);
    expect(settled.game?.status).toBe('hand-settled');

    if (settled.game?.status === 'hand-settled') {
      const { settlement } = settled.game;
      expect(settlement.summary.totalDistributed).toBe(1200);

      // Verificação das premiações discriminadas por pote
      const mainAward = settlement.potAwards.find(pa => pa.potId === 'main')!;
      expect(mainAward.potAmount).toBe(600);
      expect(mainAward.winners).toEqual([p2Id]);
      expect(mainAward.awards).toEqual([{ playerId: p2Id, amount: 600 }]);

      const sideAward = settlement.potAwards.find(pa => pa.potId === 'side-1')!;
      expect(sideAward.potAmount).toBe(600);
      expect(sideAward.winners).toEqual([p0Id]);
      expect(sideAward.awards).toEqual([{ playerId: p0Id, amount: 600 }]);

      // Stacks finais matematicamente conferidos:
      const p2Settled = settlement.players.find(p => p.id === p2Id)!;
      // Começou a mão com 200, colocou 200 no pote, ganhou 600 -> 600
      expect(p2Settled.chips).toBe(600);
      expect(p2Settled.totalWon).toBe(600);

      const p0Settled = settlement.players.find(p => p.id === p0Id)!;
      // Começou a mão com 1810, colocou 500 no pote, ganhou 600 -> 1910
      expect(p0Settled.chips).toBe(1910);
      expect(p0Settled.totalWon).toBe(600);

      const p1Settled = settlement.players.find(p => p.id === p1Id)!;
      // Começou a mão com 990, colocou 500 no pote, ganhou 0 -> 490
      expect(p1Settled.chips).toBe(490);
      expect(p1Settled.totalWon).toBe(0);

      // Conservação estrita do total de fichas da mesa (1000 * 3 = 3000)
      const totalChips = settlement.players.reduce((sum, p) => sum + p.chips, 0);
      expect(totalChips).toBe(3000);
    }
  });

  // 4B. Cenário com pote que possui apenas um jogador elegível
  it('projeta pote secundário com apenas um jogador elegível e aceita decisão pré-selecionada', async () => {
    await g.setup(3);
    const p0Id = g.admissions[0].credentials.playerId;
    const p2Id = g.admissions[2].credentials.playerId;

    // Mão 1: reduz stack de P2 para 200
    await g.act('raise', 800);
    await g.act('fold');
    await g.act('call');
    await g.advance();
    await g.act('fold');
    await g.settle([]);
    await g.nextHand(); // Inicia Mão 2

    // Mão 2:
    // P1 raises 500
    await g.act('raise', 500);
    // P2 All-in 200
    await g.act('all-in');
    // P0 calls 500
    await g.act('call');

    // Flop: P0 aposta 100
    await g.advance();
    await g.act('raise', 100);
    // P1 dá FOLD! P1 agora desistiu
    await g.act('fold');

    // Como P2 está em all-in e P1 deu fold, não há mais jogadores ativos com fichas para apostar
    // O motor transita diretamente para showdown!
    const state = g.state();
    expect(state.game?.hand.status).toBe('showdown');
    expect(state.game?.hand.pots).toHaveLength(2);

    const pots = state.game?.hand.pots;
    expect(pots).toBeDefined();
    if (!pots) throw new Error('Pots missing');
    // Main pot: 200 * 3 = 600 (elegíveis ativos: P2 e P0)
    expect(pots[0].id).toBe('main');
    expect(pots[0].amount).toBe(600);
    expect(pots[0].eligiblePlayers).toHaveLength(2);
    expect(pots[0].eligiblePlayers).toContain(p0Id);
    expect(pots[0].eligiblePlayers).toContain(p2Id);

    // Side pot: (500 - 200) * 2 = 600 (a aposta não coberta de 100 de P0 no flop é restituída via settleUncalled)
    // Como P1 deu fold e P2 só apostou 200, o ÚNICO jogador elegível é P0!
    expect(pots[1].id).toBe('side-1');
    expect(pots[1].amount).toBe(600);
    expect(pots[1].eligiblePlayers).toEqual([p0Id]);

    // Rejeição caso tente declarar P2 (inelegível) como vencedor do side pot
    const invalidRes = await g.command(0, {
      type: 'settle-hand',
      decisions: [
        { potId: 'main', winners: [p2Id] },
        { potId: 'side-1', winners: [p2Id] },
      ],
    });
    expect(invalidRes).toMatchObject({
      ok: false,
      error: { code: 'INELIGIBLE_WINNER' },
    });

    // A decisão com o jogador pré-selecionado pelo motor/UI (P0 no side-1) é aceita
    const settled = await g.settle([
      { potId: 'main', winners: [p2Id] },
      { potId: 'side-1', winners: [p0Id] },
    ]);
    expect(settled.game?.status).toBe('hand-settled');

    if (settled.game?.status === 'hand-settled') {
      const { settlement } = settled.game;
      expect(settlement.summary.totalDistributed).toBe(1200);
      const sideAward = settlement.potAwards.find(pa => pa.potId === 'side-1')!;
      expect(sideAward.winners).toEqual([p0Id]);
      expect(sideAward.awards).toEqual([{ playerId: p0Id, amount: 600 }]);

      const totalChips = settlement.players.reduce((sum, p) => sum + p.chips, 0);
      expect(totalChips).toBe(3000);
    }
  });

  // 5. Conservação de fichas
  it('preserva a conservação matemática exata das fichas da mesa após a liquidação', async () => {
    await g.setup(2);
    const totalBefore = g.state().config.startingChips * 2;

    await g.act('call');
    await g.act('check');
    await g.advance();
    await g.act('check');
    await g.act('check');
    await g.advance();
    await g.act('check');
    await g.act('check');
    await g.advance();
    await g.act('check');
    await g.act('check');
    await g.advance();

    const p0Id = g.admissions[0].credentials.playerId;
    const settled = await g.settle([{ potId: 'main', winners: [p0Id] }]);

    if (settled.game?.status === 'hand-settled') {
      const sumAfter = settled.game.settlement.players.reduce((sum, p) => sum + p.chips, 0);
      expect(sumAfter).toBe(totalBefore);
    }
  });

  // 6. Deduplicação e Idempotência
  it('deduplica comandos settle-hand com mesmo commandId', async () => {
    await g.setup(2);
    await g.act('fold');

    const cmdId = randomUUID();
    const rev = g.state().revision;

    const res1 = ok(await g.send(g.sockets[0], { type: 'settle-hand', decisions: [], commandId: cmdId, expectedRevision: rev }));
    expect(res1.game?.status).toBe('hand-settled');

    // Reenvio com mesmo commandId retorna idempotentemente o mesmo estado sem alterar nada
    const res2 = ok(await g.send(g.sockets[0], { type: 'settle-hand', decisions: [], commandId: cmdId, expectedRevision: rev }));
    expect(res2.game?.status).toBe('hand-settled');
    expect(res2.revision).toBe(res1.revision);
  });

  // 7. Rejeição de STALE_STATE
  it('rejeita settle-hand com revisão desatualizada', async () => {
    await g.setup(2);
    await g.act('fold');

    const res = await g.send(g.sockets[0], {
      type: 'settle-hand',
      decisions: [],
      commandId: randomUUID(),
      expectedRevision: 0, // Incorreto
    });
    expect(res).toMatchObject({
      ok: false,
      error: { code: 'STALE_STATE' },
    });
  });

  // 8. Rejeição por Não-Anfitrião (FORBIDDEN)
  it('rejeita settle-hand e next-hand enviados por participante comum (FORBIDDEN)', async () => {
    await g.setup(2);
    await g.act('fold');

    // Convidado (P1) tenta liquidar
    const settleRes = await g.command(1, { type: 'settle-hand', decisions: [] });
    expect(settleRes).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });

    // Host liquida
    await g.settle([]);

    // Convidado (P1) tenta iniciar próxima mão
    const nextRes = await g.command(1, { type: 'next-hand' });
    expect(nextRes).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  // 9. Rejeição de liquidação duplicada com novo commandId (ALREADY_SETTLED)
  it('rejeita tentativa de liquidar novamente uma mão já liquidada', async () => {
    await g.setup(2);
    await g.act('fold');
    await g.settle([]);

    const res = await g.command(0, { type: 'settle-hand', decisions: [] });
    expect(res).toMatchObject({
      ok: false,
      error: { code: 'ALREADY_SETTLED' },
    });
  });

  // 10. Início de próxima mão (next-hand) e rotação de dealer
  it('inicia próxima mão com rotação correta de dealer, blinds preservados e stacks atualizados', async () => {
    await g.setup(2);
    const hand1Dealer = g.state().game!.hand.dealerSeat;

    await g.act('fold');
    await g.settle([]);

    // Host executa next-hand
    const hand2 = await g.nextHand();
    expect(hand2.game?.status).toBe('hand-active');
    expect(hand2.game?.hand.street).toBe('preflop');

    // Em heads-up, o dealerSeat alterna para o outro jogador
    const hand2Dealer = hand2.game?.hand.dealerSeat;
    expect(hand2Dealer).not.toBe(hand1Dealer);

    // Stacks após blinds postados:
    // P0 tinha 990, agora é BB (20) -> 970
    // P1 tinha 1010, agora é SB/Dealer (10) -> 1000
    const p0 = hand2.game!.hand.players.find(p => p.id === g.admissions[0].credentials.playerId)!;
    const p1 = hand2.game!.hand.players.find(p => p.id === g.admissions[1].credentials.playerId)!;
    expect(p0.chips).toBe(970);
    expect(p0.roundCommitted).toBe(20);
    expect(p1.chips).toBe(1000);
    expect(p1.roundCommitted).toBe(10);
    expect(hand2.game?.hand.pot).toBe(30);
  });

  // 11. Eliminação de jogador e encerramento definitivo (game-complete)
  it('reconhece eliminação de jogador e encerra a partida como game-complete quando restar apenas um com fichas', async () => {
    await g.setup(2);
    // P0 dá all-in de 1000, P1 dá all-in de 1000
    await g.act('all-in');
    await g.act('all-in');

    // Ao irem all-in, o motor transita diretamente para showdown
    const state = g.state();
    expect(state.game?.hand.status).toBe('showdown');

    const p0Id = g.admissions[0].credentials.playerId;
    const p1Id = g.admissions[1].credentials.playerId;

    // P0 vence tudo! P1 fica com 0 fichas (eliminado)
    const settled = await g.settle([{ potId: 'main', winners: [p0Id] }]);
    expect(settled.game?.status).toBe('game-complete');
    if (settled.game?.status === 'game-complete') {
      expect(settled.game.winnerId).toBe(p0Id);
      const champion = settled.game.settlement.players.find(p => p.id === p0Id)!;
      expect(champion.chips).toBe(2000);
      const eliminated = settled.game.settlement.players.find(p => p.id === p1Id)!;
      expect(eliminated.chips).toBe(0);
    }

    // Tentar executar next-hand em partida concluída deve ser rejeitado com GAME_OVER
    const nextRes = await g.command(0, { type: 'next-hand' });
    expect(nextRes).toMatchObject({
      ok: false,
      error: { code: 'GAME_OVER' },
    });
  });

  // 12. Persistência e Recuperação após Reinício
  it('recupera o estado de hand-settled após reinício do servidor', async () => {
    await g.setup(2);
    await g.act('fold');
    await g.settle([]);

    expect(g.state().game?.status).toBe('hand-settled');

    // Reinicia o servidor
    await g.restart();

    // Sincroniza estado após restart
    const synced = await g.sync();
    expect(synced.game?.status).toBe('hand-settled');
    if (synced.game?.status === 'hand-settled') {
      expect(synced.game.settlement.summary.totalDistributed).toBe(20);
    }
  });
});
