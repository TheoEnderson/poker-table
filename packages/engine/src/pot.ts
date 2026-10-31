import { EngineError } from './errors.js';
import type {
  BuildPotsInput,
  Pot,
  PotPlayerInput,
  PotType,
  RoundState,
} from './types.js';

function areSetsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const item of b) {
    if (!setA.has(item)) return false;
  }
  return true;
}

export function buildPots(input: BuildPotsInput): readonly Pot[] {
  if (typeof input !== 'object' || input === null) {
    throw new EngineError('INVALID_INPUT', 'Entrada inválida para cálculo de potes.');
  }

  let rawPlayers: readonly PotPlayerInput[];
  let expectedPot: number | null = null;

  // Identifica se a entrada é um RoundState, HandFlowState, um array de jogadores ou um objeto com { players }
  if (Array.isArray(input)) {
    rawPlayers = input;
  } else if ('street' in input && 'players' in input && Array.isArray(input.players)) {
    const flow = input as unknown as {
      street: string;
      status: string;
      pot: number;
      currentRound: { status: string };
      players: readonly { id: string; totalCommitted?: number; committed: number; folded?: boolean }[];
    };

    if (flow.status === 'in_progress' && flow.currentRound?.status === 'active') {
      throw new EngineError(
        'INVALID_INPUT',
        'Não é possível construir potes definitivos durante uma rodada ativa.',
      );
    }

    if (!Number.isSafeInteger(flow.pot) || flow.pot < 0) {
      throw new EngineError(
        'INVALID_INPUT',
        'Valor total do pote inválido.',
      );
    }

    rawPlayers = flow.players.map(p => ({
      id: p.id,
      committed: p.totalCommitted ?? p.committed,
      folded: p.folded,
    }));
    expectedPot = flow.pot;
  } else if ('players' in input && Array.isArray(input.players)) {
    if ('status' in input && 'pot' in input) {
      const round = input as RoundState;

      if (round.status === 'active') {
        throw new EngineError(
          'INVALID_INPUT',
          'Não é possível construir potes definitivos durante uma rodada ativa.',
        );
      }

      if (
        round.status !== 'completed' &&
        round.status !== 'hand_ended_by_fold'
      ) {
        throw new EngineError(
          'INVALID_INPUT',
          'Status da rodada inválido.',
        );
      }

      if (!Number.isSafeInteger(round.pot) || round.pot < 0) {
        throw new EngineError(
          'INVALID_INPUT',
          'Valor total do pote inválido.',
        );
      }

      rawPlayers = round.players;
      expectedPot = round.pot;
    } else {
      rawPlayers = input.players;
    }
  } else {
    throw new EngineError('INVALID_INPUT', 'A entrada deve ser um RoundState ou uma lista de jogadores.');
  }

  // Validação estrita de jogadores e conservação numérica.
  const seenIds = new Set<string>();
  let totalCommitted = 0;

  for (const player of rawPlayers) {
    if (typeof player !== 'object' || player === null) {
      throw new EngineError('INVALID_INPUT', 'Jogador inválido na lista para cálculo de potes.');
    }
    if (typeof player.id !== 'string' || player.id.trim().length === 0) {
      throw new EngineError('INVALID_INPUT', 'O ID do jogador deve ser uma string não vazia.');
    }
    if (
      typeof player.committed !== 'number' ||
      !Number.isSafeInteger(player.committed) ||
      player.committed < 0
    ) {
      throw new EngineError(
        'INVALID_INPUT',
        `Valor de aposta comprometida inválido para o jogador ${player.id}: ${String(player.committed)}.`,
      );
    }

    if (seenIds.has(player.id)) {
      throw new EngineError(
        'INVALID_INPUT',
        `ID de jogador duplicado: ${player.id}.`,
      );
    }

    seenIds.add(player.id);

    if (totalCommitted > Number.MAX_SAFE_INTEGER - player.committed) {
      throw new EngineError(
        'INVALID_INPUT',
        'A soma das contribuições excede o limite seguro de inteiros.',
      );
    }

    totalCommitted += player.committed;
  }

  // Um RoundState deve contabilizar exatamente todas as contribuições.
  if (expectedPot !== null && expectedPot !== totalCommitted) {
    throw new EngineError(
      'INVALID_INPUT',
      'O valor do pote não corresponde à soma das contribuições.',
    );
  }

  // O construtor não movimenta fichas: as contribuições já
  // precisam ter sido regularizadas pelo motor de apostas.
  const byCommitted = [...rawPlayers].sort(
    (a, b) => b.committed - a.committed,
  );

  const highest = byCommitted[0];
  const second = byCommitted[1];

  if (
    highest &&
    !highest.folded &&
    highest.committed > (second?.committed ?? 0)
  ) {
    throw new EngineError(
      'INVALID_INPUT',
      'Existem fichas não igualadas. Regularize as contribuições antes de construir os potes.',
    );
  }

  const settledPlayers = rawPlayers;

  // Identifica jogadores ativos e níveis únicos de contribuição acima de zero
  const contributingPlayers = settledPlayers.filter(p => p.committed > 0);
  if (contributingPlayers.length === 0) {
    return Object.freeze([]);
  }

  const activePlayers = settledPlayers.filter(p => !p.folded);
  const activePlayerIds = activePlayers.map(p => p.id).sort();

  const levels = Array.from(
    new Set(contributingPlayers.map(p => p.committed)),
  ).sort((a, b) => a - b);

  interface RawSlice {
    amount: number;
    contributors: string[];
    eligible: string[];
  }

  let prevLevel = 0;
  const rawSlices: RawSlice[] = [];

  for (const level of levels) {
    const sliceContributors: string[] = [];
    const sliceEligible: string[] = [];
    let sliceAmount = 0;

    for (const p of settledPlayers) {
      const contrib = Math.max(0, Math.min(p.committed, level) - prevLevel);
      if (contrib > 0) {
        sliceAmount += contrib;
        sliceContributors.push(p.id);
        if (!p.folded && p.committed >= level) {
          sliceEligible.push(p.id);
        }
      }
    }

    if (sliceAmount > 0) {
      // Se todos os contribuintes desta fatia desistiram (dead money), a fatia é disputada pelos ativos
      const eligible = sliceEligible.length > 0 ? sliceEligible : activePlayerIds;

      rawSlices.push({
        amount: sliceAmount,
        contributors: sliceContributors.sort(),
        eligible: eligible.sort(),
      });
    }

    prevLevel = level;
  }

  // Regra fundamental: potes consecutivos com o mesmo conjunto de jogadores elegíveis
  // não devem ser divididos artificialmente.
  const mergedSlices: RawSlice[] = [];
  for (const slice of rawSlices) {
    if (mergedSlices.length === 0) {
      mergedSlices.push({
        amount: slice.amount,
        contributors: [...slice.contributors],
        eligible: [...slice.eligible],
      });
      continue;
    }

    const prev = mergedSlices[mergedSlices.length - 1];
    if (areSetsEqual(prev.eligible, slice.eligible)) {
      prev.amount += slice.amount;
      prev.contributors = Array.from(
        new Set([...prev.contributors, ...slice.contributors]),
      ).sort();
    } else {
      mergedSlices.push({
        amount: slice.amount,
        contributors: [...slice.contributors],
        eligible: [...slice.eligible],
      });
    }
  }

  const pots: Pot[] = mergedSlices.map((slice, idx) => {
    const isMain = idx === 0;
    const id = isMain ? 'main' : `side-${idx}`;
    const type: PotType = isMain ? 'main' : 'side';

    const contributors = Object.freeze([...slice.contributors]);
    const eligiblePlayers = Object.freeze([...slice.eligible]);

    return Object.freeze({
      id,
      type,
      index: idx,
      amount: slice.amount,
      contributors,
      eligiblePlayers,
      contributorIds: contributors,
      eligiblePlayerIds: eligiblePlayers,
    });
  });

  return Object.freeze(pots);
}
