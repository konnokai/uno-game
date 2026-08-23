import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent } from "react";
import {
  isCardPlayable,
  isDrawCardStackable,
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
import { playGameSound, unlockGameAudio, type GameSound } from "./sound-effects";

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

interface CardMotion {
  key: string;
  type: "play" | "draw";
  card: Card | null;
  fromLeft: number;
  fromTop: number;
  toLeft: number;
  toTop: number;
  width: number;
  height: number;
  tilt: number;
}

function cardLabel(card: Card): string {
  const value = typeof card.value === "number" ? String(card.value) : VALUE_LABELS[card.value];
  return `${card.color ? COLOR_LABELS[card.color] : "萬用"} ${value}`;
}

function isMultiCardValue(value: Card["value"]): boolean {
  return typeof value === "number" || value === "skip" || value === "reverse" || value === "draw-two";
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

/** Places the local player at the bottom and distributes every seat around the table edge. */
function tableSeatPosition(index: number, selfIndex: number, count: number): CSSProperties {
  const relativeIndex = (index - selfIndex + count) % count;
  const angle = Math.PI / 2 + relativeIndex * Math.PI * 2 / count;
  return {
    left: `${50 + Math.cos(angle) * 37}%`,
    top: `${50 + Math.sin(angle) * 38}%`,
  };
}

function visibleRect(element: HTMLElement | null | undefined): DOMRect | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

/** Centers one card-sized overlay on the measured source and destination elements. */
function createCardMotion(
  key: string,
  type: CardMotion["type"],
  source: DOMRect,
  target: DOMRect,
  card: Card | null,
): CardMotion {
  const size = type === "play" ? target : source;
  const fromCenter = { x: source.left + source.width / 2, y: source.top + source.height / 2 };
  const toCenter = { x: target.left + target.width / 2, y: target.top + target.height / 2 };
  return {
    key,
    type,
    card,
    fromLeft: fromCenter.x - size.width / 2,
    fromTop: fromCenter.y - size.height / 2,
    toLeft: toCenter.x - size.width / 2,
    toTop: toCenter.y - size.height / 2,
    width: size.width,
    height: size.height,
    tilt: fromCenter.x <= toCenter.x ? 7 : -7,
  };
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
  elementRef,
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
  elementRef?: (element: HTMLElement | null) => void;
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
      <div aria-label={cardLabel(card)} className={className} ref={elementRef} role="img">
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
      ref={elementRef}
      type="button"
    >
      <span aria-hidden="true" className="card-corner">{cornerSymbol}</span>
      {centerSymbol}
      <span aria-hidden="true" className="card-corner card-corner-bottom">{cornerSymbol}</span>
    </button>
  );
}

function CardBack({ count, label = "牌庫", elementRef }: { count?: number; label?: string; elementRef?: (element: HTMLElement | null) => void }) {
  return (
    <div aria-label={label} className="uno-card card-back" ref={elementRef} role="img">
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
    case "play-card": return `${action.jumpIn ? `${actor} 搶牌打出` : `${actor} 打出`}${action.cardIds && action.cardIds.length > 1 ? ` ${action.cardIds.length} 張${card ? ` ${cardLabel(card)}` : "牌"}` : card ? ` ${cardLabel(card)}` : "一張牌"}${room.rulesMode === "taiwan" && room.rulesOptions.sevenZeroEnabled && card?.value === 7 && target !== "玩家" ? `，和 ${target} 交換手牌` : ""}${room.rulesMode === "taiwan" && room.rulesOptions.sevenZeroEnabled && card?.value === 0 ? "，全員傳遞手牌" : ""}${room.rulesMode === "taiwan" && room.rulesOptions.stackingEnabled && card?.value === "draw-two" && amount > 0 ? `，累積抽 ${amount} 張` : ""}${room.rulesMode === "taiwan" && room.rulesOptions.stackingEnabled && card?.value === "wild-draw-four" && amount > 4 ? `，累積抽 ${amount} 張` : ""}${action.declaredUno ? "，並喊了 UNO！" : ""}`;
    case "draw-card": return `${actor} 抽了 ${amount} 張牌`;
    case "pass": return `${actor} 保留新牌並結束回合`;
    case "call-uno": return `${actor} 喊了 UNO！`;
    case "catch-uno": return `${actor} 抓到 ${target} 漏喊 UNO，罰抽 ${amount} 張`;
    case "accept-draw-four": return `${actor} 接受抽四，需逐張抽 ${amount} 張`;
    case "challenge-draw-four":
      return action.successful
        ? `${actor} 質疑成功，出牌者需逐張抽 ${amount} 張`
        : `${actor} 質疑失敗，需逐張抽 ${amount} 張`;
  }
}

function actionMessage(game: GameSnapshot, room: RoomSnapshot): string {
  return actionText(game.lastAction, room, game.topDiscard);
}

function actionSoundKey(game: GameSnapshot): string {
  const action = game.lastAction;
  return [
    game.version,
    action.type,
    action.playerId,
    action.cardId,
    action.targetPlayerId,
    action.amount,
    action.declaredUno,
  ].join(":");
}

function soundsForAction(game: GameSnapshot): GameSound[] {
  const action = game.lastAction;
  switch (action.type) {
    case "play-card":
      return [
        game.topDiscard.value === "wild-draw-four" ? "wild-draw-four" : "play-card",
        ...(action.declaredUno ? ["uno" as const] : []),
      ];
    case "draw-card": return ["draw-card"];
    case "call-uno": return ["uno"];
    default: return [];
  }
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
        <h3 id="color-title">選擇接下來要用的顏色</h3>
        <p>{mode === "start" ? "你是起始玩家，先看看手上的牌，再決定顏色。" : "選色後會立即打出這張萬用牌。"}</p>
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

function TargetDialog({
  players,
  gamePlayers,
  currentPlayerId,
  onChoose,
  onClose,
}: {
  players: RoomSnapshot["players"];
  gamePlayers: GameSnapshot["players"];
  currentPlayerId: string;
  onChoose: (playerId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-labelledby="target-title" aria-modal="true" className="target-dialog" role="dialog">
        <p className="eyebrow">SEVEN SWAP</p>
        <h3 id="target-title">選擇交換手牌的玩家</h3>
        <p>出 7 後，你會和指定玩家交換手上的全部牌。</p>
        <div className="target-options">
          {players.filter((player) => player.id !== currentPlayerId).map((player) => {
            const handCount = gamePlayers.find((candidate) => candidate.id === player.id)?.handCount ?? 0;
            return (
              <button className="button secondary" key={player.id} onClick={() => onChoose(player.id)} type="button">
                <strong>{player.nickname}</strong>
                <small>{player.isBot ? "機器人" : "玩家"} · 剩餘 {handCount} 張牌</small>
              </button>
            );
          })}
        </div>
        <button className="text-button" onClick={onClose} type="button">返回手牌</button>
      </section>
    </div>
  );
}

export function GamePage({ connected, room, game, session, error, onError, onLeave }: GamePageProps) {
  const { roomCode = "" } = useParams();
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [choosingColor, setChoosingColor] = useState(false);
  const [choosingTarget, setChoosingTarget] = useState(false);
  const [declareUno, setDeclareUno] = useState(false);
  const [handOrder, setHandOrder] = useState<string[]>([]);
  const [automaticSorting, setAutomaticSorting] = useState(true);
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
  const [cardMotion, setCardMotion] = useState<CardMotion | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const audioState = useRef<{ key: string; phase: GameSnapshot["phase"] } | null>(null);
  const motionGameState = useRef<GameSnapshot | null>(null);
  const motionTimeout = useRef<number | null>(null);
  const pendingPlayOrigin = useRef<{ cardId: string; rect: DOMRect } | null>(null);
  const drawPileCard = useRef<HTMLElement | null>(null);
  const discardPileCard = useRef<HTMLElement | null>(null);
  const handArea = useRef<HTMLElement | null>(null);
  const handCards = useRef(new Map<string, HTMLElement>());
  const playerTargets = useRef(new Map<string, HTMLElement>());

  function setPlayerTarget(kind: "order" | "seat", playerId: string, element: HTMLElement | null): void {
    const key = `${kind}:${playerId}`;
    if (element) playerTargets.current.set(key, element);
    else playerTargets.current.delete(key);
  }

  function playerTargetRect(playerId: string): DOMRect | null {
    if (playerId === session?.playerId) {
      const handRect = visibleRect(handArea.current);
      if (handRect) return handRect;
    }
    return visibleRect(playerTargets.current.get(`seat:${playerId}`)) ??
      visibleRect(playerTargets.current.get(`order:${playerId}`));
  }

  useEffect(() => {
    const unlock = () => unlockGameAudio();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    const handIds = new Set(game?.hand.map((card) => card.id) ?? []);
    setSelectedCardIds((current) => current.filter((cardId) => handIds.has(cardId)));
    if (selectedCardId && !handIds.has(selectedCardId)) {
      setSelectedCardId(null);
      setDeclareUno(false);
      setChoosingColor(false);
      setChoosingTarget(false);
    }
  }, [game, selectedCardId]);

  useEffect(() => {
    if (!game) return;
    const handIds = automaticSorting
      ? [...game.hand].sort(compareCards).map((card) => card.id)
      : game.hand.map((card) => card.id);
    const handIdSet = new Set(handIds);
    setHandOrder((current) => {
      if (automaticSorting) {
        return handIds.length === current.length && handIds.every((cardId, index) => cardId === current[index])
          ? current
          : handIds;
      }
      const retained = current.filter((cardId) => handIdSet.has(cardId));
      const retainedSet = new Set(retained);
      const next = [...retained, ...handIds.filter((cardId) => !retainedSet.has(cardId))];
      return next.length === current.length && next.every((cardId, index) => cardId === current[index])
        ? current
        : next;
    });
  }, [automaticSorting, game]);

  useEffect(() => () => {
    if (motionTimeout.current !== null) window.clearTimeout(motionTimeout.current);
  }, []);

  useEffect(() => {
    if (!game) {
      motionGameState.current = null;
      setCardMotion(null);
      return;
    }

    const previous = motionGameState.current;
    motionGameState.current = game;
    if (!previous || previous.version >= game.version) return;

    const action = game.lastAction;
    let nextMotion: CardMotion | null = null;
    if (action.type === "play-card" && action.playerId) {
      const localOrigin = pendingPlayOrigin.current;
      const source = action.playerId === session?.playerId && localOrigin !== null && localOrigin.cardId === action.cardId
        ? localOrigin.rect
        : playerTargetRect(action.playerId);
      const target = visibleRect(discardPileCard.current);
      if (source && target) {
        nextMotion = createCardMotion(`${game.version}:play`, "play", source, target, game.topDiscard);
      }
      if (action.playerId === session?.playerId) pendingPlayOrigin.current = null;
    } else if (action.type === "draw-card" && action.playerId && (action.amount ?? 0) > 0) {
      const source = visibleRect(drawPileCard.current);
      const previousIds = new Set(previous.hand.map((card) => card.id));
      const newCard = action.playerId === session?.playerId
        ? game.hand.find((card) => !previousIds.has(card.id))
        : undefined;
      const target = newCard
        ? visibleRect(handCards.current.get(newCard.id)) ?? playerTargetRect(action.playerId)
        : playerTargetRect(action.playerId);
      if (source && target) {
        nextMotion = createCardMotion(`${game.version}:draw`, "draw", source, target, null);
      }
    }

    if (!nextMotion) return;
    if (motionTimeout.current !== null) window.clearTimeout(motionTimeout.current);
    setCardMotion(nextMotion);
    motionTimeout.current = window.setTimeout(() => setCardMotion(null), 620);
  }, [game, session?.playerId]);

  useEffect(() => {
    if (game?.turnDeadlineAt === null || game?.turnDeadlineAt === undefined) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [game?.turnDeadlineAt]);

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

  useEffect(() => {
    if (!game) {
      audioState.current = null;
      return;
    }

    const key = actionSoundKey(game);
    const previous = audioState.current;
    audioState.current = { key, phase: game.phase };
    if (!previous || previous.key === key) return;

    for (const sound of soundsForAction(game)) playGameSound(sound);
    if (previous.phase !== "finished" && game.phase === "finished") {
      window.setTimeout(() => playGameSound("victory"), 240);
    }
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
  const selfPlayerIndex = Math.max(0, room.players.findIndex((player) => player.id === session.playerId));
  const gameMe = game.players.find((player) => player.id === session.playerId);
  const selectedCard = game.hand.find((card) => card.id === selectedCardId) ?? null;
  const selectedCards = selectedCardIds
    .map((cardId) => game.hand.find((card) => card.id === cardId))
    .filter((card): card is Card => card !== undefined);
  const handById = new Map(game.hand.map((card) => [card.id, card]));
  const orderedIdSet = new Set(handOrder);
  const orderedHand = automaticSorting
    ? [...game.hand].sort(compareCards)
    : [
        ...handOrder.flatMap((cardId) => {
          const orderedCard = handById.get(cardId);
          return orderedCard ? [orderedCard] : [];
        }),
        ...game.hand.filter((card) => !orderedIdSet.has(card.id)),
      ];
  const paused = !connected;
  const isBotManaged = me?.isBotManaged ?? false;
  const isMyTurn = game.currentPlayerId === session.playerId;
  const isTaiwanRules = game.rulesMode === "taiwan";
  const isPlayingTurn = !paused && !isBotManaged && isMyTurn && game.phase === "playing" && game.currentColor !== null;
  const isDrawFourTarget = !paused && !isBotManaged && game.phase === "awaiting-draw-four-challenge" &&
    game.pendingDrawFour?.targetId === session.playerId;
  const stackableDrawCard = isDrawFourTarget && isTaiwanRules && game.pendingDrawType !== null
    ? game.hand.find((card) => isDrawCardStackable(game.pendingDrawType, card.value, game.rulesOptions))
    : undefined;
  const canStackDrawCard = stackableDrawCard !== undefined;
  const canJumpIn = !paused && !isBotManaged && isTaiwanRules && game.rulesOptions.jumpInEnabled && !isMyTurn && game.phase === "playing" &&
    game.currentColor !== null && game.pendingDrawAmount === 0 &&
    game.hand.some((card) => card.color === game.topDiscard.color && card.value === game.topDiscard.value);

  function isPlayableNow(card: Card): boolean {
    if (canStackDrawCard) return card.value === stackableDrawCard?.value ||
      isDrawCardStackable(game!.pendingDrawType, card.value, game!.rulesOptions);
    if (isPlayingTurn) {
      return (!game!.hasDrawnThisTurn || game!.drawnCardId === card.id) &&
        (game!.pendingDrawAmount === 0
          ? isCardPlayable(card, game!.topDiscard, game!.currentColor!)
          : isDrawCardStackable(game!.pendingDrawType, card.value, game!.rulesOptions));
    }
    return canJumpIn && card.color === game!.topDiscard.color && card.value === game!.topDiscard.value;
  }

  const selectedCardPlayable = selectedCard !== null && isPlayableNow(selectedCard);
  const multiSelectEnabled = isPlayingTurn && isTaiwanRules && game.rulesOptions.multiCardPlayEnabled;
  const selectedBatchPlayable = selectedCards.length > 1 &&
    multiSelectEnabled &&
    isMultiCardValue(selectedCards[0]!.value) &&
    selectedCards.every((card) => card.value === selectedCards[0]!.value) &&
    selectedCards.every((card) => card.color !== null) &&
    isPlayableNow(selectedCards[0]!);
  const selectedPlayValid = selectedCards.length > 1 ? selectedBatchPlayable : selectedCardPlayable;
  const draggingCard = game.hand.find((card) => card.id === draggingCardId) ?? null;
  const draggingCardPlayable = draggingCard !== null && isPlayableNow(draggingCard);
  const mustContinueDrawing = isTaiwanRules && game.rulesOptions.drawToMatchEnabled &&
    game.hasDrawnThisTurn && game.drawnCardId === null && game.lastAction.type === "draw-card" &&
    (game.lastAction.amount ?? 0) > 0;
  const canDraw = isPlayingTurn && (!game.hasDrawnThisTurn || mustContinueDrawing);
  const canPass = isPlayingTurn && game.hasDrawnThisTurn && !mustContinueDrawing;
  const canCallUno = !paused && !isBotManaged && game.unoVulnerablePlayerId === session.playerId;
  const canCatchUno = !paused && !isBotManaged && game.unoVulnerablePlayerId !== null && !canCallUno;
  const shouldChooseStartingColor = !paused && !isBotManaged && game.currentColor === null && isMyTurn && game.phase === "playing";
  const turnRemainingSeconds = game.turnDeadlineAt === null
    ? null
    : Math.max(0, Math.ceil((game.turnDeadlineAt - now) / 1_000));

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

  function submitCard(
    card: Card,
    color?: CardColor,
    withUno = false,
    targetPlayerId?: string,
    additionalCardIds?: readonly string[],
  ) {
    const origin = visibleRect(handCards.current.get(card.id));
    if (origin) pendingPlayOrigin.current = { cardId: card.id, rect: origin };
    run(
      (done) => socket.emit("game:play-card", {
        cardId: card.id,
        requestId: requestId(),
        ...(color ? { chosenColor: color } : {}),
        ...(withUno ? { declareUno: true } : {}),
        ...(targetPlayerId ? { targetPlayerId } : {}),
        ...(additionalCardIds && additionalCardIds.length > 0 ? { additionalCardIds: [...additionalCardIds] } : {}),
      }, done),
    );
    setChoosingColor(false);
    setChoosingTarget(false);
  }

  function submitSelectedCard(color?: CardColor) {
    if (selectedCard && selectedCards.length === 1) submitCard(selectedCard, color, declareUno);
  }

  function playCardShortcut(card: Card) {
    if (busy || !isPlayableNow(card)) return;
    setSelectedCardId(card.id);
    setSelectedCardIds([card.id]);
    if (card.value === 7 && isTaiwanRules && game!.rulesOptions.sevenZeroEnabled) {
      setChoosingTarget(true);
    } else if (card.color === null) {
      setChoosingColor(true);
    } else {
      submitCard(card, undefined, declareUno);
    }
  }

  function playSelected() {
    if (!selectedCard || !selectedPlayValid) return;
    if (selectedCards.length > 1) {
      if (selectedCards[0]!.value === 7 && isTaiwanRules && game!.rulesOptions.sevenZeroEnabled) {
        setChoosingTarget(true);
        return;
      }
      submitCard(selectedCards[0]!, undefined, declareUno, undefined, selectedCards.slice(1).map((card) => card.id));
      return;
    }
    if (selectedCard.value === 7 && isTaiwanRules && game!.rulesOptions.sevenZeroEnabled) setChoosingTarget(true);
    else if (selectedCard.color === null) setChoosingColor(true);
    else submitSelectedCard();
  }

  function chooseTarget(targetPlayerId: string) {
    if (selectedCard) submitCard(
      selectedCard,
      undefined,
      declareUno,
      targetPlayerId,
      selectedCards.length > 1 ? selectedCards.slice(1).map((card) => card.id) : undefined,
    );
  }

  function stackDrawCard() {
    const card = stackableDrawCard;
    if (!card) return;
    setSelectedCardId(card.id);
    setSelectedCardIds([card.id]);
    if (card.value === "wild-draw-four") setChoosingColor(true);
    else submitCard(card, undefined, declareUno);
  }

  function selectCard(card: Card) {
    if (!multiSelectEnabled || !isMultiCardValue(card.value)) {
      const isSameCard = card.id === selectedCardId;
      setSelectedCardId(isSameCard ? null : card.id);
      setSelectedCardIds(isSameCard ? [] : [card.id]);
      return;
    }

    const alreadySelected = selectedCardIds.includes(card.id);
    if (alreadySelected) {
      const nextIds = selectedCardIds.filter((cardId) => cardId !== card.id);
      setSelectedCardIds(nextIds);
      setSelectedCardId(nextIds[0] ?? null);
      return;
    }

    const firstSelected = selectedCards[0];
    if (firstSelected && (firstSelected.value !== card.value || !isMultiCardValue(firstSelected.value))) {
      setSelectedCardIds([card.id]);
      setSelectedCardId(card.id);
      return;
    }
    const nextIds = [...selectedCardIds, card.id];
    setSelectedCardIds(nextIds);
    setSelectedCardId(nextIds[0] ?? card.id);
  }

  function normalizedOrder(current: string[]): string[] {
    const handIds = game!.hand.map((card) => card.id);
    const handIdSet = new Set(handIds);
    const retained = current.filter((cardId) => handIdSet.has(cardId));
    const retainedSet = new Set(retained);
    return [...retained, ...handIds.filter((cardId) => !retainedSet.has(cardId))];
  }

  function moveCard(cardId: string, targetCardId: string) {
    if (automaticSorting || cardId === targetCardId) return;
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
          <small>{isTaiwanRules ? "台灣玩法" : "經典規則"}</small>
        </div>
        <div className={`turn-banner ${isMyTurn ? "is-mine" : ""}`} aria-live="polite">
          <span className={`color-indicator ${game.currentColor ? `color-${game.currentColor}` : "color-wild"}`} />
          <div>
            <small>
              {turnRemainingSeconds === null ? "未啟動倒數" : `剩餘 ${turnRemainingSeconds} 秒`}
              {` · ${game.direction === 1 ? "往下 ↓" : "往上 ↑"} · 目前顏色`}
            </small>
            <strong>{isMyTurn && isBotManaged ? "機器人正在代管" : isMyTurn ? "輪到你了" : canJumpIn ? "可以搶牌" : `等待 ${playerName(room, game.currentPlayerId)}`}</strong>
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
            <span>抓到了！</span>
            <strong>+{tableEffect.amount}</strong>
            <small>{playerName(room, tableEffect.targetPlayerId)} 漏喊 UNO</small>
          </div>
        </div>
      )}

      {cardMotion && (
        <div
          aria-hidden="true"
          className={`card-motion is-${cardMotion.type}`}
          key={cardMotion.key}
          style={{
            "--motion-from-left": `${cardMotion.fromLeft}px`,
            "--motion-from-top": `${cardMotion.fromTop}px`,
            "--motion-to-left": `${cardMotion.toLeft}px`,
            "--motion-to-top": `${cardMotion.toTop}px`,
            "--motion-width": `${cardMotion.width}px`,
            "--motion-height": `${cardMotion.height}px`,
            "--motion-tilt": `${cardMotion.tilt}deg`,
          } as CSSProperties}
        >
          {cardMotion.card ? <UnoCard card={cardMotion.card} /> : <CardBack label="抽出的牌" />}
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
                ref={(element) => setPlayerTarget("order", player.id, element)}
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
          aria-label={canPass
            ? game.drawnCardId ? "牌桌，雙擊可保留抽到的牌並結束回合" : "牌桌，雙擊可結束抽牌回合"
            : "UNO 牌桌"}
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
          <ol aria-label="牌桌座位" className="desktop-player-seats">
            {room.players.map((player, index) => {
              const publicPlayer = game.players.find((candidate) => candidate.id === player.id);
              const active = game.currentPlayerId === player.id;
              return (
                <li
                  aria-current={active ? "step" : undefined}
                  className={`${active ? "is-active" : ""} ${player.id === session.playerId ? "is-me" : ""} ${!player.isConnected && !player.isBotManaged ? "is-offline" : ""}`}
                  key={player.id}
                  ref={(element) => setPlayerTarget("seat", player.id, element)}
                  style={tableSeatPosition(index, selfPlayerIndex, room.players.length)}
                >
                  <span className="table-seat-number">{String(index + 1).padStart(2, "0")}</span>
                  <span className="table-seat-player">
                    <strong>{player.nickname}</strong>
                    <small>{active ? "目前回合" : player.isBotManaged ? "機器人代管" : !player.isConnected ? "連線中斷" : player.id === session.playerId ? "你的座位" : "等待中"}</small>
                  </span>
                  <strong className="table-seat-cards">{publicPlayer?.handCount ?? 0}<small>張</small></strong>
                </li>
              );
            })}
          </ol>
          {draggingCardPlayable && (
            <div className="table-drop-hint">{tableDragActive ? "放開即可出牌" : "把牌拖到牌桌上出牌"}</div>
          )}
          <div className="pile-zone">
            <button
              aria-label={`抽牌，牌庫剩餘 ${game.drawPileCount} 張`}
              className={`pile-button ${shuffleEffect !== null ? "is-reshuffling" : ""}`}
              disabled={!canDraw || busy}
              onClick={() => run((done) => socket.emit("game:draw-card", { requestId: requestId() }, done))}
              type="button"
            >
              <CardBack count={game.drawPileCount} elementRef={(element) => { drawPileCard.current = element; }} />
              <span>抽牌</span>
            </button>
            <div className="discard-pile">
              <UnoCard card={game.topDiscard} elementRef={(element) => { discardPileCard.current = element; }} />
              <span>棄牌堆</span>
            </div>
          </div>
          {shuffleEffect && (
            <div aria-live="polite" className="shuffle-notice" key={shuffleEffect.version} role="status">
              <strong>{shuffleEffect.type === "initial" ? "洗牌並發牌" : "重新洗牌"}</strong>
              <span>{shuffleEffect.type === "initial" ? "新牌局準備開始" : "棄牌已洗回牌庫"}</span>
            </div>
          )}
          {canPass && <span className="table-pass-hint">{game.drawnCardId ? "雙擊牌桌 · 保留新牌並結束" : "雙擊牌桌 · 結束抽牌回合"}</span>}
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
            <button
              aria-pressed={automaticSorting}
              className="hand-sort-button"
              disabled={busy}
              onClick={() => setAutomaticSorting((enabled) => !enabled)}
              type="button"
            >
              {automaticSorting ? "自動整理" : "手動整理"}
            </button>
          </div>
        </div>
        <div className="hand-scroll">
          <div className="card-hand" ref={(element) => { handArea.current = element; }}>
            {orderedHand.map((card) => {
              return (
                <UnoCard
                  card={card}
                  disabled={busy}
                  draggable={!busy && !automaticSorting}
                  dragging={draggingCardId === card.id}
                  elementRef={(element) => {
                    if (element) handCards.current.set(card.id, element);
                    else handCards.current.delete(card.id);
                  }}
                  key={card.id}
                  onClick={() => selectCard(card)}
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
                  selected={selectedCardIds.includes(card.id)}
                />
              );
            })}
          </div>
        </div>
      </section>
      </div>

      <aside className="player-actions-panel">
      <details aria-label="玩家行動紀錄" className="action-history-panel" open>
        <summary>
          <span className="action-history-title">
            <span>ACTION LOG</span>
            <strong>玩家操作紀錄</strong>
          </span>
          <span aria-hidden="true" className="action-history-toggle" />
        </summary>
        <ol aria-live="polite">
          {[...game.actionHistory].reverse().map((entry) => (
            <li key={entry.version}>
              <span>{String(entry.version).padStart(2, "0")}</span>
              <p>{actionText(entry.action, room, entry.card)}</p>
            </li>
          ))}
        </ol>
      </details>

      <nav aria-label="遊戲操作" className="game-controls">
        <div className="selection-copy">
          <span>{isBotManaged ? "BOT CONTROL" : selectedCards.length > 1 ? `已選擇 ${selectedCards.length} 張` : selectedCard ? "已選擇" : canJumpIn ? "JUMP-IN" : "選一張可出的牌"}</span>
          <strong>{isBotManaged ? "機器人代管中" : selectedCards.length > 1 ? cardLabel(selectedCards[0]!) : selectedCard ? cardLabel(selectedCard) : canJumpIn ? "可以搶牌" : isMyTurn ? "你的回合" : "等待對手"}</strong>
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
        {selectedCard && !automaticSorting && (
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
        {selectedPlayValid && game.hand.length - selectedCards.length === 1 && (
          <button
            aria-pressed={declareUno}
            className={`uno-action ${declareUno ? "is-armed" : ""}`}
            disabled={paused}
            onClick={() => setDeclareUno((value) => !value)}
            type="button"
          >
            {declareUno ? "已準備喊 UNO" : "準備喊 UNO"}
          </button>
        )}
        {canCallUno && (
          <button className="uno-action is-urgent" onClick={() => run((done) => socket.emit("game:call-uno", { requestId: requestId() }, done))} type="button">
            喊 UNO！
          </button>
        )}
        {canCatchUno && (
          <button className="catch-action" onClick={() => run((done) => socket.emit("game:catch-uno", { requestId: requestId() }, done))} type="button">
            抓到漏喊 UNO
          </button>
        )}
         {canPass && (
           <button className="button secondary" disabled={busy} onClick={() => run((done) => socket.emit("game:pass", { requestId: requestId() }, done))} type="button">
             {game.drawnCardId ? "保留新牌並結束" : "結束回合"}
           </button>
         )}
         {canDraw && (
           <button className="button secondary" disabled={busy} onClick={() => run((done) => socket.emit("game:draw-card", { requestId: requestId() }, done))} type="button">
              {game.pendingDrawAmount > 0 ? `抽一張（還需 ${game.pendingDrawAmount} 張）` : isTaiwanRules && game.rulesOptions.drawToMatchEnabled ? "抽一張（直到能出）" : "抽一張牌"}
           </button>
         )}
         <button className="button primary play-action" disabled={!selectedPlayValid || busy || paused} onClick={playSelected} type="button">
           {busy ? "處理中…" : selectedCards.length > 1 ? `打出這 ${selectedCards.length} 張牌` : "打出這張牌"}
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
            <h3 id="challenge-title">{game.rulesOptions.drawFourChallengeEnabled ? "要質疑這張抽四嗎？" : "請接受這次抽四"}</h3>
            {game.pendingDrawFour && (
              <p className="challenge-color-note">
                <span className={`color-indicator color-${game.pendingDrawFour.chosenColor}`} />
                對方選擇：<strong>{COLOR_LABELS[game.pendingDrawFour.chosenColor]}</strong>
              </p>
            )}
            <p>{game.rulesOptions.drawFourChallengeEnabled
              ? game.pendingDrawAmount > 4
                ? `目前累積需抽 ${game.pendingDrawAmount} 張。`
                : "若對方出牌前手上有目前顏色的牌，質疑成功，對方抽四張；否則你要抽六張。"
              : "目前未開啟 +4 質疑，你要抽完累積張數並跳過回合。"}</p>
            <div className="challenge-actions">
              {canStackDrawCard && <button className="button secondary" disabled={busy} onClick={stackDrawCard} type="button">疊出 {stackableDrawCard?.value === "wild-draw-four" ? "+4" : "+2"}</button>}
              <button className="button secondary" disabled={busy} onClick={() => run((done) => socket.emit("game:challenge-draw-four", { challenge: false, requestId: requestId() }, done))} type="button">{`接受，逐張抽 ${game.pendingDrawAmount} 張`}</button>
              {game.rulesOptions.drawFourChallengeEnabled && <button className="button primary" disabled={busy} onClick={() => run((done) => socket.emit("game:challenge-draw-four", { challenge: true, requestId: requestId() }, done))} type="button">提出質疑</button>}
            </div>
          </section>
        </div>
      )}

      {choosingTarget && selectedCard?.value === 7 && (
        <TargetDialog
          currentPlayerId={session.playerId}
          gamePlayers={game.players}
          onChoose={chooseTarget}
          onClose={() => setChoosingTarget(false)}
          players={room.players}
        />
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
            <p>這局結束了。要不要再來一局？</p>
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
