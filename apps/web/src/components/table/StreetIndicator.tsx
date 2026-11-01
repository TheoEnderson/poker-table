import type { GameState } from '@poker-table/protocol';

const STREET_LABELS: Record<string, string> = {
  preflop: 'PRÉ-FLOP',
  flop: 'FLOP',
  turn: 'TURN',
  river: 'RIVER',
};

export function StreetIndicator({ game }: { game: GameState }) {
  let label = STREET_LABELS[game.hand.street] ?? game.hand.street.toUpperCase();
  let modifier = 'active';

  if (game.status === 'game-complete') {
    label = 'PARTIDA ENCERRADA';
    modifier = 'complete';
  } else if (game.status === 'hand-settled') {
    label = 'MÃO LIQUIDADA';
    modifier = 'settled';
  } else if (game.hand.status === 'showdown') {
    label = 'SHOWDOWN';
    modifier = 'showdown';
  } else if (game.hand.status === 'hand_ended_by_fold') {
    label = 'MÃO ENCERRADA';
    modifier = 'ended';
  }

  return (
    <div className={`street-indicator street-${modifier}`} role="status" aria-label={`Fase da mão: ${label}`}>
      <span className="street-badge">{label}</span>
    </div>
  );
}
