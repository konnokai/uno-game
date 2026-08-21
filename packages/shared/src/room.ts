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
  | "GAME_NOT_FINISHED"
  | "GAME_PAUSED"
  | "RATE_LIMITED";

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
  drawnCardId: string | null;
  unoVulnerablePlayerId: string | null;
  pendingDrawFour: PublicPendingDrawFour | null;
  winnerId: string | null;
  lastAction: GameAction;
  actionHistory: GameHistoryEntry[];
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

export interface ClientToServerEvents {
  "connection:ping": (acknowledge: (serverTime: string) => void) => void;
  "room:list": (acknowledge: (rooms: RoomListItem[]) => void) => void;
  "room:create": (
    payload: CreateRoomPayload,
    acknowledge: (response: RoomSessionResponse) => void,
  ) => void;
  "room:join": (
    payload: JoinRoomPayload,
    acknowledge: (response: RoomSessionResponse) => void,
  ) => void;
  "room:ready": (
    payload: SetReadyPayload,
    acknowledge: (response: RoomActionResponse) => void,
  ) => void;
  "room:add-bot": (
    payload: ActionRequestPayload,
    acknowledge: (response: RoomActionResponse) => void,
  ) => void;
  "room:remove-bot": (
    payload: RemoveBotPayload,
    acknowledge: (response: RoomActionResponse) => void,
  ) => void;
  "room:leave": (
    payload: ActionRequestPayload,
    acknowledge: (response: RoomActionResponse) => void,
  ) => void;
  "game:start": (
    payload: ActionRequestPayload,
    acknowledge: (response: RoomActionResponse) => void,
  ) => void;
  "game:rematch": (
    payload: ActionRequestPayload,
    acknowledge: (response: RoomActionResponse) => void,
  ) => void;
  "game:bot-control": (
    payload: SetBotControlPayload,
    acknowledge: (response: RoomActionResponse) => void,
  ) => void;
  "game:play-card": (
    payload: PlayCardPayload,
    acknowledge: (response: GameActionResponse) => void,
  ) => void;
  "game:draw-card": (
    payload: ActionRequestPayload,
    acknowledge: (response: GameActionResponse) => void,
  ) => void;
  "game:pass": (
    payload: ActionRequestPayload,
    acknowledge: (response: GameActionResponse) => void,
  ) => void;
  "game:choose-color": (
    payload: ChooseColorPayload,
    acknowledge: (response: GameActionResponse) => void,
  ) => void;
  "game:call-uno": (
    payload: ActionRequestPayload,
    acknowledge: (response: GameActionResponse) => void,
  ) => void;
  "game:catch-uno": (
    payload: ActionRequestPayload,
    acknowledge: (response: GameActionResponse) => void,
  ) => void;
  "game:challenge-draw-four": (
    payload: ResolveDrawFourPayload,
    acknowledge: (response: GameActionResponse) => void,
  ) => void;
}

export interface ServerToClientEvents {
  "connection:ready": (payload: ConnectionReadyPayload) => void;
  "room:list-updated": (rooms: RoomListItem[]) => void;
  "room:updated": (room: RoomSnapshot) => void;
  "game:started": (payload: GameStartedPayload) => void;
  "game:state": (state: GameSnapshot) => void;
  "game:action-rejected": (payload: GameActionRejectedPayload) => void;
}

export interface ConnectionReadyPayload {
  connectedAt: string;
  message: string;
}
