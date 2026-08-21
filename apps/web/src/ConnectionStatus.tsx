import { useEffect, useState } from "react";
import type { ConnectionReadyPayload } from "@uno/shared";
import { socket } from "./socket";

type ConnectionState = "connecting" | "connected" | "disconnected";

export function ConnectionStatus() {
  const [state, setState] = useState<ConnectionState>(
    socket.connected ? "connected" : "connecting",
  );
  const [serverMessage, setServerMessage] = useState("");

  useEffect(() => {
    function handleConnect() {
      setState("connected");
    }

    function handleDisconnect() {
      setState("disconnected");
    }

    function handleReady(payload: ConnectionReadyPayload) {
      setServerMessage(payload.message);
    }

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connection:ready", handleReady);
    socket.connect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connection:ready", handleReady);
    };
  }, []);

  const labels: Record<ConnectionState, string> = {
    connected: "伺服器已連線",
    connecting: "正在連線",
    disconnected: "伺服器未連線",
  };

  return (
    <div className={`connection-status ${state}`} role="status">
      <span className="status-dot" aria-hidden="true" />
      <span>{labels[state]}</span>
      {serverMessage && <small>{serverMessage}</small>}
    </div>
  );
}
