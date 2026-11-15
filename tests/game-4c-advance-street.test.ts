import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { useLanGame, waitFor } from './support/lan-game.js';

const g = useLanGame();

describe('Etapa 4C: Avanço Automático de Streets no Modo Físico', () => {
  it('avança automaticamente pelas streets (preflop -> flop -> turn -> river -> showdown) ao concluir cada rodada', async () => {
    await g.setup(2);

    expect(g.state().game?.hand.street).toBe('preflop');
    expect(g.state().game?.hand.canAdvanceStreet).toBe(false);

    // Pré-flop concluído -> avança automaticamente ao Flop
    await g.act('call'); // SB iguala 20
    const flopState = await g.act('check'); // BB fecha rodada
    expect(flopState.game?.hand.street).toBe('flop');
    expect(flopState.game?.hand.canAdvanceStreet).toBe(false);

    // Flop -> Turn
    await g.act('check');
    const turnState = await g.act('check');
    expect(turnState.game?.hand.street).toBe('turn');
    expect(turnState.game?.hand.canAdvanceStreet).toBe(false);

    // Turn -> River
    await g.act('check');
    const riverState = await g.act('check');
    expect(riverState.game?.hand.street).toBe('river');
    expect(riverState.game?.hand.canAdvanceStreet).toBe(false);

    // River -> Showdown
    await g.act('check');
    const showdownState = await g.act('check');
    expect(showdownState.game?.hand.street).toBe('river');
    expect(showdownState.game?.hand.status).toBe('showdown');
    expect(showdownState.game?.hand.canAdvanceStreet).toBe(false);
  });

  it('rejeita advance-street manual enviado por não-anfitrião (FORBIDDEN)', async () => {
    await g.setup(2);
    await g.act('call');
    await g.act('check');
    expect(g.state().game?.hand.street).toBe('flop');
    expect(g.state().game?.hand.canAdvanceStreet).toBe(false);

    const res = await g.command(1, { type: 'advance-street' });
    expect(res).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('rejeita advance-street prematuro quando ainda existem ações pendentes na street (CANNOT_ADVANCE_STREET)', async () => {
    await g.setup(2);
    expect(g.state().game?.hand.canAdvanceStreet).toBe(false);

    const res = await g.command(0, { type: 'advance-street' });
    expect(res).toMatchObject({
      ok: false,
      error: { code: 'CANNOT_ADVANCE_STREET' },
    });
  });

  it('rejeita advance-street com revisão desatualizada (STALE_STATE)', async () => {
    await g.setup(2);
    await g.act('call');
    await g.act('check');

    const staleRev = g.state().revision - 1;
    const res = await g.send(g.sockets[0], {
      type: 'advance-street',
      commandId: randomUUID(),
      expectedRevision: staleRev,
    });
    expect(res).toMatchObject({
      ok: false,
      error: { code: 'STALE_STATE' },
    });
  });

  it('transita diretamente para showdown quando todos os jogadores restantes estão all-in e rejeita avanço posterior', async () => {
    await g.setup(2);
    await g.act('all-in');
    await g.act('all-in');

    const state = g.state();
    expect(state.game?.hand.status).toBe('showdown');
    expect(state.game?.hand.canAdvanceStreet).toBe(false);

    const res = await g.command(0, { type: 'advance-street' });
    expect(res).toMatchObject({
      ok: false,
      error: { code: 'HAND_ALREADY_COMPLETED' },
    });
  });

  it('transita automaticamente para showdown no all-in parcial de múltiplos jogadores sem apostas possíveis', async () => {
    await g.setup(3);
    g.seedStacks([200, 1000, 1800]);

    // Preflop: P0 all-in 200, P1 all-in 1000, P2 call 1000 -> 2 all-in e apenas 1 ativo com fichas -> showdown
    await g.act('all-in');
    await g.act('all-in');
    const showdownState = await g.act('call');

    expect(showdownState.game?.status).toBe('hand-active');
    expect(showdownState.game?.hand.status).toBe('showdown');
    expect(showdownState.game?.hand.pot).toBe(2200);
    expect(showdownState.game?.hand.pots).toHaveLength(2);
  });

  it('difunde o avanço automático de street para todos os clientes conectados', async () => {
    await g.setup(3);
    const observed: number[] = [];
    g.sockets[1].on('room:state', s => {
      if (s.game?.hand.street === 'flop') observed.push(s.revision);
    });

    await g.act('call');
    await g.act('call');
    const flop = await g.act('check');
    expect(flop.game?.hand.street).toBe('flop');

    await waitFor(() => observed.includes(flop.revision));
    const sync1 = await g.sync(g.sockets[1]);
    expect(sync1.game?.hand.street).toBe('flop');
    const sync2 = await g.sync(g.sockets[2]);
    expect(sync2.game?.hand.street).toBe('flop');
  });

  it('avança automaticamente de street quando uma pré-ação conclui a rodada e limpa pré-ações antigas', async () => {
    await g.setup(2);
    const p1Id = g.admissions[1]!.credentials.playerId;

    // P1 (BB) marca pré-ação check antes de P0 agir
    const preSet = await g.command(1, { type: 'set-pre-action', preAction: { type: 'check' } });
    expect(preSet.ok).toBe(true);
    expect(preSet.ok && preSet.data.game?.status === 'hand-active' ? preSet.data.game.preActions?.[p1Id] : undefined).toEqual({
      type: 'check',
    });

    // P0 (SB) iguala 20 -> dispara check automático de P1 -> fecha pré-flop -> avança automaticamente ao Flop!
    const afterCall = await g.act('call');
    expect(afterCall.game?.status).toBe('hand-active');
    expect(afterCall.game?.hand.street).toBe('flop');
    expect(afterCall.game?.hand.pot).toBe(40);
    expect(afterCall.game?.hand.canAdvanceStreet).toBe(false);

    // Pré-ações consumidas/antigas foram limpas na nova street
    const p1Sync = await g.sync(g.sockets[1]);
    expect(p1Sync.game?.status === 'hand-active' ? p1Sync.game.preActions : undefined).toBeUndefined();
  });
});
