import type { GameState } from '@poker-table/protocol';
import { ChipAmount } from '../common/ChipAmount';

export function TablePot({ game }: { game: GameState }) {
  const isSettled = game.status === 'hand-settled' || game.status === 'game-complete';
  const potValue = isSettled ? game.settlement.originalPot : game.hand.pot;

  const potLabel =
    game.status === 'game-complete'
      ? 'POTE FINAL'
      : game.status === 'hand-settled'
        ? 'POTE DISTRIBUÍDO'
        : 'POTE TOTAL';

  const sidePots = game.hand.pots && game.hand.pots.length > 1 ? game.hand.pots.slice(1) : [];

  return (
    <div className="table-pot" aria-label="Pote da mesa">
      <span className="pot-label">{potLabel}</span>
      <div className="pot-chips-row">
        <span className="pot-stack-icon" aria-hidden="true">🪙</span>
        <ChipAmount value={potValue} size="md" className="pot-value" />
      </div>

      {sidePots.length > 0 && (
        <div className="side-pots-container" aria-label="Potes secundários">
          {sidePots.map((sp, idx) => (
            <span key={sp.id ?? idx} className="side-pot-pill tabular-nums">
              Pote {idx + 1}: {sp.amount}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
