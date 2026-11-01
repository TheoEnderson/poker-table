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
  const eliminatedPlayers = settlement.players.filter(p => p.chips === 0);

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
          const isTie = pot.winners.length > 1;
          const winnerNames = pot.winners
            .map(id => room.players.find(p => p.id === id)?.name ?? 'Jogador')
            .join(', ');
          const winnerLabel = isTie ? 'Vencedores (Empate)' : 'Vencedor';

          return (
            <div key={pot.potId} className="pot-award-row">
              <div className="pot-award-main">
                <div className="pot-award-info">
                  <strong>{potTitle}</strong>
                  <span>{winnerLabel}: {winnerNames}</span>
                </div>
                <ChipAmount value={pot.potAmount} size="sm" className="pot-award-amount" />
              </div>

              {isTie && pot.awards.length > 1 && (
                <ul className="pot-split-list" aria-label={`Divisão do ${potTitle}`}>
                  {pot.awards.map(award => {
                    const pl = room.players.find(p => p.id === award.playerId);
                    const name = pl?.name ?? 'Jogador';
                    return (
                      <li key={award.playerId} className="pot-split-item">
                        <span className="split-winner-name">• {name}:</span>
                        <span className="split-winner-amount">+{award.amount.toLocaleString('pt-BR')} fichas</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {eliminatedPlayers.length > 0 && (
        <div className="settlement-eliminated-section">
          <span className="eliminated-heading">Jogadores eliminados:</span>
          <div className="eliminated-tags-list">
            {eliminatedPlayers.map(p => {
              const name = room.players.find(rp => rp.id === p.id)?.name ?? `Assento ${p.seat}`;
              return (
                <span key={p.id} className="eliminated-player-pill">
                  #{p.seat} {name} (eliminado)
                </span>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
