export const CARD_COLORS = ["red", "yellow", "green", "blue"] as const;
export const MIN_GAME_PLAYERS = 2;
export const MAX_GAME_PLAYERS = 8;

export type CardColor = (typeof CARD_COLORS)[number];

export type CardValue =
  | number
  | "skip"
  | "reverse"
  | "draw-two"
  | "wild"
  | "wild-draw-four";

export interface Card {
  readonly id: string;
  readonly color: CardColor | null;
  readonly value: CardValue;
}

export type Direction = 1 | -1;

export type GamePhase =
  | "lobby"
  | "playing"
  | "awaiting-draw-four-challenge"
  | "finished";

export interface GamePlayer {
  id: string;
  hand: Card[];
}

export interface PendingDrawFour {
  attackerId: string;
  targetId: string;
  wasLegal: boolean;
  pendingWinnerId: string | null;
}

export type GameActionType =
  | "start"
  | "choose-color"
  | "play-card"
  | "draw-card"
  | "pass"
  | "call-uno"
  | "catch-uno"
  | "accept-draw-four"
  | "challenge-draw-four";

export interface GameAction {
  type: GameActionType;
  playerId: string | null;
  cardId?: string;
  chosenColor?: CardColor;
  amount?: number;
  successful?: boolean;
  declaredUno?: boolean;
  targetPlayerId?: string;
  shuffle?: "initial" | "recycle";
}

export interface GameState {
  players: GamePlayer[];
  drawPile: Card[];
  discardPile: Card[];
  currentColor: CardColor | null;
  currentPlayerIndex: number;
  direction: Direction;
  phase: Exclude<GamePhase, "lobby">;
  drawnCardId: string | null;
  unoVulnerablePlayerId: string | null;
  pendingDrawFour: PendingDrawFour | null;
  winnerId: string | null;
  lastAction: GameAction;
  version: number;
}

export type RuleErrorCode =
  | "GAME_NOT_PLAYING"
  | "NOT_YOUR_TURN"
  | "CARD_NOT_IN_HAND"
  | "CARD_NOT_PLAYABLE"
  | "COLOR_REQUIRED"
  | "COLOR_NOT_ALLOWED"
  | "MUST_PLAY_DRAWN_CARD"
  | "ALREADY_DREW"
  | "NO_DRAWN_CARD"
  | "STARTING_COLOR_REQUIRED"
  | "NOT_AWAITING_DRAW_FOUR"
  | "NOT_DRAW_FOUR_TARGET"
  | "NOT_UNO_VULNERABLE"
  | "CANNOT_CATCH_SELF"
  | "PLAYER_NOT_IN_GAME"
  | "INVALID_COLOR";

export interface RuleError {
  code: RuleErrorCode;
  message: string;
}

export type RuleResult =
  | { ok: true; state: GameState }
  | { ok: false; state: GameState; error: RuleError };

export type RandomSource = () => number;

export interface StartGameOptions {
  random?: RandomSource;
  deck?: Card[];
  handSize?: number;
}

export interface PlayCardOptions {
  chosenColor?: CardColor;
  declareUno?: boolean;
  random?: RandomSource;
}
