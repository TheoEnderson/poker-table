import { useState, type FormEvent } from 'react';
import { createRoomSchema, type Admission } from '@poker-table/protocol';
import { request } from '../lib/api';
import { checkStorage, saveSession } from '../lib/sessions';
import { ErrorNotice } from '../components/Layout';
import {
  buildResetGameConfig,
  createRoomGameSettingsDraft,
  RoomGameSettingsFields,
  type RoomGameSettingsDraft,
} from '../components/RoomGameSettingsFields';

export function Create() {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [settings, setSettings] = useState<RoomGameSettingsDraft>(() => createRoomGameSettingsDraft());

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const fields = new FormData(event.currentTarget);
    setError('');
    setPending(true);

    try {
      checkStorage();
      const gameConfig = buildResetGameConfig(settings);
      const data = createRoomSchema.parse({
        hostName: fields.get('hostName'),
        config: {
          name: fields.get('name'),
          maxPlayers: Number(fields.get('maxPlayers')),
          ...gameConfig,
        },
      });

      const result = await request<Admission>('/api/rooms', data);
      saveSession(result.room.code, result.credentials);
      location.assign(`/room/${result.room.code}`);
    } catch (e) {
      const parsed = e as Error & { issues?: { message: string }[] };
      setError(parsed.issues?.[0]?.message ?? parsed.message);
      setPending(false);
    }
  }

  return (
    <div className="form-page">
      <a className="back-link" href="/">
        ← Início
      </a>
      <span className="eyebrow">TODOS SÃO BEM-VINDOS</span>
      <h1>Prepare sua mesa.</h1>
      <p className="lede">Dê um nome ao encontro. Depois, é só compartilhar o convite.</p>

      <form className="panel form" onSubmit={e => void submit(e)}>
        <fieldset disabled={pending}>
          <legend className="sr-only">Configuração da mesa</legend>

          <label>
            Nome da mesa
            <input name="name" placeholder="Poker de sábado" maxLength={32} required autoFocus />
          </label>

          <label>
            Seu nome
            <input
              name="hostName"
              placeholder="Como devemos chamar você?"
              maxLength={32}
              required
              autoComplete="given-name"
            />
          </label>

          <RoomGameSettingsFields
            draft={settings}
            onChange={setSettings}
            leadingField={
              <label>
                Máximo de participantes
                <select name="maxPlayers" defaultValue="6">
                  {Array.from({ length: 9 }, (_, i) => (
                    <option key={i} value={i + 2}>
                      {i + 2} pessoas
                    </option>
                  ))}
                </select>
              </label>
            }
          />

          <ErrorNotice message={error} />
          <button className="primary full" type="submit">
            {pending ? 'Criando mesa…' : 'Criar mesa'}
          </button>
        </fieldset>
      </form>
    </div>
  );
}
