export interface RequestDeduplicatorOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

interface CachedResponse {
  expiresAt: number;
  response: unknown;
}

export class RequestDeduplicator {
  private readonly responses = new Map<string, CachedResponse>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: RequestDeduplicatorOptions = {}) {
    this.ttlMs = options.ttlMs ?? 10 * 60_000;
    this.maxEntries = options.maxEntries ?? 5_000;
    this.now = options.now ?? Date.now;
  }

  execute<T>(
    scope: string,
    action: string,
    requestId: string,
    operation: () => T,
  ): { response: T; duplicate: boolean } {
    const now = this.now();
    this.prune(now);
    const key = `${scope}\u0000${action}\u0000${requestId}`;
    const cached = this.responses.get(key);
    if (cached) return { response: cached.response as T, duplicate: true };

    const response = operation();
    this.responses.set(key, { expiresAt: now + this.ttlMs, response });
    while (this.responses.size > this.maxEntries) {
      const oldestKey = this.responses.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.responses.delete(oldestKey);
    }
    return { response, duplicate: false };
  }

  private prune(now: number): void {
    for (const [key, cached] of this.responses) {
      if (cached.expiresAt <= now) this.responses.delete(key);
    }
  }
}
