import type { CommandInput, GameState, HandSnapshot, RoomState } from '@poker-table/protocol';

interface StreetTransitionInfo {
  buttonLabel: string;
  hint: string;
}

function getStreetTransition(street: HandSnapshot['street']): StreetTransitionInfo {
  switch (street) {
    case 'preflop':
      return {
        buttonLabel: 'Iniciar Flop',
        hint: 'Apostas do pré-flop encerradas. Avance para o flop.',
      };
    case 'flop':
      return {
        buttonLabel: 'Iniciar Turn',
        hint: 'Apostas do flop encerradas. Avance para o turn.',
      };
    case 'turn':
      return {
        buttonLabel: 'Iniciar River',
        hint: 'Apostas do turn encerradas. Avance para o river.',
      };
    case 'river':
      return {
        buttonLabel: 'Ir para Showdown',
        hint: 'Apostas do river encerradas. Avance para o Showdown para apurar os vencedores.',
      };
  }
}

export function HostStreetControls({
  game,
  room,
  selfId,
  command,
  pending,
  disabled,
}: {
  game: GameState;
  room: RoomState;
  selfId: string;
  command: (input: CommandInput) => Promise<boolean>;
  pending: boolean;
  disabled: boolean;
}) {
  const me = room.players.find(p => p.id === selfId);
  const isHost = me?.isHost ?? false;
  const hand = game.hand;

  // Fluxo normal avança streets automaticamente; exibido apenas em estados legados aguardando avanço.
  const canAdvance =
    isHost &&
    game.status === 'hand-active' &&
    hand.status === 'in_progress' &&
    hand.canAdvanceStreet === true;

  if (!canAdvance) return null;

  const transition = getStreetTransition(hand.street);
  const isActionDisabled = disabled || pending;

  return (
    <section className="host-street-controls" aria-label="Controles administrativos do anfitrião">
      <div className="host-street-card">
        <div className="host-street-meta">
          <span className="host-badge" title="Controle exclusivo do anfitrião da mesa">
            ADMIN
          </span>
          <span className="host-street-title">Próxima Rodada</span>
        </div>

        <p className="host-street-hint">{transition.hint}</p>

        <button
          type="button"
          className="button primary host-advance-btn"
          onClick={() => void command({ type: 'advance-street' })}
          disabled={isActionDisabled}
          aria-label={`${transition.buttonLabel} na mesa física`}
        >
          {pending ? 'Avançando…' : `${transition.buttonLabel} ♠`}
        </button>
      </div>
    </section>
  );
}
