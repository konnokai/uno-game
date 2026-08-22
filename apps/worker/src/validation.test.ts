import { describe, expect, it } from "vitest";
import { parseClientMessage } from "./validation.js";

describe("WebSocket protocol validation", () => {
  it("accepts a session attach and preserves its typed payload", () => {
    const playerToken = "a".repeat(64);
    const result = parseClientMessage(JSON.stringify({
      type: "session:attach",
      requestId: "attach-01",
      payload: {
        roomCode: "ABC234",
        playerId: "player-1",
        playerToken,
      },
    }));

    expect(result).toEqual({
      ok: true,
      message: {
        type: "session:attach",
        requestId: "attach-01",
        payload: {
          roomCode: "ABC234",
          playerId: "player-1",
          playerToken,
        },
      },
    });
  });

  it("rejects malformed, unknown and illegal-color messages", () => {
    expect(parseClientMessage("not-json")).toMatchObject({
      ok: false,
      error: { code: "INVALID_PAYLOAD" },
    });
    expect(parseClientMessage(JSON.stringify({
      type: "game:unknown",
      requestId: "unknown-1",
      payload: {},
    }))).toMatchObject({
      ok: false,
      error: { code: "INVALID_PAYLOAD" },
    });
    expect(parseClientMessage(JSON.stringify({
      type: "game:choose-color",
      requestId: "color-001",
      payload: { requestId: "color-001", color: "purple" },
    }))).toMatchObject({
      ok: false,
      error: { code: "INVALID_PAYLOAD" },
    });
  });

  it("requires a request id before accepting an action", () => {
    expect(parseClientMessage(JSON.stringify({
      type: "game:draw-card",
      requestId: "short",
      payload: { requestId: "short" },
    }))).toMatchObject({
      ok: false,
      error: { code: "INVALID_PAYLOAD" },
    });
  });

  it("validates the room turn timeout payload", () => {
    expect(parseClientMessage(JSON.stringify({
      type: "room:set-turn-timeout",
      requestId: "timeout-01",
      payload: { requestId: "timeout-01", seconds: 45 },
    })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({
      type: "room:set-turn-timeout",
      requestId: "timeout-02",
      payload: { requestId: "timeout-02", seconds: 0 },
    })).ok).toBe(false);
  });

  it("validates the room rules mode payload", () => {
    expect(parseClientMessage(JSON.stringify({
      type: "room:set-rules-mode",
      requestId: "rules-001",
      payload: { requestId: "rules-001", rulesMode: "taiwan" },
    })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({
      type: "room:set-rules-mode",
      requestId: "rules-002",
      payload: { requestId: "rules-002", rulesMode: "house" },
    })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({
      type: "room:set-rules-mode",
      requestId: "rules-003",
      payload: {
        requestId: "rules-003",
        rulesMode: "taiwan",
        rulesOptions: {
          stackingEnabled: true,
          stackingMode: "mixed",
          sevenZeroEnabled: true,
          jumpInEnabled: false,
          drawToMatchEnabled: true,
          drawFourChallengeEnabled: true,
          multiCardPlayEnabled: true,
        },
      },
    })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({
      type: "room:set-rules-mode",
      requestId: "rules-004",
      payload: {
        requestId: "rules-004",
        rulesMode: "taiwan",
        rulesOptions: { stackingEnabled: true, stackingMode: "invalid" },
      },
    })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({
      type: "game:play-card",
      requestId: "play-card-01",
      payload: {
        requestId: "play-card-01",
        cardId: "red-5-1",
        additionalCardIds: ["blue-5-1"],
      },
    })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({
      type: "game:play-card",
      requestId: "play-card-02",
      payload: {
        requestId: "play-card-02",
        cardId: "red-5-1",
        additionalCardIds: [""],
      },
    })).ok).toBe(false);
  });
});
