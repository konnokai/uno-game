import type {
  ClientToServerEvents,
  GameSnapshot,
  RoomActionResponse,
  RoomSessionResponse,
  RoomSnapshot,
  ServerToClientEvents,
} from "@uno/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import { clearReliabilityTimers, httpServer, io, rooms } from "./index.js";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let serverUrl = "";
const clients: ClientSocket[] = [];

function connectClient(): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const client: ClientSocket = createClient(serverUrl, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
    });
    clients.push(client);
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

function waitFor<T>(client: ClientSocket, event: keyof ServerToClientEvents): Promise<T> {
  return new Promise((resolve) => {
    client.once(event, (payload: unknown) => resolve(payload as T));
  });
}

function createRoom(client: ClientSocket, nickname: string, requestId: string) {
  return new Promise<RoomSessionResponse>((resolve) => {
    client.emit("room:create", { nickname, requestId }, resolve);
  });
}

function joinRoom(
  client: ClientSocket,
  roomCode: string,
  nickname: string,
  requestId: string,
  playerToken?: string,
) {
  return new Promise<RoomSessionResponse>((resolve) => {
    client.emit("room:join", {
      roomCode,
      nickname,
      requestId,
      ...(playerToken ? { playerToken } : {}),
    }, resolve);
  });
}

beforeAll(async () => {
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind a TCP port");
  serverUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  for (const client of clients) client.disconnect();
  clearReliabilityTimers();
  await new Promise<void>((resolve) => io.close(() => resolve()));
});

describe("Socket reliability", () => {
  it("adds a bot and starts a playable two-seat game", async () => {
    const host = await connectClient();
    const created = await createRoom(host, "Bot Host", "bot-create-request");
    if (!created.ok) throw new Error(created.error.message);

    const added = await new Promise<RoomActionResponse>((resolve) => host.emit(
      "room:add-bot",
      { requestId: "bot-add-request" },
      resolve,
    ));
    expect(added).toMatchObject({
      ok: true,
      room: { canStart: true, players: [{ isBot: false }, { isBot: true }] },
    });

    const gameStatePromise = waitFor<GameSnapshot>(host, "game:state");
    const started = await new Promise<RoomActionResponse>((resolve) => host.emit(
      "game:start",
      { requestId: "bot-start-request" },
      resolve,
    ));
    expect(started).toMatchObject({ ok: true, room: { phase: "playing" } });
    expect((await gameStatePromise).players).toHaveLength(2);
  });

  it("deduplicates mutations and restores an automatically delegated private seat", async () => {
    const host = await connectClient();
    const guest = await connectClient();
    const created = await createRoom(host, "Host", "create-request-1");
    if (!created.ok) throw new Error(created.error.message);
    const joined = await joinRoom(
      guest,
      created.room.code,
      "Guest",
      "join-request-1",
    );
    if (!joined.ok) throw new Error(joined.error.message);

    const readyRequest = { isReady: true, requestId: "ready-request-1" };
    const firstReady = await new Promise((resolve) => guest.emit("room:ready", readyRequest, resolve));
    const versionAfterReady = rooms.getRoom(created.room.code)!.version;
    const duplicateReady = await new Promise((resolve) => guest.emit("room:ready", readyRequest, resolve));
    expect(duplicateReady).toEqual(firstReady);
    expect(rooms.getRoom(created.room.code)!.version).toBe(versionAfterReady);

    const gameStatePromise = waitFor<GameSnapshot>(guest, "game:state");
    await new Promise((resolve) => host.emit(
      "game:start",
      { requestId: "start-request-1" },
      resolve,
    ));
    const guestGameBefore = await gameStatePromise;

    const delegatedPromise = waitFor<RoomSnapshot>(host, "room:updated");
    guest.disconnect();
    const delegatedRoom = await delegatedPromise;
    expect(delegatedRoom).toMatchObject({
      players: [
        { isBotManaged: false },
        { id: joined.session.playerId, isConnected: false, isBotManaged: true },
      ],
    });

    const restoredClient = await connectClient();
    const restoredGamePromise = waitFor<GameSnapshot>(restoredClient, "game:state");
    const restored = await joinRoom(
      restoredClient,
      created.room.code,
      joined.session.nickname,
      "restore-request-1",
      joined.session.playerToken,
    );
    if (!restored.ok) throw new Error(restored.error.message);
    const restoredGame = await restoredGamePromise;

    expect(restored.session.playerId).toBe(joined.session.playerId);
    expect(restored.room.players.find((player) => player.id === joined.session.playerId)?.isBotManaged).toBe(false);
    expect(restoredGame.hand).toEqual(guestGameBefore.hand);
  });
});
