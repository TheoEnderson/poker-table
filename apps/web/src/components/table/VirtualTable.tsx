import type { GameState, RoomState } from '@poker-table/protocol';
import { TableFelt } from './TableFelt';
import { TablePot } from './TablePot';
import { CommunityCards } from './CommunityCards';
import { SeatPod } from './SeatPod';
import { StreetIndicator } from './StreetIndicator';
import { BlindsIndicator } from './BlindsIndicator';
import {
  formatActionNarrative,
  getLastAction,
  getPlayerDisplayName,
  groupActionsByStreet,
} from '../../utils/actions';
import { getRelativeSeatIndex, getSeatPosition } from '../../utils/table-geometry';

export function VirtualTable({
  game,
  room,
  selfId,
}: {
  game: GameState;
  room: RoomState;
  selfId?: string;
}) {
  const { hand } = game;
  // Ordena os jogadores sentados por assento para ancoragem física
  const seatedPlayers = room.players
    .filter(p => p.seat !== null)
    .sort((a, b) => a.seat! - b.seat!);
  const selfIndex = seatedPlayers.findIndex(p => p.id === selfId);

  const currentActor = hand.currentActorId
    ? room.players.find(p => p.id === hand.currentActorId)
    : null;
  const currentActorSeat = hand.players.find(p => p.id === hand.currentActorId)?.seat;
  const isSelfActor = currentActor != null && currentActor.id === selfId;

  const lastAction = getLastAction(hand);
  const lastActionPlayerName = lastAction
    ? getPlayerDisplayName(room, lastAction.playerId, lastAction.seat)
    : '';

  const actions = hand.actions ?? [];
  const historyGroups = groupActionsByStreet(actions);

  return (
    <div className="virtual-table-container" aria-label="Mesa virtual de poker">
      {/* 1. Nível Superior: Barra de Status Externa (Street, Blinds e Turno) */}
      <header className="table-top-status-bar pot-summary" aria-label="Resumo e status da rodada">
        <div className="table-status-meta">
          <StreetIndicator game={game} />
          <BlindsIndicator game={game} />
        </div>

        {/* Banner do Jogador da Vez */}
        {hand.status === 'in_progress' && currentActor && (
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
      </header>

      {/* 2. Nível Central: Feltro da Mesa com Pote, Cartas Comunitárias e Assentos */}
      <section
        className={`virtual-table-arena ${seatedPlayers.length >= 7 ? 'seats-dense' : ''}`}
        aria-label="Feltro da mesa com jogadores"
      >
        <TableFelt />

        {/* Centro da Mesa: Pote e Cartas Comunitárias */}
        <div className="table-center-content">
          <TablePot game={game} />
          <CommunityCards game={game} />
        </div>

        {/* Perímetro da Mesa: Assentos dos Jogadores */}
        <div className="table-seats-layer" role="list" aria-label="Jogadores na mesa">
          {seatedPlayers.map((roomPlayer, idx) => {
            const player = hand.players.find(p => p.id === roomPlayer.id);
            const isSelf = roomPlayer.id === selfId;
            const isWaitingForNextHand = !player && !(game.admittedPlayerIds?.includes(roomPlayer.id) ?? false);
            const isEliminated = !player && !isWaitingForNextHand;

            const isDealer = player ? player.seat === hand.dealerSeat : false;
            const isSmallBlind = player ? player.seat === hand.smallBlindSeat : false;
            const isBigBlind = player ? player.seat === hand.bigBlindSeat : false;
            const isActor = hand.status === 'in_progress' && player?.id === hand.currentActorId;

            const relativeIndex = getRelativeSeatIndex(idx, selfIndex, seatedPlayers.length);
            const position = getSeatPosition(seatedPlayers.length, relativeIndex);

            const podPlayer = player ?? {
              id: roomPlayer.id,
              seat: roomPlayer.seat!,
              chips: isWaitingForNextHand ? room.config.startingChips : 0,
              roundCommitted: 0,
              totalCommitted: 0,
              folded: isEliminated,
              isAllIn: false,
            };

            return (
              <div key={roomPlayer.id} role="listitem" className="table-seat-slot">
                <SeatPod
                  player={podPlayer}
                  roomPlayer={roomPlayer}
                  game={game}
                  isSelf={isSelf}
                  isDealer={isDealer}
                  isSmallBlind={isSmallBlind}
                  isBigBlind={isBigBlind}
                  isActor={isActor}
                  position={position}
                  isWaitingForNextHand={isWaitingForNextHand}
                  isEliminated={isEliminated}
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* 3. Nível Inferior: Narrativa de Última Ação e Histórico Expansível */}
      {lastAction && (
        <div className="last-action-bar" role="status">
          <span className="last-action-badge">ÚLTIMA AÇÃO</span>
          <span className="last-action-text">
            {formatActionNarrative(lastAction, lastActionPlayerName)}
          </span>
        </div>
      )}

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
    </div>
  );
}
