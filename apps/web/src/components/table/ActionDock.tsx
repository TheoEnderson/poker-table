import { useEffect, useState } from 'react';
import type { CommandInput, GameState, RoomState } from '@poker-table/protocol';
import { ConfirmDialog } from '../ConfirmDialog';
import { RaiseControl } from './RaiseControl';

export function ActionDock({
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
  const [showRaise, setShowRaise] = useState(false);
  const [confirmFold, setConfirmFold] = useState(false);
  const [confirmAllIn, setConfirmAllIn] = useState(false);
  const [allInIntent, setAllInIntent] = useState<
    | { type: 'button' }
    | { type: 'raise'; amount: number }
    | { type: 'call' }
    | null
  >(null);

  const meInRoom = room.players.find(p => p.id === selfId);
  const meInHand = game.hand.players.find(p => p.id === selfId);

  const isSpectator = !meInRoom || meInRoom.seat === null;
  const isSettled = game.status === 'hand-settled' || game.status === 'game-complete';
  const settledPlayer = isSettled && meInHand
    ? game.settlement.players.find(p => p.id === selfId)
    : null;

  const currentChips = settledPlayer ? settledPlayer.chips : (meInHand?.chips ?? 0);
  const isEliminated = !isSpectator && ((isSettled && currentChips === 0) || (meInRoom?.seat !== null && !meInHand));
  const isFolded = settledPlayer ? settledPlayer.folded : (meInHand?.folded ?? false);
  const isAllIn = settledPlayer ? settledPlayer.isAllIn : (meInHand?.isAllIn ?? false);

  const isMyTurn =
    !isSpectator &&
    !isFolded &&
    !isAllIn &&
    !isEliminated &&
    game.hand.status === 'in_progress' &&
    game.hand.currentActorId === selfId;

  const allowed = game.hand.allowedActions;
  const isActionDisabled = disabled || pending;

  // Limpeza de estado transitório quando a oportunidade de ação não for mais válida
  useEffect(() => {
    setShowRaise(false);
    setConfirmFold(false);
    setConfirmAllIn(false);
    setAllInIntent(null);
  }, [
    game.hand.street,
    game.hand.currentActorId,
    game.hand.dealerSeat,
    room.revision,
    isMyTurn,
  ]);

  // Handlers
  const handleFold = async () => {
    const success = await command({ type: 'game-action', action: 'fold' });
    if (success) setConfirmFold(false);
  };

  const handleCheck = async () => {
    await command({ type: 'game-action', action: 'check' });
  };

  const handleCall = async () => {
    await command({ type: 'game-action', action: 'call' });
  };

  const handleRaiseSubmit = async (amount: number) => {
    const isMaxAllIn =
      allowed != null && allowed.maxRaiseAmount !== null && amount === allowed.maxRaiseAmount;
    const commitsEntireStack = (amount - (meInHand?.roundCommitted ?? 0)) >= currentChips;

    if (isMaxAllIn || commitsEntireStack) {
      setAllInIntent({ type: 'raise', amount });
      setConfirmAllIn(true);
      return;
    }

    const success = await command({ type: 'game-action', action: 'raise', amount });
    if (success) setShowRaise(false);
  };

  const handleAllInConfirm = async () => {
    if (!allInIntent) return;

    let success = false;
    if (allInIntent.type === 'raise') {
      success = await command({ type: 'game-action', action: 'raise', amount: allInIntent.amount });
    } else if (allInIntent.type === 'call') {
      success = await command({ type: 'game-action', action: 'call' });
    } else {
      success = await command({ type: 'game-action', action: 'all-in' });
    }

    if (success) {
      setConfirmAllIn(false);
      setAllInIntent(null);
      setShowRaise(false);
    }
  };

  // Se não for a vez do jogador, renderiza dock informativo
  if (!isMyTurn) {
    const isHost = meInRoom?.isHost ?? false;

    // Se o jogador for anfitrião e já possuir um painel administrativo ativo e funcional
    // (Avanço de Street, Apuração de Showdown, Liquidação de Fold ou Início da Próxima Mão),
    // não renderiza uma mensagem inferior redundante que apenas repita a instrução do painel.
    const hasHostStreetControl =
      isHost &&
      game.status === 'hand-active' &&
      game.hand.status === 'in_progress' &&
      game.hand.canAdvanceStreet === true;

    const hasHostSettlementControl =
      isHost &&
      ((game.status === 'hand-active' &&
        (game.hand.status === 'showdown' || game.hand.status === 'hand_ended_by_fold')) ||
        game.status === 'hand-settled');

    if (hasHostStreetControl || hasHostSettlementControl) {
      return null;
    }

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
    } else if (isFolded) {
      message = 'Você desistiu desta mão (Fold). Aguardando próxima rodada.';
      badgeType = 'info';
      icon = '🏳';
    } else if (isAllIn) {
      message = 'Você está em All-in. Aguardando o desfecho da mão.';
      badgeType = 'info';
      icon = '⚡';
    } else if (game.hand.status === 'showdown') {
      message = 'Showdown: cartas na mesa. Aguardando a distribuição dos prêmios.';
      badgeType = 'wait';
      icon = '🃏';
    } else if (game.hand.status === 'hand_ended_by_fold') {
      message = 'Mão encerrada por desistência. Aguardando a confirmação do vencedor.';
      badgeType = 'wait';
      icon = '🏳';
    } else if (game.hand.currentActorId === null) {
      if (game.hand.street === 'preflop') {
        message = 'Aguardando o anfitrião iniciar o Flop.';
      } else if (game.hand.street === 'flop') {
        message = 'Aguardando o anfitrião iniciar o Turn.';
      } else if (game.hand.street === 'turn') {
        message = 'Aguardando o anfitrião iniciar o River.';
      } else {
        message = 'Rodada de apostas encerrada. Aguardando Showdown.';
      }
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

  // É a vez do jogador: Console Funcional de Apostas
  const isBet = (allowed?.currentBet ?? 0) === 0;

  // Se o jogador estiver enfrentando uma aposta e o valor necessário para pagar
  // consumir todo o seu stack disponível (ou allInType for 'call'), o Call já é um All-in.
  const isCallAllIn =
    allowed?.canCall === true &&
    (allowed.allInType === 'call' || currentChips <= allowed.callAmount);

  // Distinção entre All-in total (que iguala o valor da aposta) e All-in parcial (insuficiente para igualar)
  const isPartialCallAllIn =
    isCallAllIn &&
    (meInHand?.roundCommitted ?? 0) + currentChips < (allowed?.currentBet ?? 0);

  // O botão dedicado "All-in" só deve ser exibido quando representar um Aumento (Raise)
  // ou quando o jogador não estiver em uma situação onde o Call já seja o seu único All-in.
  // Evita a redundância de exibir "Pagar X (All-in)" e "All-in (X)" lado a lado.
  const showDedicatedAllInButton =
    allowed?.canAllIn === true && !isCallAllIn;

  return (
    <footer className="action-dock action-dock-active" aria-label="Painel de ações de aposta">
      {showRaise && allowed?.canRaise && allowed.minRaiseAmount !== null && allowed.maxRaiseAmount !== null ? (
        <RaiseControl
          minRaiseAmount={allowed.minRaiseAmount}
          maxRaiseAmount={allowed.maxRaiseAmount}
          minRaiseIncrement={allowed.minRaiseIncrement ?? game.hand.bigBlind}
          playerRoundCommitted={meInHand?.roundCommitted ?? 0}
          playerChips={currentChips}
          pot={game.hand.pot}
          currentBet={allowed.currentBet ?? 0}
          isBet={isBet}
          disabled={isActionDisabled}
          onConfirm={amount => void handleRaiseSubmit(amount)}
          onCancel={() => setShowRaise(false)}
        />
      ) : (
        <div className="action-dock-content">
          {allowed?.actionNotReopened && (
            <p className="action-dock-note" role="status">
              A aposta anterior não reabriu o aumento. Você só pode pagar ou desistir.
            </p>
          )}

          <div className="action-buttons-grid">
            {/* 1. Fold */}
            <button
              type="button"
              className="action-btn action-btn-fold"
              disabled={isActionDisabled}
              onClick={() => setConfirmFold(true)}
              aria-label="Desistir desta mão"
            >
              Desistir (Fold)
            </button>

            {/* 2. Check ou Call */}
            {allowed?.canCheck ? (
              <button
                type="button"
                className="action-btn action-btn-check"
                disabled={isActionDisabled}
                onClick={() => void handleCheck()}
                aria-label="Passar a vez (Check)"
              >
                Passar (Check)
              </button>
            ) : allowed?.canCall ? (
              <button
                type="button"
                className="action-btn action-btn-call"
                disabled={isActionDisabled}
                onClick={() => {
                  if (isCallAllIn) {
                    setAllInIntent({ type: 'call' });
                    setConfirmAllIn(true);
                  } else {
                    void handleCall();
                  }
                }}
                aria-label={
                  isPartialCallAllIn
                    ? `Pagar ${allowed.callAmount.toLocaleString('pt-BR')} fichas (All-in parcial)`
                    : isCallAllIn
                      ? `Pagar ${allowed.callAmount.toLocaleString('pt-BR')} fichas (All-in)`
                      : `Pagar ${allowed.callAmount.toLocaleString('pt-BR')} fichas`
                }
              >
                Pagar {allowed.callAmount.toLocaleString('pt-BR')}
                {isCallAllIn ? ' (All-in)' : ''}
              </button>
            ) : null}

            {/* 3. Raise ou Bet */}
            {allowed?.canRaise && (
              <button
                type="button"
                className="action-btn action-btn-raise"
                disabled={isActionDisabled}
                onClick={() => setShowRaise(true)}
                aria-label={isBet ? 'Abrir opções de aposta' : 'Abrir opções de aumento de aposta'}
              >
                {isBet ? 'Apostar' : 'Aumentar (Raise)'}
              </button>
            )}

            {/* 4. All-in (apenas quando for ação distinta do call) */}
            {showDedicatedAllInButton && (
              <button
                type="button"
                className="action-btn action-btn-allin"
                disabled={isActionDisabled}
                onClick={() => {
                  setAllInIntent({ type: 'button' });
                  setConfirmAllIn(true);
                }}
                aria-label={`Apostar tudo: ${allowed.allInAmount} fichas`}
              >
                All-in ({allowed.allInAmount?.toLocaleString('pt-BR')})
              </button>
            )}
          </div>
        </div>
      )}

      {/* Confirmação de Fold */}
      <ConfirmDialog
        open={confirmFold}
        title="Confirmar desistência?"
        description="Você sairá desta mão e abrirá mão de disputar as fichas do pote atual."
        confirmLabel="Desistir da mão"
        pending={pending}
        onCancel={() => setConfirmFold(false)}
        onConfirm={() => void handleFold()}
      />

      {/* Confirmação de All-in */}
      <ConfirmDialog
        open={confirmAllIn}
        title="Confirmar All-in?"
        description={
          allInIntent?.type === 'raise'
            ? `Você apostará todas as suas ${currentChips.toLocaleString('pt-BR')} fichas restantes na mesa (aumento total de ${allInIntent.amount.toLocaleString('pt-BR')} fichas na rodada).`
            : allInIntent?.type === 'call'
              ? isPartialCallAllIn
                ? `Você pagará com todas as suas ${currentChips.toLocaleString('pt-BR')} fichas restantes na mesa (All-in parcial insuficiente para cobrir o total da aposta).`
                : `Você pagará com todas as suas ${currentChips.toLocaleString('pt-BR')} fichas restantes na mesa (All-in).`
              : `Você apostará todas as suas ${currentChips.toLocaleString('pt-BR')} fichas restantes na mesa.`
        }
        confirmLabel="Confirmar All-in"
        pending={pending}
        onCancel={() => {
          setConfirmAllIn(false);
          setAllInIntent(null);
        }}
        onConfirm={() => void handleAllInConfirm()}
      />
    </footer>
  );
}
