import type { GameState, RoomState } from '@poker-table/protocol';
import { ChipAmount } from '../common/ChipAmount';

export function MyStatusPanel({
  game,
  room,
  selfId,
}: {
  game: GameState;
  room: RoomState;
  selfId: string;
}) {
  const meInRoom = room.players.find(p => p.id === selfId);
  const meInHand = game.hand.players.find(p => p.id === selfId);

  const isSpectator = !meInRoom || meInRoom.seat === null;

  const isSettled = game.status === 'hand-settled' || game.status === 'game-complete';
  const settledPlayer = isSettled && meInHand
    ? game.settlement.players.find(p => p.id === selfId)
    : null;

  const currentChips = settledPlayer ? settledPlayer.chips : (meInHand?.chips ?? 0);
  const isEliminated = !isSpectator && ((isSettled && currentChips === 0) || (meInRoom?.seat !== null && !meInHand));
  const isMyTurn = !isSpectator && game.hand.status === 'in_progress' && game.hand.currentActorId === selfId;
  const isFolded = settledPlayer ? settledPlayer.folded : (meInHand?.folded ?? false);
  const isAllIn = settledPlayer ? settledPlayer.isAllIn : (meInHand?.isAllIn ?? false);

  return (
    <section
      className={`my-status-panel ${isMyTurn ? 'panel-my-turn' : ''} ${isSpectator ? 'panel-spectator' : ''}`}
      aria-label="Seu painel pessoal"
    >
      <div className="my-status-header">
        <span className="my-status-title">
          {isSpectator ? 'MODO ESPECTADOR' : 'SEU STACK'}
        </span>
        <span className="my-seat-badge" title={isSpectator ? 'Você não possui assento na mesa' : `Você está no assento ${meInRoom?.seat}`}>
          {isSpectator ? 'Sem assento' : `Assento #${meInRoom?.seat}${isEliminated ? ' (Eliminado)' : ''}`}
        </span>
      </div>

      <div className="my-status-body">
        <div className="my-stack-display">
          {isSpectator ? (
            <span className="spectator-desc">
              Você está acompanhando a partida como espectador.
            </span>
          ) : (
            <>
              <ChipAmount value={currentChips} size="lg" className="my-stack-amount" />
              {meInHand && !isSettled && meInHand.roundCommitted > 0 && (
                <span className="my-committed-tag tabular-nums">
                  Aposta na street: {meInHand.roundCommitted}
                </span>
              )}
            </>
          )}
        </div>

        <div className="my-state-message">
          {isSpectator ? (
            <span className="state-pill state-spectator">Apenas observando</span>
          ) : isEliminated ? (
            <span className="state-pill state-eliminated">Você foi eliminado desta partida</span>
          ) : isFolded ? (
            <span className="state-pill state-folded">Você desistiu desta mão (Fold)</span>
          ) : isAllIn ? (
            <span className="state-pill state-allin">Você está em All-in</span>
          ) : isMyTurn ? (
            <span className="state-pill state-turn">É A SUA VEZ DE AGIR!</span>
          ) : game.hand.status === 'showdown' ? (
            <span className="state-pill state-showdown">Showdown · Cartas na mesa</span>
          ) : (
            <span className="state-pill state-waiting">Aguardando sua vez</span>
          )}
        </div>
      </div>
    </section>
  );
}
