import type { GameState, RoomState } from '@poker-table/protocol';
import { ChipAmount } from '../common/ChipAmount';

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

  const cardClasses = [
    'player-card',
    isSelf ? 'card-self' : '',
    isActor ? 'card-turn' : '',
    isFolded ? 'card-folded' : '',
    isAllIn ? 'card-allin' : '',
    !isConnected ? 'card-offline' : '',
  ]
    .filter(Boolean)
    .join(' ');

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
        {!isConnected && <span className="presence-tag offline">Ausente</span>}
      </div>

      <div className="card-stack">
        <ChipAmount value={currentChips} size="sm" />
      </div>

      {/* Indicadores de Ação */}
      <div className="card-status-bar">
        {isSettled && currentChips === 0 ? (
          <span className="action-tag tag-eliminated">ELIMINADO</span>
        ) : isFolded ? (
          <span className="action-tag tag-fold">FOLD</span>
        ) : isAllIn ? (
          <span className="action-tag tag-allin">ALL-IN</span>
        ) : isActor ? (
          <span className="action-tag tag-turn">SUA VEZ</span>
        ) : !isSettled && player.roundCommitted > 0 ? (
          <span className="action-tag tag-bet tabular-nums">+{player.roundCommitted}</span>
        ) : null}
      </div>
    </article>
  );
}
