import { EngineError } from './errors.js';
import type { BlindsConfig, PlayerInput } from './types.js';

export function validatePlayer(input: unknown): PlayerInput {
  if (typeof input !== 'object' || input === null) {
    throw new EngineError('INVALID_INPUT', 'O jogador deve ser um objeto válido.');
  }

  const record = input as Record<string, unknown>;

  if (typeof record.id !== 'string' || record.id.trim().length === 0) {
    throw new EngineError('INVALID_INPUT', 'O ID do jogador deve ser uma string não vazia.');
  }

  if (typeof record.seat !== 'number' || !Number.isSafeInteger(record.seat) || record.seat < 1) {
    throw new EngineError('INVALID_SEAT', `O assento do jogador deve ser um número inteiro positivo (recebido: ${String(record.seat)}).`);
  }

  if (typeof record.chips !== 'number' || !Number.isSafeInteger(record.chips) || record.chips < 0) {
    throw new EngineError('INVALID_CHIPS', `As fichas do jogador devem ser um número inteiro não negativo (recebido: ${String(record.chips)}).`);
  }

  if (record.name !== undefined && typeof record.name !== 'string') {
    throw new EngineError('INVALID_INPUT', 'O nome do jogador deve ser uma string.');
  }

  return {
    id: record.id,
    seat: record.seat,
    chips: record.chips,
    ...(typeof record.name === 'string' ? { name: record.name } : {}),
  };
}

export function validatePlayers(input: unknown): PlayerInput[] {
  if (!Array.isArray(input)) {
    throw new EngineError('INVALID_INPUT', 'A lista de jogadores deve ser um array.');
  }

  const seenIds = new Set<string>();
  const seenSeats = new Set<number>();
  const validated: PlayerInput[] = [];

  for (const item of input) {
    const player = validatePlayer(item);

    if (seenIds.has(player.id)) {
      throw new EngineError('DUPLICATE_PLAYER_ID', `ID de jogador duplicado detectado: ${player.id}.`);
    }
    seenIds.add(player.id);

    if (seenSeats.has(player.seat)) {
      throw new EngineError('DUPLICATE_SEAT', `Assento duplicado na mesa detectado: ${player.seat}.`);
    }
    seenSeats.add(player.seat);

    validated.push(player);
  }

  return validated;
}

export function validateBlinds(input: unknown): BlindsConfig {
  if (typeof input !== 'object' || input === null) {
    throw new EngineError('INVALID_BLINDS', 'A configuração de blinds deve ser um objeto válido.');
  }

  const record = input as Record<string, unknown>;

  if (typeof record.smallBlind !== 'number' || !Number.isSafeInteger(record.smallBlind) || record.smallBlind <= 0) {
    throw new EngineError('INVALID_BLINDS', 'O small blind deve ser um número inteiro positivo maior que zero.');
  }

  if (typeof record.bigBlind !== 'number' || !Number.isSafeInteger(record.bigBlind) || record.bigBlind <= 0) {
    throw new EngineError('INVALID_BLINDS', 'O big blind deve ser um número inteiro positivo maior que zero.');
  }

  if (record.bigBlind < record.smallBlind) {
    throw new EngineError('INVALID_BLINDS', 'O big blind deve ser maior ou igual ao small blind.');
  }

  return {
    smallBlind: record.smallBlind,
    bigBlind: record.bigBlind,
  };
}

export function getEligiblePlayers(players: readonly PlayerInput[]): PlayerInput[] {
  const validated = validatePlayers(players);
  // Apenas jogadores com fichas (> 0) são elegíveis para iniciar uma mão
  const eligible = validated.filter(p => p.chips > 0);
  // Ordena pela posição física na mesa (ordem circular horária baseada no assento)
  return eligible.sort((a, b) => a.seat - b.seat);
}

