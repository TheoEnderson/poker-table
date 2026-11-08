import type { RoomState } from '@poker-table/protocol';

export function HostParticipantsManager({
  room,
  disabled,
  onRemove,
}: {
  room: RoomState;
  disabled: boolean;
  onRemove: (player: RoomState['players'][number]) => void;
}) {
  const guests = room.players.filter(p => !p.isHost);
  const host = room.players.find(p => p.isHost);

  return (
    <section className="panel host-participants-panel" aria-label="Gerenciamento de participantes">
      <div className="host-participants-header">
        <h2>Participantes</h2>
        <span className="count-badge">
          {room.players.length} / {room.config.maxPlayers}
        </span>
      </div>
      <p className="form-help">
        Gerencie os participantes. Convidados ausentes podem ser removidos para liberar assentos.
      </p>

      <ul className="host-participants-list" aria-label="Lista de participantes">
        {host && (
          <li key={host.id} className="host-participant-item host-self-item">
            <div className="participant-info">
              <span className="participant-name">
                <strong>{host.name}</strong>
                <span className="host-badge"> · Anfitrião</span>
              </span>
              <span className="participant-meta">
                <span className="participant-seat">
                  {host.seat !== null ? `Assento #${host.seat}` : 'Sem assento'}
                </span>
                <span className="meta-separator" aria-hidden="true">·</span>
                <span className={`participant-status ${host.connected ? 'status-online' : 'status-offline'}`}>
                  <span className={host.connected ? 'connected-dot' : 'offline-dot'} aria-hidden="true" />
                  {host.connected ? 'Conectado' : 'Desconectado'}
                </span>
              </span>
            </div>
            <span className="host-protected-label">Você</span>
          </li>
        )}

        {guests.map(guest => (
          <li
            key={guest.id}
            className={`host-participant-item ${!guest.connected ? 'participant-disconnected' : ''}`}
          >
            <div className="participant-info">
              <span className="participant-name">
                <strong>{guest.name}</strong>
              </span>
              <span className="participant-meta">
                <span className="participant-seat">
                  {guest.seat !== null ? `Assento #${guest.seat}` : 'Sem assento'}
                </span>
                <span className="meta-separator" aria-hidden="true">·</span>
                <span className={`participant-status ${guest.connected ? 'status-online' : 'status-offline'}`}>
                  <span className={guest.connected ? 'connected-dot' : 'offline-dot'} aria-hidden="true" />
                  {guest.connected ? 'Conectado' : 'Desconectado'}
                </span>
              </span>
            </div>
            <button
              type="button"
              className="danger-quiet small remove-participant-btn"
              disabled={disabled}
              onClick={() => onRemove(guest)}
              aria-label={`Remover ${guest.name}`}
            >
              Remover
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
