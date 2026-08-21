import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  GameSnapshot,
  RoomActionResponse,
  RoomListItem,
  RoomSession,
  RoomSessionResponse,
  RoomSnapshot,
  SessionAttachResponse,
} from "@uno/shared";
import {
  MAX_NICKNAME_LENGTH,
  MAX_GAME_PLAYERS,
  MIN_NICKNAME_LENGTH,
  normalizeNickname,
} from "@uno/shared";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { ConnectionStatus } from "./ConnectionStatus";
import { GamePage } from "./GameTable";
import { RulesGuide } from "./RulesGuide";
import { createRoom as createRoomRequest, joinRoom as joinRoomRequest, listRooms, socket } from "./socket";

const SESSION_KEY = "uno-room-session";

function requestId(): string {
  return crypto.randomUUID();
}

function readSession(): RoomSession | null {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as Partial<RoomSession> | null;
    return value &&
      typeof value.roomCode === "string" &&
      typeof value.playerId === "string" &&
      typeof value.playerToken === "string" &&
      typeof value.nickname === "string"
      ? (value as RoomSession)
      : null;
  } catch {
    return null;
  }
}

interface HomePageProps {
  rooms: RoomListItem[];
  session: RoomSession | null;
  onSession: (response: Extract<RoomSessionResponse, { ok: true }>) => void;
  onError: (message: string) => void;
  error: string;
}

function HomePage({ rooms, session, onSession, onError, error }: HomePageProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [nickname, setNickname] = useState(session?.nickname ?? "");
  const [roomCode, setRoomCode] = useState(searchParams.get("room")?.toUpperCase() ?? "");
  const [submitting, setSubmitting] = useState<"create" | "join" | null>(null);

  function handleResponse(response: RoomSessionResponse) {
    setSubmitting(null);
    if (!response.ok) {
      onError(response.error.message);
      return;
    }
    onSession(response);
    navigate(`/lobby/${response.room.code}`);
  }

  async function createRoom(event: FormEvent) {
    event.preventDefault();
    onError("");
    const normalized = normalizeNickname(nickname);
    if (!normalized) {
      onError(`暱稱須為 ${MIN_NICKNAME_LENGTH}–${MAX_NICKNAME_LENGTH} 個有效字元，且不可只包含標點符號`);
      return;
    }
    setSubmitting("create");
    setNickname(normalized);
    handleResponse(await createRoomRequest(normalized, requestId()));
  }

  async function submitJoin(code: string) {
    onError("");
    const normalized = normalizeNickname(nickname);
    if (!normalized) {
      onError(`暱稱須為 ${MIN_NICKNAME_LENGTH}–${MAX_NICKNAME_LENGTH} 個有效字元，且不可只包含標點符號`);
      return;
    }
    setSubmitting("join");
    setNickname(normalized);
    setRoomCode(code);
    handleResponse(await joinRoomRequest(code, normalized, requestId()));
  }

  function joinRoom(event: FormEvent) {
    event.preventDefault();
    submitJoin(roomCode);
  }

  return (
    <main className="page home-page">
      <section className="hero">
        <p className="eyebrow">REAL-TIME CARD TABLE</p>
        <h1>UNO</h1>
        <p className="lead">開一張桌，丟一條連結。2–8 位玩家，直接開打。</p>
        <ConnectionStatus />
      </section>

      <section className="join-panel" aria-label="建立或加入房間">
        <label htmlFor="nickname">你的暱稱</label>
        <input
          id="nickname"
          maxLength={MAX_NICKNAME_LENGTH * 2}
          minLength={MIN_NICKNAME_LENGTH}
          onChange={(event) => setNickname(event.target.value)}
          placeholder={`${MIN_NICKNAME_LENGTH}–${MAX_NICKNAME_LENGTH} 個字元`}
          required
          value={nickname}
        />

        {error && <p className="form-error" role="alert">{error}</p>}

        <form onSubmit={createRoom}>
          <button className="button primary" disabled={submitting !== null} type="submit">
            {submitting === "create" ? "建立中…" : "建立新房間"}
          </button>
        </form>

        <div className="divider"><span>或輸入房號</span></div>

        <form className="join-row" onSubmit={joinRoom}>
          <input
            aria-label="六碼房號"
            className="room-code-input"
            maxLength={6}
            onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
            pattern="[A-HJ-NP-Z2-9]{6}"
            placeholder="ABC123"
            required
            value={roomCode}
          />
          <button className="button secondary" disabled={submitting !== null} type="submit">
            {submitting === "join" ? "加入中…" : "加入房間"}
          </button>
        </form>
      </section>

      <section className="room-browser" aria-labelledby="room-list-title">
        <div className="room-browser-heading">
          <div>
            <p className="eyebrow">OPEN TABLES</p>
            <h2 id="room-list-title">房間清單</h2>
          </div>
          <span>{rooms.length} 間等待中</span>
        </div>

        {rooms.length === 0 ? (
          <p className="empty-rooms">目前沒有公開房間，建立第一張牌桌吧。</p>
        ) : (
          <ul className="room-list">
            {rooms.map((availableRoom) => (
              <li key={availableRoom.code}>
                <strong>{availableRoom.code}</strong>
                <span className="room-host">房主 {availableRoom.hostNickname}</span>
                <span className="room-capacity">
                  {availableRoom.playerCount} / {availableRoom.maxPlayers} 人
                </span>
                <button
                  className="button secondary"
                  disabled={availableRoom.isFull || submitting !== null}
                  onClick={() => submitJoin(availableRoom.code)}
                  type="button"
                >
                  {availableRoom.isFull ? "房間已滿" : "加入"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

interface RoomPageProps {
  room: RoomSnapshot | null;
  session: RoomSession | null;
  error: string;
  onError: (message: string) => void;
  onLeave: () => void;
}

function LobbyPage({ room, session, error, onError, onLeave }: RoomPageProps) {
  const navigate = useNavigate();
  const { roomCode = "" } = useParams();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (room?.code === roomCode && room.phase !== "lobby") {
      navigate(`/game/${roomCode}`, { replace: true });
    }
  }, [navigate, room, roomCode]);

  if (!session || session.roomCode !== roomCode) {
    return <MissingSession roomCode={roomCode} />;
  }
  if (!room || room.code !== roomCode) {
    return <LoadingRoom roomCode={roomCode} />;
  }

  const me = room.players.find((player) => player.id === session.playerId);
  const invitation = `${window.location.origin}/?room=${room.code}`;

  async function copyInvitation() {
    await navigator.clipboard.writeText(invitation);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function applyAction(response: RoomActionResponse) {
    setBusy(false);
    if (!response.ok) {
      onError(response.error.message);
    }
  }

  function toggleReady() {
    if (!me) return;
    setBusy(true);
    onError("");
    socket.emit("room:ready", { isReady: !me.isReady, requestId: requestId() }, applyAction);
  }

  function start() {
    setBusy(true);
    onError("");
    socket.emit("game:start", { requestId: requestId() }, applyAction);
  }

  function addBot() {
    setBusy(true);
    onError("");
    socket.emit("room:add-bot", { requestId: requestId() }, applyAction);
  }

  function removeBot(botId: string) {
    setBusy(true);
    onError("");
    socket.emit("room:remove-bot", { botId, requestId: requestId() }, applyAction);
  }

  return (
    <main className="page lobby-page">
      <header className="room-header">
        <div>
          <p className="eyebrow">WAITING ROOM</p>
          <h2>牌桌就緒</h2>
        </div>
        <button className="text-button" onClick={onLeave} type="button">離開房間</button>
      </header>

      <section className="room-code-card">
        <div>
          <span>房號</span>
          <strong>{room.code}</strong>
        </div>
        <button className="button secondary" onClick={copyInvitation} type="button">
          {copied ? "已複製邀請連結" : "複製邀請連結"}
        </button>
      </section>

      <section className="lobby-grid">
        <div className="players-panel">
          <div className="section-heading">
            <h3>玩家</h3>
            <span>{room.players.length} / {MAX_GAME_PLAYERS}</span>
          </div>
          <ol className="player-list">
            {room.players.map((player, index) => (
              <li className={player.id === session.playerId ? "is-me" : ""} key={player.id}>
                <span className="player-number">{String(index + 1).padStart(2, "0")}</span>
                <span className="player-name">
                  {player.nickname}
                  {player.id === session.playerId && <small>你</small>}
                </span>
                <span className="player-actions">
                  <span className={`player-state ${player.isReady ? "ready" : ""}`}>
                    {player.isHost ? "房主" : player.isBot ? "機器人" : player.isReady ? "已準備" : "等待中"}
                  </span>
                  {me?.isHost && player.isBot && (
                    <button
                      aria-label={`移除 ${player.nickname}`}
                      className="remove-bot"
                      disabled={busy}
                      onClick={() => removeBot(player.id)}
                      type="button"
                    >
                      移除
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <aside className="lobby-controls">
          <p className="control-label">你的狀態</p>
          {me?.isHost ? (
            <>
              <h3>你是房主</h3>
              <p>邀請真人玩家，或加入機器人補滿牌桌。</p>
              <button
                className="button secondary"
                disabled={room.players.length >= MAX_GAME_PLAYERS || busy}
                onClick={addBot}
                type="button"
              >
                {room.players.length >= MAX_GAME_PLAYERS ? "牌桌已滿" : "+ 加入機器人"}
              </button>
              <button className="button primary" disabled={!room.canStart || busy} onClick={start} type="button">
                {busy ? "處理中…" : "開始遊戲"}
              </button>
            </>
          ) : (
            <>
              <h3>{me?.isReady ? "準備完成" : "還差一步"}</h3>
              <p>{me?.isReady ? "等待房主開始遊戲。" : "確認準備後，房主就能開始。"}</p>
              <button
                className={`button ${me?.isReady ? "secondary" : "primary"}`}
                disabled={busy}
                onClick={toggleReady}
                type="button"
              >
                {busy ? "處理中…" : me?.isReady ? "取消準備" : "我準備好了"}
              </button>
            </>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
        </aside>
      </section>
    </main>
  );
}

function MissingSession({ roomCode }: { roomCode: string }) {
  return (
    <main className="page status-page">
      <p className="eyebrow">ROOM {roomCode}</p>
      <h2>需要先加入房間</h2>
      <Link className="button primary" to={`/?room=${roomCode}`}>輸入暱稱加入</Link>
    </main>
  );
}

function LoadingRoom({ roomCode }: { roomCode: string }) {
  return (
    <main className="page status-page">
      <p className="eyebrow">ROOM {roomCode}</p>
      <h2>正在恢復座位…</h2>
      <ConnectionStatus />
    </main>
  );
}

function NotFoundPage() {
  return (
    <main className="page status-page">
      <p className="eyebrow">404</p>
      <h2>找不到頁面</h2>
      <Link className="button primary" to="/">回到首頁</Link>
    </main>
  );
}

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [session, setSession] = useState<RoomSession | null>(readSession);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [game, setGame] = useState<GameSnapshot | null>(null);
  const [availableRooms, setAvailableRooms] = useState<RoomListItem[]>([]);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(socket.connected);
  const [needsRestore, setNeedsRestore] = useState(false);
  const restoring = useRef<string | null>(null);

  function updateRoom(nextRoom: RoomSnapshot) {
    setRoom((current) =>
      current?.code === nextRoom.code && current.version >= nextRoom.version
        ? current
        : nextRoom,
    );
  }

  function saveSession(response: Extract<RoomSessionResponse, { ok: true }>) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(response.session));
    setSession(response.session);
    updateRoom(response.room);
    setGame(null);
    setError("");
  }

  useEffect(() => {
    function handleRoomUpdated(nextRoom: RoomSnapshot) {
      updateRoom(nextRoom);
    }
    function handleDisconnect() {
      setConnected(false);
      setNeedsRestore(true);
      restoring.current = null;
    }
    function handleConnect() {
      setConnected(true);
    }
    function handleRejected(payload: { error: { message: string } }) {
      setError(payload.error.message);
    }
    function handleGameState(nextGame: GameSnapshot) {
      setGame((current) => current && current.version >= nextGame.version ? current : nextGame);
    }
    function handleGameStarted({ room: nextRoom }: { room: RoomSnapshot }) {
      setGame(null);
      updateRoom(nextRoom);
    }
    function handleSessionAttached(response: Extract<SessionAttachResponse, { ok: true }>) {
      updateRoom(response.room);
      setGame(response.game);
      setNeedsRestore(false);
    }
    function handleSessionAttachFailed(response: Extract<SessionAttachResponse, { ok: false }>) {
      restoring.current = null;
      setError(response.error.message);
      if (response.error.code === "ROOM_NOT_FOUND" || response.error.code === "NOT_IN_ROOM") {
        socket.disconnect();
        localStorage.removeItem(SESSION_KEY);
        setSession(null);
        setRoom(null);
        setGame(null);
        setNeedsRestore(false);
      }
    }

    socket.on("room:updated", handleRoomUpdated);
    socket.on("game:started", handleGameStarted);
    socket.on("game:action-rejected", handleRejected);
    socket.on("game:state", handleGameState);
    socket.on("session:attached", handleSessionAttached);
    socket.on("session:attach-failed", handleSessionAttachFailed);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect", handleConnect);
    void listRooms().then(setAvailableRooms);

    return () => {
      socket.off("room:updated", handleRoomUpdated);
      socket.off("game:started", handleGameStarted);
      socket.off("game:action-rejected", handleRejected);
      socket.off("game:state", handleGameState);
      socket.off("session:attached", handleSessionAttached);
      socket.off("session:attach-failed", handleSessionAttachFailed);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect", handleConnect);
    };
  }, []);

  useEffect(() => {
    const match = location.pathname.match(/^\/(?:lobby|game)\/([^/]+)$/);
    const routeCode = match?.[1]?.toUpperCase();
    if (
      !routeCode ||
      !session ||
      session.roomCode !== routeCode ||
      (restoring.current === `${routeCode}:${session.playerToken}` && !needsRestore)
    ) {
      return;
    }
    const restoreKey = `${routeCode}:${session.playerToken}`;
    if (restoring.current === restoreKey) return;
    restoring.current = restoreKey;
    socket.attach(session);
  }, [location.pathname, needsRestore, session]);

  function leaveRoom() {
    const clearLocalSession = () => {
      socket.disconnect();
      localStorage.removeItem(SESSION_KEY);
      setSession(null);
      setRoom(null);
      setGame(null);
      setError("");
      navigate("/");
    };
    if (!socket.connected) {
      clearLocalSession();
      return;
    }
    socket.emit("room:leave", { requestId: requestId() }, clearLocalSession);
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<HomePage error={error} onError={setError} onSession={saveSession} rooms={availableRooms} session={session} />} />
        <Route path="/lobby/:roomCode" element={<LobbyPage error={error} onError={setError} onLeave={leaveRoom} room={room} session={session} />} />
        <Route path="/game/:roomCode" element={<GamePage connected={connected && !needsRestore} error={error} game={game} onError={setError} onLeave={leaveRoom} room={room} session={session} />} />
        <Route path="/home" element={<Navigate replace to="/" />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <RulesGuide />
    </>
  );
}
