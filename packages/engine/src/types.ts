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

export type BettingActionType = 'fold' | 'check' | 'call' | 'raise' | 'all-in' | 'allIn';

export interface PlayerAction {
  readonly playerId: string;
  readonly type: BettingActionType;
  readonly amount?: number;
}

export type RoundStatus = 'active' | 'completed' | 'hand_ended_by_fold';

export interface RoundPlayer extends HandPlayer {
  readonly folded: boolean;
  readonly lastActionBet: number | null;
}

export interface RoundState {
  readonly players: readonly RoundPlayer[];
  readonly currentBet: number;
  readonly minRaiseIncrement: number;
  readonly lastRaiseIncrement: number;
  readonly pot: number;
  readonly currentActorId: string | null;
  readonly playersToAct: readonly string[];
  readonly status: RoundStatus;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly dealerSeat: number;
  readonly smallBlindSeat: number;
  readonly bigBlindSeat: number;
  readonly handState: HandState;
}

export type PotType = 'main' | 'side';

export interface Pot {
  readonly id: string;
  readonly type: PotType;
  readonly index: number;
  readonly amount: number;
  readonly contributors: readonly string[];
  readonly eligiblePlayers: readonly string[];
  readonly contributorIds?: readonly string[];
  readonly eligiblePlayerIds?: readonly string[];
}

export interface PotPlayerInput {
  readonly id: string;
  readonly committed: number;
  readonly folded?: boolean;
}

export type BuildPotsInput =
  | RoundState
  | readonly PotPlayerInput[]
  | { readonly players: readonly PotPlayerInput[] };
