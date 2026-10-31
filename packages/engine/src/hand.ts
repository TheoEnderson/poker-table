import {
  calculatePostFlopActionOrder,
  calculatePreFlopActionOrder,
} from './action-order.js';
import { postBlinds } from './blinds.js';
import { getEligiblePlayers, validateBlinds } from './eligibility.js';
import { EngineError } from './errors.js';
import { advanceDealer, determineBlindsPositions } from './positions.js';
import type { HandState, InitHandParams } from './types.js';

export function createInitialHand(params: InitHandParams): HandState {
  if (typeof params !== 'object' || params === null) {
    throw new EngineError('INVALID_INPUT', 'Parâmetros de início de mão inválidos.');
  }

  const blinds = validateBlinds(params.blinds);
  const eligible = getEligiblePlayers(params.players);

  // Impede perda de precisão na soma das fichas da mesa.
  let totalChips = 0;

  for (const player of eligible) {
    if (totalChips > Number.MAX_SAFE_INTEGER - player.chips) {
      throw new EngineError(
        'INVALID_CHIPS',
        'A soma das fichas excede o limite seguro de inteiros.',
      );
    }

    totalChips += player.chips;
  }

  if (eligible.length < 2) {
    throw new EngineError(
      'INSUFFICIENT_PLAYERS',
      'São necessários ao menos 2 jogadores com fichas para iniciar uma mão.',
    );
  }

  let dealerSeat: number;

  if (params.dealerSeat !== undefined) {
    if (!Number.isSafeInteger(params.dealerSeat) || params.dealerSeat < 1) {
      throw new EngineError('INVALID_SEAT', 'O assento do dealer deve ser um número inteiro positivo.');
    }
    const found = eligible.find(p => p.seat === params.dealerSeat);
    if (!found) {
      throw new EngineError(
        'INVALID_DEALER',
        `O assento informado para dealer (${params.dealerSeat}) não pertence a um jogador elegível com fichas.`,
      );
    }
    dealerSeat = params.dealerSeat;
  } else if (params.previousDealerSeat !== undefined && params.previousDealerSeat !== null) {
    const nextDealer = advanceDealer(eligible, params.previousDealerSeat);
    dealerSeat = nextDealer.seat;
  } else {
    // Escolha determinística na ausência de dealer anterior: primeiro jogador elegível
    const firstDealer = advanceDealer(eligible, null);
    dealerSeat = firstDealer.seat;
  }

  const positions = determineBlindsPositions(eligible, dealerSeat);
  const playersWithBlinds = postBlinds(eligible, positions, blinds)
    .map(player => Object.freeze(player));
  const pot = playersWithBlinds.reduce((sum, p) => sum + p.committed, 0);

  const preFlopActionPlayers = calculatePreFlopActionOrder(playersWithBlinds, dealerSeat);
  const postFlopActionPlayers = calculatePostFlopActionOrder(playersWithBlinds, dealerSeat);

  const preFlopOrder = preFlopActionPlayers.map(p => p.id);
  const postFlopOrder = postFlopActionPlayers.map(p => p.id);

  return Object.freeze({
    players: Object.freeze(playersWithBlinds),
    participatingPlayers: Object.freeze(playersWithBlinds),
    dealerSeat: positions.dealerSeat,
    smallBlindSeat: positions.smallBlindSeat,
    bigBlindSeat: positions.bigBlindSeat,
    pot,
    smallBlind: blinds.smallBlind,
    bigBlind: blinds.bigBlind,
    preFlopOrder: Object.freeze(preFlopOrder),
    postFlopOrder: Object.freeze(postFlopOrder),
    preFlopActionOrder: Object.freeze(preFlopOrder),
    postFlopActionOrder: Object.freeze(postFlopOrder),
    preFlopActionPlayers: Object.freeze(preFlopActionPlayers),
    postFlopActionPlayers: Object.freeze(postFlopActionPlayers),
    currentActorId: preFlopOrder[0] ?? null,
  });
}

export const initHand = createInitialHand;

