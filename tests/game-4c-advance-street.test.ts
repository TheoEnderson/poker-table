import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ok, useLanGame, waitFor } from './support/lan-game.js';

const g = useLanGame();

describe('Etapa 4C: Avanço de Streets e Controles do Anfitrião', () => {
  it('permite ao anfitrião avançar pelas streets (flop -> turn -> river -> showdown) quando a rodada está concluída', async () => {
    await g.setup(2);

    // Pré-flop: antes das apostas, canAdvanceStreet deve ser false
    expect(g.state().game?.hand.canAdvanceStreet).toBe(false);

    await g.act('call'); // SB iguala 20
    await g.act('check'); // BB passa a vez (20 já investidos)

    // Rodada concluída: canAdvanceStreet torna-se true
    expect(g.state().game?.hand.canAdvanceStreet).toBe(true);
    expect(g.state().game?.hand.street).toBe('preflop');

    // Host avança para Flop
    const flopState = ok(await g.command(0, { type: 'advance-street' }));
    expect(flopState.game?.hand.street).toBe('flop');
    expect(flopState.game?.hand.canAdvanceStreet).toBe(false);

    // Flop: ambos dão check
    await g.act('check');
    await g.act('check');
    expect(g.state().game?.hand.canAdvanceStreet).toBe(true);

    // Host avança para Turn
    const turnState = ok(await g.command(0, { type: 'advance-street' }));
    expect(turnState.game?.hand.street).toBe('turn');
    expect(turnState.game?.hand.canAdvanceStreet).toBe(false);

    // Turn: ambos dão check
    await g.act('check');
    await g.act('check');
    expect(g.state().game?.hand.canAdvanceStreet).toBe(true);

    // Host avança para River
    const riverState = ok(await g.command(0, { type: 'advance-street' }));
    expect(riverState.game?.hand.street).toBe('river');
    expect(riverState.game?.hand.canAdvanceStreet).toBe(false);

    // River: ambos dão check
    await g.act('check');
    await g.act('check');
    expect(g.state().game?.hand.canAdvanceStreet).toBe(true);

    // Host avança para Showdown
    const showdownState = ok(await g.command(0, { type: 'advance-street' }));
    expect(showdownState.game?.hand.status).toBe('showdown');
    expect(showdownState.game?.hand.canAdvanceStreet).toBe(false);
  });

  it('rejeita avanço de street enviado por participante que não é anfitrião (FORBIDDEN)', async () => {
    await g.setup(2);
    await g.act('call');
    await g.act('check');
    expect(g.state().game?.hand.canAdvanceStreet).toBe(true);

    // Jogador 1 (convidado) tenta avançar
    const res = await g.command(1, { type: 'advance-street' });
    expect(res).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('rejeita avanço prematuro quando ainda existem ações pendentes na street (CANNOT_ADVANCE_STREET)', async () => {
    await g.setup(2);
    // No início do pré-flop, SB ainda não agiu
    expect(g.state().game?.hand.canAdvanceStreet).toBe(false);

    const res = await g.command(0, { type: 'advance-street' });
    expect(res).toMatchObject({
      ok: false,
      error: { code: 'CANNOT_ADVANCE_STREET' },
    });
  });

  it('deduplica comandos advance-street idempotentemente com mesmo commandId', async () => {
    await g.setup(2);
    await g.act('call');
    await g.act('check');

    const cmdId = randomUUID();
    const rev = g.state().revision;

    const res1 = ok(await g.send(g.sockets[0], { type: 'advance-street', commandId: cmdId, expectedRevision: rev }));
    expect(res1.game?.hand.street).toBe('flop');

    // Reenvio com mesmo commandId não avança uma segunda street
    const res2 = ok(await g.send(g.sockets[0], { type: 'advance-street', commandId: cmdId, expectedRevision: rev }));
    expect(res2.game?.hand.street).toBe('flop');
    expect(res2.revision).toBe(res1.revision);
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
    // Ambos vão all-in no pré-flop
    await g.act('all-in');
    await g.act('all-in');

    const state = g.state();
    expect(state.game?.hand.status).toBe('showdown');
    expect(state.game?.hand.canAdvanceStreet).toBe(false);

    // Como já está em showdown, tentativa de avanço deve falhar com HAND_ALREADY_COMPLETED
    const res = await g.command(0, { type: 'advance-street' });
    expect(res).toMatchObject({
      ok: false,
      error: { code: 'HAND_ALREADY_COMPLETED' },
    });
  });

  it('difunde o estado atualizado da street para todos os clientes conectados', async () => {
    await g.setup(3);
    const observed: number[] = [];
    g.sockets[1].on('room:state', s => {
      if (s.game?.hand.street === 'flop') observed.push(s.revision);
    });

    // Finaliza pré-flop
    await g.act('call');
    await g.act('call');
    await g.act('check');

    const flop = ok(await g.command(0, { type: 'advance-street' }));
    expect(flop.game?.hand.street).toBe('flop');

    await waitFor(() => observed.includes(flop.revision));
    const sync1 = await g.sync(g.sockets[1]);
    expect(sync1.game?.hand.street).toBe('flop');
    const sync2 = await g.sync(g.sockets[2]);
    expect(sync2.game?.hand.street).toBe('flop');
  });
});

