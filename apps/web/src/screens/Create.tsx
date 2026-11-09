import { useState, type FormEvent } from 'react';
import { createRoomSchema, type Admission, type BlindLevel, type BlindsStructure, getDefaultBlindLevels } from '@poker-table/protocol';
import { request } from '../lib/api';
import { checkStorage, saveSession } from '../lib/sessions';
import { ErrorNotice } from '../components/Layout';

export function Create() {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [blindsType, setBlindsType] = useState<'fixed' | 'hands' | 'time'>('fixed');
  const [handsPerLevel, setHandsPerLevel] = useState(3);
  const [minutesPerLevel, setMinutesPerLevel] = useState(10);
  const [levels, setLevels] = useState<BlindLevel[]>(() => getDefaultBlindLevels(10, 20));

  const applyPreset = (preset: 'turbo' | 'regular') => {
    if (preset === 'turbo') {
      setHandsPerLevel(3);
      setMinutesPerLevel(5);
      setLevels([
        { smallBlind: 10, bigBlind: 20 },
        { smallBlind: 20, bigBlind: 40 },
        { smallBlind: 30, bigBlind: 60 },
        { smallBlind: 50, bigBlind: 100 },
        { smallBlind: 100, bigBlind: 200 },
      ]);
    } else {
      setHandsPerLevel(5);
      setMinutesPerLevel(10);
      setLevels([
        { smallBlind: 10, bigBlind: 20 },
        { smallBlind: 15, bigBlind: 30 },
        { smallBlind: 25, bigBlind: 50 },
        { smallBlind: 50, bigBlind: 100 },
        { smallBlind: 75, bigBlind: 150 },
        { smallBlind: 100, bigBlind: 200 },
      ]);
    }
  };

  const updateLevel = (index: number, field: 'smallBlind' | 'bigBlind', value: number) => {
    setLevels(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: Math.max(1, value) };
      return next;
    });
  };

  const addLevel = () => {
    if (levels.length >= 20) return;
    const last = levels[levels.length - 1];
    setLevels(prev => [
      ...prev,
      {
        smallBlind: Math.min(1_000_000, last.smallBlind * 2),
        bigBlind: Math.min(1_000_000, last.bigBlind * 2),
      },
    ]);
  };

  const removeLevel = () => {
    if (levels.length <= 1) return;
    setLevels(prev => prev.slice(0, -1));
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const fields = new FormData(event.currentTarget);
    setError('');
    setPending(true);

    try {
      checkStorage();
      const initialSB = blindsType === 'fixed' ? Number(fields.get('smallBlind')) : levels[0].smallBlind;
      const initialBB = blindsType === 'fixed' ? Number(fields.get('bigBlind')) : levels[0].bigBlind;

      let blindsStructure: BlindsStructure | undefined;
      if (blindsType === 'hands') {
        blindsStructure = {
          type: 'hands',
          handsPerLevel,
          levels,
        };
      } else if (blindsType === 'time') {
        blindsStructure = {
          type: 'time',
          minutesPerLevel,
          levels,
        };
      } else {
        blindsStructure = { type: 'fixed' };
      }

      const data = createRoomSchema.parse({
        hostName: fields.get('hostName'),
        config: {
          name: fields.get('name'),
          maxPlayers: Number(fields.get('maxPlayers')),
          startingChips: Number(fields.get('startingChips')),
          smallBlind: initialSB,
          bigBlind: initialBB,
          blindsStructure,
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

          <div className="form-grid">
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

            <label>
              Fichas iniciais
              <input
                name="startingChips"
                type="number"
                inputMode="numeric"
                min="1"
                max="1000000"
                step="1"
                defaultValue="1000"
                required
              />
            </label>

            <label>
              Estrutura de Blinds
              <select
                name="blindsType"
                value={blindsType}
                onChange={e => setBlindsType(e.target.value as 'fixed' | 'hands' | 'time')}
              >
                <option value="fixed">Blinds Fixos</option>
                <option value="hands">Progressão por Mãos</option>
                <option value="time">Progressão por Tempo</option>
              </select>
            </label>

            {blindsType === 'fixed' ? (
              <>
                <label>
                  Small blind
                  <input
                    name="smallBlind"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="1000000"
                    step="1"
                    defaultValue="10"
                    required
                  />
                </label>

                <label>
                  Big blind
                  <input
                    name="bigBlind"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="1000000"
                    step="1"
                    defaultValue="20"
                    required
                  />
                </label>
              </>
            ) : blindsType === 'hands' ? (
              <label>
                Mãos por nível
                <input
                  name="handsPerLevel"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="1000"
                  step="1"
                  value={handsPerLevel}
                  onChange={e => setHandsPerLevel(Math.max(1, Number(e.target.value)))}
                  required
                />
              </label>
            ) : (
              <label>
                Minutos por nível
                <input
                  name="minutesPerLevel"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="120"
                  step="1"
                  value={minutesPerLevel}
                  onChange={e => setMinutesPerLevel(Math.max(1, Number(e.target.value)))}
                  required
                />
              </label>
            )}
          </div>

          {blindsType !== 'fixed' && (
            <div className="blinds-progressive-section">
              <div className="blinds-section-header">
                <strong>Sequência de Níveis ({levels.length})</strong>
                <div className="blinds-preset-buttons">
                  <button
                    type="button"
                    className="blinds-preset-btn"
                    onClick={() => applyPreset('turbo')}
                  >
                    Turbo
                  </button>
                  <button
                    type="button"
                    className="blinds-preset-btn"
                    onClick={() => applyPreset('regular')}
                  >
                    Regular
                  </button>
                </div>
              </div>

              <div className="levels-table-container">
                <table className="levels-table">
                  <thead>
                    <tr>
                      <th>Nível</th>
                      <th>Small Blind</th>
                      <th>Big Blind</th>
                    </tr>
                  </thead>
                  <tbody>
                    {levels.map((lvl, idx) => (
                      <tr key={idx}>
                        <td>Nível {idx + 1}</td>
                        <td>
                          <input
                            type="number"
                            min="1"
                            max="1000000"
                            value={lvl.smallBlind}
                            onChange={e => updateLevel(idx, 'smallBlind', Number(e.target.value))}
                            className="level-input"
                            required
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="1"
                            max="1000000"
                            value={lvl.bigBlind}
                            onChange={e => updateLevel(idx, 'bigBlind', Number(e.target.value))}
                            className="level-input"
                            required
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="levels-actions">
                <button
                  type="button"
                  className="level-action-btn"
                  onClick={addLevel}
                  disabled={levels.length >= 20}
                >
                  + Adicionar Nível
                </button>
                <button
                  type="button"
                  className="level-action-btn"
                  onClick={removeLevel}
                  disabled={levels.length <= 1}
                >
                  - Remover Último Nível
                </button>
              </div>
            </div>
          )}

          <p className="form-help">
            {blindsType === 'fixed'
              ? 'Blinds constantes durante toda a partida.'
              : blindsType === 'hands'
              ? `Os blinds aumentam a cada ${handsPerLevel} ${handsPerLevel === 1 ? 'mão' : 'mãos'}. O aumento só é aplicado no início de uma nova mão.`
              : `Os blinds aumentam a cada ${minutesPerLevel} minutos. A transição ocorre sempre no início da mão seguinte.`}
          </p>

          <ErrorNotice message={error} />
          <button className="primary full" type="submit">
            {pending ? 'Criando mesa…' : 'Criar mesa'}
          </button>
        </fieldset>
      </form>
    </div>
  );
}
