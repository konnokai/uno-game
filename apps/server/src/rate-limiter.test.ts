import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limiter.js";

describe("RateLimiter", () => {
  it("limits each key independently and resets after the window", () => {
    let now = 1_000;
    const limiter = new RateLimiter({ limit: 2, windowMs: 10_000, now: () => now });

    expect(limiter.consume("one")).toBe(true);
    expect(limiter.consume("one")).toBe(true);
    expect(limiter.consume("one")).toBe(false);
    expect(limiter.consume("two")).toBe(true);

    now += 10_000;
    expect(limiter.consume("one")).toBe(true);
  });

  it("does not count rejected attempts toward a later window", () => {
    let now = 0;
    const limiter = new RateLimiter({ limit: 1, windowMs: 100, now: () => now });

    expect(limiter.consume("client")).toBe(true);
    expect(limiter.consume("client")).toBe(false);
    now = 100;
    expect(limiter.consume("client")).toBe(true);
  });
});
