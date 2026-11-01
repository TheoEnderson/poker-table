import type { GameState, RoomState } from '@poker-table/protocol';
import { ChipAmount } from '../common/ChipAmount';

export function SettlementBanner({
  game,
  room,
}: {
  game: GameState;
  room: RoomState;
}) {
  if (game.status !== 'hand-settled' && game.status !== 'game-complete') {
    return null;
  }

  const { settlement } = game;
  const isComplete = game.status === 'game-complete';
  const winner = isComplete
    ? room.players.find(p => p.id === game.winnerId)
    : null;

  return (
    <section className="settlement-banner" aria-label="Resumo dos prêmios">
      <div className="settlement-header">
        <h2>{isComplete ? '🏆 Fim de Partida' : 'Resultado da Mão'}</h2>
        <span className="settlement-total">
          Total distribuído: <ChipAmount value={settlement.summary.totalDistributed} size="sm" />
        </span>
      </div>

      {isComplete && winner && (
        <div className="winner-announcement">
          <span className="trophy-icon" aria-hidden="true">👑</span>
          <div>
            <strong>{winner.name} venceu a partida!</strong>
            <p>Todas as fichas da mesa foram conquistadas.</p>
          </div>
        </div>
      )}

      <div className="awards-list">
        {settlement.potAwards.map(pot => {
          const potTitle = pot.potType === 'main' ? 'Pote Principal' : `Pote Paralelo ${pot.potIndex}`;
          const winnerNames = pot.winners
            .map(id => room.players.find(p => p.id === id)?.name ?? 'Jogador')
            .join(', ');

          return (
            <div key={pot.potId} className="pot-award-row">
              <div className="pot-award-info">
                <strong>{potTitle}</strong>
                <span>Vencedor: {winnerNames}</span>
              </div>
              <ChipAmount value={pot.potAmount} size="sm" className="pot-award-amount" />
            </div>
          );
        })}
      </div>
    </section>
  );
}

