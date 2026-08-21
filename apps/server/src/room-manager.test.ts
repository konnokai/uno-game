import { describe, expect, it } from "vitest";
import { normalizeNickname } from "@uno/shared";
import { normalizeRoomCode, RoomManager, type RoomManagerOptions } from "./room-manager.js";

function createManager(options: RoomManagerOptions = {}) {
  let id = 0;
  let token = 0;
  let code = 0;
  return new RoomManager({
    createId: () => `player-${++id}`,
    createToken: () => `token-${++token}`,
    createCode: () => `ABCDE${++code + 1}`,
    ...options,
  });
}

function createRoom(manager: RoomManager, socketId = "socket-1", nickname = "Host") {
  const response = manager.create(socketId, nickname);
  if (!response.ok) throw new Error(response.error.message);
  return response;
}

function joinRoom(
  manager: RoomManager,
  roomCode: string,
  socketId: string,
  nickname: string,
) {
  const response = manager.join(socketId, roomCode, nickname);
  if (!response.ok) throw new Error(response.error.message);
  return response;
}

describe("room input normalization", () => {
  it("trims names and room codes", () => {
    expect(normalizeNickname("  Alice   Uno  ")).toBe("Alice Uno");
    expect(normalizeRoomCode(" abcde2 ")).toBe("ABCDE2");
  });

  it("rejects ambiguous or malformed input", () => {
    expect(normalizeNickname("A")).toBeNull();
    expect(normalizeNickname(`A\u0000B`)).toBeNull();
    expect(normalizeNickname("---")).toBeNull();
    expect(normalizeNickname(`Player\uE000`)).toBeNull();
    expect(normalizeRoomCode("ABC1O0")).toBeNull();
  });

  it("normalizes Unicode names without excluding symbols", () => {
    expect(normalizeNickname("  A\u0301lice 🃏  ")).toBe("Álice 🃏");
  });
});

describe("RoomManager", () => {
  it("creates a room and gives its creator host authority", () => {
    const manager = createManager();
    const created = createRoom(manager);

    expect(created.room.code).toBe("ABCDE2");
    expect(created.room.players).toHaveLength(1);
    expect(created.room.players[0]).toMatchObject({
      nickname: "Host",
      isHost: true,
      isReady: false,
      isConnected: true,
    });
    expect(created.session.playerToken).toBe("token-1");
    expect(created.room.canStart).toBe(false);
  });

  it("rejects nickname conflicts without regard to letter case", () => {
    const manager = createManager();
    const created = createRoom(manager, "socket-1", "Alice");

    const response = manager.join("socket-2", created.room.code, "alice");

    expect(response).toMatchObject({ ok: false, error: { code: "NICKNAME_TAKEN" } });
  });

  it("prevents duplicate sockets and lets a valid token replace a stale connection", () => {
    const manager = createManager();
    const created = createRoom(manager);

    expect(manager.join("socket-1", created.room.code, "Other")).toMatchObject({
      ok: false,
      error: { code: "ALREADY_IN_ROOM" },
    });
    expect(
      manager.join("socket-2", created.room.code, "Host", created.session.playerToken),
    ).toMatchObject({ ok: true, session: { playerId: created.session.playerId } });
    expect(manager.getPlayerId("socket-1")).toBeNull();
    expect(manager.getPlayerId("socket-2")).toBe(created.session.playerId);
  });

  it("limits rooms to eight players", () => {
    const manager = createManager();
    const created = createRoom(manager);
    for (let index = 2; index <= 8; index += 1) {
      joinRoom(manager, created.room.code, `socket-${index}`, `Player ${index}`);
    }

    expect(manager.join("socket-9", created.room.code, "Player 9")).toMatchObject({
      ok: false,
      error: { code: "ROOM_FULL" },
    });
    for (let index = 2; index <= 8; index += 1) {
      manager.setReady(`socket-${index}`, true);
    }
    const started = manager.start("socket-1");
    expect(started).toMatchObject({ ok: true, room: { phase: "playing" } });
    if (!started.ok || !started.room) throw new Error("Eight-player game did not start");
    expect(started.room.players).toHaveLength(8);
  });

  it("lets only the host add and remove ready bot seats", () => {
    const manager = createManager();
    const created = createRoom(manager);
    joinRoom(manager, created.room.code, "socket-2", "Guest");

    expect(manager.addBot("socket-2")).toMatchObject({
      ok: false,
      error: { code: "HOST_ONLY" },
    });
    const added = manager.addBot("socket-1");
    expect(added).toMatchObject({
      ok: true,
      room: {
        players: [
          { isBot: false },
          { isBot: false },
          { nickname: "UNO Bot", isBot: true, isReady: true, isConnected: true },
        ],
      },
    });
    if (!added.ok || !added.room) throw new Error("Bot was not added");
    const botId = added.room.players.find((player) => player.isBot)!.id;

    expect(manager.removeBot("socket-2", botId)).toMatchObject({
      ok: false,
      error: { code: "HOST_ONLY" },
    });
    expect(manager.removeBot("socket-1", botId)).toMatchObject({
      ok: true,
      room: { players: [{ isBot: false }, { isBot: false }] },
    });
  });

  it("allows a host to start a game with a bot as the second player", () => {
    const manager = createManager();
    createRoom(manager);
    manager.addBot("socket-1");

    expect(manager.start("socket-1")).toMatchObject({
      ok: true,
      room: { phase: "playing", players: [{ isBot: false }, { isBot: true }] },
    });
  });

  it("lists lobby rooms with host and capacity and hides started games", () => {
    const manager = createManager();
    const first = createRoom(manager, "socket-1", "Alice");
    const second = createRoom(manager, "socket-2", "Bob");
    joinRoom(manager, first.room.code, "socket-3", "Guest");

    expect(manager.listRooms()).toEqual([
      {
        code: first.room.code,
        hostNickname: "Alice",
        playerCount: 2,
        maxPlayers: 8,
        isFull: false,
      },
      {
        code: second.room.code,
        hostNickname: "Bob",
        playerCount: 1,
        maxPlayers: 8,
        isFull: false,
      },
    ]);

    manager.setReady("socket-3", true);
    manager.start("socket-1");
    expect(manager.listRooms()).toEqual([
      expect.objectContaining({ code: second.room.code }),
    ]);
  });

  it("requires every non-host player to be ready before the host starts", () => {
    const manager = createManager();
    const created = createRoom(manager);
    joinRoom(manager, created.room.code, "socket-2", "Guest");

    expect(manager.start("socket-1")).toMatchObject({
      ok: false,
      error: { code: "PLAYERS_NOT_READY" },
    });
    expect(manager.setReady("socket-1", true)).toMatchObject({
      ok: false,
      error: { code: "HOST_CANNOT_READY" },
    });

    const ready = manager.setReady("socket-2", true);
    expect(ready).toMatchObject({ ok: true, room: { canStart: true } });

    const started = manager.start("socket-1");
    expect(started).toMatchObject({ ok: true, room: { phase: "playing", canStart: false } });
  });

  it("enforces host-only start and rematch permissions", () => {
    const manager = createManager();
    const created = createRoom(manager);
    joinRoom(manager, created.room.code, "socket-2", "Guest");

    expect(manager.start("socket-2")).toMatchObject({
      ok: false,
      error: { code: "HOST_ONLY" },
    });
    expect(manager.rematch("socket-2")).toMatchObject({
      ok: false,
      error: { code: "HOST_ONLY" },
    });
    expect(manager.rematch("socket-1")).toMatchObject({
      ok: false,
      error: { code: "GAME_NOT_FINISHED" },
    });
  });

  it("lets a player enable and disable bot control for their own seat", () => {
    const manager = createManager();
    const created = createRoom(manager);
    joinRoom(manager, created.room.code, "socket-2", "Guest");
    manager.setReady("socket-2", true);
    manager.start("socket-1");

    expect(manager.setBotControl("socket-2", true)).toMatchObject({
      ok: true,
      room: {
        players: [
          { isBotManaged: false },
          { nickname: "Guest", isBotManaged: true },
        ],
      },
    });
    expect(manager.draw("socket-2")).toMatchObject({
      ok: false,
      error: { code: "BOT_CONTROL_ACTIVE" },
    });
    expect(manager.setBotControl("socket-2", false)).toMatchObject({
      ok: true,
      room: { players: [{ isBotManaged: false }, { isBotManaged: false }] },
    });
  });

  it("transfers host authority when the lobby host disconnects", () => {
    const manager = createManager();
    const created = createRoom(manager);
    const joined = joinRoom(manager, created.room.code, "socket-2", "Next Host");

    const result = manager.disconnect("socket-1");

    expect(result?.room).toMatchObject({
      hostId: joined.session.playerId,
      players: [{ id: joined.session.playerId, isHost: true }],
    });
  });

  it("deletes empty rooms", () => {
    const manager = createManager();
    const created = createRoom(manager);

    expect(manager.disconnect("socket-1")).toMatchObject({ room: null });
    expect(manager.getRoom(created.room.code)).toBeNull();
  });

  it("restores a disconnected game seat only with its token", () => {
    const manager = createManager();
    const created = createRoom(manager);
    joinRoom(manager, created.room.code, "socket-2", "Guest");
    manager.setReady("socket-2", true);
    manager.start("socket-1");
    manager.disconnect("socket-2");

    expect(manager.join("socket-3", created.room.code, "Intruder")).toMatchObject({
      ok: false,
      error: { code: "GAME_ALREADY_STARTED" },
    });
    const restored = manager.join(
      "socket-4",
      created.room.code,
      "Guest",
      "token-2",
    );
    expect(restored).toMatchObject({
      ok: true,
      room: {
        players: [{ isConnected: true }, { nickname: "Guest", isConnected: true }],
      },
    });
  });

  it("automatically delegates a disconnected seat and restores it on reconnection", () => {
    const manager = createManager();
    const created = createRoom(manager);
    const joined = joinRoom(manager, created.room.code, "socket-2", "Guest");
    manager.setReady("socket-2", true);
    manager.start("socket-1");
    const handBefore = manager.getGameRecipients(created.room.code)
      .find((recipient) => recipient.socketId === "socket-2")!.state.hand;

    const disconnected = manager.disconnect("socket-2");

    expect(disconnected).toMatchObject({
      room: {
        players: [
          { isBotManaged: false },
          { id: joined.session.playerId, isConnected: false, isBotManaged: true },
        ],
      },
    });

    const restored = manager.join(
      "socket-3",
      created.room.code,
      "Guest",
      joined.session.playerToken,
    );
    expect(restored).toMatchObject({
      ok: true,
      session: { playerId: joined.session.playerId },
      room: {
        players: [
          { isBotManaged: false },
          { isConnected: true, isBotManaged: false },
        ],
      },
    });
    expect(manager.getGameRecipients(created.room.code)
      .find((recipient) => recipient.socketId === "socket-3")!.state.hand).toEqual(handBefore);
    expect(manager.getRoom(created.room.code)?.phase).toBe("playing");
  });

  it("lets bot control act immediately for the current player after disconnect", () => {
    const manager = createManager();
    const created = createRoom(manager);
    const joined = joinRoom(manager, created.room.code, "socket-2", "Guest");
    manager.setReady("socket-2", true);
    manager.start("socket-1");
    const game = manager.getGameRecipients(created.room.code)[0]!.state;
    const currentSocket = game.currentPlayerId === created.session.playerId
      ? "socket-1"
      : "socket-2";

    manager.disconnect(currentSocket);

    expect(manager.hasPendingBotAction(created.room.code)).toBe(true);
    expect(manager.performBotAction(created.room.code)).toBe(true);
    expect(manager.getRoom(created.room.code)?.players.find((player) =>
      player.id === (currentSocket === "socket-1" ? created.session.playerId : joined.session.playerId),
    )?.isBotManaged).toBe(true);
  });

  it("retains a disconnected seat without cancelling the active game", () => {
    const manager = createManager();
    const created = createRoom(manager);
    const joined = joinRoom(manager, created.room.code, "socket-2", "Guest");
    manager.setReady("socket-2", true);
    manager.start("socket-1");
    manager.disconnect("socket-2");

    expect(manager.getRoom(created.room.code)).toMatchObject({
      phase: "playing",
      players: [
        { id: created.session.playerId, isConnected: true },
        { id: joined.session.playerId, isConnected: false, isBotManaged: true },
      ],
    });
  });

  it("transfers the host and deletes the room when no connected human remains", () => {
    const manager = createManager();
    const created = createRoom(manager);
    const joined = joinRoom(manager, created.room.code, "socket-2", "Guest");
    manager.setReady("socket-2", true);
    manager.start("socket-1");
    expect(manager.disconnect("socket-1")).toMatchObject({
      room: { hostId: joined.session.playerId, phase: "playing" },
    });
    expect(manager.disconnect("socket-2")).toMatchObject({ room: null });
    expect(manager.getRoom(created.room.code)).toBeNull();
  });

  it("does not leave disconnected ghost seats when another player leaves", () => {
    const manager = createManager();
    const created = createRoom(manager);
    joinRoom(manager, created.room.code, "socket-2", "Guest");
    manager.setReady("socket-2", true);
    manager.start("socket-1");
    manager.disconnect("socket-1");

    expect(manager.leave("socket-2")).toMatchObject({ ok: true, room: null });
    expect(manager.getRoom(created.room.code)).toBeNull();
  });

  it("cancels an active game when a player explicitly leaves", () => {
    const manager = createManager();
    const created = createRoom(manager);
    joinRoom(manager, created.room.code, "socket-2", "Guest");
    manager.setReady("socket-2", true);
    manager.start("socket-1");

    const result = manager.leave("socket-2");

    expect(result).toMatchObject({ ok: true, room: { phase: "lobby", players: [{ isHost: true }] } });
  });

  it("creates a private game snapshot for each connected player", () => {
    const manager = createManager();
    const created = createRoom(manager);
    const joined = joinRoom(manager, created.room.code, "socket-2", "Guest");
    manager.setReady("socket-2", true);
    manager.start("socket-1");

    const recipients = manager.getGameRecipients(created.room.code);

    expect(recipients).toHaveLength(2);
    expect(recipients.map((recipient) => recipient.socketId)).toEqual(["socket-1", "socket-2"]);
    for (const recipient of recipients) {
      const ownerId = recipient.socketId === "socket-1"
        ? created.session.playerId
        : joined.session.playerId;
      expect(recipient.state.hand).toHaveLength(
        recipient.state.players.find((player) => player.id === ownerId)!.handCount,
      );
      expect(recipient.state.players.map((player) => Object.keys(player))).toEqual([
        ["id", "handCount"],
        ["id", "handCount"],
      ]);
      expect(recipient.state).not.toHaveProperty("drawPile");
      if (recipient.state.pendingDrawFour) {
        expect(recipient.state.pendingDrawFour).not.toHaveProperty("wasLegal");
      }
      expect(recipient.state.actionHistory).toHaveLength(1);
      expect(recipient.state.actionHistory[0]).toMatchObject({
        version: 1,
        action: { type: "start", playerId: null },
        card: recipient.state.topDiscard,
      });
    }
    expect(recipients[0]!.state.hand).not.toEqual(recipients[1]!.state.hand);
  });
});
