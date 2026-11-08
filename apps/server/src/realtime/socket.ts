import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { authSchema, commandSchema, type ClientEvents, type Credentials, type ServerEvents } from '@poker-table/protocol';
import { failure, RoomError } from '../errors.js';
import type { RoomService } from '../rooms/service.js';
import { sameOrigin } from '../http/network.js';

type SocketData = { credentials: Credentials };
export function attachRealtime(http: HttpServer, rooms: RoomService) {
  const io = new Server<ClientEvents, ServerEvents, Record<string, never>, SocketData>(http, {
    serveClient: false, maxHttpBufferSize: 8192,
    pingInterval: 10000, pingTimeout: 10000,
    allowRequest: (req, callback) => callback(null, sameOrigin(req.headers.origin, req.headers.host)),
  });
  const broadcast = (roomId: string) => io.to(roomId).emit('room:state', rooms.state(roomId));
  io.use((socket, next) => {
    try {
      const auth = authSchema.parse(socket.handshake.auth);
      socket.data.credentials = rooms.authenticate(auth.credentials);
      if (rooms.state(auth.credentials.roomId).closed) throw new RoomError('ROOM_CLOSED', 'Esta mesa foi encerrada.');
      next();
    } catch (error) {
      const reply = failure(error);
      next(Object.assign(new Error(reply.error.message), { data: reply.error }));
    }
  });
  io.on('connection', socket => {
    const credentials = socket.data.credentials;
    try {
      rooms.connect(credentials, socket.id);
      void socket.join(credentials.roomId);
      broadcast(credentials.roomId);
    } catch {
      socket.emit('session:ended', 'Não foi possível registrar a conexão. Tente novamente.');
      socket.disconnect(true);
      return;
    }
    let count = 0, windowStart = Date.now();
    const limit = () => {
      if (Date.now() - windowStart > 10000) { count = 0; windowStart = Date.now(); }
      if (++count > 80) throw new RoomError('RATE_LIMITED', 'Muitas solicitações. Aguarde alguns segundos.');
    };
    socket.on('room:sync', ack => {
      if (typeof ack !== 'function') return;
      try { limit(); rooms.authenticate(credentials); ack({ ok: true, data: rooms.state(credentials.roomId) }); }
      catch (error) { ack(failure(error)); }
    });
    socket.on('room:command', (input, ack) => {
      if (typeof ack !== 'function') return;
      try {
        limit();
        const command = commandSchema.parse(input);
        const state = rooms.command(credentials, command);
        // Reutiliza o snapshot já confirmado, sem uma segunda leitura do banco.
        io.to(credentials.roomId).emit('room:state', state);
        ack({ ok: true, data: state });
        if (command.type === 'leave') {
          for (const peer of io.sockets.sockets.values()) if (peer.data.credentials.playerId === credentials.playerId) {
            peer.emit('session:ended', 'Você saiu definitivamente desta mesa.');
            peer.disconnect(true);
          }
        }
        if (command.type === 'remove-player') {
          for (const peer of io.sockets.sockets.values()) if (peer.data.credentials.playerId === command.playerId) {
            peer.emit('session:ended', 'Você foi removido da sala pelo anfitrião.');
            peer.disconnect(true);
          }
        }
        if (command.type === 'close-room') {
          io.to(credentials.roomId).emit('session:ended', 'O anfitrião encerrou esta mesa.');
          io.in(credentials.roomId).disconnectSockets(true);
        }
      } catch (error) {
        let reply = failure(error);
        if (reply.error.code === 'STALE_STATE') {
          try { socket.emit('room:state', rooms.state(credentials.roomId)); }
          catch (stateError) { reply = failure(stateError); }
        }
        ack(reply);
      }
    });
    socket.on('disconnect', () => {
      try { rooms.disconnect(credentials, socket.id); broadcast(credentials.roomId); }
      catch {
        // Storage failure must not be hidden as a successfully updated presence.
        io.to(credentials.roomId).emit('session:ended', 'Falha de armazenamento. Reabra a mesa após verificar o servidor.');
      }
    });
  });
  return { io, broadcast };
}
