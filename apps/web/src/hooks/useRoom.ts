import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { PROTOCOL_VERSION, roomStateSchema, type ClientEvents, type CommandInput, type Credentials, type RoomState, type ServerEvents } from '@poker-table/protocol';
import { commandId } from '../lib/api';

export function useRoom(credentials: Credentials | null) {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'ended'>('connecting');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const socketRef = useRef<Socket<ServerEvents, ClientEvents> | null>(null);
  const roomRef = useRef<RoomState | null>(null);
  const busy = useRef(false);
  const accept = useCallback((raw: RoomState) => {
    const parsed = roomStateSchema.safeParse(raw);
    if (!parsed.success) { setError('O servidor enviou um estado incompatível. Atualize a página.'); return; }
    const next = parsed.data;
    if (roomRef.current && next.revision < roomRef.current.revision) return;
    roomRef.current = next; setRoom(next);
  }, []);
  const sync = useCallback(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    socket.timeout(5000).emit('room:sync', (err, reply) => {
      if (err) { setError('Sem resposta do servidor. Tentaremos reconectar.'); return; }
      if (reply.ok) accept(reply.data); else setError(reply.error.message);
    });
  }, [accept]);
  useEffect(() => {
    if (!credentials) return;
    const socket: Socket<ServerEvents, ClientEvents> = io({
      auth: { protocol: PROTOCOL_VERSION, credentials },
      reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 4000,
      // No retries/buffered commands: uncertain actions are reconciled by snapshot.
      autoConnect: false,
    });
    socketRef.current = socket;
    let ended = false;
    socket.on('room:state', accept);
    socket.on('connect', () => { setStatus('connected'); setError(''); sync(); });
    socket.on('disconnect', reason => { if (!ended && reason !== 'io server disconnect') setStatus('disconnected'); });
    socket.on('connect_error', err => {
      const code = (err as Error & { data?: { code?: string } }).data?.code;
      if (code === 'UNAUTHORIZED' || code === 'ROOM_CLOSED' || code === 'INVALID_INPUT') { ended = true; setStatus('ended'); socket.disconnect(); }
      else if (!ended) setStatus('disconnected');
      setError(code ? err.message : 'Servidor indisponível. Reconectando automaticamente…');
    });
    socket.on('session:ended', reason => { ended = true; setError(reason); setStatus('ended'); socket.disconnect(); });
    const resume = () => { if (document.visibilityState === 'visible') { if (!socket.connected && socket.active) socket.connect(); sync(); } };
    document.addEventListener('visibilitychange', resume);
    socket.connect();
    return () => { document.removeEventListener('visibilitychange', resume); socket.removeAllListeners(); socket.disconnect(); socketRef.current = null; };
  }, [credentials, accept, sync]);
  const command = async (input: CommandInput): Promise<boolean> => {
    const socket = socketRef.current, current = roomRef.current;
    if (!socket?.connected || !current || busy.current) return false;
    busy.current = true; setPending(true); setError('');
    return new Promise(resolve => {
      socket.timeout(5000).emit('room:command', { ...input, commandId: commandId(), expectedRevision: current.revision }, (err, reply) => {
        busy.current = false; setPending(false);
        if (err) { setError('Confirmação não recebida. Confira a mesa sincronizada antes de tentar novamente.'); sync(); resolve(false); return; }
        if (!reply.ok) { setError(reply.error.message); sync(); resolve(false); return; }
        accept(reply.data); resolve(true);
      });
    });
  };
  return { room, status, error, pending, command, sync };
}
