import type { GameState, RoomState } from '@poker-table/protocol';
import { PlayerCard } from './PlayerCard';

export function SeatStrip({
  game,
  room,
  selfId,
}: {
  game: GameState;
  room: RoomState;
  selfId?: string;
}) {
  const { hand } = game;
  // Sort players by seat number for deterministic physical orientation
  const sortedPlayers = [...hand.players].sort((a, b) => a.seat - b.seat);

  return (
    <section className="seat-strip-container" aria-label="Jogadores na mesa">
      <div className="seat-strip" role="list">
        {sortedPlayers.map(player => {
          const roomPlayer = room.players.find(p => p.id === player.id);
          const isSelf = player.id === selfId;
          const isDealer = player.seat === hand.dealerSeat;
          const isSmallBlind = player.seat === hand.smallBlindSeat;
          const isBigBlind = player.seat === hand.bigBlindSeat;
          const isActor = hand.status === 'in_progress' && player.id === hand.currentActorId;

          return (
            <div key={player.id} role="listitem" className="seat-strip-item">
              <PlayerCard
                player={player}
                roomPlayer={roomPlayer}
                game={game}
                isSelf={isSelf}
                isDealer={isDealer}
                isSmallBlind={isSmallBlind}
                isBigBlind={isBigBlind}
                isActor={isActor}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
