import { useEffect, useRef, useState } from 'react';
import type { GameState } from '@poker-table/protocol';
import {
  initClockSync,
  computeSynchronizedRemaining,
  formatCountdownTime,
} from '../../utils/clock-sync';

export function BlindsIndicator({ game }: { game: GameState }) {
  const { hand, blindsState } = game;
  const isTimeMode = blindsState?.type === 'time';
  const initialRemaining = blindsState?.secondsRemainingInLevel ?? 0;

  const getPerfNow = () =>
    typeof performance !== 'undefined' ? performance.now() : Date.now();

  // Referência de sincronização temporal monotônica imune a desvios no relógio do cliente
  const syncRef = useRef(initClockSync(initialRemaining, getPerfNow()));
  const [secondsRemaining, setSecondsRemaining] = useState<number>(initialRemaining);

  useEffect(() => {
    if (!isTimeMode || !blindsState) return;

    const perf = getPerfNow();
    const serverRemaining = blindsState.secondsRemainingInLevel ?? 0;
    syncRef.current = initClockSync(serverRemaining, perf);
    setSecondsRemaining(computeSynchronizedRemaining(syncRef.current, perf));

    const update = () => {
      setSecondsRemaining(computeSynchronizedRemaining(syncRef.current, getPerfNow()));
    };

    const interval = setInterval(update, 1000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        update();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [
    isTimeMode,
    blindsState?.currentLevelIndex,
    blindsState?.secondsRemainingInLevel,
    blindsState?.levelExpiresAt,
    blindsState?.isNextLevelPending,
  ]);

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

  const isPending =
    blindsState.isNextLevelPending ||
    (isTimeMode && secondsRemaining === 0 && Boolean(blindsState.nextLevel));

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
              ⏱ {formatCountdownTime(secondsRemaining)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
