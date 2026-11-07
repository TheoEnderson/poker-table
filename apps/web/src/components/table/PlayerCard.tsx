import type { GameState, RoomState } from '@poker-table/protocol';
import { ChipAmount } from '../common/ChipAmount';
import { formatActionTag, getPlayerLastActionInStreet } from '../../utils/actions';

export function PlayerCard({
  player,
  roomPlayer,
  game,
  isSelf,
  isDealer,
  isSmallBlind,
  isBigBlind,
  isActor,
}: {
  player: GameState['hand']['players'][number];
  roomPlayer?: RoomState['players'][number];
  game: GameState;
  isSelf: boolean;
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  isActor: boolean;
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

  const cardClasses = [
    'player-card',
    isSelf ? 'card-self' : '',
    isActor ? (isSelf ? 'card-turn-self' : 'card-turn') : '',
    isFolded ? 'card-folded' : '',
    isAllIn ? 'card-allin' : '',
    !isConnected ? 'card-offline' : '',
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
      return (
        <span className={`action-tag ${formatted.className} tabular-nums`} title={formatted.sub}>
          {formatted.label} {formatted.sub ? <small className="tag-sub">{formatted.sub}</small> : null}
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
    <article className={cardClasses} aria-label={`Jogador ${playerName}, assento ${player.seat}`}>
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

      {/* Indicadores de Ação */}
      <div className="card-status-bar">
        {renderStatusTag()}
      </div>
    </article>
  );
}
