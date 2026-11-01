import { EngineError, startHandFlow, type HandFlowState } from '@poker-table/engine';
import { configSchema, gameStateSchema, type GameState, type RoomConfig, type RoomState } from '@poker-table/protocol';
import { RoomError } from '../errors.js';

export function initializeHand(players: RoomState['players'], input: RoomConfig): HandFlowState {
  const config = configSchema.parse(input);
  const seated = players.filter(p => p.seat !== null);
  if (players.length > config.maxPlayers || seated.length > 10) throw new RoomError('INVALID_INPUT', 'Quantidade de participantes inválida.');
  if (seated.length < 2) throw new RoomError('INSUFFICIENT_PLAYERS', 'São necessários pelo menos dois participantes sentados.');
  if (seated.some(p => !p.connected)) throw new RoomError('PLAYERS_DISCONNECTED', 'Todos os participantes sentados precisam estar conectados para iniciar.');
  if (seated.some(p => p.seat! > config.maxPlayers)) throw new RoomError('INVALID_INPUT', 'Posição fora dos limites desta mesa.');
  if (config.startingChips > Math.floor(Number.MAX_SAFE_INTEGER / seated.length)) throw new RoomError('INVALID_INPUT', 'A soma das fichas excede o limite seguro.');
  try {
    return startHandFlow({
      players: seated.map(p => ({ id: p.id, seat: p.seat!, chips: config.startingChips })),
      blinds: { smallBlind: config.smallBlind, bigBlind: config.bigBlind },
    });
  } catch (error) {
    if (error instanceof EngineError) throw new RoomError('INVALID_INPUT', 'Configuração ou participantes inválidos para iniciar a mão.');
    throw error;
  }
}

export function publicGame(hand: HandFlowState): GameState {
  return gameStateSchema.parse({
    status: 'hand-active',
    hand: {
      street: hand.street, status: hand.status,
      players: hand.players.map(p => ({
        id: p.id, seat: p.seat, chips: p.chips, roundCommitted: p.roundCommitted,
        totalCommitted: p.totalCommitted, folded: p.folded, isAllIn: p.isAllIn,
      })),
      dealerSeat: hand.dealerSeat, smallBlindSeat: hand.smallBlindSeat, bigBlindSeat: hand.bigBlindSeat,
      smallBlind: hand.smallBlind, bigBlind: hand.bigBlind, pot: hand.pot,
      currentActorId: hand.currentActorId, playersToAct: [...hand.playersToAct],
    },
  });
}
