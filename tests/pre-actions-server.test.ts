import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Reply, RoomState } from '@poker-table/protocol';
import { ok, useLanGame, waitFor } from './support/lan-game.js';

const g = useLanGame();

describe('Server-authoritative Pre-Actions & Call <valor>', () => {
  it('selects Call <valor>, preserves on matching calls, and auto-executes when turn arrives', async () => {
    await g.setup(3);
    // 3 jogadores: P0 (Dealer/UTG, seat 1), P1 (SB 10, seat 2), P2 (BB 20, seat 3).
    // Turno inicial é P0.
    expect(g.hand().currentActorId).toBe(g.admissions[0].credentials.playerId);

    // P0 dá raise para 60 -> turno passa para P1 (SB committed 10, toCall = 50).
    await g.act('raise', 60);
    expect(g.hand().currentActorId).toBe(g.admissions[1].credentials.playerId);

    const p2Id = g.admissions[2].credentials.playerId;
    // P2 (BB committed 20) vê toCall = 40 e seleciona Call 40.
    const selectedState = ok(
      await g.command(2, { type: 'set-pre-action', preAction: { type: 'call', amount: 40 } }),
    );
    expect(selectedState.game?.status).toBe('hand-active');
    if (selectedState.game?.status === 'hand-active') {
      expect(selectedState.game.preActions).toEqual({ [p2Id]: { type: 'call', amount: 40 } });
    }

    // P1 paga 60 -> turno passa para P2, que auto-executa Call 40 e limpa pré-ação.
    const afterP1Call = ok(
      await g.command(1, { type: 'game-action', action: 'call' }),
    );
    expect(afterP1Call.game?.status).toBe('hand-active');
    if (afterP1Call.game?.status === 'hand-active') {
      expect(afterP1Call.game.preActions).toBeUndefined();
    }

    const hand = g.hand();
    expect(hand.currentRound.status).toBe('completed');
    expect(hand.pot).toBe(180);
    expect(hand.players[2].roundCommitted).toBe(60);
    expect(hand.players[2].chips).toBe(940);
    expect(hand.actions?.at(-1)).toMatchObject({
      playerId: p2Id,
      type: 'call',
      amount: 40,
      roundCommitted: 60,
    });
    g.assertConserved();
  });

  it('rejects stale Call amount (race condition) without mutating pre-actions', async () => {
    await g.setup(3);
    const p1Id = g.admissions[1].credentials.playerId;

    // Antes da ação de P0, P1 captura revisão antiga com toCall = 10.
    const oldSync = await g.sync();

    // P0 aumenta para 80 enquanto P1 tenta enviar Call 10.
    const raisedState = await g.act('raise', 80);

    // 1) Com revisão antiga -> STALE_STATE
    const staleRevReply = await g.send(g.sockets[1], {
      type: 'set-pre-action',
      preAction: { type: 'call', amount: 10 },
      commandId: randomUUID(),
      expectedRevision: oldSync.revision,
    });
    expect(staleRevReply).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });

    // 2) Agora é a vez de P1 -> rejeita selecionar pré-ação no próprio turno (INVALID_ACTION)
    const ownTurnReply = await g.send(g.sockets[1], {
      type: 'set-pre-action',
      preAction: { type: 'call', amount: 70 },
      commandId: randomUUID(),
      expectedRevision: raisedState.revision,
    });
    expect(ownTurnReply).toMatchObject({ ok: false, error: { code: 'INVALID_ACTION' } });

    // 3) P2 (BB 20, fora da vez) vê toCall = 60; se enviar amount errado (40) na revisão atual -> STALE_STATE
    const p2WrongReply = await g.send(g.sockets[2], {
      type: 'set-pre-action',
      preAction: { type: 'call', amount: 40 },
      commandId: randomUUID(),
      expectedRevision: raisedState.revision,
    });
    expect(p2WrongReply).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });

    const synced = await g.sync();
    if (synced.game?.status === 'hand-active') {
      expect(synced.game.preActions).toBeUndefined();
    }
    expect(g.hand().currentActorId).toBe(p1Id);
  });

  it('automatically invalidates Call X when an opponent re-raises above X before turn arrives', async () => {
    await g.setup(4);
    // 4 jogadores: P0 (Dealer/seat 1), P1 (SB 10/seat 2), P2 (BB 20/seat 3), P3 (UTG/seat 4).
    // Ordem pré-flop: P3 -> P0 -> P1 -> P2.
    expect(g.hand().currentActorId).toBe(g.admissions[3].credentials.playerId);

    // P3 dá raise para 60 -> turno vai para P0.
    await g.act('raise', 60);
    expect(g.hand().currentActorId).toBe(g.admissions[0].credentials.playerId);

    const p2Id = g.admissions[2].credentials.playerId;
    // P2 (BB 20) marca Call 40.
    ok(await g.command(2, { type: 'set-pre-action', preAction: { type: 'call', amount: 40 } }));

    // P0 dá re-raise para 140 -> turno vai para P1, toCall de P2 sobe para 120 (> 40).
    const afterReRaise = ok(await g.command(0, { type: 'game-action', action: 'raise', amount: 140 }));
    if (afterReRaise.game?.status === 'hand-active') {
      expect(afterReRaise.game.preActions).toBeUndefined();
    }

    // P1 dá fold -> vez chega em P2, mas P2 NÃO dá auto-call (precisa agir manualmente).
    const atP2Turn = ok(await g.command(1, { type: 'game-action', action: 'fold' }));
    expect(atP2Turn.game?.status).toBe('hand-active');
    if (atP2Turn.game?.status === 'hand-active') {
      expect(atP2Turn.game.hand.currentActorId).toBe(p2Id);
      expect(atP2Turn.game.hand.allowedActions?.callAmount).toBe(120);
      expect(atP2Turn.game.hand.players.find(p => p.id === p2Id)?.roundCommitted).toBe(20);
    }
    g.assertConserved();
  });

  it('auto-executes all-in call when short-stack (stack < bet) marked Call <stack>', async () => {
    await g.setup(4, false);
    // 4 jogadores (ordem pré-flop P3 -> P0 -> P1 -> P2), total 4000:
    // P0=1500, P1=1430, P2=70 (BB=20 -> sobra 50 de stack), P3=1000.
    g.seedStacks([1500, 1430, 70, 1000]);

    const p2Id = g.admissions[2].credentials.playerId;
    // P3 dá raise para 100 -> turno em P0.
    await g.act('raise', 100);

    // Para P2 (committed 20, chips 50): toCall = 80, min(80, 50) = 50.
    const selected = ok(await g.command(2, { type: 'set-pre-action', preAction: { type: 'call', amount: 50 } }));
    if (selected.game?.status === 'hand-active') {
      expect(selected.game.preActions).toEqual({ [p2Id]: { type: 'call', amount: 50 } });
    }

    // P0 dá re-raise para 200 -> turno vai para P1; como min(toCall=180, stack=50) segue 50,
    // a pré-ação all-in Call 50 de P2 permanece válida enquanto P1 pensa.
    const afterReRaise = ok(await g.command(0, { type: 'game-action', action: 'raise', amount: 200 }));
    expect(afterReRaise.game?.status).toBe('hand-active');
    if (afterReRaise.game?.status === 'hand-active') {
      expect(afterReRaise.game.hand.currentActorId).toBe(g.admissions[1].credentials.playerId);
      expect(afterReRaise.game.preActions).toEqual({ [p2Id]: { type: 'call', amount: 50 } });
    }

    // P1 paga 200 -> turno passa para P2, que executa automaticamente all-in de 50 e limpa pré-ação!
    await g.act('call');
    await g.act('call'); // P3 paga 200 encerrando a rodada.
    const hand = g.hand();
    const p2 = hand.players.find(p => p.id === p2Id)!;
    expect(p2.chips).toBe(0);
    expect(p2.isAllIn).toBe(true);
    expect(p2.totalCommitted).toBe(70);
    expect(hand.pot).toBe(670);
    expect(hand.currentRound.status).toBe('completed');
    g.assertConserved();
  });

  it('invalidates Check on bet while keeping Check/Fold to fold on bet', async () => {
    await g.setup(4);
    // Ordem pré-flop: P3 -> P0 -> P1 -> P2. BB (P2) começa com toCall = 0.
    const p2Id = g.admissions[2].credentials.playerId;
    const p1Id = g.admissions[1].credentials.playerId;

    // P2 marca Check (toCall === 0) e P1 marca Check/Fold (toCall = 10 no SB).
    ok(await g.command(2, { type: 'set-pre-action', preAction: { type: 'check' } }));
    ok(await g.command(1, { type: 'set-pre-action', preAction: { type: 'check-fold' } }));

    // P3 aumenta para 60 -> Check de P2 deve ser invalidado, Check/Fold de P1 deve permanecer.
    const afterBet = await g.act('raise', 60);
    if (afterBet.game?.status === 'hand-active') {
      expect(afterBet.game.preActions).toEqual({ [p1Id]: { type: 'check-fold' } });
    }

    // P0 paga 60 -> passa automaticamente por P1 que dá Fold via Check/Fold, e para manualmente em P2!
    const atP2 = await g.act('call');
    expect(atP2.game?.status).toBe('hand-active');
    if (atP2.game?.status === 'hand-active') {
      expect(atP2.game.hand.currentActorId).toBe(p2Id);
      expect(atP2.game.preActions).toBeUndefined();
      expect(atP2.game.hand.players.find(p => p.id === p1Id)?.folded).toBe(true);
    }
    g.assertConserved();
  });

  it('persists pre-actions compatibly across SQLite server restart, rejects corrupted DB preActions, and clears on player disconnect', async () => {
    await g.setup(3);
    const p1Id = g.admissions[1].credentials.playerId;
    const p2Id = g.admissions[2].credentials.playerId;

    // Seleciona Call 10 para P1 e Check para P2 antes do primeiro game-action (v1 inclusive)
    ok(await g.command(1, { type: 'set-pre-action', preAction: { type: 'call', amount: 10 } }));
    const beforeRestart = ok(await g.command(2, { type: 'set-pre-action', preAction: { type: 'check' } }));

    // Reinício gracioso do servidor preserva preActions no SQLite
    const resumed = await g.restart();
    expect(resumed.game).toEqual(beforeRestart.game);
    if (resumed.game?.status === 'hand-active') {
      expect(resumed.game.preActions).toEqual({
        [p1Id]: { type: 'call', amount: 10 },
        [p2Id]: { type: 'check' },
      });
    }

    // Desconexão de P1 enquanto servidor está ativo descarta apenas a pré-ação de P1
    g.sockets[1].disconnect();
    await waitFor(() => !g.state().players.find(p => p.id === p1Id)!.connected);
    const afterDisconnect = await g.sync();
    if (afterDisconnect.game?.status === 'hand-active') {
      expect(afterDisconnect.game.preActions).toEqual({ [p2Id]: { type: 'check' } });
    }

    // Estado corrompido em preActions no SQLite (ex.: Call com valor inválido) gera STORAGE_ERROR
    const saved = JSON.parse(g.raw()) as Record<string, unknown>;
    saved.preActions = { [p2Id]: { type: 'call', amount: 999 } };
    g.app.store.db.prepare('UPDATE rooms SET game=? WHERE id=?').run(JSON.stringify(saved), g.roomId);
    const corruptReply = await new Promise<Reply<RoomState>>(resolve =>
      g.sockets[0].emit('room:sync', resolve),
    );
    expect(corruptReply).toMatchObject({ error: { code: 'STORAGE_ERROR' } });
  });
});
