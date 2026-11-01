import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { HandFlowState } from '@poker-table/engine';
import type { Reply, RoomState } from '@poker-table/protocol';
import { ok, useLanGame, waitFor } from './support/lan-game.js';

const g = useLanGame();

it.each(['preflop', 'flop', 'turn', 'river', 'fold', 'showdown'])('recovers %s without replaying actions or changing financial state', async target => {
  await g.setup(2);
  if (target !== 'preflop' && target !== 'fold') {
    await g.finishRound(); await g.advance();
    if (target !== 'flop') {
      await g.finishRound(); await g.advance();
      if (target !== 'turn') { await g.finishRound(); await g.advance(); }
    }
  }
  const socket = g.sockets[g.actorIndex()];
  const input = await g.envelope({ type: 'game-action', action: target === 'fold' ? 'fold' : target === 'showdown' ? 'check' : 'raise', ...(['fold', 'showdown'].includes(target) ? {} : { amount: 100 }) }, socket);
  ok(await g.send(socket, input));
  if (target === 'showdown') { await g.finishRound(); await g.advance(); }
  const before = await g.sync(), raw = g.raw();
  expect(JSON.parse(raw).version).toBe(2);
  const resumed = await g.restart();
  expect(resumed.game).toEqual(before.game);
  expect(resumed.revision).toBeGreaterThan(before.revision);
  expect(g.raw()).toBe(raw);
  expect(ok(await g.send(socket, input))).toEqual(resumed);
  expect(g.raw()).toBe(raw);
  const hand = g.hand();
  expect(Object.isFrozen(hand)).toBe(true);
  expect(Object.isFrozen(hand.players[0])).toBe(true);
  expect(Object.isFrozen(hand.currentRound.players)).toBe(true);
  g.assertConserved();
  if (target !== 'fold' && target !== 'showdown') { await g.act('call'); g.assertConserved(); }
});

it.each(['fold', 'call', 'raise', 'all-in', 'advance-street'])('preserves durable deduplication of %s after restart', async action => {
  await g.setup();
  if (action === 'advance-street') await g.finishRound();
  const socket = action === 'advance-street' ? g.sockets[0] : g.sockets[g.actorIndex()];
  const input = await g.envelope(action === 'advance-street' ? { type: action } : { type: 'game-action', action, ...(action === 'raise' ? { amount: 100 } : {}) }, socket);
  ok(await g.send(socket, input));
  const raw = g.raw(), state = await g.restart();
  expect(ok(await g.send(socket, input))).toEqual(state);
  expect(g.raw()).toBe(raw);
  expect(await g.send(socket, { commandId: input.commandId, expectedRevision: state.revision, type: 'rename', name: 'Conflict' })).toMatchObject({ error: { code: 'COMMAND_CONFLICT' } });
});

it('reads a 3A v1 hand unchanged and upgrades only after a committed poker transition', async () => {
  await g.setup();
  const raw = g.raw();
  expect(JSON.parse(raw).version).toBe(1);
  await g.restart();
  expect(g.raw()).toBe(raw);
  expect(await g.command(0, { type: 'game-action', action: 'check' })).toMatchObject({ error: { code: 'CANNOT_CHECK' } });
  expect(g.raw()).toBe(raw);
  await g.act('call');
  expect(JSON.parse(g.raw()).version).toBe(2);
  expect(g.app.store.db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 2 });
});

it('keeps the disconnected actor and hand until the original session reconnects', async () => {
  await g.setup(); await g.act('call');
  const actor = g.actorIndex(), id = g.admissions[actor].credentials.playerId;
  const before = g.state();
  g.sockets[actor].disconnect();
  await waitFor(() => !g.state().players.find(p => p.id === id)!.connected);
  expect((await g.sync()).game).toEqual(before.game);
  expect(g.hand().currentActorId).toBe(id);
  expect(await g.command(0, { type: 'game-action', action: 'call' })).toMatchObject({ error: { code: 'OUT_OF_TURN' } });
  expect(await g.command(0, { type: 'advance-street' })).toMatchObject({ error: { code: 'CANNOT_ADVANCE_STREET' } });
  g.sockets[actor].connect();
  await waitFor(() => g.sockets[actor].connected && g.state().players.find(p => p.id === id)!.connected);
  expect((await g.sync(g.sockets[actor])).game).toEqual(before.game);
  await g.act('call'); g.assertConserved();
});

it.each([false, true])('serializes concurrent actions in two tabs (identical command: %s)', async identical => {
  await g.setup();
  const second = await g.connect(g.host.credentials);
  const before = g.state(), input = await g.envelope({ type: 'game-action', action: 'raise', amount: 100 });
  const results = await Promise.all([
    g.send(g.sockets[0], input),
    g.send(second, identical ? input : { ...input, commandId: randomUUID() }),
  ]);
  expect(results.filter(r => r.ok)).toHaveLength(identical ? 2 : 1);
  if (!identical) expect(results.find(r => !r.ok)).toMatchObject({ error: { code: 'STALE_STATE' } });
  expect(g.state().revision).toBe(before.revision + 1);
  expect(g.hand().pot).toBe(130);
  g.assertConserved();
});

it('serializes concurrent advances without skipping a street', async () => {
  await g.setup(); await g.finishRound();
  const second = await g.connect(g.host.credentials), input = await g.envelope({ type: 'advance-street' });
  const results = await Promise.all([g.send(g.sockets[0], input), g.send(second, { ...input, commandId: randomUUID() })]);
  expect(results.filter(r => r.ok)).toHaveLength(1);
  expect(g.hand().street).toBe('flop');
});

it.each(['game', 'command', 'revision'])('rolls back a poker action when writing %s fails, allowing a safe retry', async stage => {
  await g.setup();
  const before = g.state(), raw = g.raw(), input = await g.envelope({ type: 'game-action', action: 'raise', amount: 100 });
  const target = stage === 'game' ? 'UPDATE OF game ON rooms' : stage === 'command' ? 'INSERT ON commands' : 'UPDATE OF revision ON rooms';
  g.app.store.db.exec(`CREATE TRIGGER fail_action BEFORE ${target} BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
  let broadcasts = 0; g.sockets[0].on('room:state', () => broadcasts++);
  expect(await g.send(g.sockets[0], input)).toMatchObject({ error: { code: 'STORAGE_ERROR' } });
  expect(await g.sync()).toEqual(before); expect(g.raw()).toBe(raw); expect(broadcasts).toBe(0);
  expect(g.app.store.db.prepare('SELECT * FROM commands WHERE command_id=?').get(input.commandId)).toBeUndefined();
  g.app.store.db.exec('DROP TRIGGER fail_action');
  ok(await g.send(g.sockets[0], input));
  expect(g.hand().pot).toBe(130); g.assertConserved();
});

it('rolls back a failed street transition without losing cumulative contributions', async () => {
  await g.setup(); await g.finishRound();
  const before = g.state(), raw = g.raw(), input = await g.envelope({ type: 'advance-street' });
  g.app.store.db.exec("CREATE TRIGGER fail_advance BEFORE INSERT ON commands BEGIN SELECT RAISE(ABORT, 'injected'); END");
  expect(await g.send(g.sockets[0], input)).toMatchObject({ error: { code: 'STORAGE_ERROR' } });
  expect(g.state()).toEqual(before); expect(g.raw()).toBe(raw);
  g.app.store.db.exec('DROP TRIGGER fail_advance');
  ok(await g.send(g.sockets[0], input));
  expect(g.hand().pot).toBe(60);
});

type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
it('reports corrupted stored configuration as storage failure, not invalid player input', async () => {
  await g.setup(); await g.act('call');
  const state = g.state(), raw = g.raw();
  g.app.store.db.prepare('UPDATE rooms SET config=? WHERE id=?').run(JSON.stringify({ ...state.config, bigBlind: -1 }), g.roomId);
  expect(await g.send(g.sockets[1], { type: 'game-action', action: 'call', commandId: randomUUID(), expectedRevision: state.revision })).toMatchObject({ error: { code: 'STORAGE_ERROR' } });
  expect(g.raw()).toBe(raw);
  expect(g.app.store.db.prepare('SELECT revision FROM rooms WHERE id=?').get(g.roomId)).toMatchObject({ revision: state.revision });
});

const corruptions: [string, (hand: Mutable<HandFlowState>) => void][] = [
  ['pot', h => h.pot++], ['round pot', h => h.currentRound.pot++],
  ['chips', h => h.players[0].chips++], ['total contribution', h => h.players[0].totalCommitted++],
  ['street contribution', h => h.players[0].roundCommitted++], ['base contribution', h => h.players[0].baseCommitted++],
  ['round player', h => h.currentRound.players[0].chips++],
  ['duplicate identity', h => { h.players[0].id = h.players[1].id; }],
  ['duplicate seat', h => { h.players[0].seat = h.players[1].seat; }],
  ['fold flag', h => { h.players[0].folded = true; }],
  ['all-in flag', h => { h.players[0].isAllIn = true; }],
  ['actor', h => { h.currentActorId = randomUUID(); }],
  ['queue', h => { h.currentRound.playersToAct.push(h.currentRound.playersToAct[0]); }],
  ['hand status', h => { h.status = 'showdown'; }],
  ['round status', h => { h.currentRound.status = 'completed'; }],
  ['survivor', h => { h.survivorId = h.players[0].id; }],
  ['unsafe integer', h => { h.players[0].chips = Number.MAX_SAFE_INTEGER + 1; }],
  ['reopening data', h => { h.currentRound.players[0].lastActionBet = h.currentRound.currentBet + 1; }],
  ['raise increment', h => { h.currentRound.minRaiseIncrement = 1; }],
  ['origin', h => { h.handState.players[0].chips++; }],
];
it.each(corruptions)('rejects corrupted v2 %s as STORAGE_ERROR without resetting or accepting actions', async (_name, corrupt) => {
  await g.setup(); await g.act('call');
  const state = g.state(), saved = JSON.parse(g.raw()) as { version: number; hand: Mutable<HandFlowState> };
  corrupt(saved.hand);
  const raw = JSON.stringify(saved);
  g.app.store.db.prepare('UPDATE rooms SET game=? WHERE id=?').run(raw, g.roomId);
  const reply = await new Promise<Reply<RoomState>>(resolve => g.sockets[0].emit('room:sync', resolve));
  expect(reply).toMatchObject({ error: { code: 'STORAGE_ERROR' } });
  expect(await g.send(g.sockets[1], { type: 'game-action', action: 'call', commandId: randomUUID(), expectedRevision: state.revision })).toMatchObject({ error: { code: 'STORAGE_ERROR' } });
  expect(await g.send(g.sockets[1], { type: 'game-action', action: 'call', commandId: randomUUID(), expectedRevision: state.revision - 1 })).toMatchObject({ error: { code: 'STORAGE_ERROR' } });
  expect(g.raw()).toBe(raw);
  expect(g.app.store.db.prepare('SELECT revision FROM rooms WHERE id=?').get(g.roomId)).toMatchObject({ revision: state.revision });
});
