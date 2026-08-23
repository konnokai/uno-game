import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type {
  GameSnapshot,
  GameRuleOptions,
  GameRulesMode,
  StackingMode,
  RoomActionResponse,
  RoomListItem,
  RoomSession,
  RoomSessionResponse,
  RoomSnapshot,
  SessionAttachResponse,
} from "@uno/shared";
import {
  DEFAULT_GAME_RULE_OPTIONS,
  DEFAULT_TURN_TIMEOUT_SECONDS,
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
import { applyPageMetadata, getPageMetadata } from "./metadata";
import { RulesGuide } from "./RulesGuide";
import { createRoom as createRoomRequest, joinRoom as joinRoomRequest, listRooms, socket } from "./socket";

const SESSION_KEY = "uno-room-session";

const RULES_MODE_LABELS: Record<GameRulesMode, string> = {
  classic: "經典官方規則",
  taiwan: "台灣常見玩法",
};

const STACKING_MODE_LABELS: Record<StackingMode, string> = {
  "same-type": "+2 只能疊 +2，+4 只能疊 +4",
  "draw-four-over-two": "+4 可以疊 +2，但 +2 不能疊 +4",
  mixed: "+2、+4 可以混合疊牌",
};

const STACKING_MODE_ORDER: StackingMode[] = ["same-type", "draw-four-over-two", "mixed"];

const RULE_HINTS = {
  stacking: "開啟後，遇到累積中的 +2 或 +4，下一位可以依下方設定繼續出 +2 或 +4，讓累積的罰抽張數傳給下一位；關閉後，必須逐張抽完累積張數。",
  sevenZero: "出 7 時可指定一位玩家交換全部手牌；出 0 時，所有玩家依目前方向把手牌傳給下一位。",
  jumpIn: "不是自己回合時，如果手上有和棄牌堆頂牌顏色、牌面都相同的牌，就能立即搶牌；接著由搶牌者繼續出牌。",
  drawToMatch: "輪到自己但沒有可出的牌時，每次點牌庫抽一張，直到抽到可出的牌；抽到後可以打出，也可以保留並結束回合。",
  drawFourChallenge: "有人打出 +4 後，下一位玩家可以檢查對方出牌前手上是否有目前顏色的牌。質疑成功時，由出牌者抽牌；質疑失敗時，由質疑者抽 6 張。未開啟時，只能接受 +4。",
  multiCardPlay: "開啟後，一回合可以一次打出兩張以上相同數字或相同功能的非萬用牌。第一張必須合法，後續牌必須與第一張牌面值相同。",
} as const;

function RuleHint({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <span className="rule-hint">
      <button
        aria-describedby={`${id}-tooltip`}
        aria-label={`${label}說明`}
        className="rule-hint-button"
        type="button"
      >
        ?
      </button>
      <span className="rule-tooltip" id={`${id}-tooltip`} role="tooltip">{children}</span>
    </span>
  );
}

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
          <span>目前有 {rooms.length} 間房間開放中</span>
        </div>

        {rooms.length === 0 ? (
          <p className="empty-rooms">目前沒有公開房間，先開一間吧。</p>
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
  const [timeoutSeconds, setTimeoutSeconds] = useState(String(DEFAULT_TURN_TIMEOUT_SECONDS));
  const [rulesMode, setRulesMode] = useState<GameRulesMode>("classic");
  const [rulesOptions, setRulesOptions] = useState<GameRuleOptions>({ ...DEFAULT_GAME_RULE_OPTIONS });

  useEffect(() => {
    if (room?.code === roomCode && room.phase !== "lobby") {
      navigate(`/game/${roomCode}`, { replace: true });
    }
  }, [navigate, room, roomCode]);

  useEffect(() => {
    if (room) setTimeoutSeconds(String(room.turnTimeoutSeconds));
  }, [room?.turnTimeoutSeconds]);

  useEffect(() => {
    if (room) {
      setRulesMode(room.rulesMode);
      setRulesOptions({ ...room.rulesOptions });
    }
  }, [
    room?.rulesMode,
    room?.rulesOptions.stackingEnabled,
    room?.rulesOptions.stackingMode,
    room?.rulesOptions.sevenZeroEnabled,
    room?.rulesOptions.jumpInEnabled,
    room?.rulesOptions.drawToMatchEnabled,
  ]);

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

  function saveTurnTimeout(event: FormEvent) {
    event.preventDefault();
    const seconds = Number(timeoutSeconds);
    if (!Number.isSafeInteger(seconds) || seconds <= 0) {
      onError("出牌時間必須是大於 0 的整數秒");
      return;
    }
    setBusy(true);
    onError("");
    socket.emit("room:set-turn-timeout", { seconds, requestId: requestId() }, applyAction);
  }

  function saveRulesMode() {
    setBusy(true);
    onError("");
    socket.emit("room:set-rules-mode", { rulesMode, rulesOptions, requestId: requestId() }, applyAction);
  }

  function updateRulesOption<K extends keyof GameRuleOptions>(key: K, value: GameRuleOptions[K]) {
    setRulesOptions((current) => ({ ...current, [key]: value }));
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
          <h2>等待玩家加入</h2>
        </div>
        <button className="text-button" onClick={onLeave} type="button">離開房間</button>
      </header>

      <section className="room-code-card">
        <div>
          <span>房號</span>
          <strong>{room.code}</strong>
        </div>
        <div className="room-code-actions">
          <small>{RULES_MODE_LABELS[room.rulesMode]}</small>
          <button className="button secondary" onClick={copyInvitation} type="button">
            {copied ? "已複製邀請連結" : "複製邀請連結"}
          </button>
        </div>
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
              <p>邀請其他玩家，也可以加入機器人一起玩。</p>
              <form className="timeout-setting" onSubmit={saveTurnTimeout}>
                <label htmlFor="turn-timeout">每回合出牌時間</label>
                <div className="timeout-input-row">
                  <input
                    id="turn-timeout"
                    min="1"
                    onChange={(event) => setTimeoutSeconds(event.target.value)}
                    required
                    step="1"
                    type="number"
                    value={timeoutSeconds}
                  />
                  <span>秒</span>
                  <button className="button secondary" disabled={busy} type="submit">儲存</button>
                </div>
                <small>預設 {DEFAULT_TURN_TIMEOUT_SECONDS} 秒，時間到後會自動交給機器人代打。</small>
              </form>
              <div className="rules-mode-setting">
                <label htmlFor="rules-mode">遊戲規則</label>
                <select
                  id="rules-mode"
                  disabled={busy}
                  onChange={(event) => setRulesMode(event.target.value as GameRulesMode)}
                  value={rulesMode}
                >
                  <option value="classic">經典官方規則</option>
                  <option value="taiwan">台灣常見玩法</option>
                </select>
                <fieldset className="rules-detail-setting">
                  <legend>台灣玩法細項</legend>
                  <div className="rules-toggle-row">
                    <label className="rules-toggle">
                      <input
                        aria-label="允許疊牌"
                        checked={rulesOptions.stackingEnabled}
                        disabled={busy || rulesMode === "classic"}
                        onChange={(event) => updateRulesOption("stackingEnabled", event.target.checked)}
                        type="checkbox"
                      />
                      <span>允許疊牌</span>
                    </label>
                    <RuleHint id="stacking" label="允許疊牌">{RULE_HINTS.stacking}</RuleHint>
                  </div>
                  <div className="stacking-mode-options">
                    <span>疊牌方式</span>
                    {STACKING_MODE_ORDER.map((mode) => (
                      <label className="rules-radio" key={mode}>
                        <input
                          aria-label={STACKING_MODE_LABELS[mode]}
                          checked={rulesOptions.stackingMode === mode}
                          disabled={busy || rulesMode === "classic" || !rulesOptions.stackingEnabled}
                          name="stacking-mode"
                          onChange={() => updateRulesOption("stackingMode", mode)}
                          type="radio"
                          value={mode}
                        />
                        <span>{STACKING_MODE_LABELS[mode]}</span>
                      </label>
                    ))}
                  </div>
                  <div className="rules-toggle-row">
                    <label className="rules-toggle">
                      <input
                        aria-label="7-0 換牌"
                        checked={rulesOptions.sevenZeroEnabled}
                        disabled={busy || rulesMode === "classic"}
                        onChange={(event) => updateRulesOption("sevenZeroEnabled", event.target.checked)}
                        type="checkbox"
                      />
                      <span>7-0 換牌</span>
                    </label>
                    <RuleHint id="seven-zero" label="7-0 換牌">{RULE_HINTS.sevenZero}</RuleHint>
                  </div>
                  <div className="rules-toggle-row">
                    <label className="rules-toggle">
                      <input
                        aria-label="Jump-In 搶牌"
                        checked={rulesOptions.jumpInEnabled}
                        disabled={busy || rulesMode === "classic"}
                        onChange={(event) => updateRulesOption("jumpInEnabled", event.target.checked)}
                        type="checkbox"
                      />
                      <span>Jump-In 搶牌</span>
                    </label>
                    <RuleHint id="jump-in" label="Jump-In 搶牌">{RULE_HINTS.jumpIn}</RuleHint>
                  </div>
                  <div className="rules-toggle-row">
                    <label className="rules-toggle">
                      <input
                        aria-label="抽到能出的牌為止"
                        checked={rulesOptions.drawToMatchEnabled}
                        disabled={busy || rulesMode === "classic"}
                        onChange={(event) => updateRulesOption("drawToMatchEnabled", event.target.checked)}
                        type="checkbox"
                      />
                      <span>抽到能出的牌為止</span>
                    </label>
                    <RuleHint id="draw-to-match" label="抽到能出的牌為止">{RULE_HINTS.drawToMatch}</RuleHint>
                  </div>
                  <div className="rules-toggle-row">
                    <label className="rules-toggle">
                      <input
                        aria-label="+4 質疑"
                        checked={rulesOptions.drawFourChallengeEnabled}
                        disabled={busy || rulesMode === "classic"}
                        onChange={(event) => updateRulesOption("drawFourChallengeEnabled", event.target.checked)}
                        type="checkbox"
                      />
                      <span>+4 質疑</span>
                    </label>
                    <RuleHint id="draw-four-challenge" label="+4 質疑">{RULE_HINTS.drawFourChallenge}</RuleHint>
                  </div>
                  <div className="rules-toggle-row">
                    <label className="rules-toggle">
                      <input
                        aria-label="同回合多張連出"
                        checked={rulesOptions.multiCardPlayEnabled}
                        disabled={busy || rulesMode === "classic"}
                        onChange={(event) => updateRulesOption("multiCardPlayEnabled", event.target.checked)}
                        type="checkbox"
                      />
                      <span>同回合多張連出</span>
                    </label>
                    <RuleHint id="multi-card-play" label="同回合多張連出">{RULE_HINTS.multiCardPlay}</RuleHint>
                  </div>
                </fieldset>
                  <small>{rulesMode === "classic" ? "經典模式不套用台灣細項；切換到台灣常見玩法後，才能調整下方設定。" : "可單獨關閉玩法；疊牌方式會決定 +2 與 +4 的混疊關係。"}</small>
                <button className="button secondary" disabled={busy} onClick={saveRulesMode} type="button">儲存規則與細項</button>
              </div>
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
              <p>{me?.isReady ? "等待房主開始遊戲。" : "按下準備後，房主就能開始。"}</p>
              <div className="rules-mode-readonly">
                <span>遊戲規則</span>
                <strong>{RULES_MODE_LABELS[room.rulesMode]}</strong>
                {room.rulesMode === "taiwan" && (
                  <small>{room.rulesOptions.stackingEnabled ? STACKING_MODE_LABELS[room.rulesOptions.stackingMode] : "疊牌關閉"} · {room.rulesOptions.sevenZeroEnabled ? "7-0 開啟" : "7-0 關閉"} · {room.rulesOptions.jumpInEnabled ? "搶牌開啟" : "搶牌關閉"} · {room.rulesOptions.drawToMatchEnabled ? "抽到能出" : "只抽一張"} · {room.rulesOptions.drawFourChallengeEnabled ? "+4 可質疑" : "+4 不可質疑"} · {room.rulesOptions.multiCardPlayEnabled ? "多張連出開啟" : "多張連出關閉"}</small>
                )}
              </div>
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

  useEffect(() => {
    applyPageMetadata(getPageMetadata(new URL(window.location.href)));
  }, [location.pathname, location.search]);

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
      setGame((current) => current && current.version > nextGame.version ? current : nextGame);
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
        navigate("/", { replace: true });
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
