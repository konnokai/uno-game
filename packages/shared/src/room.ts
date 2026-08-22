import type {
  Card,
  CardColor,
  Direction,
  GameAction,
  GamePhase,
  RuleError,
} from "./game/types.js";

export const ROOM_CODE_LENGTH = 6;
export const MIN_NICKNAME_LENGTH = 2;
export const MAX_NICKNAME_LENGTH = 20;
export const DEFAULT_TURN_TIMEOUT_SECONDS = 30;

export function normalizeNickname(value: string): string | null {
  const nickname = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  const length = [...nickname].length;
  if (
    length < MIN_NICKNAME_LENGTH ||
    length > MAX_NICKNAME_LENGTH ||
    /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]/u.test(nickname) ||
    !/[\p{L}\p{N}\p{S}]/u.test(nickname)
  ) {
    return null;
  }
  return nickname;
}

export interface RoomPlayer {
  id: string;
  nickname: string;
  isBot: boolean;
  isHost: boolean;
  isReady: boolean;
  isConnected: boolean;
  isBotManaged: boolean;
}

export interface RoomSnapshot {
  code: string;
  phase: GamePhase;
  hostId: string;
  turnTimeoutSeconds: number;
  players: RoomPlayer[];
  canStart: boolean;
  winnerId: string | null;
  version: number;
}

export interface RoomListItem {
  code: string;
  hostNickname: string;
  playerCount: number;
  maxPlayers: number;
  isFull: boolean;
}

export interface RoomSession {
  roomCode: string;
  playerId: string;
  playerToken: string;
  nickname: string;
}

export interface CreateRoomPayload {
  nickname: string;
  requestId: string;
  playerToken?: string;
}

export interface JoinRoomPayload {
  roomCode: string;
  nickname: string;
  playerToken?: string;
  requestId: string;
}

export interface SetReadyPayload {
  isReady: boolean;
  requestId: string;
}

export interface RemoveBotPayload extends ActionRequestPayload {
  botId: string;
}

export interface SetBotControlPayload extends ActionRequestPayload {
  enabled: boolean;
}

export interface SetTurnTimeoutPayload extends ActionRequestPayload {
  seconds: number;
}

export interface ActionRequestPayload {
  requestId: string;
}

export type RoomErrorCode =
  | "INVALID_PAYLOAD"
  | "INVALID_NICKNAME"
  | "INVALID_ROOM_CODE"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "NICKNAME_TAKEN"
  | "ALREADY_IN_ROOM"
  | "ALREADY_JOINED"
  | "GAME_ALREADY_STARTED"
  | "NOT_IN_ROOM"
  | "HOST_ONLY"
  | "HOST_CANNOT_READY"
  | "NOT_ENOUGH_PLAYERS"
  | "PLAYERS_NOT_READY"
  | "BOT_NOT_FOUND"
  | "BOT_CONTROL_UNAVAILABLE"
  | "BOT_CONTROL_ACTIVE"
  | "INVALID_TURN_TIMEOUT"
  | "GAME_NOT_FINISHED"
  | "GAME_PAUSED"
  | "RATE_LIMITED"
  | "NETWORK_ERROR";

export interface RoomError {
  code: RoomErrorCode;
  message: string;
}

export type RoomActionResponse =
  | { ok: true; room: RoomSnapshot | null }
  | { ok: false; error: RoomError };

export type RoomSessionResponse =
  | { ok: true; room: RoomSnapshot; session: RoomSession }
  | { ok: false; error: RoomError };

export type RoomActionName =
  | "room:create"
  | "room:join"
  | "room:ready"
  | "room:add-bot"
  | "room:remove-bot"
  | "room:set-turn-timeout"
  | "room:leave"
  | "game:start"
  | "game:rematch"
  | "game:bot-control"
  | "game:play-card"
  | "game:draw-card"
  | "game:pass"
  | "game:choose-color"
  | "game:call-uno"
  | "game:catch-uno"
  | "game:challenge-draw-four";

export interface RoomActionRejectedPayload {
  action: RoomActionName;
  error: RoomError;
}

export interface GameStartedPayload {
  room: RoomSnapshot;
}

export interface PublicGamePlayer {
  id: string;
  handCount: number;
}

export interface PublicPendingDrawFour {
  attackerId: string;
  targetId: string;
  chosenColor: CardColor;
}

export interface GameHistoryEntry {
  version: number;
  action: GameAction;
  card?: Card;
}

/** A player-specific view. Only `hand` contains private card data. */
export interface GameSnapshot {
  players: PublicGamePlayer[];
  hand: Card[];
  topDiscard: Card;
  drawPileCount: number;
  currentColor: CardColor | null;
  currentPlayerId: string;
  direction: Direction;
  phase: Exclude<GamePhase, "lobby">;
  hasDrawnThisTurn: boolean;
  drawnCardId: string | null;
  unoVulnerablePlayerId: string | null;
  pendingDrawFour: PublicPendingDrawFour | null;
  winnerId: string | null;
  lastAction: GameAction;
  actionHistory: GameHistoryEntry[];
  turnDeadlineAt: number | null;
  version: number;
}

export interface PlayCardPayload {
  cardId: string;
  chosenColor?: CardColor;
  declareUno?: boolean;
  requestId: string;
}

export interface ChooseColorPayload {
  color: CardColor;
  requestId: string;
}

export interface ResolveDrawFourPayload {
  challenge: boolean;
  requestId: string;
}

export type GameActionResponse =
  | { ok: true }
  | { ok: false; error: RuleError | RoomError };

export interface GameActionRejectedPayload {
  action: string;
  error: RuleError | RoomError;
}

export interface SessionAttachPayload {
  roomCode: string;
  playerId: string;
  playerToken: string;
}

export interface SessionAttachedPayload {
  room: RoomSnapshot;
  game: GameSnapshot | null;
}

export type SessionAttachResponse =
  | { ok: true; room: RoomSnapshot; game: GameSnapshot | null }
  | { ok: false; error: RoomError };

/** Messages sent after the HTTP room create/join flow has established a session. */
export type ClientMessage =
  | { type: "session:attach"; requestId: string; payload: SessionAttachPayload }
  | { type: "room:ready"; requestId: string; payload: SetReadyPayload }
  | { type: "room:add-bot"; requestId: string; payload: ActionRequestPayload }
  | { type: "room:remove-bot"; requestId: string; payload: RemoveBotPayload }
  | { type: "room:set-turn-timeout"; requestId: string; payload: SetTurnTimeoutPayload }
  | { type: "room:leave"; requestId: string; payload: ActionRequestPayload }
  | { type: "game:start"; requestId: string; payload: ActionRequestPayload }
  | { type: "game:rematch"; requestId: string; payload: ActionRequestPayload }
  | { type: "game:bot-control"; requestId: string; payload: SetBotControlPayload }
  | { type: "game:play-card"; requestId: string; payload: PlayCardPayload }
  | { type: "game:draw-card"; requestId: string; payload: ActionRequestPayload }
  | { type: "game:pass"; requestId: string; payload: ActionRequestPayload }
  | { type: "game:choose-color"; requestId: string; payload: ChooseColorPayload }
  | { type: "game:call-uno"; requestId: string; payload: ActionRequestPayload }
  | { type: "game:catch-uno"; requestId: string; payload: ActionRequestPayload }
  | { type: "game:challenge-draw-four"; requestId: string; payload: ResolveDrawFourPayload };

export type ClientMessageType = ClientMessage["type"];

export type ProtocolResponse = RoomActionResponse | GameActionResponse | SessionAttachResponse;

export type ServerMessage =
  | { type: "response"; requestId: string; payload: ProtocolResponse }
  | { type: "connection:ready"; payload: ConnectionReadyPayload }
  | { type: "session:attached"; payload: SessionAttachedPayload }
  | { type: "room:updated"; payload: RoomSnapshot }
  | { type: "game:started"; payload: GameStartedPayload }
  | { type: "game:state"; payload: GameSnapshot }
  | { type: "game:action-rejected"; payload: GameActionRejectedPayload };

export interface ConnectionReadyPayload {
  connectedAt: string;
  message: string;
}
