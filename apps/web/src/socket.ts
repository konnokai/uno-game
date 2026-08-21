import type {
  ClientMessage,
  GameActionResponse,
  RoomActionResponse,
  RoomListItem,
  RoomSession,
  RoomSessionResponse,
  ServerMessage,
  SessionAttachResponse,
} from "@uno/shared";

const configuredServerUrl = import.meta.env.VITE_SERVER_URL as string | undefined;
export const serverUrl = (configuredServerUrl ||
  (import.meta.env.DEV ? "http://localhost:8787" : window.location.origin)).replace(/\/$/u, "");

type ActionMessage = Exclude<ClientMessage, { type: "session:attach" }>;
type ActionType = ActionMessage["type"];
type PayloadFor<T extends ActionType> = Extract<ActionMessage, { type: T }>["payload"];
type ActionResponse = RoomActionResponse | GameActionResponse;
type PendingResponse = ActionResponse | SessionAttachResponse;
type GameActionType =
  | "game:play-card"
  | "game:draw-card"
  | "game:pass"
  | "game:choose-color"
  | "game:call-uno"
  | "game:catch-uno"
  | "game:challenge-draw-four";
type ResponseFor<T extends ActionType> = T extends GameActionType ? GameActionResponse : RoomActionResponse;
type Listener = (...args: never[]) => void;

function networkError(message = "目前無法連線到遊戲伺服器"): RoomSessionResponse {
  return { ok: false, error: { code: "NETWORK_ERROR", message } };
}

function sessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(`${serverUrl}${path}`, init);
    return await response.json() as T;
  } catch {
    return null;
  }
}

export async function listRooms(): Promise<RoomListItem[]> {
  const result = await requestJson<RoomListItem[]>("/api/rooms");
  return Array.isArray(result) ? result : [];
}

export async function createRoom(nickname: string, requestId: string): Promise<RoomSessionResponse> {
  const body = JSON.stringify({ nickname, requestId, playerToken: sessionToken() });
  const init = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  } satisfies RequestInit;
  return await requestJson<RoomSessionResponse>("/api/rooms", init) ??
    await requestJson<RoomSessionResponse>("/api/rooms", init) ??
    networkError();
}

export async function joinRoom(
  roomCode: string,
  nickname: string,
  requestId: string,
  playerToken?: string,
): Promise<RoomSessionResponse> {
  const body = JSON.stringify({
    roomCode,
    nickname,
    requestId,
    playerToken: playerToken ?? sessionToken(),
  });
  const init = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  } satisfies RequestInit;
  return await requestJson<RoomSessionResponse>(`/api/rooms/${encodeURIComponent(roomCode)}/join`, init) ??
    await requestJson<RoomSessionResponse>(`/api/rooms/${encodeURIComponent(roomCode)}/join`, init) ??
    networkError();
}

function isServerMessage(value: unknown): value is ServerMessage {
  return typeof value === "object" && value !== null &&
    typeof (value as { type?: unknown }).type === "string";
}

/** Native WebSocket transport with reconnect and one request-response entry point. */
class RealtimeClient {
  private ws: WebSocket | null = null;
  private session: RoomSession | null = null;
  private reconnectTimer: number | null = null;
  private shouldReconnect = false;
  private pending = new Map<string, (response: PendingResponse) => void>();
  private listeners = new Map<string, Set<Listener>>();
  connected = false;

  on(event: string, listener: Listener): void {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: string, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }

  attach(session: RoomSession): void {
    const sessionChanged = this.session !== null && (
      this.session.roomCode !== session.roomCode ||
      this.session.playerId !== session.playerId ||
      this.session.playerToken !== session.playerToken
    );
    this.session = session;
    this.shouldReconnect = true;
    if (sessionChanged) {
      const previousSocket = this.ws;
      const wasConnected = this.connected;
      this.ws = null;
      this.connected = false;
      this.failPending();
      previousSocket?.close(1000, "room changed");
      if (wasConnected) this.emitEvent("disconnect");
      this.open();
    } else if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendAttach();
    } else {
      this.open();
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.session = null;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const wasConnected = this.connected;
    const previousSocket = this.ws;
    this.ws = null;
    this.connected = false;
    this.failPending();
    previousSocket?.close(1000, "client closed");
    if (wasConnected) this.emitEvent("disconnect");
  }

  emit<T extends ActionType>(
    type: T,
    payload: PayloadFor<T>,
    callback?: (response: ResponseFor<T>) => void,
  ): void {
    const requestId = (payload as { requestId: string }).requestId;
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      callback?.(networkError() as ResponseFor<T>);
      return;
    }
    if (callback) this.pending.set(requestId, (response) => callback(response as ResponseFor<T>));
    this.ws.send(JSON.stringify({ type, requestId, payload }));
  }

  private open(): void {
    if (this.ws || !this.session) return;
    const protocol = serverUrl.startsWith("https://") ? "wss" : "ws";
    const url = `${protocol}://${new URL(serverUrl).host}/ws/room/${encodeURIComponent(this.session.roomCode)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.addEventListener("open", () => {
      if (this.ws !== ws) return;
      this.sendAttach();
    });
    ws.addEventListener("message", (event) => {
      if (this.ws === ws) this.handleMessage(event.data);
    });
    ws.addEventListener("close", () => {
      if (this.ws !== ws) return;
      this.ws = null;
      const wasConnected = this.connected;
      this.connected = false;
      this.failPending();
      if (wasConnected) this.emitEvent("disconnect");
      if (this.shouldReconnect && this.session && this.reconnectTimer === null) {
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          this.open();
        }, 1_000);
      }
    });
    ws.addEventListener("error", () => {
      this.emitEvent("error");
    });
  }

  private sendAttach(): void {
    if (!this.ws || !this.session || this.ws.readyState !== WebSocket.OPEN) return;
    const requestId = crypto.randomUUID();
    this.pending.set(requestId, (response) => {
      if (response.ok && "game" in response) {
        this.connected = true;
        this.emitEvent("session:attached", response);
        this.emitEvent("connect");
      } else if (!response.ok) {
        this.emitEvent("session:attach-failed", response);
      }
    });
    this.ws.send(JSON.stringify({
      type: "session:attach",
      requestId,
      payload: this.session,
    }));
  }

  private handleMessage(raw: unknown): void {
    let value: unknown;
    try {
      value = JSON.parse(typeof raw === "string" ? raw : String(raw));
    } catch {
      return;
    }
    if (!isServerMessage(value)) return;
    if (value.type === "response") {
      const callback = this.pending.get(value.requestId);
      if (!callback) return;
      this.pending.delete(value.requestId);
      callback(value.payload as PendingResponse);
      return;
    }
    this.emitEvent(value.type, value.payload);
  }

  private emitEvent(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args as never[]);
    }
  }

  private failPending(): void {
    const error = networkError() as PendingResponse;
    const callbacks = [...this.pending.values()];
    this.pending.clear();
    for (const callback of callbacks) callback(error);
  }
}

export const socket = new RealtimeClient();
