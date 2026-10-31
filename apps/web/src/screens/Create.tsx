import { useState, type FormEvent } from 'react';
import { createRoomSchema, type Admission } from '@poker-table/protocol';
import { request } from '../lib/api';
import { checkStorage, saveSession } from '../lib/sessions';
import { ErrorNotice } from '../components/Layout';

export function Create() {
  const [error, setError] = useState(''), [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    const fields = new FormData(event.currentTarget);
    setError(''); setPending(true);
    try {
      checkStorage();
      const data = createRoomSchema.parse({ hostName: fields.get('hostName'), config: {
        name: fields.get('name'), maxPlayers: Number(fields.get('maxPlayers')), startingChips: Number(fields.get('startingChips')),
        smallBlind: Number(fields.get('smallBlind')), bigBlind: Number(fields.get('bigBlind')),
      } });
      const result = await request<Admission>('/api/rooms', data);
      saveSession(result.room.code, result.credentials);
      location.assign(`/room/${result.room.code}`);
    } catch (e) {
      const parsed = e as Error & { issues?: { message: string }[] };
      setError(parsed.issues?.[0]?.message ?? parsed.message); setPending(false);
    }
  }
  return <div className="form-page"><a className="back-link" href="/">← Início</a><span className="eyebrow">TODOS SÃO BEM-VINDOS</span><h1>Prepare sua mesa.</h1><p className="lede">Dê um nome ao encontro. Depois, é só compartilhar o convite.</p><form className="panel form" onSubmit={e => void submit(e)}><fieldset disabled={pending}><legend className="sr-only">Configuração da mesa</legend><label>Nome da mesa<input name="name" placeholder="Poker de sábado" maxLength={32} required autoFocus /></label><label>Seu nome<input name="hostName" placeholder="Como devemos chamar você?" maxLength={32} required autoComplete="given-name" /></label><div className="form-grid"><label>Máximo de participantes<select name="maxPlayers" defaultValue="6">{Array.from({ length: 9 }, (_, i) => <option key={i} value={i + 2}>{i + 2} pessoas</option>)}</select></label><label>Fichas iniciais<input name="startingChips" type="number" inputMode="numeric" min="1" max="1000000" step="1" defaultValue="1000" required /></label><label>Small blind<input name="smallBlind" type="number" inputMode="numeric" min="1" max="1000000" step="1" defaultValue="10" required /></label><label>Big blind<input name="bigBlind" type="number" inputMode="numeric" min="1" max="1000000" step="1" defaultValue="20" required /></label></div><p className="form-help">Fichas e blinds ficam salvos como configuração. Apostas ainda não estão disponíveis.</p><ErrorNotice message={error} /><button className="primary full" type="submit">{pending ? 'Criando mesa…' : 'Criar mesa'}</button></fieldset></form></div>;
}
