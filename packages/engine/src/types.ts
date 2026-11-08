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

export type Street = 'preflop' | 'flop' | 'turn' | 'river';

export type HandFlowStatus = 'in_progress' | 'hand_ended_by_fold' | 'showdown';

export interface HandFlowPlayer {
  readonly id: string;
  readonly seat: number;
  readonly chips: number;
  readonly roundCommitted: number;
  readonly totalCommitted: number;
  readonly committed: number;
  readonly isAllIn: boolean;
  readonly folded: boolean;
  readonly baseCommitted: number;
  readonly name?: string;
}

export type HandActionType =
  | 'small_blind'
  | 'big_blind'
  | 'fold'
  | 'check'
  | 'call'
  | 'bet'
  | 'raise';

export interface HandAction {
  readonly seq: number;
  readonly playerId: string;
  readonly seat: number;
  readonly street: Street;
  readonly type: HandActionType;
  readonly amount: number;
  readonly roundCommitted: number;
  readonly currentBet: number;
  readonly isAllIn: boolean;
  readonly raiseTarget?: number | null;
}

export interface HandFlowState {
  readonly street: Street;
  readonly currentRound: RoundState;
  readonly players: readonly HandFlowPlayer[];
  readonly dealerSeat: number;
  readonly smallBlindSeat: number;
  readonly bigBlindSeat: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly pot: number;
  readonly status: HandFlowStatus;
  readonly handState: HandState;
  readonly currentActorId: string | null;
  readonly playersToAct: readonly string[];
  readonly survivorId?: string | null;
  readonly actions?: readonly HandAction[];
}

export interface AllowedActionsInfo {
  readonly playerId: string;
  readonly canFold: boolean;
  readonly canCheck: boolean;
  readonly canCall: boolean;
  readonly callAmount: number;
  readonly canRaise: boolean;
  readonly minRaiseAmount: number | null;
  readonly maxRaiseAmount: number | null;
  readonly minRaiseIncrement: number | null;
  readonly currentBet: number | null;
  readonly canAllIn: boolean;
  readonly allInAmount: number | null;
  readonly allInType: 'call' | 'raise' | null;
  readonly actionNotReopened: boolean;
}

export type BuildPotsInput =
  | RoundState
  | HandFlowState
  | readonly PotPlayerInput[]
  | { readonly players: readonly PotPlayerInput[] };

export interface PotWinnerDecision {
  readonly potId: string;
  readonly winnerIds?: readonly string[];
  readonly winners?: readonly string[];
}

export interface PlayerPotAward {
  readonly playerId: string;
  readonly amount: number;
}

export interface PotAward {
  readonly potId: string;
  readonly potType: PotType;
  readonly potIndex: number;
  readonly potAmount: number;
  readonly winners: readonly string[];
  readonly awards: readonly PlayerPotAward[];
}

export interface SettledPlayer {
  readonly id: string;
  readonly seat: number;
  readonly chips: number;
  readonly committed: number;
  readonly isAllIn: boolean;
  readonly folded: boolean;
  readonly name?: string;
  readonly totalWon: number;
  readonly previousChips: number;
}

export interface SettlementSummary {
  readonly totalDistributed: number;
  readonly playerAwards: readonly PlayerPotAward[];
}

export interface SettlementResult {
  readonly status: 'settled';
  readonly isSettled: true;
  readonly pot: 0;
  readonly originalPot: number;
  readonly players: readonly SettledPlayer[];
  readonly pots: readonly Pot[];
  readonly potAwards: readonly PotAward[];
  readonly summary: SettlementSummary;
  readonly handState: HandState;
  readonly dealerSeat: number;
}

export interface StartNextHandOptions {
  readonly blinds?: BlindsConfig;
  readonly newPlayers?: readonly PlayerInput[];
}
