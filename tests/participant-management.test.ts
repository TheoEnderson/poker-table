import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { useLanGame, waitFor } from './support/lan-game.js';

describe('Participant Management by Host (Gerenciamento de participantes)', () => {
  const g = useLanGame();

  it('removes a connected player, frees seat, terminates session and updates room state in real time', async () => {
    // Setup 3 players in lobby (start = false)
    await g.setup(3, false);
    const hostId = g.admissions[0].credentials.playerId;
    const p1Id = g.admissions[1].credentials.playerId;
    const p2Id = g.admissions[2].credentials.playerId;

    const p1Socket = g.sockets[1];
    let sessionEndedReason = '';
    p1Socket.on('session:ended', reason => {
      sessionEndedReason = reason;
    });

    // P1 is seated at seat 2
    expect(g.state().players.find(p => p.id === p1Id)?.seat).toBe(2);

    // Host removes P1
    const removeReply = await g.command(0, { type: 'remove-player', playerId: p1Id });
    expect(removeReply.ok).toBe(true);
    if (!removeReply.ok) return;

    // Room state has 2 players remaining (Host and P2)
    const nextState = removeReply.data;
    expect(nextState.players).toHaveLength(2);
    expect(nextState.players.map(p => p.id)).toEqual([hostId, p2Id]);

    // Seat 2 is now free
    expect(nextState.players.some(p => p.seat === 2)).toBe(false);

    // P1's socket receives session:ended and disconnects
    await waitFor(() => sessionEndedReason !== '');
    expect(sessionEndedReason).toBe('Você foi removido da sala pelo anfitrião.');
    await waitFor(() => !p1Socket.connected);
  });

  it('removes a disconnected seated player and frees the seat', async () => {
    await g.setup(3, false);
    const p1Id = g.admissions[1].credentials.playerId;
    const p1Socket = g.sockets[1];

    // P1 disconnects
    p1Socket.disconnect();
    await waitFor(() => !g.state().players.find(p => p.id === p1Id)?.connected);

    // Host removes disconnected P1
    const removeReply = await g.command(0, { type: 'remove-player', playerId: p1Id });
    expect(removeReply.ok).toBe(true);
    if (!removeReply.ok) return;

    // P1 is gone and seat 2 is freed
    expect(removeReply.data.players.find(p => p.id === p1Id)).toBeUndefined();
    expect(removeReply.data.players.some(p => p.seat === 2)).toBe(false);
  });

  it('allows another participant or new joiner to take the freed seat', async () => {
    await g.setup(2, false);
    const p1Id = g.admissions[1].credentials.playerId;

    // P1 is at seat 2. Host removes P1.
    const removeReply = await g.command(0, { type: 'remove-player', playerId: p1Id });
    expect(removeReply.ok).toBe(true);

    // New participant joins and selects the freed seat 2
    const guest2 = g.app.rooms.join(g.host.room.code, { name: 'Charlie', seat: 2 });
    expect(guest2.room.players.find(p => p.id === guest2.credentials.playerId)?.seat).toBe(2);
  });

  it('rejects any subsequent command from the removed player session (UNAUTHORIZED)', async () => {
    await g.setup(3, false);
    const p1Id = g.admissions[1].credentials.playerId;

    // Host removes P1
    await g.command(0, { type: 'remove-player', playerId: p1Id });

    // P1 tries to send a command with their old credentials directly to RoomService
    expect(() => {
      g.app.rooms.command(g.admissions[1].credentials, {
        type: 'rename',
        name: 'Hacker',
        commandId: randomUUID(),
        expectedRevision: g.state().revision,
      });
    }).toThrowError(/Sessão inválida/);
  });

  it('prevents removed player from automatically recovering seat upon reconnection', async () => {
    await g.setup(2, false);
    const p1Creds = g.admissions[1].credentials;

    // Host removes P1
    await g.command(0, { type: 'remove-player', playerId: p1Creds.playerId });

    // P1 attempts to reconnect socket with old credentials
    await expect(g.connect(p1Creds)).rejects.toThrowError(/Sessão inválida/);
  });

  it('allows removed player to re-enter room as a new legitimate participant', async () => {
    await g.setup(2, false);
    const p1Id = g.admissions[1].credentials.playerId;

    // Host removes P1
    await g.command(0, { type: 'remove-player', playerId: p1Id });

    // P1 re-joins legitimately using room code
    const reentered = g.app.rooms.join(g.host.room.code, { name: 'P1-Back', seat: 2 });
    expect(reentered.credentials.playerId).not.toBe(p1Id);
    expect(reentered.room.players.find(p => p.name === 'P1-Back')?.seat).toBe(2);

    // Can connect and interact with new credentials
    const newSocket = await g.connect(reentered.credentials);
    expect(newSocket.connected).toBe(true);
  });

  it('rejects remove-player command when requested by a guest (FORBIDDEN)', async () => {
    await g.setup(3, false);
    const p2Id = g.admissions[2].credentials.playerId;

    // Guest 1 tries to remove Guest 2
    const reply = await g.command(1, { type: 'remove-player', playerId: p2Id });
    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.error.code).toBe('FORBIDDEN');
    }
  });

  it('prohibits host from removing self (INVALID_INPUT)', async () => {
    await g.setup(2, false);
    const hostId = g.admissions[0].credentials.playerId;

    // Host tries to remove self
    const reply = await g.command(0, { type: 'remove-player', playerId: hostId });
    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.error.code).toBe('INVALID_INPUT');
      expect(reply.error.message).toContain('não pode remover a si mesmo');
    }
  });

  it('blocks remove-player during active game (GAME_IN_PROGRESS)', async () => {
    // Setup and start game (start = true)
    await g.setup(2, true);
    expect(g.state().game?.status).toBe('hand-active');

    const p1Id = g.admissions[1].credentials.playerId;
    const reply = await g.command(0, { type: 'remove-player', playerId: p1Id });
    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.error.code).toBe('GAME_IN_PROGRESS');
    }
  });

  it('rejects remove-player for non-existent participant (NOT_FOUND)', async () => {
    await g.setup(2, false);
    const fakeId = randomUUID();

    const reply = await g.command(0, { type: 'remove-player', playerId: fakeId });
    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.error.code).toBe('NOT_FOUND');
    }
  });

  it('handles duplicate remove-player commands idempotently', async () => {
    await g.setup(3, false);
    const p1Id = g.admissions[1].credentials.playerId;

    const commandId = randomUUID();
    const env = await g.envelope({ type: 'remove-player', playerId: p1Id });
    env.commandId = commandId;

    const reply1 = await g.send(g.sockets[0], env);
    expect(reply1.ok).toBe(true);

    // Resend same command
    const reply2 = await g.send(g.sockets[0], env);
    expect(reply2.ok).toBe(true);

    // Conflict with different payload
    const replyConflict = await g.send(g.sockets[0], {
      type: 'start-game',
      commandId,
      expectedRevision: reply1.ok ? reply1.data.revision : 0,
    });
    expect(replyConflict.ok).toBe(false);
    if (!replyConflict.ok) {
      expect(replyConflict.error.code).toBe('COMMAND_CONFLICT');
    }
  });

  it('rejects remove-player with stale expectedRevision (STALE_STATE)', async () => {
    await g.setup(3, false);
    const p1Id = g.admissions[1].credentials.playerId;

    const currentRev = g.state().revision;
    const reply = await g.send(g.sockets[0], {
      type: 'remove-player',
      playerId: p1Id,
      commandId: randomUUID(),
      expectedRevision: currentRev - 1,
    });

    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.error.code).toBe('STALE_STATE');
    }
  });

  it('survives server restart, maintaining removed player state and freed seat', async () => {
    await g.setup(3, false);
    const p1Id = g.admissions[1].credentials.playerId;

    // Remove P1
    await g.command(0, { type: 'remove-player', playerId: p1Id });

    // Since P1 was removed, P1 is no longer a valid participant and cannot reconnect.
    // Clean up P1's socket from tracking before restarting server.
    g.sockets = [g.sockets[0], g.sockets[2]];
    g.admissions = [g.admissions[0], g.admissions[2]];

    // Restart server
    const recovered = await g.restart();
    expect(recovered.players).toHaveLength(2);
    expect(recovered.players.find(p => p.id === p1Id)).toBeUndefined();
    expect(recovered.players.some(p => p.seat === 2)).toBe(false);
  });

  it('synchronizes removal across multiple connected sockets simultaneously', async () => {
    await g.setup(3, false);
    const p1Id = g.admissions[1].credentials.playerId;

    let p2ObservedPlayerCount = 0;
    g.sockets[2].on('room:state', state => {
      p2ObservedPlayerCount = state.players.length;
    });

    // Host removes P1
    await g.command(0, { type: 'remove-player', playerId: p1Id });

    // P2's socket observes update to 2 players in real time
    await waitFor(() => p2ObservedPlayerCount === 2);
  });
});
