import { advanceStreet } from '@poker-table/engine';
import type { PreAction } from '@poker-table/protocol';
import type { StoredGame } from '../persistence/hand.js';

type ActiveGame = Extract<StoredGame, { status: 'hand-active' }>;

/**
 * Avança automaticamente as streets no modo de cartas físicas sempre que uma
 * rodada de apostas for concluída (preflop -> flop -> turn -> river -> showdown),
 * descartando pré-ações pendentes ao trocar de street.
 * Mãos encerradas por fold (`hand_ended_by_fold`) permanecem para liquidação imediata.
 */
export function resolvePhysicalProgression<T extends ActiveGame>(game: T): T {
  let hand = game.hand;
  const startingStreet = hand.street;

  while (hand.status === 'in_progress' && hand.currentRound.status === 'completed') {
    hand = advanceStreet(hand);
  }

  const { preActions: previousPreActions, ...restGame } = game;
  const nextPreActions: Readonly<Record<string, PreAction>> | undefined =
    hand.status === 'in_progress' && hand.street === startingStreet
      ? previousPreActions
      : undefined;

  return {
    ...restGame,
    hand,
    ...(nextPreActions !== undefined ? { preActions: nextPreActions } : {}),
  } as T;
}
