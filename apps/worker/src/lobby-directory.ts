import { MAX_GAME_PLAYERS, type RoomListItem, type RoomSnapshot } from "@uno/shared";
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env.js";
import { isRequestId } from "./validation.js";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOMS_KEY = "lobby:rooms";
const CREATE_REQUESTS_KEY = "lobby:create-requests";
const CREATE_REQUEST_TTL_MS = 10 * 60_000;
const CREATE_REQUEST_MAX_ENTRIES = 5_000;

type StoredRooms = Record<string, RoomListItem>;

interface StoredCreateRequest {
  code: string;
  hostNickname: string;
  playerId: string;
  tokenHash: string;
  expiresAt: number;
}

type StoredCreateRequests = Record<string, StoredCreateRequest>;

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

function createRoomCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => ROOM_CODE_ALPHABET[byte & 31]).join("");
}

function roomListItem(room: RoomSnapshot): RoomListItem | null {
  if (room.phase !== "lobby") return null;
  const host = room.players.find((player) => player.id === room.hostId);
  if (!host) return null;
  return {
    code: room.code,
    hostNickname: host.nickname,
    playerCount: room.players.length,
    maxPlayers: MAX_GAME_PLAYERS,
    isFull: room.players.length >= MAX_GAME_PLAYERS,
  };
}

/** Stores only the public lobby index; game state stays in room objects. */
export class LobbyDirectory extends DurableObject<Env> {
  private rooms: StoredRooms = {};
  private createRequests: StoredCreateRequests = {};
  private readonly ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.rooms = (await ctx.storage.get<StoredRooms>(ROOMS_KEY)) ?? {};
      this.createRequests = (await ctx.storage.get<StoredCreateRequests>(CREATE_REQUESTS_KEY)) ?? {};
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/rooms") {
      return json(Object.values(this.rooms));
    }

    if (request.method === "POST" && url.pathname === "/create") {
      const body = await request.json<{
        requestId?: string;
        hostNickname?: string;
        playerId?: string;
        tokenHash?: string;
      }>().catch(() => null);
      if (!body?.hostNickname || !isRequestId(body.requestId) ||
        !body.playerId || !body.tokenHash) {
        return json({ error: "invalid payload" }, { status: 400 });
      }
      const now = Date.now();
      for (const [requestId, reservation] of Object.entries(this.createRequests)) {
        if (reservation.expiresAt <= now) delete this.createRequests[requestId];
      }
      const existing = this.createRequests[body.requestId];
      if (existing) {
        if (existing.hostNickname !== body.hostNickname || existing.tokenHash !== body.tokenHash) {
          return json({ error: "request already used" }, { status: 409 });
        }
        return json({ code: existing.code, playerId: existing.playerId });
      }
      let code = createRoomCode();
      while (this.rooms[code]) code = createRoomCode();
      this.rooms[code] = {
        code,
        hostNickname: body.hostNickname,
        playerCount: 1,
        maxPlayers: MAX_GAME_PLAYERS,
        isFull: false,
      };
      this.createRequests[body.requestId] = {
        code,
        hostNickname: body.hostNickname,
        playerId: body.playerId,
        tokenHash: body.tokenHash,
        expiresAt: now + CREATE_REQUEST_TTL_MS,
      };
      const oldest = Object.entries(this.createRequests)
        .sort((left, right) => left[1].expiresAt - right[1].expiresAt);
      while (oldest.length > CREATE_REQUEST_MAX_ENTRIES) {
        const entry = oldest.shift();
        if (entry) delete this.createRequests[entry[0]];
      }
      await this.save();
      return json({ code, playerId: body.playerId });
    }

    if (request.method === "POST" && url.pathname === "/update") {
      const room = await request.json<RoomSnapshot>().catch(() => null);
      if (!room || typeof room.code !== "string") return json({ error: "invalid payload" }, { status: 400 });
      const item = roomListItem(room);
      if (item) this.rooms[item.code] = item;
      else delete this.rooms[room.code];
      await this.save();
      return json({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/remove") {
      const body = await request.json<{ code?: string }>().catch(() => null);
      if (!body?.code) return json({ error: "invalid payload" }, { status: 400 });
      delete this.rooms[body.code];
      for (const [requestId, reservation] of Object.entries(this.createRequests)) {
        if (reservation.code === body.code) delete this.createRequests[requestId];
      }
      await this.save();
      return json({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put({
      [ROOMS_KEY]: this.rooms,
      [CREATE_REQUESTS_KEY]: this.createRequests,
    });
  }
}
