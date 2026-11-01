import type { GameState, RoomState } from '@poker-table/protocol';
import { ChipAmount } from '../common/ChipAmount';
import { StreetIndicator } from './StreetIndicator';

export function PotSummary({
  game,
  players,
}: {
  game: GameState;
  players: RoomState['players'];
}) {
  const isSettled = game.status === 'hand-settled' || game.status === 'game-complete';
  const potValue = isSettled ? game.settlement.originalPot : game.hand.pot;

  const potLabel =
    game.status === 'game-complete'
      ? 'POTE DA ÚLTIMA MÃO'
      : game.status === 'hand-settled'
        ? 'POTE DISTRIBUÍDO'
        : 'POTE TOTAL';

  const currentActor = game.hand.currentActorId
    ? players.find(p => p.id === game.hand.currentActorId)
    : null;

  return (
    <section className="pot-summary" aria-label="Resumo da mesa">
      <div className="pot-header">
        <StreetIndicator game={game} />
        <div className="blinds-badge">
          <small>BLINDS</small>
          <span className="tabular-nums">
            {game.hand.smallBlind} / {game.hand.bigBlind}
          </span>
        </div>
      </div>

      <div className="pot-display">
        <span className="pot-label">{potLabel}</span>
        <ChipAmount value={potValue} size="xl" className="pot-value" />
      </div>

      {game.hand.status === 'in_progress' && currentActor && (
        <div className="turn-banner" role="status">
          <span className="turn-pulse" aria-hidden="true" />
          <span>Vez de <strong>{currentActor.name}</strong></span>
        </div>
      )}
    </section>
  );
}
