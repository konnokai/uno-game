import { describe, expect, it } from "vitest";
import { createRoomState, RoomService, type NewRoomPlayer } from "./room-service.js";

function player(id: string, nickname: string, tokenHash: string): NewRoomPlayer {
  return { id, nickname, tokenHash };
}

function startedRoom() {
  const service = new RoomService(createRoomState("ABC234", player("host", "Host", "host-hash")), {
    createId: (() => {
      let id = 0;
      return () => `bot-${++id}`;
    })(),
  });
  const joined = service.join("Guest", undefined, player("guest", "Guest", "guest-hash"));
  if (!joined.ok) throw new Error(joined.error.message);
  expect(service.attach("host", "host-hash")).toMatchObject({ ok: true });
  expect(service.attach("guest", "guest-hash")).toMatchObject({ ok: true });
  expect(service.setReady("guest", true)).toMatchObject({ ok: true });
  expect(service.start("host")).toMatchObject({ ok: true });
  return service;
}

describe("RoomService", () => {
  it("enforces nickname, host and readiness permissions", () => {
    const service = new RoomService(createRoomState("ABC234", player("host", "Host", "host-hash")));
    expect(service.join("Host", undefined, player("guest", "Guest", "guest-hash"))).toMatchObject({
      ok: false,
      error: { code: "NICKNAME_TAKEN" },
    });
    const joined = service.join("Guest", undefined, player("guest", "Guest", "guest-hash"));
    expect(joined).toMatchObject({ ok: true });
    expect(service.attach("host", "host-hash")).toMatchObject({ ok: true });
    expect(service.attach("guest", "guest-hash")).toMatchObject({ ok: true });

    expect(service.start("guest")).toMatchObject({ ok: false, error: { code: "HOST_ONLY" } });
    expect(service.start("host")).toMatchObject({ ok: false, error: { code: "PLAYERS_NOT_READY" } });
    expect(service.setReady("host", true)).toMatchObject({ ok: false, error: { code: "HOST_CANNOT_READY" } });
    expect(service.setReady("guest", true)).toMatchObject({ ok: true, room: { canStart: true } });
    expect(service.start("host")).toMatchObject({ ok: true, room: { phase: "playing" } });
  });

  it("limits a room to eight players and permits host-controlled bots", () => {
    const service = new RoomService(createRoomState("ABC234", player("host", "Host", "host-hash")), {
      createId: () => "bot-1",
    });
    expect(service.attach("host", "host-hash")).toMatchObject({ ok: true });
    for (let index = 2; index <= 8; index += 1) {
      const candidate = player(`player-${index}`, `Player ${index}`, `hash-${index}`);
      expect(service.join(candidate.nickname, undefined, candidate)).toMatchObject({ ok: true });
      expect(service.attach(candidate.id, candidate.tokenHash)).toMatchObject({ ok: true });
      expect(service.setReady(candidate.id, true)).toMatchObject({ ok: true });
    }
    expect(service.join("Player 9", undefined, player("player-9", "Player 9", "hash-9")))
      .toMatchObject({ ok: false, error: { code: "ROOM_FULL" } });

    expect(service.addBot("player-2")).toMatchObject({ ok: false, error: { code: "HOST_ONLY" } });
    expect(service.removeBot("host", "missing")).toMatchObject({ ok: false, error: { code: "BOT_NOT_FOUND" } });
    const bot = new RoomService(createRoomState("XYZ789", player("host", "Host", "host-hash")), {
      createId: () => "bot-1",
    });
    expect(bot.attach("host", "host-hash")).toMatchObject({ ok: true });
    const added = bot.addBot("host");
    expect(added).toMatchObject({ ok: true, room: { players: [{ isBot: false }, { isBot: true, isReady: true }] } });
    expect(bot.start("host")).toMatchObject({ ok: true, room: { phase: "playing" } });
  });

  it("enables bot control only for the player's own active seat", () => {
    const service = startedRoom();
    expect(service.setBotControl("host", true)).toMatchObject({
      ok: true,
      room: { players: [{ isBotManaged: true }, { isBotManaged: false }] },
    });
    expect(service.draw("host")).toMatchObject({ ok: false, error: { code: "BOT_CONTROL_ACTIVE" } });
    expect(service.setBotControl("host", false)).toMatchObject({
      ok: true,
      room: { players: [{ isBotManaged: false }, { isBotManaged: false }] },
    });
  });

  it("round-trips durable state and keeps hands private", () => {
    const service = startedRoom();
    const hostGame = service.gameSnapshot("host");
    const guestGame = service.gameSnapshot("guest");
    expect(hostGame?.hand).not.toEqual(guestGame?.hand);
    expect(hostGame).not.toHaveProperty("drawPile");
    expect(hostGame?.players.map((candidate) => Object.keys(candidate))).toEqual([
      ["id", "handCount"],
      ["id", "handCount"],
    ]);
    expect(hostGame?.actionHistory).toHaveLength(1);
    expect(service.snapshot().players.map((candidate) => Object.keys(candidate))).toEqual([
      ["id", "nickname", "isBot", "isHost", "isReady", "isConnected", "isBotManaged"],
      ["id", "nickname", "isBot", "isHost", "isReady", "isConnected", "isBotManaged"],
    ]);

    const restored = new RoomService(JSON.parse(JSON.stringify(service.state)));
    expect(restored.gameSnapshot("guest")?.hand).toEqual(guestGame?.hand);
    expect(restored.gameSnapshot("host")?.players).toEqual(hostGame?.players);
  });

  it("delegates a disconnected game seat and restores it with its token hash", () => {
    const service = startedRoom();
    const before = service.gameSnapshot("guest")?.hand;
    const disconnected = service.disconnect("guest");

    expect(disconnected).toMatchObject({
      deleted: false,
      room: { players: [{ id: "host" }, { id: "guest", isConnected: false, isBotManaged: true }] },
    });
    const restored = service.attach("guest", "guest-hash");
    expect(restored).toMatchObject({ ok: true, playerId: "guest", reconnected: true });
    expect(service.gameSnapshot("guest")?.hand).toEqual(before);
    expect(service.attach("guest", "wrong-hash")).toMatchObject({
      ok: false,
      error: { code: "NOT_IN_ROOM" },
    });
  });

  it("removes a room as soon as no connected human remains", () => {
    const service = startedRoom();
    expect(service.disconnect("host")).toMatchObject({ deleted: false });
    expect(service.disconnect("guest")).toEqual({ room: null, deleted: true });
  });

  it("transfers lobby ownership when a reserved host leaves before attach", () => {
    const service = new RoomService(
      createRoomState("ABC234", player("host", "Host", "host-hash")),
    );
    const joined = service.join("Guest", undefined, player("guest", "Guest", "guest-hash"));
    expect(joined).toMatchObject({ ok: true });

    const result = service.leave("host");

    expect(result.room?.hostId).toBe("guest");
  });

  it("removes a player who disconnects after the game is finished", () => {
    const service = new RoomService(
      createRoomState("ABC234", player("host", "Host", "host-hash")),
    );
    for (const candidate of [
      player("guest", "Guest", "guest-hash"),
      player("third", "Third", "third-hash"),
    ]) {
      const joined = service.join(candidate.nickname, undefined, candidate);
      expect(joined).toMatchObject({ ok: true });
      expect(service.attach(candidate.id, candidate.tokenHash)).toMatchObject({ ok: true });
      expect(service.setReady(candidate.id, true)).toMatchObject({ ok: true });
    }
    expect(service.attach("host", "host-hash")).toMatchObject({ ok: true });
    expect(service.start("host")).toMatchObject({ ok: true });
    service.state.game!.phase = "finished";
    service.state.game!.winnerId = "host";

    const result = service.disconnect("guest");

    expect(result.room?.players.map((candidate) => candidate.id)).toEqual(["host", "third"]);
    expect(service.rematch("host")).toMatchObject({ ok: true });
  });

  it("cleans up HTTP reservations that never attach", () => {
    const service = new RoomService(
      createRoomState("ABC234", player("host", "Host", "host-hash")),
    );
    const joined = service.join("Guest", undefined, player("guest", "Guest", "guest-hash"));
    expect(joined).toMatchObject({ ok: true });

    const result = service.cleanupReservations(Date.now() + 1_000, 1);

    expect(result).toEqual({ room: null, deleted: true });
  });

  it("cancels an active game when a player explicitly leaves", () => {
    const service = startedRoom();

    const result = service.leave("guest");

    expect(result.room).toMatchObject({ phase: "lobby", players: [{ id: "host" }] });
    expect(service.gameSnapshot("host")).toBeNull();
  });
});
