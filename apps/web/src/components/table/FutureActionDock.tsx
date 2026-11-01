import type { GameState, RoomState } from '@poker-table/protocol';

export function FutureActionDock({
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

  let message = 'Aguardando o andamento da mão…';
  let badgeType: 'info' | 'turn' | 'wait' | 'alert' = 'info';
  let icon = '⏳';

  if (isSpectator) {
    message = 'Acompanhando a partida como espectador.';
    badgeType = 'info';
    icon = '👁';
  } else if (game.status === 'game-complete') {
    message = 'Partida concluída. O torneio chegou ao fim.';
    badgeType = 'info';
    icon = '🏆';
  } else if (game.status === 'hand-settled') {
    message = 'Mão liquidada. Aguardando o anfitrião iniciar a próxima mão.';
    badgeType = 'wait';
    icon = '⏳';
  } else if (isEliminated) {
    message = 'Você foi eliminado desta partida.';
    badgeType = 'alert';
    icon = '✕';
  } else if (game.hand.status === 'showdown') {
    message = 'Showdown: cartas na mesa. Aguardando a distribuição dos prêmios.';
    badgeType = 'wait';
    icon = '🃏';
  } else if (game.hand.status === 'hand_ended_by_fold') {
    message = 'Mão encerrada por desistência. Aguardando a confirmação do vencedor.';
    badgeType = 'wait';
    icon = '🏳';
  } else if (isMyTurn) {
    message = 'É sua vez de agir! Os controles de apostas chegam na próxima etapa.';
    badgeType = 'turn';
    icon = '⚡';
  } else if (game.hand.currentActorId === null) {
    message = 'Apostas igualadas. Aguardando o anfitrião avançar a rodada.';
    badgeType = 'wait';
    icon = '⏳';
  } else {
    const actor = room.players.find(p => p.id === game.hand.currentActorId);
    message = `Aguardando ${actor?.name ?? 'outro jogador'} agir…`;
    badgeType = 'wait';
    icon = '⏳';
  }

  return (
    <footer className={`future-action-dock dock-${badgeType}`} aria-label="Painel de ações">
      <div className="dock-content">
        <span className="dock-icon" aria-hidden="true">
          {icon}
        </span>
        <p className="dock-message">{message}</p>
      </div>
    </footer>
  );
}
