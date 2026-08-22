export const CARD_COLORS = ["red", "yellow", "green", "blue"] as const;
export const GAME_RULES_MODES = ["classic", "taiwan"] as const;
export const STACKING_MODES = ["same-type", "draw-four-over-two", "mixed"] as const;
export const MIN_GAME_PLAYERS = 2;
export const MAX_GAME_PLAYERS = 8;

export type CardColor = (typeof CARD_COLORS)[number];
export type GameRulesMode = (typeof GAME_RULES_MODES)[number];
export type StackingMode = (typeof STACKING_MODES)[number];
export type PendingDrawType = "draw-two" | "wild-draw-four";

export interface GameRuleOptions {
  stackingEnabled: boolean;
  stackingMode: StackingMode;
  sevenZeroEnabled: boolean;
  jumpInEnabled: boolean;
  drawToMatchEnabled: boolean;
  drawFourChallengeEnabled: boolean;
  multiCardPlayEnabled: boolean;
}

export const DEFAULT_GAME_RULES_MODE: GameRulesMode = "classic";
export const DEFAULT_GAME_RULE_OPTIONS: GameRuleOptions = {
  stackingEnabled: true,
  stackingMode: "same-type",
  sevenZeroEnabled: true,
  jumpInEnabled: true,
  drawToMatchEnabled: true,
  drawFourChallengeEnabled: true,
  multiCardPlayEnabled: false,
};

export function isGameRulesMode(value: unknown): value is GameRulesMode {
  return GAME_RULES_MODES.some((mode) => mode === value);
}

export function isStackingMode(value: unknown): value is StackingMode {
  return STACKING_MODES.some((mode) => mode === value);
}

export function isGameRuleOptions(value: unknown): value is GameRuleOptions {
  if (typeof value !== "object" || value === null) return false;
  const options = value as Record<string, unknown>;
  return typeof options.stackingEnabled === "boolean" &&
    isStackingMode(options.stackingMode) &&
    typeof options.sevenZeroEnabled === "boolean" &&
    typeof options.jumpInEnabled === "boolean" &&
    typeof options.drawToMatchEnabled === "boolean" &&
    typeof options.drawFourChallengeEnabled === "boolean" &&
    typeof options.multiCardPlayEnabled === "boolean";
}

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
  jumpIn?: boolean;
  cardIds?: string[];
  shuffle?: "initial" | "recycle";
}

export interface GameState {
  rulesMode: GameRulesMode;
  rulesOptions: GameRuleOptions;
  players: GamePlayer[];
  drawPile: Card[];
  discardPile: Card[];
  currentColor: CardColor | null;
  currentPlayerIndex: number;
  direction: Direction;
  phase: Exclude<GamePhase, "lobby">;
  hasDrawnThisTurn: boolean;
  drawnCardId: string | null;
  pendingDrawAmount: number;
  pendingDrawType: PendingDrawType | null;
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
  | "DRAW_FOUR_CHALLENGE_DISABLED"
  | "PLAYER_NOT_IN_GAME"
  | "TARGET_PLAYER_REQUIRED"
  | "INVALID_TARGET_PLAYER"
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
  rulesMode?: GameRulesMode;
  rulesOptions?: GameRuleOptions;
}

export interface PlayCardOptions {
  chosenColor?: CardColor;
  declareUno?: boolean;
  targetPlayerId?: string;
  additionalCardIds?: readonly string[];
  random?: RandomSource;
}
