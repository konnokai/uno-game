import {
  type ClientMessage,
  type GameActionResponse,
  type ProtocolResponse,
  type RoomActionResponse,
  type RoomError,
  type ServerMessage,
  type SessionAttachPayload,
} from "@uno/shared";
import { DurableObject } from "cloudflare:workers";
import {
  createRoomState,
  RoomService,
  type NewRoomPlayer,
  type StoredRoom,
} from "@uno/shared";
import type { Env } from "./env.js";
import { isRoomCode, parseClientMessage, readJson } from "./validation.js";

const STATE_KEY = "room-state";
const REQUEST_KEY = "request-dedup:room";
const REQUEST_TTL_MS = 10 * 60_000;
const REQUEST_MAX_ENTRIES = 5_000;
const RESERVATION_TTL_MS = REQUEST_TTL_MS;
const INTERNAL_ROOM_ERROR: RoomError = {
  code: "GAME_NOT_FINISHED",
  message: "房間暫時無法處理這個操作",
};

interface SocketAttachment {
  playerId: string | null;
  attached: boolean;
}

interface InternalCreateRequest {
  code: string;
  player: NewRoomPlayer;
}

interface InternalJoinRequest {
  nickname: string;
  reconnectTokenHash?: string;
  newPlayer: NewRoomPlayer;
}

interface InternalRoomResponse {
  ok: true;
  room: ReturnType<RoomService["snapshot"]>;
  playerId: string;
  reconnected?: boolean;
}

interface StoredRequest {
  action: string;
  response: ProtocolResponse;
  createdAt: number;
  expiresAt: number;
}

type StoredRequests = Record<string, StoredRequest>;

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

function errorResponse(error: RoomError, status = 400): Response {
  return json({ ok: false, error }, { status });
}

function actionError(message: string): GameActionResponse {
  return { ok: false, error: { ...INTERNAL_ROOM_ERROR, message } };
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function send(ws: WebSocket, message: ServerMessage): void {
  try {
    ws.send(JSON.stringify(message));
  } catch {
    try {
      ws.close(1011, "connection unavailable");
    } catch {
      // The socket is already closed.
    }
  }
}

function sendResponse(ws: WebSocket, requestId: string, payload: ProtocolResponse): void {
  send(ws, { type: "response", requestId, payload });
}

function attachmentOf(ws: WebSocket): SocketAttachment {
  try {
    const attachment = ws.deserializeAttachment() as Partial<SocketAttachment> | null;
    const playerId = typeof attachment?.playerId === "string" ? attachment.playerId : null;
    return { playerId, attached: attachment?.attached === true || playerId !== null };
  } catch {
    return { playerId: null, attached: false };
  }
}

/** One room is one serialized Durable Object; the service itself is storage-agnostic. */
export class RoomDurableObject extends DurableObject<Env> {
  private service: RoomService | null = null;
  private readonly ready: Promise<void>;
  private queue: Promise<void> = Promise.resolve();
  private readonly actionBuckets = new Map<string, { count: number; expiresAt: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const state = await ctx.storage.get<StoredRoom>(STATE_KEY);
      this.service = state ? new RoomService(state) : null;
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/internal/create") {
      return this.exclusive(async () => this.createRoom(await readJson(request)));
    }
    if (request.method === "POST" && url.pathname === "/internal/join") {
      return this.exclusive(async () => this.joinRoom(await readJson(request)));
    }
    if (request.method === "GET" && url.pathname === "/snapshot") {
      return json(this.service?.snapshot() ?? null, this.service ? undefined : { status: 404 });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    // Let the attach message carry a typed ROOM_NOT_FOUND response instead of
    // hiding the error behind a failed WebSocket handshake.
    const pair = new WebSocketPair();
    const client = pair[0]!;
    const server = pair[1]!;
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId: null, attached: false } satisfies SocketAttachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    await this.exclusive(async () => {
      const parsed = parseClientMessage(raw);
      if (!parsed.ok) {
        if (parsed.requestId) sendResponse(ws, parsed.requestId, parsed);
        if (!attachmentOf(ws).attached) ws.close(4003, "session attach required");
        return;
      }
      await this.handleMessage(ws, parsed.message);
    });
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.exclusive(async () => {
      const playerId = attachmentOf(ws).playerId;
      if (!playerId) return;
      await this.handleDisconnect(playerId);
    });
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.exclusive(async () => {
      const playerId = attachmentOf(ws).playerId;
      if (!playerId) return;
      await this.handleDisconnect(playerId);
    });
  }

  async alarm(): Promise<void> {
    await this.exclusive(async () => {
      if (!this.service) return;
      if (this.service.state.game !== null && !this.service.hasConnectedHuman()) {
        await this.clearRoom();
        return;
      }
      const versionBeforeAlarm = this.service.state.version;
      const cleanup = this.service.cleanupReservations(Date.now(), RESERVATION_TTL_MS);
      if (cleanup.deleted) {
        await this.clearRoom();
        return;
      }
      const timedOut = this.service.expireTurn(Date.now());
      if (this.service.state.version !== versionBeforeAlarm) {
        await this.persist();
        await this.notifyLobby();
        this.broadcastRoom();
        this.broadcastGames();
      }
      if (timedOut) {
        await this.scheduleBotAlarm();
        return;
      }
      if (!this.service.hasPendingBotAction()) {
        await this.scheduleBotAlarm();
        return;
      }
      if (!this.service.performBotAction()) {
        await this.scheduleBotAlarm();
        return;
      }
      if (this.service.state.game?.phase === "finished" &&
        !this.service.state.players.some((player) => !player.isBot && player.isConnected)) {
        await this.clearRoom();
        return;
      }
      await this.persist();
      await this.notifyLobby();
      this.broadcastRoom();
      this.broadcastGames();
      await this.scheduleBotAlarm();
    });
  }

  private async createRoom(value: unknown): Promise<Response> {
    const input = value as Partial<InternalCreateRequest> | null;
    if (!input || !isRoomCode(input.code) || !input.player ||
      typeof input.player.id !== "string" || typeof input.player.nickname !== "string" ||
      typeof input.player.tokenHash !== "string") {
      return errorResponse({ code: "INVALID_PAYLOAD", message: "建立房間資料格式不正確" });
    }
    const newPlayer = input.player;
    if (this.service) {
      const existingPlayer = this.service.state.players.find((player) =>
        !player.isBot && player.id === newPlayer.id &&
        player.nickname === newPlayer.nickname && player.tokenHash === newPlayer.tokenHash,
      );
      if (!existingPlayer) {
        return errorResponse({ code: "ALREADY_IN_ROOM", message: "房間已經存在" }, 409);
      }
      return json({ ok: true, room: this.service.snapshot(), playerId: existingPlayer.id });
    }
    this.service = new RoomService(createRoomState(input.code, newPlayer));
    await this.persist();
    await this.notifyLobby();
    await this.scheduleBotAlarm();
    return json({ ok: true, room: this.service.snapshot(), playerId: newPlayer.id });
  }

  private async joinRoom(value: unknown): Promise<Response> {
    const input = value as Partial<InternalJoinRequest> | null;
    if (!input || typeof input.nickname !== "string" || !input.newPlayer ||
      typeof input.newPlayer.id !== "string" || typeof input.newPlayer.tokenHash !== "string") {
      return errorResponse({ code: "INVALID_PAYLOAD", message: "加入房間資料格式不正確" });
    }
    if (!this.service) return errorResponse({ code: "ROOM_NOT_FOUND", message: "找不到這個房間" }, 404);
    const result = this.service.join(input.nickname, input.reconnectTokenHash, input.newPlayer);
    if (!result.ok) return errorResponse(result.error);
    await this.persist();
    await this.notifyLobby();
    this.broadcastRoom();
    this.broadcastGames();
    await this.scheduleBotAlarm();
    return json({
      ok: true,
      room: this.service.snapshot(),
      playerId: result.playerId,
      reconnected: result.reconnected,
    } satisfies InternalRoomResponse);
  }

  private async handleMessage(ws: WebSocket, message: ClientMessage): Promise<void> {
    const attachment = attachmentOf(ws);
    if (message.type === "session:attach") {
      if (attachment.attached) {
        sendResponse(ws, message.requestId, {
          ok: false,
          error: { code: "ALREADY_IN_ROOM", message: "此連線已恢復房間座位" },
        });
        ws.close(4003, "session already attached");
        return;
      }
      await this.attach(ws, message.requestId, message.payload);
      return;
    }

    const playerId = attachment.playerId;
    if (!attachment.attached || !playerId) {
      sendResponse(ws, message.requestId, {
        ok: false,
        error: { code: "NOT_IN_ROOM", message: "請先恢復房間連線" },
      });
      ws.close(4003, "session attach required");
      return;
    }
    await this.applyAction(ws, playerId, message);
  }

  private async attach(ws: WebSocket, requestId: string, payload: SessionAttachPayload): Promise<void> {
    if (!this.service || payload.roomCode !== this.service.code) {
      sendResponse(ws, requestId, { ok: false, error: { code: "ROOM_NOT_FOUND", message: "找不到這個房間" } });
      ws.close(4003, "room not found");
      return;
    }
    const result = this.service.attach(payload.playerId, await hashToken(payload.playerToken));
    if (!result.ok) {
      sendResponse(ws, requestId, result);
      ws.close(4003, "invalid session");
      return;
    }

    for (const peer of this.ctx.getWebSockets()) {
      if (peer === ws || attachmentOf(peer).playerId !== result.playerId) continue;
      peer.serializeAttachment({ playerId: null, attached: true } satisfies SocketAttachment);
      peer.close(4001, "session replaced");
    }
    ws.serializeAttachment({ playerId: result.playerId, attached: true } satisfies SocketAttachment);
    if (result.reconnected) {
      await this.persist();
      await this.notifyLobby();
    }
    sendResponse(ws, requestId, {
      ok: true,
      room: this.service.snapshot(),
      game: this.service.gameSnapshot(result.playerId),
    });
    if (result.reconnected) this.broadcastRoom();
    this.broadcastGames();
    await this.scheduleBotAlarm();
  }

  private async applyAction(ws: WebSocket, playerId: string, message: Exclude<ClientMessage, { type: "session:attach" }>): Promise<void> {
    const key = `${playerId}:${message.type}:${message.requestId}`;
    if (this.service!.expireTurn(Date.now())) {
      await this.persist();
      await this.notifyLobby();
      this.broadcastRoom();
      this.broadcastGames();
      await this.scheduleBotAlarm();
    }
    const requests = await this.ctx.storage.get<StoredRequests>(REQUEST_KEY);
    const previous = requests?.[key];
    if (previous && previous.expiresAt > Date.now()) {
      sendResponse(ws, message.requestId, previous.response);
      return;
    }
    if (!this.consumeActionRateLimit(playerId)) {
      sendResponse(ws, message.requestId, {
        ok: false,
        error: { code: "RATE_LIMITED", message: "操作過於頻繁，請稍後再試" },
      });
      return;
    }

    if (message.type === "room:leave") {
      const leaveResult = this.service!.leave(playerId);
      const leaveResponse: RoomActionResponse = { ok: true, room: leaveResult.room };
      if (leaveResult.deleted) {
        await this.clearRoom(false);
      } else {
        await this.persistRequest(key, message.type, leaveResponse);
        await this.notifyLobby();
        this.broadcastRoom();
        this.broadcastGames();
      }
      sendResponse(ws, message.requestId, leaveResponse);
      ws.serializeAttachment({ playerId: null, attached: false } satisfies SocketAttachment);
      ws.close(1000, "left room");
      return;
    }

    const response = this.dispatchAction(playerId, message);
    if (!response.ok) {
      await this.persistRequest(key, message.type, response);
      sendResponse(ws, message.requestId, response);
      return;
    }

    await this.persistRequest(key, message.type, response);
    sendResponse(ws, message.requestId, response);
    if (message.type === "game:start" || message.type === "game:rematch") {
      this.sendToAll({ type: "game:started", payload: { room: this.service!.snapshot() } });
    }
    this.broadcastRoom();
    this.broadcastGames();
    await this.notifyLobby();
    await this.scheduleBotAlarm();
  }

  private dispatchAction(
    playerId: string,
    message: Exclude<ClientMessage, { type: "session:attach" | "room:leave" }>,
  ): RoomActionResponse | GameActionResponse {
    if (!this.service) return actionError("房間已不存在");
    switch (message.type) {
      case "room:ready": return this.service.setReady(playerId, message.payload.isReady);
      case "room:add-bot": return this.service.addBot(playerId);
      case "room:remove-bot": return this.service.removeBot(playerId, message.payload.botId);
      case "room:set-turn-timeout": return this.service.setTurnTimeout(playerId, message.payload.seconds);
      case "room:set-rules-mode": return this.service.setRulesMode(
        playerId,
        message.payload.rulesMode,
        message.payload.rulesOptions,
      );
      case "game:start": return this.service.start(playerId);
      case "game:rematch": return this.service.rematch(playerId);
      case "game:bot-control": return this.service.setBotControl(playerId, message.payload.enabled);
      case "game:play-card": return this.service.play(playerId, message.payload);
      case "game:draw-card": return this.service.draw(playerId);
      case "game:pass": return this.service.pass(playerId);
      case "game:choose-color": return this.service.chooseColor(playerId, message.payload.color);
      case "game:call-uno": return this.service.callUno(playerId);
      case "game:catch-uno": return this.service.catchUno(playerId);
      case "game:challenge-draw-four": return this.service.resolveDrawFour(playerId, message.payload.challenge);
    }
  }

  private async handleDisconnect(playerId: string): Promise<void> {
    if (!this.service) return;
    if (this.service.isDisconnected(playerId)) return;
    const result = this.service.disconnect(playerId);
    if (result.deleted) {
      await this.clearRoom();
      return;
    }
    if (!result.room) return;
    await this.persist();
    await this.notifyLobby();
    this.broadcastRoom();
    this.broadcastGames();
    await this.scheduleBotAlarm();
  }

  private async persist(): Promise<void> {
    if (!this.service) return;
    try {
      await this.ctx.storage.put(STATE_KEY, this.service.state);
    } catch (error) {
      this.service = null;
      console.error("room state persistence failed", error);
      throw error;
    }
  }

  private async persistRequest(key: string, action: string, response: ProtocolResponse): Promise<void> {
    if (!this.service) throw new Error("Room is not available");
    const now = Date.now();
    try {
      await this.ctx.storage.transaction(async (transaction) => {
        const requests = (await transaction.get<StoredRequests>(REQUEST_KEY)) ?? {};
        for (const [requestKey, request] of Object.entries(requests)) {
          if (request.expiresAt <= now) delete requests[requestKey];
        }
        requests[key] = {
          action,
          response,
          createdAt: now,
          expiresAt: now + REQUEST_TTL_MS,
        };
        const oldest = Object.entries(requests)
          .sort((left, right) => left[1].createdAt - right[1].createdAt);
        while (oldest.length > REQUEST_MAX_ENTRIES) {
          const entry = oldest.shift();
          if (entry) delete requests[entry[0]];
        }
        await transaction.put(STATE_KEY, this.service!.state);
        await transaction.put(REQUEST_KEY, requests);
      });
    } catch (error) {
      this.service = null;
      console.error("room action persistence failed", error);
      throw error;
    }
  }

  private async clearRoom(closeSockets = true): Promise<void> {
    const code = this.service?.code;
    this.service = null;
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
    if (code) await this.notifyLobby(code);
    if (closeSockets) {
      for (const ws of this.ctx.getWebSockets()) {
        ws.serializeAttachment({ playerId: null, attached: false } satisfies SocketAttachment);
        ws.close(1001, "room closed");
      }
    }
  }

  private broadcastRoom(): void {
    if (this.service) this.sendToAll({ type: "room:updated", payload: this.service.snapshot() });
  }

  private sendToAll(message: ServerMessage): void {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = attachmentOf(ws);
      if (attachment.attached && attachment.playerId) send(ws, message);
    }
  }

  private broadcastGames(): void {
    if (!this.service) return;
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = attachmentOf(ws);
      if (!attachment.attached || !attachment.playerId) continue;
      const game = this.service.gameSnapshot(attachment.playerId);
      if (game) send(ws, { type: "game:state", payload: game });
    }
  }

  private async notifyLobby(code = this.service?.code): Promise<void> {
    if (!code) return;
    try {
      const stub = this.env.LOBBY.get(this.env.LOBBY.idFromName("global"));
      const room = this.service?.snapshot();
      await stub.fetch(`https://lobby/${room ? "update" : "remove"}`, {
        method: "POST",
        body: JSON.stringify(room ?? { code }),
        headers: { "content-type": "application/json" },
      });
    } catch (error) {
      console.error("lobby index update failed", error);
    }
  }

  private async scheduleBotAlarm(): Promise<void> {
    if (!this.service) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const now = Date.now();
    const alarmTimes: number[] = [];
    const reservationAt = this.service.nextReservationAt(RESERVATION_TTL_MS);
    if (reservationAt !== null) alarmTimes.push(Math.max(now + 1, reservationAt));
    const turnDeadlineAt = this.service.nextTurnDeadlineAt();
    if (turnDeadlineAt !== null) alarmTimes.push(Math.max(now + 1, turnDeadlineAt));
    if (this.service.hasPendingBotAction()) {
      const configuredDelay = Number(this.env.BOT_TURN_DELAY_MS ?? "650");
      const delay = Number.isFinite(configuredDelay) && configuredDelay >= 0 ? configuredDelay : 650;
      alarmTimes.push(now + delay);
    }
    if (alarmTimes.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const nextAlarm = Math.min(...alarmTimes);
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null || currentAlarm > nextAlarm) {
      await this.ctx.storage.setAlarm(nextAlarm);
    }
  }

  private consumeActionRateLimit(playerId: string): boolean {
    const now = Date.now();
    for (const [key, bucket] of this.actionBuckets) {
      if (bucket.expiresAt <= now) this.actionBuckets.delete(key);
    }
    const limit = Number(this.env.ACTION_RATE_LIMIT_PER_WINDOW ?? "20");
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 20;
    const bucket = this.actionBuckets.get(playerId);
    if (!bucket || bucket.expiresAt <= now) {
      this.actionBuckets.set(playerId, { count: 1, expiresAt: now + 10_000 });
      return true;
    }
    if (bucket.count >= safeLimit) return false;
    bucket.count += 1;
    return true;
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}
