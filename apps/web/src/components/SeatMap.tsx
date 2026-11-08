import type { RoomState } from '@poker-table/protocol';
export function SeatMap({ room, selfId, disabled, onSelect }: { room: RoomState; selfId?: string; disabled: boolean; onSelect: (seat: number) => void }) {
  return <div className="seat-map" aria-label="Posições ao redor da mesa"><div className="felt"><span className="felt-symbol" aria-hidden="true">♠</span><span>POKER TABLE</span><small>{room.game ? 'Assentos reservados' : 'Escolha seu lugar'}</small></div>{Array.from({ length: room.config.maxPlayers }, (_, i) => {
    const seat = i + 1, player = room.players.find(p => p.seat === seat), mine = player?.id === selfId;
    const angle = 2 * Math.PI * i / room.config.maxPlayers;
    return <button key={seat} data-seat={seat} className={`seat ${player ? 'occupied' : 'empty'} ${mine ? 'mine' : ''}`} style={{ left: `${50 + 35 * Math.sin(angle)}%`, top: `${50 - 40 * Math.cos(angle)}%` }}
      aria-label={`Posição ${seat}${player ? `, ${player.name}${mine ? ', você' : ''}, ${player.connected ? 'conectado' : 'desconectado'}` : ', disponível'}`}
      aria-pressed={mine} disabled={disabled || (!!player && !mine)} onClick={() => onSelect(seat)}>
      <span className="seat-number">{player ? player.name.slice(0, 1).toUpperCase() : '+'}<small>{seat}</small></span>
      <span className="seat-name" title={player?.name}>{player?.name ?? 'Livre'}{mine ? ' · você' : ''}</span>
      {player ? <span className={`presence ${player.connected ? 'online' : ''}`}>{player.connected ? 'Conectado' : 'Ausente'}{player.isHost ? ' · host' : ''}</span> : <span className="presence">Sentar aqui</span>}
    </button>;
  })}</div>;
}
