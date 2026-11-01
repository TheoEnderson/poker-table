import { EngineError, settleHandFlow, type HandFlowState, type PotWinnerDecision, type SettlementResult } from '@poker-table/engine';
import { settlementSnapshotSchema, type SettlementSnapshot } from '@poker-table/protocol';
import { RoomError } from '../errors.js';

export function publicSettlement(s: SettlementResult): SettlementSnapshot {
  return settlementSnapshotSchema.parse({
    originalPot: s.originalPot,
    dealerSeat: s.dealerSeat,
    players: s.players.map(p => ({
      id: p.id,
      seat: p.seat,
      chips: p.chips,
      folded: p.folded,
      isAllIn: p.isAllIn,
      totalWon: p.totalWon,
      previousChips: p.previousChips,
    })),
    pots: s.pots.map(pot => ({
      id: pot.id,
      type: pot.type,
      index: pot.index,
      amount: pot.amount,
      eligiblePlayers: [...pot.eligiblePlayers],
    })),
    potAwards: s.potAwards.map(pa => ({
      potId: pa.potId,
      potType: pa.potType,
      potIndex: pa.potIndex,
      potAmount: pa.potAmount,
      winners: [...pa.winners],
      awards: pa.awards.map(a => ({ playerId: a.playerId, amount: a.amount })),
    })),
    summary: {
      totalDistributed: s.summary.totalDistributed,
      playerAwards: s.summary.playerAwards.map(a => ({ playerId: a.playerId, amount: a.amount })),
    },
  });
}

export function settleGameHand(hand: HandFlowState, decisions: readonly PotWinnerDecision[] = []): SettlementResult {
  if (hand.status !== 'showdown' && hand.status !== 'hand_ended_by_fold') {
    throw new RoomError('HAND_NOT_ENDED', 'A mão ainda está em andamento e não pode ser liquidada.');
  }

  try {
    return settleHandFlow(hand, decisions);
  } catch (error) {
    if (error instanceof EngineError) {
      switch (error.code) {
        case 'MISSING_DECISION':
          throw new RoomError('MISSING_DECISION', 'Decisão de vencedor pendente para um ou mais potes disputados.');
        case 'DUPLICATE_DECISION':
          throw new RoomError('DUPLICATE_DECISION', 'Mais de uma decisão informada para o mesmo pote.');
        case 'INELIGIBLE_WINNER':
        case 'PLAYER_NOT_FOUND':
          throw new RoomError('INELIGIBLE_WINNER', 'O jogador indicado não é elegível para receber este pote.');
        case 'INVALID_POT':
          throw new RoomError('INVALID_POT', 'Identificador de pote não encontrado nesta mão.');
        case 'ALREADY_SETTLED':
          throw new RoomError('ALREADY_SETTLED', 'Esta mão já foi liquidada.');
        case 'ROUND_NOT_ACTIVE':
          throw new RoomError('HAND_NOT_ENDED', 'A mão ainda está em andamento e não pode ser liquidada.');
        case 'INVALID_INPUT':
          throw new RoomError('INVALID_INPUT', error.message);
        default:
          throw new RoomError('STORAGE_ERROR', 'Não foi possível liquidar a mão no motor.');
      }
    }
    throw error;
  }
}
