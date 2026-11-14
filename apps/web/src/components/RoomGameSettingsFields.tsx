import type { ReactNode } from 'react';
import {
  getDefaultBlindLevels,
  resetGameConfigSchema,
  type BlindLevel,
  type BlindsStructure,
  type ResetGameConfig,
  type RoomConfig,
} from '@poker-table/protocol';

export interface RoomGameSettingsDraft {
  deckMode: 'physical' | 'virtual';
  startingChips: string;
  blindsType: 'fixed' | 'hands' | 'time';
  smallBlind: string;
  bigBlind: string;
  handsPerLevel: string;
  minutesPerLevel: string;
  levels: BlindLevel[];
}

export function createRoomGameSettingsDraft(config?: Partial<RoomConfig>): RoomGameSettingsDraft {
  const smallBlind = config?.smallBlind ?? 10;
  const bigBlind = config?.bigBlind ?? 20;
  const bs = config?.blindsStructure;
  const blindsType = bs?.type ?? 'fixed';

  return {
    deckMode: config?.deckMode ?? 'physical',
    startingChips: String(config?.startingChips ?? 1000),
    blindsType,
    smallBlind: String(smallBlind),
    bigBlind: String(bigBlind),
    handsPerLevel: bs?.type === 'hands' ? String(bs.handsPerLevel) : '3',
    minutesPerLevel: bs?.type === 'time' ? String(bs.minutesPerLevel) : '10',
    levels:
      bs && bs.type !== 'fixed'
        ? bs.levels.map(level => ({ smallBlind: level.smallBlind, bigBlind: level.bigBlind }))
        : getDefaultBlindLevels(smallBlind, bigBlind),
  };
}

export function buildResetGameConfig(draft: RoomGameSettingsDraft): ResetGameConfig {
  const initialSB = draft.blindsType === 'fixed' ? Number(draft.smallBlind) : draft.levels[0].smallBlind;
  const initialBB = draft.blindsType === 'fixed' ? Number(draft.bigBlind) : draft.levels[0].bigBlind;

  let blindsStructure: BlindsStructure;
  if (draft.blindsType === 'hands') {
    blindsStructure = {
      type: 'hands',
      handsPerLevel: Number(draft.handsPerLevel),
      levels: draft.levels,
    };
  } else if (draft.blindsType === 'time') {
    blindsStructure = {
      type: 'time',
      minutesPerLevel: Number(draft.minutesPerLevel),
      levels: draft.levels,
    };
  } else {
    blindsStructure = { type: 'fixed' };
  }

  return resetGameConfigSchema.parse({
    deckMode: draft.deckMode,
    startingChips: Number(draft.startingChips),
    smallBlind: initialSB,
    bigBlind: initialBB,
    blindsStructure,
  });
}

interface RoomGameSettingsFieldsProps {
  draft: RoomGameSettingsDraft;
  onChange: (updater: (prev: RoomGameSettingsDraft) => RoomGameSettingsDraft) => void;
  leadingField?: ReactNode;
}

/**
 * Shared form inputs for room gameplay settings (initial chips, blind type/values, progressive levels).
 * Used both when creating a room and when editing room settings during a game reset.
 */
export function RoomGameSettingsFields({ draft, onChange, leadingField }: RoomGameSettingsFieldsProps) {
  const applyPreset = (preset: 'turbo' | 'regular') => {
    if (preset === 'turbo') {
      onChange(prev => ({
        ...prev,
        handsPerLevel: '3',
        minutesPerLevel: '5',
        levels: [
          { smallBlind: 10, bigBlind: 20 },
          { smallBlind: 20, bigBlind: 40 },
          { smallBlind: 30, bigBlind: 60 },
          { smallBlind: 50, bigBlind: 100 },
          { smallBlind: 100, bigBlind: 200 },
        ],
      }));
      return;
    }

    onChange(prev => ({
      ...prev,
      handsPerLevel: '5',
      minutesPerLevel: '10',
      levels: [
        { smallBlind: 10, bigBlind: 20 },
        { smallBlind: 15, bigBlind: 30 },
        { smallBlind: 25, bigBlind: 50 },
        { smallBlind: 50, bigBlind: 100 },
        { smallBlind: 75, bigBlind: 150 },
        { smallBlind: 100, bigBlind: 200 },
      ],
    }));
  };

  const updateLevel = (index: number, field: 'smallBlind' | 'bigBlind', value: number) => {
    onChange(prev => {
      const nextLevels = [...prev.levels];
      nextLevels[index] = { ...nextLevels[index], [field]: Math.max(1, value) };
      return { ...prev, levels: nextLevels };
    });
  };

  const addLevel = () => {
    onChange(prev => {
      if (prev.levels.length >= 20) return prev;
      const last = prev.levels[prev.levels.length - 1];
      return {
        ...prev,
        levels: [
          ...prev.levels,
          {
            smallBlind: Math.min(1_000_000, last.smallBlind * 2),
            bigBlind: Math.min(1_000_000, last.bigBlind * 2),
          },
        ],
      };
    });
  };

  const removeLevel = () => {
    onChange(prev => {
      if (prev.levels.length <= 1) return prev;
      return { ...prev, levels: prev.levels.slice(0, -1) };
    });
  };

  const handsCount = Number(draft.handsPerLevel);
  const minutesCount = Number(draft.minutesPerLevel);

  return (
    <>
      <div className="form-grid">
        {leadingField}

        <label>
          Modo de cartas
          <select
            name="deckMode"
            value={draft.deckMode}
            onChange={e =>
              onChange(prev => ({
                ...prev,
                deckMode: e.target.value === 'virtual' ? 'virtual' : 'physical',
              }))
            }
          >
            <option value="physical">Cartas físicas</option>
            <option value="virtual">Cartas virtuais</option>
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
            value={draft.startingChips}
            onChange={e => onChange(prev => ({ ...prev, startingChips: e.target.value }))}
            required
          />
        </label>

        <label>
          Estrutura de Blinds
          <select
            name="blindsType"
            value={draft.blindsType}
            onChange={e => {
              const nextType = e.target.value as 'fixed' | 'hands' | 'time';
              onChange(prev => {
                if (prev.blindsType === 'fixed' && nextType !== 'fixed') {
                  const sb = Number(prev.smallBlind);
                  const bb = Number(prev.bigBlind);
                  if (Number.isInteger(sb) && sb >= 1 && Number.isInteger(bb) && bb >= sb) {
                    const first = prev.levels[0];
                    const nextLevels =
                      first && first.smallBlind === sb && first.bigBlind === bb
                        ? prev.levels
                        : getDefaultBlindLevels(sb, bb);
                    return { ...prev, blindsType: nextType, levels: nextLevels };
                  }
                } else if (prev.blindsType !== 'fixed' && nextType === 'fixed') {
                  const first = prev.levels[0];
                  if (first) {
                    return {
                      ...prev,
                      blindsType: nextType,
                      smallBlind: String(first.smallBlind),
                      bigBlind: String(first.bigBlind),
                    };
                  }
                }
                return { ...prev, blindsType: nextType };
              });
            }}
          >
            <option value="fixed">Blinds Fixos</option>
            <option value="hands">Progressão por Mãos</option>
            <option value="time">Progressão por Tempo</option>
          </select>
        </label>

        {draft.blindsType === 'fixed' ? (
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
                value={draft.smallBlind}
                onChange={e => onChange(prev => ({ ...prev, smallBlind: e.target.value }))}
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
                value={draft.bigBlind}
                onChange={e => onChange(prev => ({ ...prev, bigBlind: e.target.value }))}
                required
              />
            </label>
          </>
        ) : draft.blindsType === 'hands' ? (
          <label>
            Mãos por nível
            <input
              name="handsPerLevel"
              type="number"
              inputMode="numeric"
              min="1"
              max="1000"
              step="1"
              value={draft.handsPerLevel}
              onChange={e => onChange(prev => ({ ...prev, handsPerLevel: e.target.value }))}
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
              value={draft.minutesPerLevel}
              onChange={e => onChange(prev => ({ ...prev, minutesPerLevel: e.target.value }))}
              required
            />
          </label>
        )}
      </div>

      {draft.blindsType !== 'fixed' && (
        <div className="blinds-progressive-section">
          <div className="blinds-section-header">
            <strong>Sequência de Níveis ({draft.levels.length})</strong>
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
                {draft.levels.map((lvl, idx) => (
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
              disabled={draft.levels.length >= 20}
            >
              + Adicionar Nível
            </button>
            <button
              type="button"
              className="level-action-btn"
              onClick={removeLevel}
              disabled={draft.levels.length <= 1}
            >
              - Remover Último Nível
            </button>
          </div>
        </div>
      )}

      <div className="form-help">
        {draft.blindsType === 'fixed'
          ? 'Blinds constantes durante toda a partida.'
          : draft.blindsType === 'hands'
          ? `Os blinds aumentam a cada ${draft.handsPerLevel || '?'} ${handsCount === 1 ? 'mão' : 'mãos'}. O aumento só é aplicado no início de uma nova mão.`
          : `Os blinds aumentam a cada ${draft.minutesPerLevel || '?'} ${minutesCount === 1 ? 'minuto' : 'minutos'}. A transição ocorre sempre no início da mão seguinte.`}
      </div>
    </>
  );
}
