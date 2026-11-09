import { useEffect, useState } from 'react';
import type { GameState } from '@poker-table/protocol';

export function BlindsIndicator({ game }: { game: GameState }) {
  const { hand, blindsState } = game;
  const isTimeMode = blindsState?.type === 'time';
  const expiresAtMs = blindsState?.levelExpiresAt ? new Date(blindsState.levelExpiresAt).getTime() : 0;

  // Contador local segundo a segundo sincronizado com o prazo (levelExpiresAt) do servidor
  const [secondsRemaining, setSecondsRemaining] = useState<number>(() => {
    if (!isTimeMode || !expiresAtMs) return 0;
    return Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000));
  });

  useEffect(() => {
    if (!isTimeMode || !expiresAtMs) return;

    const update = () => {
      const rem = Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000));
      setSecondsRemaining(rem);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [isTimeMode, expiresAtMs]);

  // Modo Fixo (padrão)
  if (!blindsState || blindsState.type === 'fixed') {
    return (
      <div className="blinds-badge" title="Small Blind / Big Blind">
        <small>BLINDS</small>
        <span className="tabular-nums">
          {hand.smallBlind} / {hand.bigBlind}
        </span>
      </div>
    );
  }

  // Formatação de MM:SS para o modo por tempo
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const isPending = blindsState.isNextLevelPending || (isTimeMode && secondsRemaining === 0 && Boolean(blindsState.nextLevel));

  return (
    <div
      className={`blinds-badge blinds-badge-progressive ${isPending ? 'blinds-badge-pending' : ''}`}
      title={`Nível ${blindsState.currentLevelIndex + 1}${blindsState.totalLevels ? ` de ${blindsState.totalLevels}` : ''}`}
    >
      <div className="blinds-main-row">
        <small className="blinds-level-tag">NÍVEL {blindsState.currentLevelIndex + 1}</small>
        <span className="tabular-nums blinds-amounts">
          {hand.smallBlind} / {hand.bigBlind}
        </span>
      </div>

      {blindsState.nextLevel && (
        <div className="blinds-sub-row">
          {isPending ? (
            <span className="blinds-pending-tag" data-testid="blinds-pending-badge">
              Próx. mão: {blindsState.nextLevel.smallBlind}/{blindsState.nextLevel.bigBlind}
            </span>
          ) : blindsState.type === 'hands' ? (
            <span className="blinds-remaining-tag">
              {blindsState.handsRemainingInLevel} {blindsState.handsRemainingInLevel === 1 ? 'mão rest.' : 'mãos rest.'}
            </span>
          ) : (
            <span className="blinds-remaining-tag tabular-nums">
              ⏱ {formatTime(secondsRemaining)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
