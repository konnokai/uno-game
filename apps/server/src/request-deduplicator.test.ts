import { describe, expect, it, vi } from "vitest";
import { RequestDeduplicator } from "./request-deduplicator.js";

describe("RequestDeduplicator", () => {
  it("returns the original response without repeating an operation", () => {
    const operation = vi.fn(() => ({ ok: true, version: 2 }));
    const requests = new RequestDeduplicator();

    expect(requests.execute("player-1", "draw", "request-1", operation)).toEqual({
      duplicate: false,
      response: { ok: true, version: 2 },
    });
    expect(requests.execute("player-1", "draw", "request-1", operation)).toEqual({
      duplicate: true,
      response: { ok: true, version: 2 },
    });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("separates players and actions, then expires cached responses", () => {
    let now = 0;
    let calls = 0;
    const requests = new RequestDeduplicator({ ttlMs: 100, now: () => now });
    const operation = () => ++calls;

    expect(requests.execute("player-1", "draw", "request-1", operation).response).toBe(1);
    expect(requests.execute("player-2", "draw", "request-1", operation).response).toBe(2);
    expect(requests.execute("player-1", "pass", "request-1", operation).response).toBe(3);
    now = 100;
    expect(requests.execute("player-1", "draw", "request-1", operation)).toEqual({
      duplicate: false,
      response: 4,
    });
  });
});
