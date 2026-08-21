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
});
