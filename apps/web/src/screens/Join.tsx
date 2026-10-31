import { useEffect, useState, type FormEvent } from 'react';
import type { Admission, RoomState } from '@poker-table/protocol';
import { roomCode } from '@poker-table/protocol';
import { request } from '../lib/api';
import { checkStorage, loadSession, saveSession } from '../lib/sessions';
import { ErrorNotice } from '../components/Layout';

export function Join({ initialCode = '' }: { initialCode?: string }) {
  const [code, setCode] = useState(initialCode), [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState(''), [pending, setPending] = useState(false);
  useEffect(() => {
    const parsed = roomCode.safeParse(code); setRoom(null); setError('');
    if (!parsed.success) return;
    let active = true;
    void request<RoomState>(`/api/rooms/${parsed.data}`).then(value => { if (active) setRoom(value); }).catch(e => { if (active) setError((e as Error).message); });
    return () => { active = false; };
  }, [code]);
  const saved = room ? loadSession(room.code) : null;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (pending || !room) return;
    const fields = new FormData(e.currentTarget); setPending(true); setError('');
    try {
      checkStorage();
      const seat = fields.get('seat');
      const result = await request<Admission>(`/api/rooms/${room.code}/join`, { name: fields.get('name'), seat: seat ? Number(seat) : null });
      saveSession(result.room.code, result.credentials); location.assign(`/room/${result.room.code}`);
    } catch (error) { setError((error as Error).message); setPending(false); }
  }
  return <div className="form-page"><a className="back-link" href="/">← Início</a><span className="eyebrow">PUXE UMA CADEIRA</span><h1>Entre na mesa.</h1><p className="lede">Use o código do anfitrião e escolha seu lugar.</p><form className="panel form" onSubmit={e => void submit(e)}><fieldset disabled={pending}><legend className="sr-only">Entrada na mesa</legend><label>Código da mesa<input name="code" value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={6} minLength={6} autoCapitalize="characters" spellCheck={false} placeholder="ABC234" required /></label>
    {room && <div className="room-preview"><strong>{room.config.name}</strong><span>{room.players.length} / {room.config.maxPlayers} participantes</span></div>}
    {saved ? <><p>Você já tem uma sessão neste navegador.</p><a className="button primary full" href={`/room/${room!.code}`}>Retomar meu lugar</a></> : <><label>Seu nome<input name="name" required maxLength={32} placeholder="Seu nome na mesa" autoComplete="given-name" /></label><label>Posição<select name="seat" defaultValue=""><option value="">Escolher depois de entrar</option>{room && Array.from({ length: room.config.maxPlayers }, (_, i) => { const p = room.players.find(p => p.seat === i + 1); return <option key={i} value={i + 1} disabled={!!p}>Posição {i + 1}{p ? ` · ${p.name}` : ' · livre'}</option>; })}</select></label><button type="submit" className="primary full" disabled={!room || room.closed || room.players.length >= room.config.maxPlayers}>{pending ? 'Entrando…' : 'Entrar na mesa'}</button></>}
    {room?.closed && <p className="notice">Esta mesa foi encerrada.</p>}{room && !saved && room.players.length >= room.config.maxPlayers && <p className="notice">A mesa está cheia, incluindo quem está temporariamente desconectado.</p>}<ErrorNotice message={error} /></fieldset></form></div>;
}
