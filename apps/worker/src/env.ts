export interface Env {
  ROOMS: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
  ALLOWED_ORIGINS?: string;
  BOT_TURN_DELAY_MS?: string;
  ACTION_RATE_LIMIT_PER_WINDOW?: string;
}
