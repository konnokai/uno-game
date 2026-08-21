export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
}

export class RateLimiter {
  private readonly attempts = new Map<string, number[]>();
  private readonly now: () => number;

  constructor(private readonly options: RateLimiterOptions) {
    this.now = options.now ?? Date.now;
  }

  consume(key: string): boolean {
    const now = this.now();
    for (const [candidate, attempts] of this.attempts) {
      const recent = attempts.filter((time) => now - time < this.options.windowMs);
      if (recent.length === 0) this.attempts.delete(candidate);
      else if (recent.length !== attempts.length) this.attempts.set(candidate, recent);
    }

    const attempts = this.attempts.get(key) ?? [];
    if (attempts.length >= this.options.limit) return false;
    attempts.push(now);
    this.attempts.set(key, attempts);
    return true;
  }
}
