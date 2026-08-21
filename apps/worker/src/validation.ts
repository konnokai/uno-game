import {
  CARD_COLORS,
  type ActionRequestPayload,
  type ClientMessage,
  type CreateRoomPayload,
  type JoinRoomPayload,
  type ChooseColorPayload,
  type PlayCardPayload,
  type RemoveBotPayload,
  type ResolveDrawFourPayload,
  type RoomError,
  type RoomErrorCode,
  type SessionAttachPayload,
  type SetBotControlPayload,
  type SetReadyPayload,
} from "@uno/shared";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const PLAYER_TOKEN_PATTERN = /^[a-f0-9]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

export function isRoomCode(value: unknown): value is string {
  return typeof value === "string" && ROOM_CODE_PATTERN.test(value.trim().toUpperCase());
}

function isPlayerToken(value: unknown): value is string {
  return typeof value === "string" && PLAYER_TOKEN_PATTERN.test(value);
}

function isCardColor(value: unknown): boolean {
  return typeof value === "string" && CARD_COLORS.some((color) => color === value);
}

function isActionPayload(value: unknown): value is Record<string, unknown> & ActionRequestPayload {
  return isRecord(value) && isRequestId(value.requestId);
}

function typedPayload<T>(value: unknown): T {
  return value as T;
}

export function isCreateRoomPayload(value: unknown): value is CreateRoomPayload {
  return isRecord(value) &&
    typeof value.nickname === "string" &&
    isRequestId(value.requestId) &&
    (value.playerToken === undefined ||
      isPlayerToken(value.playerToken));
}

export function isJoinRoomPayload(value: unknown): value is JoinRoomPayload {
  return isRecord(value) &&
    typeof value.roomCode === "string" &&
    typeof value.nickname === "string" &&
    (value.playerToken === undefined ||
      isPlayerToken(value.playerToken)) &&
    isRequestId(value.requestId);
}

function invalid(message: string, code: RoomErrorCode = "INVALID_PAYLOAD"): { ok: false; error: RoomError } {
  return { ok: false, error: { code, message } };
}

/** Parses a WebSocket frame before any room state is touched. */
export function parseClientMessage(raw: string | ArrayBuffer):
  | { ok: true; message: ClientMessage }
  | { ok: false; requestId?: string; error: RoomError } {
  let value: unknown;
  try {
    value = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
  } catch {
    return invalid("訊息格式不正確");
  }
  if (!isRecord(value) || !isRequestId(value.requestId) || typeof value.type !== "string") {
    return invalid("訊息格式不正確");
  }

  const requestId = value.requestId;
  const payload = value.payload;
  switch (value.type) {
    case "session:attach":
      if (isRecord(payload) && isRoomCode(payload.roomCode) &&
        typeof payload.playerId === "string" && payload.playerId.length <= 100 &&
        isPlayerToken(payload.playerToken)) {
        return { ok: true, message: { type: "session:attach", requestId, payload: typedPayload<SessionAttachPayload>(payload) } };
      }
      break;
    case "room:ready":
      if (isActionPayload(payload) && typeof (payload as Record<string, unknown>).isReady === "boolean") {
        return { ok: true, message: { type: "room:ready", requestId, payload: typedPayload<SetReadyPayload>(payload) } };
      }
      break;
    case "room:add-bot":
    case "room:leave":
    case "game:start":
    case "game:rematch":
    case "game:draw-card":
    case "game:pass":
    case "game:call-uno":
      case "game:catch-uno":
      if (isActionPayload(payload)) {
        return { ok: true, message: { type: value.type, requestId, payload } } as {
          ok: true;
          message: ClientMessage;
        };
      }
      break;
    case "room:remove-bot": {
      const botId = isRecord(payload) ? payload.botId : undefined;
      if (isActionPayload(payload) && typeof botId === "string" && botId.length <= 100) {
        return { ok: true, message: { type: "room:remove-bot", requestId, payload: typedPayload<RemoveBotPayload>(payload) } };
      }
      break;
    }
    case "game:bot-control":
      if (isActionPayload(payload) && typeof (payload as Record<string, unknown>).enabled === "boolean") {
        return { ok: true, message: { type: "game:bot-control", requestId, payload: typedPayload<SetBotControlPayload>(payload) } };
      }
      break;
    case "game:play-card":
      if (isActionPayload(payload) && typeof (payload as Record<string, unknown>).cardId === "string" &&
        ((payload as Record<string, unknown>).chosenColor === undefined ||
          isCardColor((payload as Record<string, unknown>).chosenColor)) &&
        ((payload as Record<string, unknown>).declareUno === undefined ||
          typeof (payload as Record<string, unknown>).declareUno === "boolean")) {
        return { ok: true, message: { type: "game:play-card", requestId, payload: typedPayload<PlayCardPayload>(payload) } };
      }
      break;
    case "game:choose-color":
      if (isActionPayload(payload) && isCardColor((payload as Record<string, unknown>).color)) {
        return { ok: true, message: { type: "game:choose-color", requestId, payload: typedPayload<ChooseColorPayload>(payload) } };
      }
      break;
    case "game:challenge-draw-four":
      if (isActionPayload(payload) && typeof (payload as Record<string, unknown>).challenge === "boolean") {
        return { ok: true, message: { type: "game:challenge-draw-four", requestId, payload: typedPayload<ResolveDrawFourPayload>(payload) } };
      }
      break;
    default:
      return { ok: false, requestId, error: { code: "INVALID_PAYLOAD", message: "不支援的訊息類型" } };
  }
  return { ok: false, requestId, error: { code: "INVALID_PAYLOAD", message: "訊息資料格式不正確" } };
}

export async function readJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
