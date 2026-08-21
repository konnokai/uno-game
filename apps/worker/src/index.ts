import {
  normalizeNickname,
  type CreateRoomPayload,
  type JoinRoomPayload,
  type RoomError,
  type RoomSnapshot,
  type RoomSessionResponse,
} from "@uno/shared";
import { LobbyDirectory } from "./lobby-directory.js";
import type { Env } from "./env.js";
import { RoomDurableObject } from "./room-durable-object.js";
import { isCreateRoomPayload, isJoinRoomPayload, isRoomCode, readJson } from "./validation.js";

const ROOM_PATH = /^\/api\/rooms\/([A-HJ-NP-Z2-9]{6})\/join$/;
const WS_PATH = /^\/ws\/room\/([A-HJ-NP-Z2-9]{6})$/;
const rateBuckets = new Map<string, { count: number; expiresAt: number }>();

// ponytail: isolate-local IP throttling is intentionally coarse; use Cloudflare
// Rate Limiting bindings if abuse volume requires a distributed limit.
function consumeRateLimit(request: Request, scope: string, limit: number): boolean {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (bucket.expiresAt <= now) rateBuckets.delete(key);
  }
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const key = `${scope}:${ip}`;
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.expiresAt <= now) {
    rateBuckets.set(key, { count: 1, expiresAt: now + 10_000 });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

function errorResponse(error: RoomError, status = 400): Response {
  return json({ ok: false, error }, { status });
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function allowedOrigins(env: Env): Set<string> {
  return new Set((env.ALLOWED_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean));
}

function isAllowedOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  return !origin || allowedOrigins(env).has(origin);
}

function withCors(response: Response, request: Request, env: Env): Response {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigins(env).has(origin)) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  headers.set("vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
}

function roomStub(env: Env, code: string): DurableObjectStub {
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}

function lobbyStub(env: Env): DurableObjectStub {
  return env.LOBBY.get(env.LOBBY.idFromName("global"));
}

async function createRoom(env: Env, body: CreateRoomPayload): Promise<Response> {
  const nickname = normalizeNickname(body.nickname);
  if (!nickname) {
    return errorResponse({
      code: "INVALID_NICKNAME",
      message: "暱稱須為 2–20 個有效字元，且不可只包含標點符號",
    });
  }
  const playerToken = body.playerToken ?? randomToken();
  const playerId = crypto.randomUUID();
  const tokenHash = await hashToken(playerToken);
  const lobbyResponse = await lobbyStub(env).fetch("https://lobby/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: body.requestId,
      hostNickname: nickname,
      playerId,
      tokenHash,
    }),
  });
  if (!lobbyResponse.ok) return errorResponse({ code: "RATE_LIMITED", message: "房間服務暫時無法使用" }, 503);
  const lobby = await lobbyResponse.json<{ code?: string; playerId?: string }>();
  if (!lobby.code) return errorResponse({ code: "RATE_LIMITED", message: "房間服務暫時無法使用" }, 503);

  const lobbyPlayerId = lobby.playerId ?? playerId;
  const roomResponse = await roomStub(env, lobby.code).fetch("https://room/internal/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: lobby.code,
      player: {
        id: lobbyPlayerId,
        nickname,
        tokenHash,
      },
    }),
  });
  const roomResult = await roomResponse.json<{
    ok: boolean;
    room?: RoomSnapshot;
    playerId?: string;
    error?: RoomError;
  }>();
  if (!roomResponse.ok || !roomResult.ok || !roomResult.room || !roomResult.playerId) {
    await lobbyStub(env).fetch("https://lobby/remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: lobby.code }),
    });
    return errorResponse(roomResult.error ?? { code: "RATE_LIMITED", message: "房間服務暫時無法使用" }, 503);
  }
  return json({
    ok: true,
    room: roomResult.room,
    session: {
      roomCode: lobby.code,
      playerId: roomResult.playerId,
      playerToken,
      nickname,
    },
  } satisfies Extract<RoomSessionResponse, { ok: true }>);
}

async function joinRoom(
  env: Env,
  code: string,
  body: JoinRoomPayload,
): Promise<Response> {
  const nickname = normalizeNickname(body.nickname);
  if (!nickname) {
    return errorResponse({
      code: "INVALID_NICKNAME",
      message: "暱稱須為 2–20 個有效字元，且不可只包含標點符號",
    });
  }
  const playerToken = body.playerToken ?? randomToken();
  const tokenHash = await hashToken(playerToken);
  const roomResponse = await roomStub(env, code).fetch("https://room/internal/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      nickname,
      reconnectTokenHash: tokenHash,
      newPlayer: {
        id: crypto.randomUUID(),
        nickname,
        tokenHash,
      },
    }),
  });
  const roomResult = await roomResponse.json<{
    ok: boolean;
    room?: RoomSnapshot;
    playerId?: string;
    reconnected?: boolean;
    error?: RoomError;
  }>();
  if (!roomResponse.ok || !roomResult.ok || !roomResult.room || !roomResult.playerId) {
    return errorResponse(roomResult.error ?? { code: "ROOM_NOT_FOUND", message: "找不到這個房間" }, roomResponse.status);
  }
  const sessionNickname = roomResult.room.players.find((player) => player.id === roomResult.playerId)?.nickname ?? nickname;
  return json({
    ok: true,
    room: roomResult.room,
    session: {
      roomCode: code,
      playerId: roomResult.playerId,
      playerToken: roomResult.reconnected ? body.playerToken! : playerToken,
      nickname: sessionNickname,
    },
  } satisfies Extract<RoomSessionResponse, { ok: true }>);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!isAllowedOrigin(request, env)) {
      return errorResponse({ code: "INVALID_PAYLOAD", message: "不允許的來源" }, 403);
    }
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }), request, env);
    }

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return withCors(json({ status: "ok" }), request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/rooms") {
      const response = await lobbyStub(env).fetch("https://lobby/rooms");
      return withCors(response, request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/rooms") {
      const body = await readJson(request);
      const response = isCreateRoomPayload(body) && consumeRateLimit(request, "create", 5)
        ? await createRoom(env, body)
        : isCreateRoomPayload(body)
          ? errorResponse({ code: "RATE_LIMITED", message: "建立房間過於頻繁，請稍後再試" }, 429)
        : errorResponse({ code: "INVALID_PAYLOAD", message: "建立房間資料格式不正確" });
      return withCors(response, request, env);
    }

    const joinMatch = url.pathname.match(ROOM_PATH);
    if (request.method === "POST" && joinMatch) {
      const code = joinMatch[1]!;
      const body = await readJson(request);
      const response = isJoinRoomPayload(body) && consumeRateLimit(
        request,
        body.playerToken ? "reconnect" : "join",
        body.playerToken ? 20 : 8,
      )
        ? await joinRoom(env, code, body)
        : isJoinRoomPayload(body)
          ? errorResponse({ code: "RATE_LIMITED", message: "加入房間過於頻繁，請稍後再試" }, 429)
        : errorResponse({ code: "INVALID_PAYLOAD", message: "加入房間資料格式不正確" });
      return withCors(response, request, env);
    }

    const wsMatch = url.pathname.match(WS_PATH);
    if (request.method === "GET" && wsMatch && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const code = wsMatch[1]!;
      return roomStub(env, code).fetch(request);
    }

    return withCors(new Response("Not found", { status: 404 }), request, env);
  },
} satisfies ExportedHandler<Env>;

export { LobbyDirectory, RoomDurableObject };
