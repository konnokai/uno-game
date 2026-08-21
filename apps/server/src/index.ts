import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  ActionRequestPayload,
  CardColor,
  ClientToServerEvents,
  CreateRoomPayload,
  GameActionResponse,
  JoinRoomPayload,
  PlayCardPayload,
  RemoveBotPayload,
  RoomActionName,
  RoomActionResponse,
  RoomError,
  RoomSessionResponse,
  ServerToClientEvents,
  SetReadyPayload,
  SetBotControlPayload,
} from "@uno/shared";
import { CARD_COLORS } from "@uno/shared";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { RateLimiter } from "./rate-limiter.js";
import { RequestDeduplicator } from "./request-deduplicator.js";
import { RoomManager } from "./room-manager.js";

const port = Number(process.env.PORT ?? 3001);
const isProduction = process.env.NODE_ENV === "production";
const clientOrigin = process.env.CLIENT_ORIGIN ?? (isProduction ? null : "http://localhost:5173");
const webDistPath = fileURLToPath(new URL("../../web/dist/", import.meta.url));

const app = express();
if (clientOrigin) app.use(cors({ origin: clientOrigin }));

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

if (isProduction) {
  app.use(express.static(webDistPath, {
    setHeaders(response, filePath) {
      response.setHeader(
        "Cache-Control",
        filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
      );
    },
  }));
  app.use((request, response, next) => {
    if (request.method !== "GET" || request.path.startsWith("/socket.io")) {
      next();
      return;
    }
    response.setHeader("Cache-Control", "no-cache");
    response.sendFile(join(webDistPath, "index.html"));
  });
}

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  ...(clientOrigin ? { cors: { origin: clientOrigin } } : {}),
});
const rooms = new RoomManager();
const createLimiter = new RateLimiter({ limit: 5, windowMs: 10_000 });
const joinLimiter = new RateLimiter({ limit: 8, windowMs: 10_000 });
const reconnectLimiter = new RateLimiter({ limit: 20, windowMs: 10_000 });
const requests = new RequestDeduplicator();
const botTimers = new Map<string, NodeJS.Timeout>();
const botTurnDelayMs = Number(process.env.BOT_TURN_DELAY_MS ?? 650);

export { httpServer, io, rooms };

export function clearReliabilityTimers(): void {
  for (const timer of botTimers.values()) clearTimeout(timer);
  botTimers.clear();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCreatePayload(value: unknown): value is CreateRoomPayload {
  return isRecord(value) && typeof value.nickname === "string" && isRequestId(value.requestId);
}

function isJoinPayload(value: unknown): value is JoinRoomPayload {
  return (
    isRecord(value) &&
    typeof value.roomCode === "string" &&
    typeof value.nickname === "string" &&
    (value.playerToken === undefined || (
      typeof value.playerToken === "string" && value.playerToken.length <= 128
    )) &&
    isRequestId(value.requestId)
  );
}

function isReadyPayload(value: unknown): value is SetReadyPayload {
  return isRecord(value) && typeof value.isReady === "boolean" && isRequestId(value.requestId);
}

function isBotControlPayload(value: unknown): value is SetBotControlPayload {
  return isRecord(value) && typeof value.enabled === "boolean" && isRequestId(value.requestId);
}

function isRemoveBotPayload(value: unknown): value is RemoveBotPayload {
  return isRecord(value) &&
    isRequestId(value.requestId) &&
    typeof value.botId === "string" &&
    value.botId.length <= 100;
}

function isRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,100}$/.test(value);
}

function isActionPayload(value: unknown): value is ActionRequestPayload {
  return isRecord(value) && isRequestId(value.requestId);
}

function isCardColor(value: unknown): value is CardColor {
  return typeof value === "string" && CARD_COLORS.some((color) => color === value);
}

function isPlayCardPayload(value: unknown): value is PlayCardPayload {
  return isRecord(value) &&
    typeof value.cardId === "string" &&
    (value.chosenColor === undefined || isCardColor(value.chosenColor)) &&
    (value.declareUno === undefined || typeof value.declareUno === "boolean") &&
    isRequestId(value.requestId);
}

function clearRoomTimers(roomCode: string): void {
  const botTimer = botTimers.get(roomCode);
  if (botTimer) {
    clearTimeout(botTimer);
    botTimers.delete(roomCode);
  }
}

function publishRoomList(): void {
  io.emit("room:list-updated", rooms.listRooms());
}

function publishGameStates(roomCode: string): void {
  for (const recipient of rooms.getGameRecipients(roomCode)) {
    io.to(recipient.socketId).emit("game:state", recipient.state);
  }
}

function scheduleBotTurn(roomCode: string): void {
  if (botTimers.has(roomCode) || !rooms.hasPendingBotAction(roomCode)) return;
  const timer = setTimeout(() => {
    botTimers.delete(roomCode);
    if (!rooms.performBotAction(roomCode)) return;
    const room = rooms.getRoom(roomCode);
    if (room) io.to(roomCode).emit("room:updated", room);
    publishGameStates(roomCode);
    scheduleBotTurn(roomCode);
  }, botTurnDelayMs);
  timer.unref();
  botTimers.set(roomCode, timer);
}

io.on("connection", (socket) => {
  socket.emit("connection:ready", {
    connectedAt: new Date().toISOString(),
    message: "UNO server connected",
  });
  socket.emit("room:list-updated", rooms.listRooms());

  socket.on("room:list", (acknowledge) => {
    if (typeof acknowledge === "function") acknowledge(rooms.listRooms());
  });

  socket.on("connection:ping", (acknowledge) => {
    if (typeof acknowledge === "function") {
      acknowledge(new Date().toISOString());
    }
  });

  function reject<T extends RoomActionResponse | RoomSessionResponse>(
    action: RoomActionName,
    error: RoomError,
    acknowledge: ((response: T) => void) | undefined,
  ): void {
    if (typeof acknowledge === "function") {
      acknowledge({ ok: false, error } as T);
    } else {
      socket.emit("game:action-rejected", { action, error });
    }
  }

  function acknowledge<T>(callback: ((response: T) => void) | undefined, response: T): void {
    if (typeof callback === "function") callback(response);
  }

  function requestScope(): string {
    return `player:${rooms.getPlayerId(socket.id) ?? `socket:${socket.id}`}`;
  }

  function publish(response: RoomActionResponse): void {
    if (response.ok && response.room) {
      io.to(response.room.code).emit("room:updated", response.room);
    }
  }

  function runGameAction(
    action: string,
    requestId: string,
    acknowledgeCallback: ((response: GameActionResponse) => void) | undefined,
    operation: () => GameActionResponse,
  ): void {
    const roomCode = rooms.getRoomCode(socket.id);
    const { response, duplicate } = requests.execute(
      `socket:${socket.id}`,
      action,
      requestId,
      operation,
    );
    acknowledge(acknowledgeCallback, response);
    if (!response.ok) {
      if (typeof acknowledgeCallback !== "function") {
        socket.emit("game:action-rejected", { action, error: response.error });
      }
      return;
    }
    if (roomCode && !duplicate) {
      const room = rooms.getRoom(roomCode);
      if (room) io.to(roomCode).emit("room:updated", room);
      publishGameStates(roomCode);
      scheduleBotTurn(roomCode);
    }
  }

  socket.on("room:create", async (payload, acknowledge) => {
    if (!isCreatePayload(payload)) {
      reject("room:create", { code: "INVALID_PAYLOAD", message: "建立房間資料格式不正確" }, acknowledge);
      return;
    }
    const { response, duplicate } = requests.execute(
      `socket:${socket.id}`,
      "room:create",
      payload.requestId,
      () => createLimiter.consume(socket.handshake.address)
        ? rooms.create(socket.id, payload.nickname)
        : { ok: false as const, error: { code: "RATE_LIMITED" as const, message: "建立房間過於頻繁，請稍後再試" } },
    );
    if (!response.ok) {
      reject("room:create", response.error, acknowledge);
      return;
    }
    await socket.join(response.room.code);
    acknowledge?.(response);
    if (!duplicate) {
      io.to(response.room.code).emit("room:updated", response.room);
      publishRoomList();
    }
  });

  socket.on("room:join", async (payload, acknowledge) => {
    if (!isJoinPayload(payload)) {
      reject("room:join", { code: "INVALID_PAYLOAD", message: "加入房間資料格式不正確" }, acknowledge);
      return;
    }
    const limiter = payload.playerToken && rooms.canReconnect(payload.roomCode, payload.playerToken)
      ? reconnectLimiter
      : joinLimiter;
    const { response, duplicate } = requests.execute(
      requestScope(),
      "room:join",
      payload.requestId,
      () => limiter.consume(socket.handshake.address)
        ? rooms.join(socket.id, payload.roomCode, payload.nickname, payload.playerToken)
        : { ok: false as const, error: { code: "RATE_LIMITED" as const, message: "加入房間過於頻繁，請稍後再試" } },
    );
    if (!response.ok) {
      reject("room:join", response.error, acknowledge);
      return;
    }
    await socket.join(response.room.code);
    acknowledge?.(response);
    if (!duplicate) {
      io.to(response.room.code).emit("room:updated", response.room);
      publishGameStates(response.room.code);
      publishRoomList();
      scheduleBotTurn(response.room.code);
    }
  });

  socket.on("room:ready", (payload, acknowledge) => {
    if (!isReadyPayload(payload)) {
      reject("room:ready", { code: "INVALID_PAYLOAD", message: "準備狀態格式不正確" }, acknowledge);
      return;
    }
    const { response, duplicate } = requests.execute(
      requestScope(), "room:ready", payload.requestId,
      () => rooms.setReady(socket.id, payload.isReady),
    );
    if (!response.ok) {
      reject("room:ready", response.error, acknowledge);
      return;
    }
    acknowledge?.(response);
    if (!duplicate) publish(response);
  });

  socket.on("room:add-bot", (payload, acknowledge) => {
    if (!isActionPayload(payload)) {
      reject("room:add-bot", { code: "INVALID_PAYLOAD", message: "加入機器人資料格式不正確" }, acknowledge);
      return;
    }
    const { response, duplicate } = requests.execute(
      requestScope(), "room:add-bot", payload.requestId, () => rooms.addBot(socket.id),
    );
    if (!response.ok) {
      reject("room:add-bot", response.error, acknowledge);
      return;
    }
    acknowledge?.(response);
    if (!duplicate) {
      publish(response);
      publishRoomList();
    }
  });

  socket.on("room:remove-bot", (payload, acknowledge) => {
    if (!isRemoveBotPayload(payload)) {
      reject("room:remove-bot", { code: "INVALID_PAYLOAD", message: "移除機器人資料格式不正確" }, acknowledge);
      return;
    }
    const { response, duplicate } = requests.execute(
      requestScope(), "room:remove-bot", payload.requestId,
      () => rooms.removeBot(socket.id, payload.botId),
    );
    if (!response.ok) {
      reject("room:remove-bot", response.error, acknowledge);
      return;
    }
    acknowledge?.(response);
    if (!duplicate) {
      publish(response);
      publishRoomList();
    }
  });

  socket.on("game:start", (payload, acknowledge) => {
    if (!isActionPayload(payload)) {
      reject("game:start", { code: "INVALID_PAYLOAD", message: "開始遊戲資料格式不正確" }, acknowledge);
      return;
    }
    const { response, duplicate } = requests.execute(
      requestScope(), "game:start", payload.requestId, () => rooms.start(socket.id),
    );
    if (!response.ok) {
      reject("game:start", response.error, acknowledge);
      return;
    }
    acknowledge?.(response);
    if (response.room && !duplicate) {
      io.to(response.room.code).emit("game:started", { room: response.room });
      publishGameStates(response.room.code);
      publishRoomList();
      scheduleBotTurn(response.room.code);
    }
  });

  socket.on("game:rematch", (payload, acknowledge) => {
    if (!isActionPayload(payload)) {
      reject("game:rematch", { code: "INVALID_PAYLOAD", message: "重新開始資料格式不正確" }, acknowledge);
      return;
    }
    const { response, duplicate } = requests.execute(
      requestScope(), "game:rematch", payload.requestId, () => rooms.rematch(socket.id),
    );
    if (!response.ok) {
      reject("game:rematch", response.error, acknowledge);
      return;
    }
    acknowledge?.(response);
    if (response.room && !duplicate) {
      io.to(response.room.code).emit("game:started", { room: response.room });
      publishGameStates(response.room.code);
      scheduleBotTurn(response.room.code);
    }
  });

  socket.on("game:bot-control", (payload, acknowledge) => {
    if (!isBotControlPayload(payload)) {
      reject("game:bot-control", { code: "INVALID_PAYLOAD", message: "代管設定格式不正確" }, acknowledge);
      return;
    }
    const roomCode = rooms.getRoomCode(socket.id);
    const { response, duplicate } = requests.execute(
      requestScope(), "game:bot-control", payload.requestId,
      () => rooms.setBotControl(socket.id, payload.enabled),
    );
    if (!response.ok) {
      reject("game:bot-control", response.error, acknowledge);
      return;
    }
    acknowledge?.(response);
    if (!duplicate) {
      publish(response);
      if (roomCode) scheduleBotTurn(roomCode);
    }
  });

  socket.on("game:play-card", (payload, acknowledge) => {
    if (!isPlayCardPayload(payload)) {
      reject("game:play-card", { code: "INVALID_PAYLOAD", message: "出牌資料格式不正確" }, acknowledge);
      return;
    }
    runGameAction("game:play-card", payload.requestId, acknowledge, () => rooms.play(socket.id, payload));
  });

  socket.on("game:draw-card", (payload, acknowledge) => {
    if (!isActionPayload(payload)) {
      reject("game:draw-card", { code: "INVALID_PAYLOAD", message: "抽牌資料格式不正確" }, acknowledge);
      return;
    }
    runGameAction("game:draw-card", payload.requestId, acknowledge, () => rooms.draw(socket.id));
  });

  socket.on("game:pass", (payload, acknowledge) => {
    if (!isActionPayload(payload)) {
      reject("game:pass", { code: "INVALID_PAYLOAD", message: "結束回合資料格式不正確" }, acknowledge);
      return;
    }
    runGameAction("game:pass", payload.requestId, acknowledge, () => rooms.pass(socket.id));
  });

  socket.on("game:choose-color", (payload, acknowledge) => {
    if (!isRecord(payload) || !isCardColor(payload.color) || !isRequestId(payload.requestId)) {
      reject("game:choose-color", { code: "INVALID_PAYLOAD", message: "顏色格式不正確" }, acknowledge);
      return;
    }
    runGameAction("game:choose-color", payload.requestId, acknowledge, () => rooms.chooseColor(socket.id, payload.color));
  });

  socket.on("game:call-uno", (payload, acknowledge) => {
    if (!isActionPayload(payload)) {
      reject("game:call-uno", { code: "INVALID_PAYLOAD", message: "UNO 資料格式不正確" }, acknowledge);
      return;
    }
    runGameAction("game:call-uno", payload.requestId, acknowledge, () => rooms.callUno(socket.id));
  });

  socket.on("game:catch-uno", (payload, acknowledge) => {
    if (!isActionPayload(payload)) {
      reject("game:catch-uno", { code: "INVALID_PAYLOAD", message: "抓 UNO 資料格式不正確" }, acknowledge);
      return;
    }
    runGameAction("game:catch-uno", payload.requestId, acknowledge, () => rooms.catchUno(socket.id));
  });

  socket.on("game:challenge-draw-four", (payload, acknowledge) => {
    if (!isRecord(payload) || typeof payload.challenge !== "boolean" || !isRequestId(payload.requestId)) {
      reject("game:challenge-draw-four", { code: "INVALID_PAYLOAD", message: "質疑資料格式不正確" }, acknowledge);
      return;
    }
    runGameAction("game:challenge-draw-four", payload.requestId, acknowledge, () =>
      rooms.resolveDrawFour(socket.id, payload.challenge),
    );
  });

  socket.on("room:leave", async (payload, acknowledge) => {
    if (!isActionPayload(payload)) {
      reject("room:leave", { code: "INVALID_PAYLOAD", message: "離開房間資料格式不正確" }, acknowledge);
      return;
    }
    const roomCode = rooms.getRoomCode(socket.id);
    const { response, duplicate } = requests.execute(
      `socket:${socket.id}`, "room:leave", payload.requestId, () => rooms.leave(socket.id),
    );
    if (!response.ok) {
      reject("room:leave", response.error, acknowledge);
      return;
    }
    const joinedRoom = [...socket.rooms].find((room) => room !== socket.id);
    acknowledge?.(response);
    if (roomCode) clearRoomTimers(roomCode);
    if (joinedRoom) {
      await socket.leave(joinedRoom);
      if (response.room && !duplicate) {
        io.to(joinedRoom).emit("room:updated", response.room);
      }
      if (!duplicate) publishRoomList();
    }
  });

  socket.on("disconnect", () => {
    const result = rooms.disconnect(socket.id);
    if (result?.room) {
      io.to(result.roomCode).emit("room:updated", result.room);
    }
    if (result) publishRoomList();
    if (result?.room) scheduleBotTurn(result.roomCode);
  });
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  httpServer.listen(port, () => {
    console.log(`UNO ${isProduction ? "host" : "server"} listening on http://localhost:${port}`);
  });
}
