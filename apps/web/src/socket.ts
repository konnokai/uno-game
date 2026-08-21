import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@uno/shared";
import { io, type Socket } from "socket.io-client";

const serverUrl = import.meta.env.VITE_SERVER_URL ||
  (import.meta.env.DEV ? "http://localhost:3001" : undefined);

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
  serverUrl,
  { autoConnect: false },
);
