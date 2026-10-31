export type EngineErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_CHIPS'
  | 'INVALID_SEAT'
  | 'DUPLICATE_PLAYER_ID'
  | 'DUPLICATE_SEAT'
  | 'INVALID_BLINDS'
  | 'INSUFFICIENT_PLAYERS'
  | 'INVALID_DEALER';

export class EngineError extends Error {
  constructor(
    public readonly code: EngineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

