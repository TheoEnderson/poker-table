import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { ResetGameConfig, RoomConfig } from '@poker-table/protocol';
import { ErrorNotice } from '../Layout';
import {
  buildResetGameConfig,
  createRoomGameSettingsDraft,
  RoomGameSettingsFields,
  type RoomGameSettingsDraft,
} from '../RoomGameSettingsFields';

interface ResetGameDialogProps {
  open: boolean;
  roomConfig: RoomConfig;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: (config?: ResetGameConfig) => void | Promise<void>;
}

/**
 * Confirmation dialog for `reset-game`. Allows confirming immediately with current room settings
 * or expanding the shared settings form to update initial stack and blinds for the new match.
 */
export function ResetGameDialog({ open, roomConfig, pending, onCancel, onConfirm }: ResetGameDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [editSettings, setEditSettings] = useState(false);
  const [draft, setDraft] = useState<RoomGameSettingsDraft>(() => createRoomGameSettingsDraft(roomConfig));
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      setDraft(createRoomGameSettingsDraft(roomConfig));
      setEditSettings(false);
      setError('');
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open, roomConfig]);

  const parsedChips = Number(draft.startingChips);
  const displayChips =
    editSettings && Number.isInteger(parsedChips) && parsedChips >= 1 ? parsedChips : roomConfig.startingChips;
  const displaySB =
    editSettings
      ? draft.blindsType === 'fixed'
        ? Number(draft.smallBlind) || roomConfig.smallBlind
        : draft.levels[0]?.smallBlind ?? roomConfig.smallBlind
      : roomConfig.smallBlind;
  const displayBB =
    editSettings
      ? draft.blindsType === 'fixed'
        ? Number(draft.bigBlind) || roomConfig.bigBlind
        : draft.levels[0]?.bigBlind ?? roomConfig.bigBlind
      : roomConfig.bigBlind;
  const activeType = editSettings ? draft.blindsType : (roomConfig.blindsStructure?.type ?? 'fixed');
  const activeDeckMode = editSettings ? draft.deckMode : (roomConfig.deckMode ?? 'physical');
  const deckModeLabel = activeDeckMode === 'virtual' ? 'Cartas virtuais' : 'Cartas físicas';
  const blindsModeLabel =
    activeType === 'hands'
      ? ` (progressivo · ${editSettings ? draft.handsPerLevel || '?' : roomConfig.blindsStructure?.type === 'hands' ? roomConfig.blindsStructure.handsPerLevel : '?'} mãos/nível)`
      : activeType === 'time'
      ? ` (progressivo · ${editSettings ? draft.minutesPerLevel || '?' : roomConfig.blindsStructure?.type === 'time' ? roomConfig.blindsStructure.minutesPerLevel : '?'} min/nível)`
      : ' (fixo)';

  const handleToggleSettings = () => {
    if (editSettings) {
      setDraft(createRoomGameSettingsDraft(roomConfig));
      setEditSettings(false);
      setError('');
    } else {
      setEditSettings(true);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    if (!editSettings) {
      void onConfirm();
      return;
    }

    try {
      const nextConfig = buildResetGameConfig(draft);
      setError('');
      void onConfirm(nextConfig);
    } catch (err) {
      const parsed = err as Error & { issues?: { message: string }[] };
      setError(parsed.issues?.[0]?.message ?? parsed.message);
    }
  };

  return (
    <dialog
      ref={ref}
      className={`confirm-dialog reset-game-dialog${editSettings ? ' reset-game-dialog-expanded' : ''}`}
      aria-labelledby={titleId}
      onCancel={e => {
        e.preventDefault();
        onCancel();
      }}
    >
      <form className="reset-game-form" onSubmit={handleSubmit}>
        <h2 id={titleId}>Iniciar Nova Partida e Reiniciar Fichas?</h2>
        <p style={{ whiteSpace: 'pre-line' }}>
          {`Esta ação iniciará uma nova partida mantendo os mesmos participantes e assentos.\n\n• Modo de cartas: ${deckModeLabel}.\n• Todos os participantes sentados receberão ${displayChips.toLocaleString('pt-BR')} fichas.\n• Blinds iniciais: ${displaySB.toLocaleString('pt-BR')} / ${displayBB.toLocaleString('pt-BR')}${blindsModeLabel}.\n• Os saldos da partida anterior serão substituídos pelas fichas iniciais.\n• Jogadores anteriormente eliminados voltarão ao jogo com fichas cheias.\n\nDeseja confirmar a reinicialização da partida?`}
        </p>

        <div className="reset-settings-header">
          <button
            type="button"
            className="reset-settings-toggle"
            aria-expanded={editSettings}
            onClick={handleToggleSettings}
            disabled={pending}
          >
            {editSettings ? 'Usar configurações atuais' : 'Alterar configurações da sala'}
          </button>
        </div>

        {editSettings && (
          <div className="reset-settings-fields">
            <RoomGameSettingsFields
              draft={draft}
              onChange={updater => {
                setError('');
                setDraft(updater);
              }}
            />
            <ErrorNotice message={error} />
          </div>
        )}

        <div className="button-row">
          <button type="button" onClick={onCancel} disabled={pending}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={pending}>
            {pending ? 'Reiniciando…' : 'Reiniciar Fichas'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
