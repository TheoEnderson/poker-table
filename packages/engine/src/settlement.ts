import { EngineError } from './errors.js';
import { buildPots } from './pot.js';
import { settleUncalled } from './round.js';
import type {
  PlayerPotAward,
  Pot,
  PotAward,
  PotWinnerDecision,
  RoundPlayer,
  RoundState,
  SettledPlayer,
  SettlementResult,
  SettlementSummary,
} from './types.js';

/** Soma fichas sem ultrapassar os inteiros seguros do JavaScript. */
function addSafeChips(a: number, b: number, context: string): number {
  if (
    !Number.isSafeInteger(a) ||
    !Number.isSafeInteger(b) ||
    a < 0 ||
    b < 0 ||
    a > Number.MAX_SAFE_INTEGER - b
  ) {
    throw new EngineError(
      'INVALID_CHIPS',
      `Total de fichas inválido: ${context}.`,
    );
  }

  return a + b;
}

/**
 * Retorna a lista de assentos ocupados ordenados no sentido horário,
 * iniciando imediatamente à esquerda do assento do dealer.
 * Posições vazias são ignoradas naturalmente.
 */
export function getClockwiseOrderFromDealer<T extends { id: string; seat: number }>(
  players: readonly T[],
  dealerSeat: number,
): readonly T[] {
  if (players.length === 0) return Object.freeze([]);

  const sorted = [...players].sort((a, b) => a.seat - b.seat);
  const dealerIdx = sorted.findIndex(p => p.seat === dealerSeat);
  const count = sorted.length;

  let startIdx: number;
  if (dealerIdx !== -1) {
    // Primeiro jogador à esquerda do dealer
    startIdx = (dealerIdx + 1) % count;
  } else {
    // Se dealerSeat não corresponder a um assento na lista (ex: assento vazio),
    // avança para o primeiro assento ocupado maior que dealerSeat
    const nextIdx = sorted.findIndex(p => p.seat > dealerSeat);
    startIdx = nextIdx !== -1 ? nextIdx : 0;
  }

  const result: T[] = [];
  for (let i = 0; i < count; i++) {
    result.push(sorted[(startIdx + i) % count]);
  }
  return Object.freeze(result);
}

/**
 * Identifica se um pote necessita de confirmação manual de vencedor(es)
 * (ou seja, possui mais de 1 jogador elegível).
 */
export function requiresDecision(pot: Pot): boolean {
  return pot.eligiblePlayers.length > 1;
}

/**
 * Filtra os potes que necessitam de confirmação manual de vencedores.
 */
export function getPotsRequiringDecision(pots: readonly Pot[]): readonly Pot[] {
  return Object.freeze(pots.filter(p => p.eligiblePlayers.length > 1));
}

/**
 * Filtra os potes que possuem exatamente um jogador elegível (atribuídos automaticamente).
 */
export function getPotsWithSingleEligible(pots: readonly Pot[]): readonly Pot[] {
  return Object.freeze(pots.filter(p => p.eligiblePlayers.length === 1));
}

/**
 * Distribui de forma pura e determinística os potes de uma mão encerrada de Texas Hold'em.
 *
 * Implementa a Regra 21 da Poker TDA 2026 para Texas Hold'em:
 * Em caso de empate, o pote é dividido em partes inteiras iguais e as fichas excedentes
 * (odd chips) são distribuídas uma a uma, em sentido horário, começando pelo primeiro
 * jogador à esquerda do dealer.
 *
 * Nota arquitetural de prevenção de duplicidade:
 * Como o motor é puro e livre de efeitos colaterais globais, o servidor/camada de persistência
 * é responsável por persistir o SettlementResult e rejeitar comandos de liquidação redundantes.
 * Qualquer tentativa de passar um resultado já liquidado a esta função dispara EngineError('ALREADY_SETTLED').
 */
export function settleHand(
  round: RoundState,
  decisions: readonly PotWinnerDecision[] = [],
): SettlementResult {
  if (typeof round !== 'object' || round === null) {
    throw new EngineError('INVALID_INPUT', 'Estado inválido para liquidação.');
  }

  const candidate = round as unknown as Record<string, unknown>;

  // Prevenção de liquidação duplicada
  if (candidate.isSettled === true || candidate.status === 'settled') {
    throw new EngineError(
      'ALREADY_SETTLED',
      'Esta mão já foi liquidada e não pode ser liquidada novamente.',
    );
  }

  if (round.status === 'active') {
    throw new EngineError(
      'ROUND_NOT_ACTIVE',
      'Não é possível liquidar uma rodada ainda ativa.',
    );
  }

  if (
    round.status !== 'completed' &&
    round.status !== 'hand_ended_by_fold'
  ) {
    throw new EngineError(
      'INVALID_INPUT',
      `Status da rodada inválido para liquidação: ${String(candidate.status)}.`,
    );
  }

  // Valida o estado original antes de qualquer restituição.
  if (!Array.isArray(round.players) || round.players.length === 0) {
    throw new EngineError(
      'INVALID_INPUT',
      'Lista original de jogadores inválida.',
    );
  }

  if (!Number.isSafeInteger(round.pot) || round.pot < 0) {
    throw new EngineError('INVALID_CHIPS', 'Pote original inválido.');
  }

  let initialChipsSum = round.pot;

  for (const player of round.players) {
    if (typeof player !== 'object' || player === null) {
      throw new EngineError(
        'INVALID_INPUT',
        'Jogador inválido no estado original.',
      );
    }

    if (!Number.isSafeInteger(player.chips) || player.chips < 0) {
      throw new EngineError(
        'INVALID_CHIPS',
        `Stack inicial inválido: ${player.id}.`,
      );
    }

    initialChipsSum = addSafeChips(
      initialChipsSum,
      player.chips,
      'mesa antes da liquidação',
    );
  }

  // Devolve eventuais apostas não igualadas antes de apurar os prêmios.
  const roundState = settleUncalled(round);

  if (!Array.isArray(roundState.players) || roundState.players.length === 0) {
    throw new EngineError('INVALID_INPUT', 'Lista de jogadores inválida no estado da rodada.');
  }

  const playerById = new Map<string, RoundPlayer>();
  const seenPlayerIds = new Set<string>();

  for (const player of roundState.players) {
    if (typeof player !== 'object' || player === null) {
      throw new EngineError('INVALID_INPUT', 'Jogador inválido no estado da rodada.');
    }
    if (typeof player.id !== 'string' || player.id.trim().length === 0) {
      throw new EngineError('INVALID_INPUT', 'O ID do jogador deve ser uma string não vazia.');
    }
    if (seenPlayerIds.has(player.id)) {
      throw new EngineError('DUPLICATE_PLAYER_ID', `ID de jogador duplicado: ${player.id}.`);
    }
    seenPlayerIds.add(player.id);
    playerById.set(player.id, player);
  }

  if (!Number.isSafeInteger(roundState.pot) || roundState.pot < 0) {
    throw new EngineError('INVALID_CHIPS', 'Valor total do pote inválido.');
  }

  // Constroi os potes da rodada
  const pots = buildPots(roundState);

  const isFoldEnding = roundState.status === 'hand_ended_by_fold';
  let foldSurvivorId: string | null = null;
  if (isFoldEnding) {
    const survivors = roundState.players.filter(p => !p.folded);
    if (survivors.length !== 1) {
      throw new EngineError(
        'INVALID_INPUT',
        `Encerramento por fold deve ter exatamente 1 jogador ativo, encontrado: ${survivors.length}.`,
      );
    }
    foldSurvivorId = survivors[0].id;
  }

  if (!Array.isArray(decisions)) {
    throw new EngineError('INVALID_INPUT', 'As decisões de vencedores devem ser fornecidas em um array.');
  }

  const decisionsByPotId = new Map<string, readonly string[]>();
  const seenPotIds = new Set<string>();

  for (const decision of decisions) {
    if (typeof decision !== 'object' || decision === null) {
      throw new EngineError('INVALID_INPUT', 'Decisão de pote inválida.');
    }
    if (typeof decision.potId !== 'string' || decision.potId.trim().length === 0) {
      throw new EngineError('INVALID_INPUT', 'Identificador do pote inválido na decisão.');
    }

    if (seenPotIds.has(decision.potId)) {
      throw new EngineError('DUPLICATE_DECISION', `Decisão duplicada para o pote: ${decision.potId}.`);
    }
    seenPotIds.add(decision.potId);

    const targetPot = pots.find(p => p.id === decision.potId);
    if (!targetPot) {
      throw new EngineError('INVALID_POT', `Pote não encontrado na mão: ${decision.potId}.`);
    }

    if (
      Object.prototype.hasOwnProperty.call(decision, 'winnerIds') &&
      Object.prototype.hasOwnProperty.call(decision, 'winners')
    ) {
      throw new EngineError(
        'INVALID_INPUT',
        `A decisão do pote ${decision.potId} deve usar winners OU winnerIds, não ambos.`,
      );
    }

    const rawWinnerIds = decision.winnerIds ?? decision.winners;
    if (!Array.isArray(rawWinnerIds) || rawWinnerIds.length === 0) {
      throw new EngineError('INVALID_INPUT', `A lista de vencedores para o pote ${decision.potId} não pode ser vazia.`);
    }

    const seenWinnersInPot = new Set<string>();
    for (const winnerId of rawWinnerIds) {
      if (typeof winnerId !== 'string' || winnerId.trim().length === 0) {
        throw new EngineError('INVALID_INPUT', `ID de vencedor inválido no pote ${decision.potId}.`);
      }
      if (seenWinnersInPot.has(winnerId)) {
        throw new EngineError('INVALID_INPUT', `Vencedor duplicado ${winnerId} na decisão para o pote ${decision.potId}.`);
      }
      seenWinnersInPot.add(winnerId);

      const player = playerById.get(winnerId);
      if (!player) {
        throw new EngineError('PLAYER_NOT_FOUND', `Jogador vencedor não encontrado na mesa: ${winnerId}.`);
      }

      if (isFoldEnding && foldSurvivorId && winnerId !== foldSurvivorId) {
        throw new EngineError(
          'INELIGIBLE_WINNER',
          `Em encerramento por fold, apenas o jogador sobrevivente (${foldSurvivorId}) pode receber potes.`,
        );
      }

      if (!targetPot.eligiblePlayers.includes(winnerId)) {
        throw new EngineError(
          'INELIGIBLE_WINNER',
          `O jogador ${winnerId} não é elegível para disputar o pote ${targetPot.id}.`,
        );
      }
    }

    decisionsByPotId.set(decision.potId, Object.freeze([...rawWinnerIds]));
  }

  // Verifica se todos os potes possuem decisões ou são atribuídos automaticamente
  for (const pot of pots) {
    if (pot.eligiblePlayers.length === 0) {
      continue;
    }

    if (isFoldEnding && foldSurvivorId) {
      if (!decisionsByPotId.has(pot.id)) {
        decisionsByPotId.set(pot.id, [foldSurvivorId]);
      }
      continue;
    }

    if (pot.eligiblePlayers.length === 1) {
      const soleEligible = pot.eligiblePlayers[0];
      if (!decisionsByPotId.has(pot.id)) {
        decisionsByPotId.set(pot.id, [soleEligible]);
      } else {
        const declared = decisionsByPotId.get(pot.id)!;
        if (declared.length !== 1 || declared[0] !== soleEligible) {
          throw new EngineError(
            'INELIGIBLE_WINNER',
            `O pote ${pot.id} possui apenas um jogador elegível (${soleEligible}).`,
          );
        }
      }
      continue;
    }

    if (!decisionsByPotId.has(pot.id)) {
      throw new EngineError(
        'MISSING_DECISION',
        `Decisão ausente para o pote disputado ${pot.id}.`,
      );
    }
  }

  const clockwisePlayers = getClockwiseOrderFromDealer(roundState.players, roundState.dealerSeat);
  const potAwards: PotAward[] = [];
  const playerWinnings = new Map<string, number>();

  for (const p of roundState.players) {
    playerWinnings.set(p.id, 0);
  }

  for (const pot of pots) {
    const winners = decisionsByPotId.get(pot.id);
    if (!winners || winners.length === 0) {
      continue;
    }

    if (winners.length === 1) {
      const winnerId = winners[0];
      const awardAmount = pot.amount;
      playerWinnings.set(
        winnerId,
        addSafeChips(
          playerWinnings.get(winnerId) ?? 0,
          awardAmount,
          'prêmios do jogador',
        ),
      );

      potAwards.push(
        Object.freeze({
          potId: pot.id,
          potType: pot.type,
          potIndex: pot.index,
          potAmount: pot.amount,
          winners: Object.freeze([winnerId]),
          awards: Object.freeze([{ playerId: winnerId, amount: awardAmount }]),
        }),
      );
    } else {
      const base = Math.floor(pot.amount / winners.length);
      const remainder = pot.amount % winners.length;

      const winnerSet = new Set(winners);
      const orderedWinners = clockwisePlayers
        .filter(pl => winnerSet.has(pl.id))
        .map(pl => pl.id);

      const awards: PlayerPotAward[] = orderedWinners.map((wId, idx) => {
        const oddChip = idx < remainder ? 1 : 0;
        const amount = base + oddChip;
        playerWinnings.set(
          wId,
          addSafeChips(
            playerWinnings.get(wId) ?? 0,
            amount,
            'prêmios do jogador',
          ),
        );
        return Object.freeze({ playerId: wId, amount });
      });

      potAwards.push(
        Object.freeze({
          potId: pot.id,
          potType: pot.type,
          potIndex: pot.index,
          potAmount: pot.amount,
          winners: Object.freeze(orderedWinners),
          awards: Object.freeze(awards),
        }),
      );
    }
  }

  let totalDistributed = 0;
  for (const pa of potAwards) {
    totalDistributed = addSafeChips(
      totalDistributed,
      pa.potAmount,
      'prêmios distribuídos',
    );
  }

  let finalStacksSum = 0;
  const settledPlayers: SettledPlayer[] = roundState.players.map(player => {
    const won = playerWinnings.get(player.id) ?? 0;
    const finalChips = addSafeChips(
      player.chips,
      won,
      `stack final de ${player.id}`,
    );

    if (!Number.isSafeInteger(finalChips) || finalChips < 0 || finalChips > Number.MAX_SAFE_INTEGER) {
      throw new EngineError(
        'INVALID_CHIPS',
        `Stack resultante inválido para o jogador ${player.id}: ${finalChips}.`,
      );
    }

    finalStacksSum = addSafeChips(
      finalStacksSum,
      finalChips,
      'total final da mesa',
    );

    return Object.freeze({
      id: player.id,
      seat: player.seat,
      chips: finalChips,
      committed: 0,
      isAllIn: finalChips === 0,
      folded: player.folded,
      name: player.name,
      totalWon: won,
      previousChips: player.chips,
    });
  });

  if (finalStacksSum !== initialChipsSum) {
    throw new EngineError(
      'INVALID_CHIPS',
      `Violação de conservação de fichas: esperado ${initialChipsSum}, obtido ${finalStacksSum}.`,
    );
  }

  if (totalDistributed !== roundState.pot) {
    throw new EngineError(
      'INVALID_CHIPS',
      `Violação de conservação de potes: pote da rodada era ${roundState.pot}, total distribuído foi ${totalDistributed}.`,
    );
  }

  const summary: SettlementSummary = Object.freeze({
    totalDistributed,
    playerAwards: Object.freeze(
      settledPlayers
        .filter(p => p.totalWon > 0)
        .map(p => Object.freeze({ playerId: p.id, amount: p.totalWon })),
    ),
  });

  return Object.freeze({
    status: 'settled',
    isSettled: true,
    pot: 0,
    originalPot: round.pot,
    players: Object.freeze(settledPlayers),
    pots: Object.freeze(pots),
    potAwards: Object.freeze(potAwards),
    summary,
    handState: roundState.handState,
    dealerSeat: roundState.dealerSeat,
  });
}
