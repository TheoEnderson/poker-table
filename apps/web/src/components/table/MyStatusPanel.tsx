import type { GameState, RoomState } from '@poker-table/protocol';
import { ChipAmount } from '../common/ChipAmount';
import { getCurrentStreetBet } from '../../utils/actions';

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

  const currentStreetBet = getCurrentStreetBet(game.hand);
  const myRoundCommitted = meInHand?.roundCommitted ?? 0;
  const callNeeded = !isFolded && !isAllIn && meInHand && game.hand.status === 'in_progress'
    ? Math.max(0, currentStreetBet - myRoundCommitted)
    : 0;

  const currentActor = game.hand.currentActorId
    ? room.players.find(p => p.id === game.hand.currentActorId)
    : null;

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
              <div className="my-bet-info-row">
                {meInHand && !isSettled && myRoundCommitted > 0 && (
                  <span className="my-committed-tag tabular-nums">
                    Sua aposta na street: {myRoundCommitted}
                  </span>
                )}
                {callNeeded > 0 && (
                  <span className="my-call-needed-tag tabular-nums">
                    Para igualar: {callNeeded}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        <div className="my-state-message">
          {isSpectator ? (
            <span className="state-pill state-spectator">Apenas observando</span>
          ) : isEliminated ? (
            <span className="state-pill state-eliminated">Você foi eliminado desta partida</span>
          ) : game.status === 'game-complete' ? (
            <span className="state-pill state-complete">Partida encerrada</span>
          ) : game.status === 'hand-settled' ? (
            <span className="state-pill state-settled">Mão encerrada</span>
          ) : isFolded ? (
            <span className="state-pill state-folded">Você desistiu desta mão (Fold)</span>
          ) : isAllIn ? (
            <span className="state-pill state-allin">Você está em All-in</span>
          ) : isMyTurn ? (
            <span className="state-pill state-turn state-turn-self">Sua vez</span>
          ) : game.hand.status === 'showdown' ? (
            <span className="state-pill state-showdown">Showdown · Cartas na mesa</span>
          ) : game.hand.status === 'hand_ended_by_fold' ? (
            <span className="state-pill state-ended">Mão encerrada</span>
          ) : (
            <span className="state-pill state-waiting">
              Aguardando {currentActor ? currentActor.name : 'jogada'}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
