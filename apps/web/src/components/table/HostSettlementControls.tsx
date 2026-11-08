import { useEffect, useState } from 'react';
import type { CommandInput, GameState, RoomState } from '@poker-table/protocol';
import { ConfirmDialog } from '../ConfirmDialog';
import { ChipAmount } from '../common/ChipAmount';

export function HostSettlementControls({
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
  const [confirmSettle, setConfirmSettle] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [selectedWinners, setSelectedWinners] = useState<Record<string, string[]>>({});
  const [tieMode, setTieMode] = useState<Record<string, boolean>>({});

  const me = room.players.find(p => p.id === selfId);
  const isHost = me?.isHost ?? false;
  const isHandActive = game.status === 'hand-active';
  const isHandSettled = game.status === 'hand-settled';
  const isGameComplete = game.status === 'game-complete';
  const isShowdown = isHandActive && game.hand.status === 'showdown';
  const isFoldEnded = isHandActive && game.hand.status === 'hand_ended_by_fold';

  const pots = game.hand.pots ?? [];

  // Reset / sync selected winners when revision or hand changes
  useEffect(() => {
    setConfirmSettle(false);
    setConfirmReset(false);
    if (isShowdown && pots.length > 0) {
      setSelectedWinners(prev => {
        const next: Record<string, string[]> = { ...prev };
        for (const pot of pots) {
          if (pot.eligiblePlayers.length === 1) {
            next[pot.id] = [pot.eligiblePlayers[0]];
          } else if (!next[pot.id] || next[pot.id].length === 0) {
            // Unselected
          } else {
            next[pot.id] = next[pot.id].filter(id => pot.eligiblePlayers.includes(id));
          }
        }
        return next;
      });
    } else {
      setSelectedWinners({});
      setTieMode({});
    }
  }, [room.revision, game.status, game.hand.street, game.hand.status, isShowdown]);

  if (!isHost) return null;

  const handleConfirmResetGame = async () => {
    const ok = await command({ type: 'reset-game' });
    if (ok) setConfirmReset(false);
  };

  // 1. Next hand state: hand is settled and game is not complete
  if (isHandSettled) {
    return (
      <section className="host-settlement-controls host-next-hand-panel" aria-label="Controle de próxima mão">
        <div className="host-settlement-card">
          <div className="settlement-status-badge">
            <span className="badge-icon" aria-hidden="true">✓</span>
            <span>Mão liquidada</span>
          </div>
          <p className="next-hand-hint">Fichas distribuídas e stacks atualizados. Pronto para iniciar a próxima rodada.</p>
          <div className="host-settlement-actions-row">
            <button
              type="button"
              className="action-btn-primary next-hand-btn"
              disabled={pending || disabled}
              onClick={() => command({ type: 'next-hand' })}
            >
              {pending ? 'Iniciando…' : 'Iniciar Próxima Mão ♠'}
            </button>
            <button
              type="button"
              className="action-btn-secondary reset-game-btn"
              disabled={pending || disabled}
              onClick={() => setConfirmReset(true)}
            >
              Nova Partida / Reiniciar Fichas 🔄
            </button>
          </div>
        </div>

        <ConfirmDialog
          open={confirmReset}
          title="Iniciar Nova Partida e Reiniciar Fichas?"
          description={`Esta ação iniciará uma nova partida mantendo os mesmos participantes e assentos.\n\n• Todos os participantes sentados receberão ${room.config.startingChips.toLocaleString('pt-BR')} fichas.\n• Os saldos da partida anterior serão substituídos pelas fichas iniciais.\n• Jogadores anteriormente eliminados voltarão ao jogo com fichas cheias.\n\nDeseja confirmar a reinicialização da partida?`}
          confirmLabel="Reiniciar Fichas"
          onCancel={() => setConfirmReset(false)}
          onConfirm={handleConfirmResetGame}
          pending={pending}
        />
      </section>
    );
  }

  // 2. Fold-ended state: engine already knows single survivor
  if (isFoldEnded) {
    const survivorId = game.hand.survivorId ?? game.hand.players.find(p => !p.folded)?.id;
    const survivor = room.players.find(p => p.id === survivorId);
    const survivorName = survivor?.name ?? 'Jogador';

    const handleConfirmFoldSettle = async () => {
      const ok = await command({ type: 'settle-hand', decisions: [] });
      if (ok) setConfirmSettle(false);
    };

    return (
      <section className="host-settlement-controls host-fold-settlement" aria-label="Liquidação por desistência">
        <div className="host-settlement-card">
          <div className="settlement-status-badge fold-badge">
            <span className="badge-icon" aria-hidden="true">🏳</span>
            <span>Mão encerrada por desistência</span>
          </div>
          <div className="fold-winner-info">
            <span className="winner-label">Vencedor da mão:</span>
            <strong className="winner-name">
              #{survivor?.seat} {survivorName}
            </strong>
            <span className="winner-pot">
              Pote a receber: <ChipAmount value={game.hand.pot} size="sm" />
            </span>
          </div>
          <button
            type="button"
            className="action-btn-primary settle-fold-btn"
            disabled={pending || disabled}
            onClick={() => setConfirmSettle(true)}
          >
            Confirmar distribuição das fichas
          </button>
        </div>

        <ConfirmDialog
          open={confirmSettle}
          title="Confirmar Distribuição das Fichas?"
          description={`Mão encerrada por desistência.\nVencedor: ${survivorName} (Assento #${survivor?.seat ?? '-'}).\nTotal a transferir: ${game.hand.pot} fichas.`}
          confirmLabel="Confirmar Distribuição"
          onCancel={() => setConfirmSettle(false)}
          onConfirm={handleConfirmFoldSettle}
          pending={pending}
        />
      </section>
    );
  }

  // 3. Showdown state: host selects winners for each pot
  if (isShowdown) {
    const allPotsResolved = pots.length > 0 && pots.every(p => (selectedWinners[p.id]?.length ?? 0) > 0);

    const togglePlayer = (potId: string, playerId: string) => {
      const isMulti = tieMode[potId] ?? false;
      setSelectedWinners(prev => {
        const current = prev[potId] ?? [];
        if (isMulti) {
          if (current.includes(playerId)) {
            return { ...prev, [potId]: current.filter(id => id !== playerId) };
          } else {
            return { ...prev, [potId]: [...current, playerId] };
          }
        } else {
          if (current.length === 1 && current[0] === playerId) {
            return { ...prev, [potId]: [] };
          }
          return { ...prev, [potId]: [playerId] };
        }
      });
    };

    const toggleTie = (potId: string) => {
      const willEnableTie = !tieMode[potId];
      setTieMode(prev => ({ ...prev, [potId]: willEnableTie }));

      if (!willEnableTie) {
        setSelectedWinners(prev => {
          const current = prev[potId] ?? [];
          if (current.length > 1) {
            return { ...prev, [potId]: [current[0]] };
          }
          return prev;
        });
      }
    };

    const handleConfirmShowdownSettle = async () => {
      const decisions = pots.map(p => ({
        potId: p.id,
        winners: selectedWinners[p.id] ?? [],
      }));
      const ok = await command({ type: 'settle-hand', decisions });
      if (ok) setConfirmSettle(false);
    };

    const summaryLines = pots.map(p => {
      const title = p.type === 'main' ? 'Pote Principal' : `Pote Paralelo ${p.index}`;
      const winners = selectedWinners[p.id] ?? [];
      const winnerNames = winners
        .map(id => {
          const pl = room.players.find(rp => rp.id === id);
          return pl ? `${pl.name} (#${pl.seat})` : id;
        })
        .join(', ');
      const tieTag = winners.length > 1 ? ` [Empate - ${winners.length} jogadores]` : '';
      return `• ${title} (${p.amount} fichas): ${winnerNames || 'Não selecionado'}${tieTag}`;
    });

    return (
      <section className="host-settlement-controls host-showdown-panel" aria-label="Painel de apuração do showdown">
        <div className="host-settlement-card">
          <div className="settlement-status-badge showdown-badge">
            <span className="badge-icon" aria-hidden="true">🃏</span>
            <span>Showdown — Seleção de Vencedores</span>
          </div>

          {game.hand.street !== 'river' && (
            <div className="early-showdown-notice" role="alert">
              <span className="notice-icon" aria-hidden="true">⚠️</span>
              <div className="notice-content">
                <strong>Showdown antecipado por All-in</strong>
                <p>
                  Revele todas as cartas comunitárias restantes na mesa física antes de declarar os vencedores.
                </p>
              </div>
            </div>
          )}

          <p className="showdown-instruction">
            Examine as cartas físicas na mesa e selecione o vencedor de cada pote:
          </p>

          <div className="showdown-pots-list">
            {pots.map(pot => {
              const potTitle = pot.type === 'main' ? 'Pote Principal' : `Pote Paralelo ${pot.index}`;
              const winners = selectedWinners[pot.id] ?? [];
              const isResolved = winners.length > 0;
              const isTie = winners.length > 1;
              const hasSingleEligible = pot.eligiblePlayers.length === 1;

              return (
                <div key={pot.id} className={`showdown-pot-box ${isResolved ? 'pot-resolved' : 'pot-pending'}`}>
                  <div className="pot-box-header">
                    <div>
                      <strong className="pot-box-title">{potTitle}</strong>
                      <span className="pot-box-amount">
                        <ChipAmount value={pot.amount} size="sm" />
                      </span>
                    </div>
                    <span className={`pot-resolution-pill ${isResolved ? 'pill-resolved' : 'pill-pending'}`}>
                      {isTie
                        ? `⚖️ Empate (${winners.length})`
                        : isResolved
                          ? '✓ Definido'
                          : '⚠️ Pendente'}
                    </span>
                  </div>

                  {!hasSingleEligible && (
                    <div className="tie-mode-row">
                      <button
                        type="button"
                        className={`tie-toggle-btn ${tieMode[pot.id] ? 'tie-active' : ''}`}
                        onClick={() => toggleTie(pot.id)}
                        disabled={pending || disabled}
                        aria-pressed={tieMode[pot.id] ?? false}
                        aria-label={tieMode[pot.id] ? 'Empate ativado para este pote' : 'Ativar empate para este pote'}
                      >
                        {tieMode[pot.id] ? '✓ Empate ativado' : '⚖ Ativar empate'}
                      </button>
                    </div>
                  )}

                  <div className="eligible-candidates-grid">
                    {pot.eligiblePlayers.map(playerId => {
                      const pl = room.players.find(p => p.id === playerId);
                      const isSelected = winners.includes(playerId);
                      const name = pl?.name ?? 'Jogador';

                      return (
                        <button
                          key={playerId}
                          type="button"
                          className={`candidate-winner-btn ${isSelected ? 'candidate-selected' : ''}`}
                          onClick={() => togglePlayer(pot.id, playerId)}
                          disabled={pending || disabled || hasSingleEligible}
                          aria-pressed={isSelected}
                        >
                          <span className="candidate-seat">#{pl?.seat}</span>
                          <span className="candidate-name">{name}</span>
                          {isSelected && <span className="candidate-check">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            className="action-btn-primary settle-showdown-btn"
            disabled={!allPotsResolved || pending || disabled}
            onClick={() => setConfirmSettle(true)}
          >
            {pending ? 'Enviando…' : 'Confirmar Liquidação do Showdown ♠'}
          </button>
        </div>

        <ConfirmDialog
          open={confirmSettle}
          title="Confirmar Liquidação do Showdown?"
          description={`Revise as premiações decididas com base nas cartas físicas:\n\n${summaryLines.join('\n')}\n\nAs fichas serão creditadas imediatamente nos stacks dos vencedores.`}
          confirmLabel="Confirmar Liquidação"
          onCancel={() => setConfirmSettle(false)}
          onConfirm={handleConfirmShowdownSettle}
          pending={pending}
        />
      </section>
    );
  }

  if (isGameComplete) {
    return (
      <section className="host-settlement-controls host-game-complete-panel" aria-label="Controle de fim de partida">
        <div className="host-settlement-card">
          <div className="settlement-status-badge complete-badge">
            <span className="badge-icon" aria-hidden="true">🏆</span>
            <span>Partida Concluída</span>
          </div>
          <p className="next-hand-hint">
            Todas as fichas foram conquistadas. Você pode iniciar uma nova partida mantendo os mesmos participantes e assentos com as fichas iniciais restauradas.
          </p>
          <button
            type="button"
            className="action-btn-primary reset-game-btn"
            disabled={pending || disabled}
            onClick={() => setConfirmReset(true)}
          >
            {pending ? 'Reiniciando…' : 'Nova Partida / Reiniciar Fichas 🔄'}
          </button>
        </div>

        <ConfirmDialog
          open={confirmReset}
          title="Iniciar Nova Partida e Reiniciar Fichas?"
          description={`Esta ação iniciará uma nova partida mantendo os mesmos participantes e assentos.\n\n• Todos os participantes sentados receberão ${room.config.startingChips.toLocaleString('pt-BR')} fichas.\n• Os saldos da partida anterior serão substituídos pelas fichas iniciais.\n• Jogadores anteriormente eliminados voltarão ao jogo com fichas cheias.\n\nDeseja confirmar a reinicialização da partida?`}
          confirmLabel="Reiniciar Fichas"
          onCancel={() => setConfirmReset(false)}
          onConfirm={handleConfirmResetGame}
          pending={pending}
        />
      </section>
    );
  }

  return null;
}
