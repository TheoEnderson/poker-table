import type { BlindsConfig, HandPlayer, HandPositions, PlayerInput } from './types.js';

export function postBlinds(
  eligiblePlayers: readonly PlayerInput[],
  positions: HandPositions,
  blinds: BlindsConfig,
): HandPlayer[] {
  const sorted = [...eligiblePlayers].sort((a, b) => a.seat - b.seat);

  return sorted.map(player => {
    let requiredBlind = 0;

    if (player.seat === positions.smallBlindSeat) {
      requiredBlind += blinds.smallBlind;
    }
    if (player.seat === positions.bigBlindSeat) {
      requiredBlind += blinds.bigBlind;
    }

    // Se o jogador não tem fichas suficientes para cobrir o blind obrigatório, vai all-in com o que tem
    const committed = Math.min(player.chips, requiredBlind);
    const remainingChips = player.chips - committed;
    const isAllIn = remainingChips === 0 && committed > 0;

    return {
      id: player.id,
      seat: player.seat,
      chips: remainingChips,
      committed,
      isAllIn,
      ...(player.name !== undefined ? { name: player.name } : {}),
    };
  });
}

