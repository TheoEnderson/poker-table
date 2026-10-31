export interface PlayerInput {
  readonly id: string;
  readonly seat: number;
  readonly chips: number;
  readonly name?: string;
}

export type TablePlayer = PlayerInput;

export interface HandPlayer {
  readonly id: string;
  readonly seat: number;
  readonly chips: number;
  readonly committed: number;
  readonly isAllIn: boolean;
  readonly name?: string;
}

export interface BlindsConfig {
  readonly smallBlind: number;
  readonly bigBlind: number;
}

export interface HandPositions {
  readonly dealerSeat: number;
  readonly smallBlindSeat: number;
  readonly bigBlindSeat: number;
}

export interface HandState {
  readonly players: readonly HandPlayer[];
  readonly participatingPlayers: readonly HandPlayer[];
  readonly dealerSeat: number;
  readonly smallBlindSeat: number;
  readonly bigBlindSeat: number;
  readonly pot: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly preFlopOrder: readonly string[];
  readonly postFlopOrder: readonly string[];
  readonly preFlopActionOrder: readonly string[];
  readonly postFlopActionOrder: readonly string[];
  readonly preFlopActionPlayers: readonly HandPlayer[];
  readonly postFlopActionPlayers: readonly HandPlayer[];
  readonly currentActorId: string | null;
}

export interface InitHandParams {
  readonly players: readonly PlayerInput[];
  readonly blinds: BlindsConfig;
  readonly dealerSeat?: number;
  readonly previousDealerSeat?: number | null;
}

