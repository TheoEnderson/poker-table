import type { GameState, RoomState } from '@poker-table/protocol';
import { ChipAmount } from '../common/ChipAmount';
import { formatActionTag, getPlayerLastActionInStreet } from '../../utils/actions';
import type { SeatPosition } from '../../utils/table-geometry';

export function SeatPod({
  player,
  roomPlayer,
  game,
  isSelf,
  isDealer,
  isSmallBlind,
  isBigBlind,
  isActor,
  position,
}: {
  player: GameState['hand']['players'][number];
  roomPlayer?: RoomState['players'][number];
  game: GameState;
  isSelf: boolean;
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  isActor: boolean;
  position: SeatPosition;
}) {
  const isSettled = game.status === 'hand-settled' || game.status === 'game-complete';
  const settledPlayer = isSettled
    ? game.settlement.players.find(p => p.id === player.id)
    : null;

  const currentChips = settledPlayer ? settledPlayer.chips : player.chips;
  const isFolded = settledPlayer ? settledPlayer.folded : player.folded;
  const isAllIn = settledPlayer ? settledPlayer.isAllIn : player.isAllIn;
  const isConnected = roomPlayer?.connected ?? true;
  const playerName = roomPlayer?.name ?? `Assento ${player.seat}`;

  const playerLastAction = getPlayerLastActionInStreet(game.hand, player.id);

  // Cartas de mão simbólicas (visíveis se o jogador ainda participa da mão)
  const hasHoleCards = !isFolded && (!isSettled || (settledPlayer && !settledPlayer.folded));

  const podClasses = [
    'player-card',
    'seat-pod',
    `zone-${position.zone}`,
    isSelf ? 'card-self pod-self' : '',
    isActor ? (isSelf ? 'card-turn-self pod-turn-self' : 'card-turn pod-turn') : '',
    isFolded ? 'card-folded pod-folded' : '',
    isAllIn ? 'card-allin pod-allin' : '',
    !isConnected ? 'card-offline pod-offline' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const renderStatusTag = () => {
    if (isSettled && currentChips === 0) {
      return <span className="action-tag tag-eliminated">ELIMINADO</span>;
    }

    if (isFolded) {
      return (
        <span className="action-tag tag-fold">
          {isConnected ? 'FOLD' : 'FOLD · AUSENTE'}
        </span>
      );
    }

    if (isAllIn) {
      return (
        <span className="action-tag tag-allin">
          {isConnected ? 'ALL-IN' : 'ALL-IN · AUSENTE'}
        </span>
      );
    }

    if (isActor) {
      if (isSelf) {
        return <span className="action-tag tag-turn tag-turn-self">SUA VEZ</span>;
      }
      if (!isConnected) {
        return <span className="action-tag tag-turn tag-turn-offline">VEZ · AUSENTE</span>;
      }
      return <span className="action-tag tag-turn">AGINDO...</span>;
    }

    if (playerLastAction) {
      const formatted = formatActionTag(playerLastAction);
      const titleText = formatted.sub ? `${formatted.label} ${formatted.sub}` : formatted.label;
      return (
        <span className={`action-tag ${formatted.className} tabular-nums`} title={titleText}>
          {formatted.label}
        </span>
      );
    }

    if (!isSettled && player.roundCommitted > 0) {
      return <span className="action-tag tag-bet tabular-nums">+{player.roundCommitted}</span>;
    }

    if (!isConnected) {
      return <span className="action-tag tag-offline">AUSENTE</span>;
    }

    return <span className="action-tag tag-active">NA MÃO</span>;
  };

  return (
    <div
      className="seat-pod-wrapper"
      style={{
        left: `${position.xPercent}%`,
        top: `${position.yPercent}%`,
      }}
    >
      <article className={podClasses} aria-label={`Jogador ${playerName}, assento ${player.seat}`}>
        {/* Cartas de mão simbólicas (Hole cards) */}
        {hasHoleCards && (
          <div className="pod-hole-cards" aria-label="Duas cartas fechadas (físicas)" title="Cartas na mão física">
            <div className="symbolic-hole-card card-left" aria-hidden="true">
              <div className="mini-card-back" />
            </div>
            <div className="symbolic-hole-card card-right" aria-hidden="true">
              <div className="mini-card-back" />
            </div>
          </div>
        )}

        <div className="card-top">
          <span className="card-seat" title={`Assento ${player.seat}`}>
            #{player.seat}
          </span>
          <div className="card-badges">
            {isDealer && <span className="badge badge-dealer" title="Dealer (Botão)">D</span>}
            {isSmallBlind && <span className="badge badge-blind" title="Small Blind">SB</span>}
            {isBigBlind && <span className="badge badge-blind" title="Big Blind">BB</span>}
            {isSelf && <span className="badge badge-self">Você</span>}
          </div>
        </div>

        <div className="card-identity">
          <strong className="card-name" title={playerName}>
            {playerName}
          </strong>
          {!isConnected && <span className="presence-tag offline">Desconectado</span>}
        </div>

        <div className="card-stack">
          <ChipAmount value={currentChips} size="sm" />
        </div>

        <div className="card-status-bar">
          {renderStatusTag()}
        </div>
      </article>

      {/* Aposta individual na street (projetada sobre o feltro) */}
      {!isSettled && player.roundCommitted > 0 && (
        <div
          className={`pod-bet-badge zone-${position.zone} tabular-nums`}
          title={`Aposta na street: ${player.roundCommitted}`}
        >
          <span className="bet-chip-glyph" aria-hidden="true">🪙</span>
          <span>{player.roundCommitted}</span>
        </div>
      )}
    </div>
  );
}
