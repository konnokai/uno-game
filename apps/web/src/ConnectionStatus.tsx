import { useEffect, useState } from "react";
import { serverUrl, socket } from "./socket";

type ConnectionState = "connecting" | "connected" | "disconnected";

export function ConnectionStatus() {
  const [state, setState] = useState<ConnectionState>(
    socket.connected ? "connected" : "connecting",
  );

  useEffect(() => {
    function handleConnect() {
      setState("connected");
    }

    function handleDisconnect() {
      setState("disconnected");
    }

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    void fetch(`${serverUrl}/health`)
      .then((response) => setState(response.ok ? "connected" : "disconnected"))
      .catch(() => setState("disconnected"));

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
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
    </div>
  );
}
