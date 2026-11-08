import { useEffect, useRef, useState } from 'react';
import type { GameState } from '@poker-table/protocol';
import { ChipAmount } from '../common/ChipAmount';
import { ChipStack } from '../chips/ChipStack';
import { PokerChip } from '../chips/PokerChip';

export function TablePot({ game }: { game: GameState }) {
  const isSettled = game.status === 'hand-settled' || game.status === 'game-complete';
  const totalPot = isSettled ? game.settlement.originalPot : game.hand.pot;

  // Quando a mão encerra, todas as apostas já pertencem ao pote consolidado
  const isHandOver = isSettled || game.hand.status === 'hand_ended_by_fold' || game.hand.status === 'showdown';

  // Apostas ativas ainda representadas nas posições individuais dos jogadores
  const activeBets = isHandOver
    ? 0
    : game.hand.players.reduce((sum, p) => sum + (p.roundCommitted || 0), 0);

  // Fichas recolhidas graficamente para a pilha central (elimina duplicação visual com apostas na mesa)
  const gatheredPot = Math.max(0, totalPot - activeBets);

  const isFirstMount = useRef(true);
  const prevStreet = useRef(game.hand.street);
  const prevStatus = useRef(game.hand.status);
  const prevGatheredPot = useRef(gatheredPot);
  const [displayGatheredPot, setDisplayGatheredPot] = useState(gatheredPot);
  const [potUpdated, setPotUpdated] = useState(false);

  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      setDisplayGatheredPot(gatheredPot);
      prevStreet.current = game.hand.street;
      prevStatus.current = game.hand.status;
      prevGatheredPot.current = gatheredPot;
      return;
    }

    const streetChanged = game.hand.street !== prevStreet.current;
    const statusChanged = game.hand.status !== prevStatus.current;
    const isAdvancing = streetChanged || statusChanged;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Se houve avanço de street ou encerramento da rodada, sincroniza a chegada das fichas no pote (300ms)
    if (isAdvancing && !prefersReducedMotion && gatheredPot > prevGatheredPot.current) {
      const timer = setTimeout(() => {
        setDisplayGatheredPot(gatheredPot);
        prevGatheredPot.current = gatheredPot;
        setPotUpdated(true);
        const glowTimer = setTimeout(() => setPotUpdated(false), 350);
        return () => clearTimeout(glowTimer);
      }, 300);

      prevStreet.current = game.hand.street;
      prevStatus.current = game.hand.status;
      return () => clearTimeout(timer);
    } else {
      setDisplayGatheredPot(gatheredPot);
      if (gatheredPot > prevGatheredPot.current) {
        setPotUpdated(true);
        const glowTimer = setTimeout(() => setPotUpdated(false), 350);
        return () => clearTimeout(glowTimer);
      }
      prevGatheredPot.current = gatheredPot;
    }

    prevStreet.current = game.hand.street;
    prevStatus.current = game.hand.status;
  }, [gatheredPot, game.hand.street, game.hand.status]);

  const potLabel =
    game.status === 'game-complete'
      ? 'POTE FINAL'
      : game.status === 'hand-settled'
        ? 'POTE DISTRIBUÍDO'
        : 'POTE TOTAL';

  const sidePots = game.hand.pots && game.hand.pots.length > 1 ? game.hand.pots.slice(1) : [];

  return (
    <div
      className={`table-pot ${potUpdated ? 'pot-glow-active' : ''}`}
      aria-label="Pote da mesa"
    >
      {/* 1. Fichas gráficas recolhidas (repousam no feltro em agrupamento cluster baixo, máx ~24px) */}
      {displayGatheredPot > 0 && (
        <div className="pot-chips-cluster" aria-hidden="true">
          <ChipStack
            amount={displayGatheredPot}
            variant="cluster"
            size="sm"
            maxChips={5}
          />
        </div>
      )}

      {/* 2. Badge integrada, compacta e elegante sobre o feltro */}
      <div className="pot-total-badge">
        <span className="pot-badge-title">{potLabel}</span>
        <span className="pot-badge-divider">·</span>
        <ChipAmount value={totalPot} size="sm" showSymbol={false} className="pot-value" />
      </div>

      {/* 3. Potes secundários quando existirem */}
      {sidePots.length > 0 && (
        <div className="side-pots-container" aria-label="Potes secundários">
          {sidePots.map((sp, idx) => (
            <span
              key={sp.id ?? idx}
              className="side-pot-pill tabular-nums"
              title={`Pote Paralelo ${idx + 1}: ${sp.amount} fichas`}
            >
              <PokerChip size="xs" denomination={sp.amount} aria-hidden="true" />
              <span>Pote {idx + 1}: {sp.amount}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
