import { validateBlinds } from './eligibility.js';
import { EngineError } from './errors.js';
import { initHand } from './hand.js';
import { startHandFlow } from './hand-flow.js';
import { advanceDealer } from './positions.js';
import type {
  BlindsConfig,
  HandFlowState,
  PlayerInput,
  SettlementResult,
  StartNextHandOptions,
} from './types.js';

/**
 * Determina o assento do dealer da próxima mão de Texas Hold'em.
 *
 * Regras aplicadas:
 * 1. Mesas com 3 ou mais jogadores elegíveis (chips > 0):
 *    - Avança o botão no sentido horário para o próximo assento físico ocupado com fichas.
 *    - Ignora assentos vazios e jogadores eliminados (chips === 0).
 *    - Utiliza o assento do dealer anterior como referência mesmo que ele tenha sido eliminado.
 *
 * 2. Mesas em Heads-Up (exatamente 2 jogadores elegíveis):
 *    a) Se a mesa já estava em heads-up na mão anterior:
 *       - Alterna normalmente o dealer entre os dois jogadores.
 *    b) Se a mesa está transicionando de 3+ jogadores para 2 (Regra 36-C da Poker TDA 2026):
 *       - O botão é ajustado para garantir que nenhum jogador pague o big blind duas vezes consecutivas.
 *       - Se o big blind da mão anterior permaneceu na mesa, ele obrigatoriamente torna-se o dealer
 *         (e portanto small blind / botão no heads-up).
 *       - Se o big blind anterior foi eliminado, a posição é determinada de forma coerente com a progressão
 *         das blinds: o small blind anterior progride para big blind, e o outro jogador assume o dealer.
 *
 * Nota arquitetural / Limitação:
 * Esta implementação adota a política de "botão móvel" (moving button) padrão de cash games e partidas
 * presenciais simplificadas. Em torneios com regra estrita de "dead button" (TDA Regra 32), a eliminação
 * do small blind pode gerar um botão morto (parado no assento vazio); aqui, o botão sempre avança para
 * o próximo jogador ativo com fichas.
 */
export function determineNextDealerSeat(
  previousSettlement: SettlementResult,
  eligiblePlayers: readonly PlayerInput[],
): number {
  if (eligiblePlayers.length < 2) {
    throw new EngineError(
      'INSUFFICIENT_PLAYERS',
      'São necessários ao menos 2 jogadores com fichas para determinar o próximo dealer.',
    );
  }

  const sortedEligible = [...eligiblePlayers].sort((a, b) => a.seat - b.seat);
  const previousDealerSeat = previousSettlement.dealerSeat;
  const previousHandState = previousSettlement.handState;
  const previousParticipantCount = previousHandState.players.length;
  const wasHeadsUp = previousParticipantCount === 2;
  const isHeadsUp = sortedEligible.length === 2;

  // Em mesas com 3 ou mais jogadores elegíveis, segue a rotação horária padrão
  if (!isHeadsUp) {
    return advanceDealer(sortedEligible, previousDealerSeat).seat;
  }

  // A próxima mão será Heads-Up (exatamente 2 jogadores elegíveis)
  if (wasHeadsUp) {
    // Mesa já estava em heads-up: alterna o dealer entre os dois jogadores
    const otherPlayer = sortedEligible.find(p => p.seat !== previousDealerSeat);
    return otherPlayer ? otherPlayer.seat : advanceDealer(sortedEligible, previousDealerSeat).seat;
  }

  // Transição de 3+ jogadores para Heads-Up (Poker TDA 2026 Regra 36-C)
  // Regra central: nenhum jogador pode pagar o big blind duas mãos consecutivas.
  const prevBBSeat = previousHandState.bigBlindSeat;
  const prevSBSeat = previousHandState.smallBlindSeat;

  const prevBBPlayer = sortedEligible.find(p => p.seat === prevBBSeat);
  if (prevBBPlayer) {
    // O big blind da mão anterior sobreviveu. Para não repetir o big blind, torna-se o dealer.
    return prevBBPlayer.seat;
  }

  // O big blind anterior foi eliminado.
  // Coerência de progressão: quem pagou small blind na mão anterior é o próximo a pagar o big blind.
  const prevSBPlayer = sortedEligible.find(p => p.seat === prevSBSeat);
  if (prevSBPlayer) {
    const otherPlayer = sortedEligible.find(p => p.seat !== prevSBSeat)!;
    return otherPlayer.seat;
  }

  // Se ambos SB e BB anteriores foram eliminados na mesma mão (ex: mesa de 4+ jogadores):
  // O próximo jogador no sentido horário a partir do BB anterior é o novo BB, e o outro é o dealer.
  const nextBB = sortedEligible.find(p => p.seat > prevBBSeat) ?? sortedEligible[0];
  const dealerPlayer = sortedEligible.find(p => p.seat !== nextBB.seat)!;
  return dealerPlayer.seat;
}

/**
 * Inicia uma nova mão de Texas Hold'em a partir do resultado de uma mão anteriormente liquidada.
 *
 * Fluxo:
 * 1. Valida estritamente que a entrada é um SettlementResult concluído.
 * 2. Extrai os stacks finais de SettlementResult.players (única fonte autoritativa de fichas).
 * 3. Descarta estados transitórios anteriores (fold, all-in, committed, totalCommitted, pot).
 * 4. Filtra jogadores com fichas (> 0) e rejeita se houver menos de 2 participantes elegíveis.
 * 5. Determina a posição correta do próximo dealer respeitando a rotação padrão e a Regra 36-C (Heads-Up).
 * 6. Cobra as novas blinds (preservadas da mão anterior ou fornecidas via options).
 * 7. Inicia a nova mão no pré-flop retornando um HandFlowState válido e imutável.
 * 8. Assegura a estrita conservação de fichas entre as mãos.
 *
 * Limitação de concorrência:
 * Como todas as operações do motor são funções puras e determinísticas sem estado global,
 * chamar startNextHand() duas vezes com o mesmo SettlementResult produzirá dois estados equivalentes.
 * Em ambiente multiplayer, a camada autoritativa do servidor é responsável por persistir o estado
 * e impedir que o mesmo SettlementResult seja consumido concorrentemente.
 */
export function startNextHand(
  previousSettlement: SettlementResult,
  options?: StartNextHandOptions,
): HandFlowState {
  if (typeof previousSettlement !== 'object' || previousSettlement === null) {
    throw new EngineError('INVALID_INPUT', 'O resultado da mão anterior deve ser um objeto válido.');
  }

  const candidate = previousSettlement as unknown as Record<string, unknown>;

  if (candidate.status !== 'settled' || candidate.isSettled !== true) {
    throw new EngineError(
      'INVALID_INPUT',
      'Apenas mãos concluídas e liquidadas (SettlementResult) podem iniciar uma nova mão.',
    );
  }

  // Uma liquidação concluída não pode manter fichas no pote.
  if (
    previousSettlement.pot !== 0 ||
    !Number.isSafeInteger(previousSettlement.originalPot) ||
    previousSettlement.originalPot < 0
  ) {
    throw new EngineError(
      'INVALID_INPUT',
      'O resultado anterior possui um pote de liquidação inválido.',
    );
  }

  if (!Array.isArray(previousSettlement.players) || previousSettlement.players.length === 0) {
    throw new EngineError('INVALID_INPUT', 'Lista de jogadores do resultado anterior inválida.');
  }

  if (typeof previousSettlement.handState !== 'object' || previousSettlement.handState === null) {
    throw new EngineError('INVALID_INPUT', 'handState inválido no resultado anterior.');
  }

  if (
    typeof previousSettlement.dealerSeat !== 'number' ||
    !Number.isSafeInteger(previousSettlement.dealerSeat) ||
    previousSettlement.dealerSeat < 1
  ) {
    throw new EngineError('INVALID_SEAT', 'Assento do dealer anterior inválido.');
  }

  const seenIds = new Set<string>();
  const seenSeats = new Set<number>();
  let totalChips = 0;

  for (const player of previousSettlement.players) {
    if (typeof player !== 'object' || player === null) {
      throw new EngineError('INVALID_INPUT', 'Jogador inválido na lista de liquidação anterior.');
    }

    if (typeof player.id !== 'string' || player.id.trim().length === 0) {
      throw new EngineError('INVALID_INPUT', 'O ID do jogador deve ser uma string não vazia.');
    }

    if (seenIds.has(player.id)) {
      throw new EngineError('DUPLICATE_PLAYER_ID', `ID de jogador duplicado detectado: ${player.id}.`);
    }
    seenIds.add(player.id);

    if (
      typeof player.seat !== 'number' ||
      !Number.isSafeInteger(player.seat) ||
      player.seat < 1
    ) {
      throw new EngineError(
        'INVALID_SEAT',
        `Assento inválido para o jogador ${player.id}: ${String(player.seat)}.`,
      );
    }

    if (seenSeats.has(player.seat)) {
      throw new EngineError('DUPLICATE_SEAT', `Assento duplicado detectado: ${player.seat}.`);
    }
    seenSeats.add(player.seat);

    if (
      typeof player.chips !== 'number' ||
      !Number.isSafeInteger(player.chips) ||
      player.chips < 0
    ) {
      throw new EngineError(
        'INVALID_CHIPS',
        `Stack inválido para o jogador ${player.id}: ${String(player.chips)}.`,
      );
    }

    if (player.committed !== 0) {
      throw new EngineError(
        'INVALID_INPUT',
        `O jogador ${player.id} possui contribuições pendentes após a liquidação.`,
      );
    }

    if (player.name !== undefined && typeof player.name !== 'string') {
      throw new EngineError('INVALID_INPUT', `Nome inválido para o jogador ${player.id}.`);
    }

    if (totalChips > Number.MAX_SAFE_INTEGER - player.chips) {
      throw new EngineError('INVALID_CHIPS', 'A soma das fichas excede o limite seguro de inteiros.');
    }
    totalChips += player.chips;
  }

  // Filtra jogadores elegíveis com fichas (> 0), descartando jogadores eliminados
  const eligible = previousSettlement.players
    .filter(p => p.chips > 0)
    .map(p => ({
      id: p.id,
      seat: p.seat,
      chips: p.chips,
      ...(p.name !== undefined ? { name: p.name } : {}),
    }));

  if (eligible.length < 2) {
    throw new EngineError(
      'INSUFFICIENT_PLAYERS',
      'São necessários ao menos 2 jogadores com fichas para iniciar uma nova mão.',
    );
  }

  // Determina a configuração de blinds (preservada ou reconfigurada)
  const blindsConfig: BlindsConfig = options?.blinds !== undefined
    ? validateBlinds(options.blinds)
    : validateBlinds({
        smallBlind: previousSettlement.handState.smallBlind,
        bigBlind: previousSettlement.handState.bigBlind,
      });

  // Determina o dealer da próxima mão
  const nextDealerSeat = determineNextDealerSeat(previousSettlement, eligible);

  // Inicializa a nova mão através do motor existente (initHand + startHandFlow)
  const nextHand = initHand({
    players: eligible,
    blinds: blindsConfig,
    dealerSeat: nextDealerSeat,
  });

  const nextFlowState = startHandFlow(nextHand);

  // Validação estrita de conservação financeira.
  if (
    !Number.isSafeInteger(nextFlowState.pot) ||
    nextFlowState.pot < 0
  ) {
    throw new EngineError('INVALID_CHIPS', 'Pote inicial inválido.');
  }

  let currentTotalChips = nextFlowState.pot;

  for (const player of nextFlowState.players) {
    if (
      !Number.isSafeInteger(player.chips) ||
      player.chips < 0 ||
      currentTotalChips > Number.MAX_SAFE_INTEGER - player.chips
    ) {
      throw new EngineError(
        'INVALID_CHIPS',
        'Total de fichas inválido na próxima mão.',
      );
    }

    currentTotalChips += player.chips;
  }

  if (currentTotalChips !== totalChips) {
    throw new EngineError(
      'INVALID_CHIPS',
      `Violação de conservação financeira entre mãos: anterior ${totalChips}, atual ${currentTotalChips}.`,
    );
  }

  return nextFlowState;
}
