import { useEffect, useState } from 'react';
import type { CommandInput, GameState, HandSnapshot, RoomState } from '@poker-table/protocol';
import { ConfirmDialog } from '../ConfirmDialog';

interface StreetTransitionInfo {
  buttonLabel: string;
  dialogTitle: string;
  dialogDescription: string;
  confirmLabel: string;
  requiresConfirmation: boolean;
  hint: string;
}

function getStreetTransition(street: HandSnapshot['street']): StreetTransitionInfo {
  switch (street) {
    case 'preflop':
      return {
        buttonLabel: 'Iniciar Flop',
        dialogTitle: 'Iniciar Flop?',
        dialogDescription: 'Confirme que as três cartas do flop já foram colocadas na mesa.',
        confirmLabel: 'Confirmar Flop',
        requiresConfirmation: true,
        hint: 'Apostas do pré-flop encerradas. Revele as três cartas do flop e avance a rodada.',
      };
    case 'flop':
      return {
        buttonLabel: 'Iniciar Turn',
        dialogTitle: 'Iniciar Turn?',
        dialogDescription: 'Confirme que a carta do turn (quarta carta) já foi colocada na mesa.',
        confirmLabel: 'Confirmar Turn',
        requiresConfirmation: true,
        hint: 'Apostas do flop encerradas. Revele a quarta carta (turn) e avance a rodada.',
      };
    case 'turn':
      return {
        buttonLabel: 'Iniciar River',
        dialogTitle: 'Iniciar River?',
        dialogDescription: 'Confirme que a carta do river (quinta carta) já foi colocada na mesa.',
        confirmLabel: 'Confirmar River',
        requiresConfirmation: true,
        hint: 'Apostas do turn encerradas. Revele a quinta carta (river) e avance a rodada.',
      };
    case 'river':
      return {
        buttonLabel: 'Ir para Showdown',
        dialogTitle: 'Ir para Showdown?',
        dialogDescription: 'Todas as rodadas de aposta foram concluídas. Avance para o Showdown.',
        confirmLabel: 'Ir para Showdown',
        requiresConfirmation: false,
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
  const [confirmAdvance, setConfirmAdvance] = useState(false);

  const me = room.players.find(p => p.id === selfId);
  const isHost = me?.isHost ?? false;
  const hand = game.hand;

  // Condição estrita e autoritativa para avançar a street:
  // Exige estritamente canAdvanceStreet === true, sem aproximações heurísticas no cliente.
  const canAdvance =
    isHost &&
    game.status === 'hand-active' &&
    hand.status === 'in_progress' &&
    hand.canAdvanceStreet === true;

  // Invalida diálogo aberto incondicionalmente se o estado da partida mudar
  useEffect(() => {
    setConfirmAdvance(false);
  }, [room.revision, game.status, hand.street, hand.status, canAdvance]);

  // Se o jogador não for anfitrião, a mão não estiver ativa ou a rodada não permitir avanço, não renderiza
  if (!canAdvance) return null;

  const transition = getStreetTransition(hand.street);
  const isActionDisabled = disabled || pending;

  const executeAdvance = async () => {
    const success = await command({ type: 'advance-street' });
    if (success) {
      setConfirmAdvance(false);
    }
  };

  const handleAdvanceClick = () => {
    if (transition.requiresConfirmation) {
      setConfirmAdvance(true);
    } else {
      void executeAdvance();
    }
  };

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
          onClick={handleAdvanceClick}
          disabled={isActionDisabled}
          aria-label={`${transition.buttonLabel} na mesa física`}
        >
          {pending ? 'Avançando…' : `${transition.buttonLabel} ♠`}
        </button>
      </div>

      {transition.requiresConfirmation && (
        <ConfirmDialog
          open={confirmAdvance}
          title={transition.dialogTitle}
          description={transition.dialogDescription}
          confirmLabel={transition.confirmLabel}
          pending={pending}
          onCancel={() => setConfirmAdvance(false)}
          onConfirm={() => void executeAdvance()}
        />
      )}
    </section>
  );
}

