import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { advanceStreet, applyHandAction } from '@poker-table/engine';
import { roomStateSchema } from '@poker-table/protocol';
import { config, ok, useLanGame, waitFor } from './support/lan-game.js';

const g = useLanGame();

it('broadcasts the committed snapshot without an additional state read', async () => {
  await g.setup(2);

  const input = await g.envelope(
    { type: 'game-action', action: 'raise', amount: 100 },
    g.sockets[0],
  );

  const observed: ReturnType<typeof g.state>[] = [];
  g.sockets[1].on('room:state', state => observed.push(state));

  const stateRead = vi.spyOn(g.app.rooms, 'state');

  try {
    const confirmed = ok(await g.send(g.sockets[0], input));

    expect(stateRead).toHaveBeenCalledTimes(1);

    await waitFor(() =>
      observed.some(state => state.revision === confirmed.revision),
    );

    expect(
      observed.find(state => state.revision === confirmed.revision),
    ).toEqual(confirmed);

    expect(confirmed.game?.hand.pot).toBe(120);
  } finally {
    stateRead.mockRestore();
  }
});

it('plays a complete hand over Socket.IO through every street and river showdown', async () => {
  await g.setup(3);
  const observed = g.sockets.map(() => [] as number[]);
  g.sockets.forEach((socket, i) => socket.on('room:state', state => observed[i].push(state.revision)));
  await g.act('call'); await g.act('call'); await g.act('check');
  const preflop = g.hand();
  expect(preflop.pot).toBe(60);
  expect(preflop.currentRound.status).toBe('completed');
  expect(await g.command(0, { type: 'game-action', action: 'call' })).toMatchObject({ error: { code: 'ROUND_NOT_ACTIVE' } });
  await g.advance();
  expect(g.hand()).toEqual(advanceStreet(preflop));
  expect(g.hand().players.every(p => p.roundCommitted === 0 && p.totalCommitted === 20)).toBe(true);
  expect(g.hand().currentRound.pot).toBe(60); // Not the sum of current-street contributions.
  expect(g.actorIndex()).toBe(1);
  const flop = g.hand();
  await g.act('raise', 100);
  expect(g.hand()).toEqual(applyHandAction(flop, { playerId: flop.currentActorId!, type: 'raise', amount: 100 }));
  await g.act('call'); await g.act('call');
  for (const street of ['turn', 'river']) {
    await g.advance();
    expect(g.hand().street).toBe(street);
    expect(g.hand().pot).toBe(360);
    expect(g.hand().players.every(p => p.roundCommitted === 0 && p.baseCommitted === 120)).toBe(true);
    await g.act('check'); await g.act('check'); await g.act('check');
  }
  const final = await g.advance();
  expect(final.game!.hand).toMatchObject({ street: 'river', status: 'showdown', pot: 360, currentActorId: null, playersToAct: [] });
  expect(final.game!.hand.players.every(p => p.chips === 880 && p.totalCommitted === 120 && p.roundCommitted === 0)).toBe(true);
  g.assertConserved();
  expect(roomStateSchema.safeParse(final).success).toBe(true);
  await waitFor(() => observed.every(revisions => revisions.at(-1) === final.revision));
  for (const socket of g.sockets) expect(await g.sync(socket)).toEqual(final);
  const json = JSON.stringify(final);
  expect(json).not.toMatch(/Token|hash|session|currentRound|handState|baseCommitted|fingerprint/);
  for (const admission of g.admissions) expect(json).not.toContain(admission.credentials.sessionToken);
  expect(await g.command(0, { type: 'advance-street' })).toMatchObject({ error: { code: 'HAND_ALREADY_COMPLETED' } });
  expect(await g.command(1, { type: 'game-action', action: 'check' })).toMatchObject({ error: { code: 'HAND_ALREADY_COMPLETED' } });
});

it('uses raise amount as the street total, including already committed blinds', async () => {
  await g.setup(2);
  const before = g.hand();
  await g.act('raise', 60);
  expect(g.hand()).toEqual(applyHandAction(before, { playerId: before.currentActorId!, type: 'raise', amount: 60 }));
  expect(g.hand().players[0]).toMatchObject({ chips: 940, roundCommitted: 60, totalCommitted: 60 });
  expect(g.hand().pot).toBe(80);
  g.assertConserved();
});

it('persists folds, refunds uncalled bets and blocks actions after the last opponent folds', async () => {
  await g.setup(2);
  await g.act('raise', 100);
  const before = g.hand();
  await g.act('fold');
  expect(g.hand()).toEqual(applyHandAction(before, { playerId: before.currentActorId!, type: 'fold' }));
  expect(g.hand()).toMatchObject({ status: 'hand_ended_by_fold', pot: 40, currentActorId: null, survivorId: g.host.credentials.playerId });
  expect(g.hand().players[0]).toMatchObject({ chips: 980, totalCommitted: 20 });
  g.assertConserved();
  expect(await g.command(0, { type: 'advance-street' })).toMatchObject({ error: { code: 'HAND_ALREADY_COMPLETED' } });
  expect(await g.command(1, { type: 'game-action', action: 'call' })).toMatchObject({ error: { code: 'HAND_ALREADY_COMPLETED' } });
});

it('preserves folded players across streets without giving them a turn', async () => {
  await g.setup(4);
  const foldedId = g.hand().currentActorId!;
  await g.act('fold'); await g.finishRound(); await g.advance();
  expect(g.hand().players.find(p => p.id === foldedId)?.folded).toBe(true);
  expect(g.hand().playersToAct).not.toContain(foldedId);
  const i = g.admissions.findIndex(a => a.credentials.playerId === foldedId);
  expect(await g.command(i, { type: 'game-action', action: 'check' })).toMatchObject({ error: { code: 'OUT_OF_TURN' } });
});

it('reaches early showdown with exact all-ins without artificial street advances', async () => {
  await g.setup(3);
  for (let i = 0; i < 3; i++) {
    const before = g.hand();
    await g.act('all-in');
    expect(g.hand()).toEqual(applyHandAction(before, { playerId: before.currentActorId!, type: 'all-in' }));
    g.assertConserved();
  }
  expect(g.hand()).toMatchObject({ street: 'preflop', status: 'showdown', pot: 3000 });
  expect(g.hand().players.every(p => p.chips === 0 && p.isAllIn)).toBe(true);
  expect(await g.command(0, { type: 'advance-street' })).toMatchObject({ error: { code: 'HAND_ALREADY_COMPLETED' } });
});

it('preserves a short all-in raise without reopening betting (engine-origin unequal-stack fixture)', async () => {
  await g.setup(); g.seedStacks([1000, 120, 1880]);
  await g.act('raise', 100);
  const before = g.hand(); await g.act('all-in');
  expect(g.hand()).toEqual(applyHandAction(before, { playerId: before.currentActorId!, type: 'all-in' }));
  expect(g.hand().currentRound).toMatchObject({ currentBet: 120, minRaiseIncrement: 80 });
  await g.act('call');
  expect(await g.command(0, { type: 'game-action', action: 'raise', amount: 200 })).toMatchObject({ error: { code: 'ACTION_NOT_REOPENED' } });
  await g.act('call'); await g.advance();
  expect(g.hand().players[1].isAllIn).toBe(true);
  expect(g.hand().playersToAct).not.toContain(g.admissions[1].credentials.playerId);
  expect(await g.command(1, { type: 'game-action', action: 'call' })).toMatchObject({ error: { code: 'OUT_OF_TURN' } });
  g.assertConserved();
});

it('reopens betting after a full all-in raise (engine-origin unequal-stack fixture)', async () => {
  await g.setup(); g.seedStacks([1000, 300, 1700]);
  await g.act('raise', 100); await g.act('all-in'); await g.act('call');
  expect(g.hand().currentRound).toMatchObject({ currentBet: 300, minRaiseIncrement: 200 });
  await g.act('raise', 500); await g.act('call');
  expect(g.hand().pot).toBe(1300);
  g.assertConserved();
});

it('accepts an all-in below call and refunds uncalled chips (engine-origin unequal-stack fixture)', async () => {
  await g.setup(); g.seedStacks([1000, 60, 1940]);
  await g.act('raise', 100); await g.act('all-in');
  expect(g.hand().players[1]).toMatchObject({ chips: 0, totalCommitted: 60, isAllIn: true });
  const before = g.hand(); await g.act('fold');
  expect(g.hand()).toEqual(applyHandAction(before, { playerId: before.currentActorId!, type: 'fold' }));
  expect(g.hand()).toMatchObject({ status: 'showdown', pot: 140 });
  expect(g.hand().players[0]).toMatchObject({ chips: 940, totalCommitted: 60 });
  g.assertConserved();
});

it.each(['fold', 'check', 'call', 'raise', 'all-in'])('deduplicates %s and rejects an ID reused with another payload', async action => {
  await g.setup();
  if (action === 'check') { await g.act('call'); await g.act('call'); }
  const socket = g.sockets[g.actorIndex()];
  const input = await g.envelope({ type: 'game-action', action, ...(action === 'raise' ? { amount: 100 } : {}) }, socket);
  const first = ok(await g.send(socket, input)), raw = g.raw();
  expect(ok(await g.send(socket, input))).toEqual(first);
  expect(g.raw()).toBe(raw);
  expect(await g.send(socket, { ...input, action: action === 'fold' ? 'call' : 'fold', amount: undefined })).toMatchObject({ error: { code: 'COMMAND_CONFLICT' } });
  g.assertConserved();
});

it('deduplicates advances without skipping streets and rejects early or non-admin advances', async () => {
  await g.setup();
  expect(await g.command(0, { type: 'advance-street' })).toMatchObject({ error: { code: 'CANNOT_ADVANCE_STREET' } });
  await g.finishRound();
  expect(await g.command(1, { type: 'advance-street' })).toMatchObject({ error: { code: 'FORBIDDEN' } });
  const noAdmin = await g.connect({ ...g.host.credentials, adminToken: undefined });
  expect(await g.send(noAdmin, await g.envelope({ type: 'advance-street' }, noAdmin))).toMatchObject({ error: { code: 'FORBIDDEN' } });
  const input = await g.envelope({ type: 'advance-street' });
  const first = ok(await g.send(g.sockets[0], input));
  expect(ok(await g.send(g.sockets[0], input))).toEqual(first);
  expect(g.hand().street).toBe('flop');
  expect(await g.command(0, { type: 'advance-street' })).toMatchObject({ error: { code: 'CANNOT_ADVANCE_STREET' } });
});

it('rejects out-of-turn actions including the host, unseated players and unknown games', async () => {
  await g.setup(3, false);
  expect(await g.command(0, { type: 'game-action', action: 'call' })).toMatchObject({ error: { code: 'GAME_NOT_STARTED' } });
  expect(await g.command(0, { type: 'advance-street' })).toMatchObject({ error: { code: 'GAME_NOT_STARTED' } });
  const waiting = g.app.rooms.join(g.host.room.code, { name: 'Waiting' }), socket = await g.connect(waiting.credentials);
  ok(await g.command(0, { type: 'start-game' }));
  expect(await g.send(socket, await g.envelope({ type: 'game-action', action: 'call' }, socket))).toMatchObject({ error: { code: 'FORBIDDEN' } });
  expect(await g.command(1, { type: 'game-action', action: 'call' })).toMatchObject({ error: { code: 'OUT_OF_TURN' } });
  await g.act('call');
  expect(await g.command(0, { type: 'game-action', action: 'call' })).toMatchObject({ error: { code: 'OUT_OF_TURN' } });
});

it('rejects unauthenticated, forged and cross-room actions without touching the target hand', async () => {
  await g.setup();
  const other = g.app.rooms.create({ hostName: 'Other', config });
  const outsider = await g.connect(other.credentials);
  const before = g.state();
  for (const credentials of [undefined, { ...g.host.credentials, sessionToken: '0'.repeat(64) }, { ...other.credentials, roomId: g.roomId }, { ...g.admissions[1].credentials, playerId: g.host.credentials.playerId }]) {
    const client = g.client(credentials);
    const error = await new Promise<Error & { data?: { code: string } }>(resolve => { client.once('connect_error', resolve); client.connect(); });
    expect(['INVALID_INPUT', 'UNAUTHORIZED']).toContain(error.data?.code);
    client.disconnect();
  }
  expect(await g.send(outsider, await g.envelope({ type: 'game-action', action: 'call' }, outsider))).toMatchObject({ error: { code: 'GAME_NOT_STARTED' } });
  expect(await g.send(outsider, await g.envelope({ type: 'game-action', action: 'call', roomId: g.roomId }, outsider))).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  expect(g.state()).toEqual(before);
});

it.each([
  { action: 'raise' }, { action: 'raise', amount: 0 }, { action: 'raise', amount: -1 },
  { action: 'raise', amount: 1.5 }, { action: 'raise', amount: NaN }, { action: 'raise', amount: Infinity },
  { action: 'raise', amount: Number.MAX_SAFE_INTEGER + 1 }, { action: 'call', amount: 20 },
  ...['playerId', 'roomId', 'chips', 'pot', 'currentActorId', 'isHost'].map(key => ({ action: 'call', [key]: randomUUID() })),
])('rejects malformed or authority-injecting action %j without writes or broadcasts', async payload => {
  await g.setup();
  const before = g.state(), raw = g.raw(); let broadcasts = 0;
  g.sockets[0].on('room:state', () => broadcasts++);
  expect(await g.command(0, { type: 'game-action', ...payload })).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  expect(await g.sync()).toEqual(before); expect(g.raw()).toBe(raw); expect(broadcasts).toBe(0);
});

it.each([
  [{ action: 'check' }, 'CANNOT_CHECK'],
  [{ action: 'raise', amount: 20 }, 'INVALID_RAISE_AMOUNT'],
  [{ action: 'raise', amount: 21 }, 'INVALID_RAISE_AMOUNT'],
  [{ action: 'raise', amount: 1001 }, 'INSUFFICIENT_CHIPS'],
] as const)('maps engine rejection %j to %s without modifying authoritative state', async (action, code) => {
  await g.setup();
  const before = g.state(), raw = g.raw();
  expect(await g.command(0, { type: 'game-action', ...action })).toMatchObject({ error: { code } });
  expect(g.state()).toEqual(before); expect(g.raw()).toBe(raw);
});
