import { useEffect, useState, type DragEvent, type MouseEvent } from "react";
import {
  isCardPlayable,
  type Card,
  type CardColor,
  type GameAction,
  type GameActionResponse,
  type GameSnapshot,
  type RoomActionResponse,
  type RoomSession,
  type RoomSnapshot,
} from "@uno/shared";
import { Navigate, useParams } from "react-router-dom";
import { socket } from "./socket";

interface GamePageProps {
  connected: boolean;
  room: RoomSnapshot | null;
  game: GameSnapshot | null;
  session: RoomSession | null;
  error: string;
  onError: (message: string) => void;
  onLeave: () => void;
}

function requestId(): string {
  return crypto.randomUUID();
}

const COLOR_LABELS: Record<CardColor, string> = {
  red: "紅色",
  yellow: "黃色",
  green: "綠色",
  blue: "藍色",
};

const COLOR_ORDER: Record<CardColor, number> = {
  red: 0,
  yellow: 1,
  green: 2,
  blue: 3,
};

const VALUE_ORDER: Record<string, number> = {
  skip: 10,
  reverse: 11,
  "draw-two": 12,
  wild: 13,
  "wild-draw-four": 14,
};

const VALUE_LABELS: Record<string, string> = {
  skip: "SKIP",
  reverse: "REV",
  "draw-two": "+2",
  wild: "WILD",
  "wild-draw-four": "+4",
};

const CARD_SYMBOLS: Record<string, string> = {
  skip: "⊘",
  reverse: "↻",
  "draw-two": "+2",
  wild: "",
  "wild-draw-four": "+4",
};

function cardLabel(card: Card): string {
  const value = typeof card.value === "number" ? String(card.value) : VALUE_LABELS[card.value];
  return `${card.color ? COLOR_LABELS[card.color] : "萬用"} ${value}`;
}

function compareCards(left: Card, right: Card): number {
  const colorDifference =
    (left.color ? COLOR_ORDER[left.color] : 4) -
    (right.color ? COLOR_ORDER[right.color] : 4);
  if (colorDifference !== 0) return colorDifference;

  const leftValue = typeof left.value === "number" ? left.value : VALUE_ORDER[left.value]!;
  const rightValue = typeof right.value === "number" ? right.value : VALUE_ORDER[right.value]!;
  return leftValue - rightValue;
}

function UnoCard({
  card,
  disabled = false,
  selected = false,
  onClick,
  compact = false,
  draggable = false,
  dragging = false,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onDoubleClick,
}: {
  card: Card;
  disabled?: boolean;
  selected?: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  compact?: boolean;
  draggable?: boolean;
  dragging?: boolean;
  onDragEnd?: () => void;
  onDragOver?: (event: DragEvent<HTMLButtonElement>) => void;
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
  onDrop?: (event: DragEvent<HTMLButtonElement>) => void;
  onDoubleClick?: () => void;
}) {
  const value = typeof card.value === "number" ? String(card.value) : VALUE_LABELS[card.value];
  const symbol = typeof card.value === "number" ? String(card.value) : CARD_SYMBOLS[card.value];
  const cornerSymbol = card.value === "wild" ? "" : symbol;
  const centerSymbol = card.value === "draw-two"
    ? <span aria-hidden="true" className="card-draw-symbol"><i /><i /></span>
    : card.value === "wild-draw-four"
      ? (
          <span aria-hidden="true" className="card-draw-four-symbol">
            <i /><i /><i /><i />
          </span>
        )
      : <strong aria-hidden="true">{symbol}</strong>;
  const className = [
    "uno-card",
    card.color ? `card-${card.color}` : "card-wild",
    typeof card.value === "number" ? "card-number" : `card-value-${card.value}`,
    selected ? "is-selected" : "",
    compact ? "is-compact" : "",
    dragging ? "is-dragging" : "",
  ].filter(Boolean).join(" ");

  if (!onClick) {
    return (
      <div aria-label={cardLabel(card)} className={className} role="img">
        <span aria-hidden="true" className="card-corner">{cornerSymbol}</span>
        {centerSymbol}
        <span aria-hidden="true" className="card-corner card-corner-bottom">{cornerSymbol}</span>
      </div>
    );
  }

  return (
    <button
      aria-label={`${selected ? "已選擇，" : ""}${cardLabel(card)}`}
      aria-pressed={selected}
      className={className}
      disabled={disabled}
      draggable={draggable}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragStart={onDragStart}
      onDrop={onDrop}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      type="button"
    >
      <span aria-hidden="true" className="card-corner">{cornerSymbol}</span>
      {centerSymbol}
      <span aria-hidden="true" className="card-corner card-corner-bottom">{cornerSymbol}</span>
    </button>
  );
}

function CardBack({ count, label = "牌庫" }: { count?: number; label?: string }) {
  return (
    <div aria-label={label} className="uno-card card-back" role="img">
      <strong>UNO</strong>
      {count !== undefined && <span className="pile-count">{count}</span>}
    </div>
  );
}

function playerName(room: RoomSnapshot, playerId: string | null | undefined): string {
  if (!playerId) return "系統";
  return room.players.find((player) => player.id === playerId)?.nickname ?? "玩家";
}

function actionText(action: GameAction, room: RoomSnapshot, card?: Card): string {
  const actor = playerName(room, action.playerId);
  const target = playerName(room, action.targetPlayerId);
  const amount = action.amount ?? 0;
  switch (action.type) {
    case "start": return `翻開${card ? ` ${cardLabel(card)}` : "起始牌"}，牌局開始`;
    case "choose-color": return `${actor} 選擇${COLOR_LABELS[action.chosenColor!]}`;
    case "play-card": return `${actor} 打出${card ? ` ${cardLabel(card)}` : "一張牌"}${action.declaredUno ? "，並喊了 UNO！" : ""}`;
    case "draw-card": return `${actor} 抽了 ${amount} 張牌`;
    case "pass": return `${actor} 保留新牌並結束回合`;
    case "call-uno": return `${actor} 喊了 UNO！`;
    case "catch-uno": return `${actor} 抓到 ${target} 漏喊 UNO，罰抽 ${amount} 張`;
    case "accept-draw-four": return `${actor} 接受抽四，抽了 ${amount} 張`;
    case "challenge-draw-four":
      return action.successful
        ? `${actor} 質疑成功，出牌者罰抽 ${amount} 張`
        : `${actor} 質疑失敗，罰抽 ${amount} 張`;
  }
}

function actionMessage(game: GameSnapshot, room: RoomSnapshot): string {
  return actionText(game.lastAction, room, game.topDiscard);
}

function ColorDialog({
  hand,
  mode,
  onChoose,
  onClose,
}: {
  hand: readonly Card[];
  mode: "play" | "start";
  onChoose: (color: CardColor) => void;
  onClose?: () => void;
}) {
  const colorCounts = Object.fromEntries(
    (["red", "yellow", "green", "blue"] as const).map((color) => [
      color,
      hand.filter((card) => card.color === color).length,
    ]),
  ) as Record<CardColor, number>;
  const strongestColor = (["red", "yellow", "green", "blue"] as const).reduce(
    (best, color) => colorCounts[color] > colorCounts[best] ? color : best,
  );
  const recommendedColor = colorCounts[strongestColor] > 0 ? strongestColor : null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-labelledby="color-title" aria-modal="true" className="color-dialog" role="dialog">
        <p className="eyebrow">WILD CARD</p>
        <h3 id="color-title">選擇接下來的顏色</h3>
        <p>{mode === "start" ? "你是起始玩家，請先觀察自己的手牌再決定顏色。" : "選色後會立即打出這張萬用牌。"}</p>
        {mode === "start" && (
          <div className="starting-hand-preview">
            <div className="starting-hand-heading">
              <span>YOUR STARTING HAND</span>
              <strong>你的起手牌</strong>
            </div>
            <div className="starting-hand-cards">
              {hand.map((card) => <UnoCard card={card} compact key={card.id} />)}
            </div>
          </div>
        )}
        <div className="color-options">
          {(["red", "yellow", "green", "blue"] as const).map((color) => (
            <button
              aria-label={`選擇${COLOR_LABELS[color]}`}
              className={`color-choice color-${color} ${mode === "start" && color === recommendedColor ? "is-recommended" : ""}`}
              key={color}
              onClick={() => onChoose(color)}
              type="button"
            >
              <span>{COLOR_LABELS[color]}</span>
              <small>{colorCounts[color]} 張{mode === "start" && color === recommendedColor ? " · 建議" : ""}</small>
            </button>
          ))}
        </div>
        {onClose && <button className="text-button" onClick={onClose} type="button">返回手牌</button>}
      </section>
    </div>
  );
}

export function GamePage({ connected, room, game, session, error, onError, onLeave }: GamePageProps) {
  const { roomCode = "" } = useParams();
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [choosingColor, setChoosingColor] = useState(false);
  const [declareUno, setDeclareUno] = useState(false);
  const [handOrder, setHandOrder] = useState<string[]>([]);
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [tableDragActive, setTableDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shuffleEffect, setShuffleEffect] = useState<{
    type: "initial" | "recycle";
    version: number;
  } | null>(null);
  const [tableEffect, setTableEffect] = useState<
    | { type: "uno"; playerId: string | null; version: number }
    | { type: "catch"; playerId: string | null; targetPlayerId: string | null; amount: number; version: number }
    | null
  >(null);

  useEffect(() => {
    if (selectedCardId && !game?.hand.some((card) => card.id === selectedCardId)) {
      setSelectedCardId(null);
      setDeclareUno(false);
      setChoosingColor(false);
    }
  }, [game, selectedCardId]);

  useEffect(() => {
    if (!game) return;
    const handIds = game.hand.map((card) => card.id);
    const handIdSet = new Set(handIds);
    setHandOrder((current) => {
      const retained = current.filter((cardId) => handIdSet.has(cardId));
      const retainedSet = new Set(retained);
      const next = [...retained, ...handIds.filter((cardId) => !retainedSet.has(cardId))];
      return next.length === current.length && next.every((cardId, index) => cardId === current[index])
        ? current
        : next;
    });
  }, [game]);

  useEffect(() => {
    if (!game?.lastAction.shuffle) {
      setShuffleEffect(null);
      return;
    }

    setShuffleEffect({ type: game.lastAction.shuffle, version: game.version });
    const timeout = window.setTimeout(() => setShuffleEffect(null), 1_650);
    return () => window.clearTimeout(timeout);
  }, [game]);

  useEffect(() => {
    const action = game?.lastAction;
    if (!game || !action) {
      setTableEffect(null);
      return;
    }

    if (action.type === "call-uno" || action.declaredUno) {
      setTableEffect({ type: "uno", playerId: action.playerId, version: game.version });
    } else if (action.type === "catch-uno") {
      setTableEffect({
        type: "catch",
        playerId: action.playerId,
        targetPlayerId: action.targetPlayerId ?? null,
        amount: action.amount ?? 2,
        version: game.version,
      });
    } else {
      setTableEffect(null);
      return;
    }

    const timeout = window.setTimeout(() => setTableEffect(null), 1_800);
    return () => window.clearTimeout(timeout);
  }, [game]);

  if (!session || session.roomCode !== roomCode) return <Navigate replace to={`/?room=${roomCode}`} />;
  if (room?.code === roomCode && room.phase === "lobby") {
    return <Navigate replace to={`/lobby/${roomCode}`} />;
  }
  if (!room || room.code !== roomCode || !game) {
    return (
      <main className="page status-page">
        <p className="eyebrow">ROOM {roomCode}</p>
        <h2>{connected ? "正在恢復牌桌…" : "正在重新連線…"}</h2>
      </main>
    );
  }
  const me = room.players.find((player) => player.id === session.playerId);
  const gameMe = game.players.find((player) => player.id === session.playerId);
  const selectedCard = game.hand.find((card) => card.id === selectedCardId) ?? null;
  const handById = new Map(game.hand.map((card) => [card.id, card]));
  const orderedIdSet = new Set(handOrder);
  const orderedHand = [
    ...handOrder.flatMap((cardId) => {
      const orderedCard = handById.get(cardId);
      return orderedCard ? [orderedCard] : [];
    }),
    ...game.hand.filter((card) => !orderedIdSet.has(card.id)),
  ];
  const paused = !connected;
  const isBotManaged = me?.isBotManaged ?? false;
  const isMyTurn = game.currentPlayerId === session.playerId;
  const isPlayingTurn = !paused && !isBotManaged && isMyTurn && game.phase === "playing" && game.currentColor !== null;
  const selectedCardPlayable = selectedCard !== null &&
    isPlayingTurn &&
    (!game.drawnCardId || game.drawnCardId === selectedCard.id) &&
    isCardPlayable(selectedCard, game.topDiscard, game.currentColor!);
  const draggingCard = game.hand.find((card) => card.id === draggingCardId) ?? null;
  const draggingCardPlayable = draggingCard !== null &&
    isPlayingTurn &&
    (!game.drawnCardId || game.drawnCardId === draggingCard.id) &&
    isCardPlayable(draggingCard, game.topDiscard, game.currentColor!);
  const canDraw = isPlayingTurn && game.drawnCardId === null;
  const canPass = isPlayingTurn && game.drawnCardId !== null;
  const canCallUno = !paused && !isBotManaged && game.unoVulnerablePlayerId === session.playerId;
  const canCatchUno = !paused && !isBotManaged && game.unoVulnerablePlayerId !== null && !canCallUno;
  const isDrawFourTarget = !paused && !isBotManaged && game.phase === "awaiting-draw-four-challenge" &&
    game.pendingDrawFour?.targetId === session.playerId;
  const shouldChooseStartingColor = !paused && !isBotManaged && game.currentColor === null && isMyTurn && game.phase === "playing";

  function run(send: (done: (response: GameActionResponse) => void) => void) {
    setBusy(true);
    onError("");
    send((response) => {
      setBusy(false);
      if (!response.ok) onError(response.error.message);
    });
  }

  function toggleBotControl() {
    setBusy(true);
    onError("");
    socket.emit(
      "game:bot-control",
      { enabled: !isBotManaged, requestId: requestId() },
      (response: RoomActionResponse) => {
        setBusy(false);
        if (!response.ok) onError(response.error.message);
      },
    );
  }

  function submitCard(card: Card, color?: CardColor, withUno = false) {
    run(
      (done) => socket.emit("game:play-card", {
        cardId: card.id,
        requestId: requestId(),
        ...(color ? { chosenColor: color } : {}),
        ...(withUno ? { declareUno: true } : {}),
      }, done),
    );
    setChoosingColor(false);
  }

  function submitSelectedCard(color?: CardColor) {
    if (selectedCard) submitCard(selectedCard, color, declareUno);
  }

  function isPlayableNow(card: Card): boolean {
    return isPlayingTurn &&
      (!game!.drawnCardId || game!.drawnCardId === card.id) &&
      isCardPlayable(card, game!.topDiscard, game!.currentColor!);
  }

  function playCardShortcut(card: Card) {
    if (busy || !isPlayableNow(card)) return;
    setSelectedCardId(card.id);
    if (card.color === null) {
      setChoosingColor(true);
    } else {
      submitCard(card, undefined, declareUno && selectedCardId === card.id);
    }
  }

  function playSelected() {
    if (!selectedCard || !selectedCardPlayable) return;
    if (selectedCard.color === null) setChoosingColor(true);
    else submitSelectedCard();
  }

  function normalizedOrder(current: string[]): string[] {
    const handIds = game!.hand.map((card) => card.id);
    const handIdSet = new Set(handIds);
    const retained = current.filter((cardId) => handIdSet.has(cardId));
    const retainedSet = new Set(retained);
    return [...retained, ...handIds.filter((cardId) => !retainedSet.has(cardId))];
  }

  function moveCard(cardId: string, targetCardId: string) {
    if (cardId === targetCardId) return;
    setHandOrder((current) => {
      const next = normalizedOrder(current);
      const sourceIndex = next.indexOf(cardId);
      const targetIndex = next.indexOf(targetCardId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, cardId);
      return next;
    });
  }

  function moveSelected(offset: -1 | 1) {
    if (!selectedCardId) return;
    const selectedIndex = orderedHand.findIndex((card) => card.id === selectedCardId);
    const target = orderedHand[selectedIndex + offset];
    if (target) moveCard(selectedCardId, target.id);
  }

  function sortHand() {
    setHandOrder([...game!.hand].sort(compareCards).map((card) => card.id));
  }

  function chooseStartingColor(color: CardColor) {
    run((done) => socket.emit("game:choose-color", { color, requestId: requestId() }, done));
  }

  function rematch() {
    setBusy(true);
    onError("");
    socket.emit("game:rematch", { requestId: requestId() }, (response) => {
      setBusy(false);
      if (!response.ok) onError(response.error.message);
    });
  }

  return (
    <main className="game-page">
      <header className="game-header">
        <div className="game-room-mark">
          <span>ROOM</span>
          <strong>{room.code}</strong>
        </div>
        <div className={`turn-banner ${isMyTurn ? "is-mine" : ""}`} aria-live="polite">
          <span className={`color-indicator ${game.currentColor ? `color-${game.currentColor}` : "color-wild"}`} />
          <div>
            <small>{game.direction === 1 ? "往下 ↓" : "往上 ↑"} · 目前顏色</small>
            <strong>{isMyTurn && isBotManaged ? "機器人正在代管" : isMyTurn ? "輪到你了" : `等待 ${playerName(room, game.currentPlayerId)}`}</strong>
          </div>
        </div>
        <button className="text-button" onClick={onLeave} type="button">離開牌桌</button>
      </header>

      {tableEffect?.type === "uno" && (
        <div aria-live="assertive" className="uno-shout-effect" key={tableEffect.version} role="status">
          <div aria-hidden="true" className="uno-shout-burst" />
          <div className="uno-shout-copy">
            <span>UNO!</span>
            <small>{playerName(room, tableEffect.playerId)} 喊出 UNO</small>
          </div>
        </div>
      )}

      {tableEffect?.type === "catch" && (
        <div aria-live="assertive" className="uno-catch-effect" key={tableEffect.version} role="status">
          <div aria-hidden="true" className="uno-catch-lines" />
          <div className="uno-catch-copy">
            <span>抓到了!</span>
            <strong>+{tableEffect.amount}</strong>
            <small>{playerName(room, tableEffect.targetPlayerId)} 漏喊 UNO</small>
          </div>
        </div>
      )}

      <aside aria-label="玩家出牌順序" className="player-order-panel">
        <header>
          <span>TURN ORDER</span>
          <strong>出牌順序</strong>
        </header>
        <ol>
          {room.players.map((player, index) => {
            const publicPlayer = game.players.find((candidate) => candidate.id === player.id);
            const active = game.currentPlayerId === player.id;
            return (
              <li
                aria-current={active ? "step" : undefined}
                className={`${active ? "is-active" : ""} ${player.id === session.playerId ? "is-me" : ""} ${!player.isConnected && !player.isBotManaged ? "is-offline" : ""} ${player.isBotManaged ? "is-managed" : ""}`}
                key={player.id}
              >
                <span className="turn-order-number">{String(index + 1).padStart(2, "0")}</span>
                <div className="turn-order-player">
                  <strong>
                    {player.nickname}
                    {player.id === session.playerId && <small className="self-badge">你</small>}
                    {player.isBot && <small className="bot-badge">BOT</small>}
                    {player.isBotManaged && <small className="bot-badge managed-badge">代管</small>}
                  </strong>
                  <span>{active ? "目前回合" : player.isBotManaged ? "機器人代管" : !player.isConnected ? "連線中斷" : "等待中"}</span>
                </div>
                <strong className="turn-order-cards">{publicPlayer?.handCount ?? 0}<small>張</small></strong>
              </li>
            );
          })}
        </ol>
      </aside>

      <div className="game-main">
      <section className="table-shell">
        <div
          aria-label={canPass ? "牌桌，雙擊可保留抽到的牌並結束回合" : "UNO 牌桌"}
          className={`felt-table ${draggingCardPlayable ? "is-drop-target" : ""} ${tableDragActive ? "is-drop-active" : ""}`}
          onDoubleClick={(event) => {
            if (!canPass || (event.target as Element).closest(".pile-zone")) return;
            run((done) => socket.emit("game:pass", { requestId: requestId() }, done));
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setTableDragActive(false);
            }
          }}
          onDragOver={(event) => {
            if (!draggingCardPlayable) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setTableDragActive(true);
          }}
          onDrop={(event) => {
            if (!draggingCardPlayable) return;
            event.preventDefault();
            const cardId = event.dataTransfer.getData("text/plain") || draggingCardId;
            const card = game.hand.find((candidate) => candidate.id === cardId);
            if (card) playCardShortcut(card);
            setDraggingCardId(null);
            setTableDragActive(false);
          }}
        >
          <div className="table-ring" />
          {draggingCardPlayable && (
            <div className="table-drop-hint">{tableDragActive ? "放開以出牌" : "拖到牌桌出牌"}</div>
          )}
          <div className="pile-zone">
            <button
              aria-label={`抽牌，牌庫剩餘 ${game.drawPileCount} 張`}
              className={`pile-button ${shuffleEffect !== null ? "is-reshuffling" : ""}`}
              disabled={!canDraw || busy}
              onClick={() => run((done) => socket.emit("game:draw-card", { requestId: requestId() }, done))}
              type="button"
            >
              <CardBack count={game.drawPileCount} />
              <span>抽牌</span>
            </button>
            <div className="discard-pile">
              <UnoCard card={game.topDiscard} />
              <span>棄牌堆</span>
            </div>
          </div>
          {shuffleEffect && (
            <div aria-live="polite" className="shuffle-notice" key={shuffleEffect.version} role="status">
              <strong>{shuffleEffect.type === "initial" ? "洗牌發牌" : "重新洗牌"}</strong>
              <span>{shuffleEffect.type === "initial" ? "新牌局準備開始" : "棄牌已洗回牌庫"}</span>
            </div>
          )}
          {canPass && <span className="table-pass-hint">雙擊牌桌 · 保留新牌並結束</span>}
          <p className="action-feed" aria-live="polite">
            <span>LAST MOVE</span>
            {actionMessage(game, room)}
          </p>
        </div>
      </section>

      <section className="hand-section" aria-label="你的手牌">
        <div className="hand-heading">
          <div>
            <span>YOUR HAND</span>
            <strong>{me?.nickname}</strong>
          </div>
          <div className="hand-tools">
            <p>{gameMe?.handCount ?? game.hand.length} 張牌</p>
            <button className="hand-sort-button" disabled={busy} onClick={sortHand} type="button">
              自動整理
            </button>
          </div>
        </div>
        <div className="hand-scroll">
          <div className="card-hand">
            {orderedHand.map((card) => {
              return (
                <UnoCard
                  card={card}
                  disabled={busy}
                  draggable={!busy}
                  dragging={draggingCardId === card.id}
                  key={card.id}
                  onClick={(event) => {
                    const isSameCard = card.id === selectedCardId;
                    setSelectedCardId(isSameCard ? null : card.id);
                    // Keep UNO armed through the two clicks that precede onDoubleClick.
                    if (event.detail === 1 && !isSameCard) setDeclareUno(false);
                  }}
                  onDragEnd={() => {
                    setDraggingCardId(null);
                    setTableDragActive(false);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDragStart={(event) => {
                    setDraggingCardId(card.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", card.id);
                  }}
                  onDoubleClick={() => playCardShortcut(card)}
                  onDrop={(event) => {
                    event.preventDefault();
                    const sourceCardId = event.dataTransfer.getData("text/plain") || draggingCardId;
                    if (sourceCardId) moveCard(sourceCardId, card.id);
                    setDraggingCardId(null);
                  }}
                  selected={card.id === selectedCardId}
                />
              );
            })}
          </div>
        </div>
      </section>
      </div>

      <aside className="player-actions-panel">
      <section aria-label="玩家行動紀錄" className="action-history-panel">
        <header>
          <span>ACTION LOG</span>
          <strong>玩家操作紀錄</strong>
        </header>
        <ol aria-live="polite">
          {[...game.actionHistory].reverse().map((entry) => (
            <li key={entry.version}>
              <span>{String(entry.version).padStart(2, "0")}</span>
              <p>{actionText(entry.action, room, entry.card)}</p>
            </li>
          ))}
        </ol>
      </section>

      <nav aria-label="遊戲操作" className="game-controls">
        <div className="selection-copy">
          <span>{isBotManaged ? "BOT CONTROL" : selectedCard ? "已選擇" : "選一張可出的牌"}</span>
          <strong>{isBotManaged ? "機器人代管中" : selectedCard ? cardLabel(selectedCard) : isMyTurn ? "你的回合" : "等待對手"}</strong>
        </div>
        {game.phase !== "finished" && (
          <button
            aria-pressed={isBotManaged}
            className={`bot-control-action ${isBotManaged ? "is-active" : ""}`}
            disabled={busy || !connected}
            onClick={toggleBotControl}
            type="button"
          >
            {isBotManaged ? "取回控制" : "機器人代管"}
          </button>
        )}
        {selectedCard && (
          <div className="reorder-actions" aria-label="調整手牌順序">
            <button
              className="reorder-action"
              disabled={orderedHand[0]?.id === selectedCard.id || busy}
              onClick={() => moveSelected(-1)}
              type="button"
            >
              左移
            </button>
            <button
              className="reorder-action"
              disabled={orderedHand.at(-1)?.id === selectedCard.id || busy}
              onClick={() => moveSelected(1)}
              type="button"
            >
              右移
            </button>
          </div>
        )}
        {selectedCardPlayable && game.hand.length === 2 && (
          <button
            aria-pressed={declareUno}
            className={`uno-action ${declareUno ? "is-armed" : ""}`}
            disabled={paused}
            onClick={() => setDeclareUno((value) => !value)}
            type="button"
          >
            {declareUno ? "已準備喊 UNO" : "一起喊 UNO"}
          </button>
        )}
        {canCallUno && (
          <button className="uno-action is-urgent" onClick={() => run((done) => socket.emit("game:call-uno", { requestId: requestId() }, done))} type="button">
            喊 UNO！
          </button>
        )}
        {canCatchUno && (
          <button className="catch-action" onClick={() => run((done) => socket.emit("game:catch-uno", { requestId: requestId() }, done))} type="button">
            抓漏喊 UNO
          </button>
        )}
        {canPass && (
          <button className="button secondary" disabled={busy} onClick={() => run((done) => socket.emit("game:pass", { requestId: requestId() }, done))} type="button">
            保留並結束
          </button>
        )}
        {canDraw && (
          <button className="button secondary" disabled={busy} onClick={() => run((done) => socket.emit("game:draw-card", { requestId: requestId() }, done))} type="button">
            抽一張牌
          </button>
        )}
        <button className="button primary play-action" disabled={!selectedCardPlayable || busy || paused} onClick={playSelected} type="button">
          {busy ? "處理中…" : "打出這張牌"}
        </button>
      </nav>
      </aside>

      {error && (
        <div className="game-toast is-error" role="alert">
          <strong>操作未完成</strong>
          <span>{error}</span>
          <button aria-label="關閉提示" onClick={() => onError("")} type="button">×</button>
        </div>
      )}

      {paused && (
        <div className="pause-backdrop" role="status">
          <section className="pause-panel">
            <p className="eyebrow">CONNECTION HOLD</p>
            <h2>正在重新連線</h2>
            <p>正在恢復你的座位與手牌，請不要關閉此頁。</p>
          </section>
        </div>
      )}

      {isDrawFourTarget && (
        <div className="dialog-backdrop">
          <section aria-labelledby="challenge-title" aria-modal="true" className="challenge-dialog" role="dialog">
            <div className="challenge-card"><span>+4</span></div>
            <p className="eyebrow">WILD DRAW FOUR</p>
            <h3 id="challenge-title">要質疑這張抽四嗎？</h3>
            <p>若對方出牌前持有目前顏色，質疑成功，對方抽四；否則你要抽六張。</p>
            <div className="challenge-actions">
              <button className="button secondary" disabled={busy} onClick={() => run((done) => socket.emit("game:challenge-draw-four", { challenge: false, requestId: requestId() }, done))} type="button">接受並抽四</button>
              <button className="button primary" disabled={busy} onClick={() => run((done) => socket.emit("game:challenge-draw-four", { challenge: true, requestId: requestId() }, done))} type="button">提出質疑</button>
            </div>
          </section>
        </div>
      )}

      {(choosingColor || shouldChooseStartingColor) && (
        <ColorDialog
          hand={game.hand}
          mode={shouldChooseStartingColor ? "start" : "play"}
          onChoose={shouldChooseStartingColor ? chooseStartingColor : submitSelectedCard}
          {...(!shouldChooseStartingColor ? { onClose: () => setChoosingColor(false) } : {})}
        />
      )}

      {game.phase === "finished" && (
        <div className="result-backdrop">
          <section className="result-panel">
            <p className="eyebrow">FINAL RESULT</p>
            <span className="result-kicker">{game.winnerId === session.playerId ? "VICTORY" : "GAME OVER"}</span>
            <h2>{game.winnerId === session.playerId ? "你贏了！" : `${playerName(room, game.winnerId)} 獲勝`}</h2>
            <p>本局共進行到狀態 #{game.version}。要不要再來一局？</p>
            <div className="result-actions">
              {me?.isHost && <button className="button primary" disabled={busy} onClick={rematch} type="button">再玩一局</button>}
              {!me?.isHost && <span>等待房主開啟下一局</span>}
              <button className="button secondary" onClick={onLeave} type="button">離開房間</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
