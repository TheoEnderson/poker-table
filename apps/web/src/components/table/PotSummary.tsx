import type { GameState, RoomState } from '@poker-table/protocol';
import { ChipAmount } from '../common/ChipAmount';
import { StreetIndicator } from './StreetIndicator';
import {
  formatActionNarrative,
  getLastAction,
  getPlayerDisplayName,
  groupActionsByStreet,
} from '../../utils/actions';

export function PotSummary({
  game,
  room,
  selfId,
}: {
  game: GameState;
  room: RoomState;
  selfId?: string;
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
    ? room.players.find(p => p.id === game.hand.currentActorId)
    : null;
  const currentActorSeat = game.hand.players.find(p => p.id === game.hand.currentActorId)?.seat;

  const isSelfActor = currentActor != null && currentActor.id === selfId;

  const lastAction = getLastAction(game.hand);
  const lastActionPlayerName = lastAction
    ? getPlayerDisplayName(room, lastAction.playerId, lastAction.seat)
    : '';

  const actions = game.hand.actions ?? [];
  const historyGroups = groupActionsByStreet(actions);

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

      {/* Destaque do Turno / Jogador da Vez */}
      {game.hand.status === 'in_progress' && currentActor && (
        <div
          className={`turn-banner ${isSelfActor ? 'turn-banner-self' : !currentActor.connected ? 'turn-banner-offline' : ''}`}
          role="status"
        >
          <span
            className={`turn-pulse ${isSelfActor ? 'pulse-self' : !currentActor.connected ? 'pulse-offline' : ''}`}
            aria-hidden="true"
          />
          {isSelfActor ? (
            <span>🎯 <strong>É a sua vez de agir!</strong></span>
          ) : !currentActor.connected ? (
            <span>
              Vez de <strong>{currentActor.name}</strong> (Assento #{currentActorSeat} · <span className="text-offline">Desconectado</span>)
            </span>
          ) : (
            <span>
              Vez de <strong>{currentActor.name}</strong> (Assento #{currentActorSeat})
            </span>
          )}
        </div>
      )}

      {/* Destaque da Última Ação Realizada */}
      {lastAction && (
        <div className="last-action-bar" role="status">
          <span className="last-action-badge">ÚLTIMA AÇÃO</span>
          <span className="last-action-text">
            {formatActionNarrative(lastAction, lastActionPlayerName)}
          </span>
        </div>
      )}

      {/* Histórico Expansível da Mão */}
      {actions.length > 0 && (
        <details className="hand-history-details">
          <summary className="hand-history-summary">
            <span>Histórico da mão ({actions.length})</span>
            <span className="history-toggle-arrow" aria-hidden="true">▾</span>
          </summary>
          <div className="hand-history-content">
            {historyGroups.map(group => (
              <div key={group.street} className="history-group">
                <span className="history-group-title">{group.label}</span>
                <ul className="history-action-list">
                  {group.actions.map(act => (
                    <li key={act.seq} className="history-action-item">
                      <span className="history-seat">#{act.seat}</span>
                      <span className="history-desc">
                        {formatActionNarrative(act, getPlayerDisplayName(room, act.playerId, act.seat))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
