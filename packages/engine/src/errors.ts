export type EngineErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_CHIPS'
  | 'INVALID_SEAT'
  | 'DUPLICATE_PLAYER_ID'
  | 'DUPLICATE_SEAT'
  | 'INVALID_BLINDS'
  | 'INSUFFICIENT_PLAYERS'
  | 'INVALID_DEALER'
  | 'ROUND_NOT_ACTIVE'
  | 'OUT_OF_TURN'
  | 'INVALID_ACTION'
  | 'CANNOT_CHECK'
  | 'CANNOT_RAISE'
  | 'ACTION_NOT_REOPENED'
  | 'INVALID_RAISE_AMOUNT'
  | 'INSUFFICIENT_CHIPS'
  | 'PLAYER_NOT_FOUND'
  | 'PLAYER_FOLDED'
  | 'PLAYER_ALL_IN';

export class EngineError extends Error {
  constructor(
    public readonly code: EngineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

