import { createDeck, shuffleDeck } from "./deck.js";
import type {
  Card,
  CardColor,
  CardValue,
  GameRuleOptions,
  GameRulesMode,
  GamePlayer,
  GameState,
  PendingDrawType,
  PlayCardOptions,
  QueuedDrawPenalty,
  RandomSource,
  RuleErrorCode,
  RuleResult,
  StartGameOptions,
} from "./types.js";
import {
  CARD_COLORS,
  DEFAULT_GAME_RULES_MODE,
  DEFAULT_GAME_RULE_OPTIONS,
  MAX_GAME_PLAYERS,
  MIN_GAME_PLAYERS,
} from "./types.js";

function rejected(
  state: GameState,
  code: RuleErrorCode,
  message: string,
): RuleResult {
  return { ok: false, state, error: { code, message } };
}

function accepted(state: GameState): RuleResult {
  state.version += 1;
  return { ok: true, state };
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      hand: [...player.hand],
    })),
    drawPile: [...state.drawPile],
    discardPile: [...state.discardPile],
    rulesOptions: { ...state.rulesOptions },
    pendingDrawFour: state.pendingDrawFour
      ? { ...state.pendingDrawFour }
      : null,
    queuedDrawPenalty: state.queuedDrawPenalty
      ? { ...state.queuedDrawPenalty }
      : null,
    lastAction: { ...state.lastAction },
  };
}

function playerIndex(state: GameState, playerId: string): number {
  return state.players.findIndex((player) => player.id === playerId);
}

function isCardColor(value: unknown): value is CardColor {
  return CARD_COLORS.some((color) => color === value);
}

function isValidCard(card: Card): boolean {
  if (typeof card.id !== "string" || card.id.length === 0) {
    return false;
  }
  if (typeof card.value === "number") {
    return (
      Number.isInteger(card.value) &&
      card.value >= 0 &&
      card.value <= 9 &&
      isCardColor(card.color)
    );
  }
  if (card.value === "wild" || card.value === "wild-draw-four") {
    return card.color === null;
  }
  return (
    (card.value === "skip" ||
      card.value === "reverse" ||
      card.value === "draw-two") &&
    isCardColor(card.color)
  );
}

function currentPlayer(state: GameState): GamePlayer {
  const player = state.players[state.currentPlayerIndex];

  if (!player) {
    throw new RangeError("Game state has no current player");
  }

  return player;
}

export function nextPlayerIndex(
  state: Pick<GameState, "players" | "direction">,
  fromIndex: number,
  steps = 1,
): number {
  const count = state.players.length;
  return ((fromIndex + state.direction * steps) % count + count) % count;
}

function topDiscard(state: GameState): Card {
  const card = state.discardPile.at(-1);

  if (!card) {
    throw new RangeError("Game state has no discard card");
  }

  return card;
}

function refillDrawPile(state: GameState, random: RandomSource): boolean {
  if (state.drawPile.length > 0 || state.discardPile.length <= 1) {
    return false;
  }

  const currentDiscard = state.discardPile.at(-1);
  if (!currentDiscard) {
    return false;
  }

  state.drawPile = shuffleDeck(state.discardPile.slice(0, -1), random);
  state.discardPile = [currentDiscard];
  return true;
}

interface DrawCardsResult {
  cards: Card[];
  reshuffled: boolean;
}

function drawCards(
  state: GameState,
  targetIndex: number,
  amount: number,
  random: RandomSource,
): DrawCardsResult {
  const drawn: Card[] = [];
  let reshuffled = false;
  const target = state.players[targetIndex];

  if (!target) {
    throw new RangeError("Cannot draw cards for an unknown player");
  }

  for (let count = 0; count < amount; count += 1) {
    reshuffled = refillDrawPile(state, random) || reshuffled;
    const card = state.drawPile.pop();
    if (!card) {
      break;
    }
    target.hand.push(card);
    drawn.push(card);
  }

  return { cards: drawn, reshuffled };
}

function completeTurn(state: GameState, fromIndex: number, steps = 1): void {
  state.unoVulnerablePlayerId = null;
  state.hasDrawnThisTurn = false;
  state.drawnCardId = null;
  state.currentPlayerIndex = nextPlayerIndex(state, fromIndex, steps);
}

function isTaiwanRules(state: Pick<GameState, "rulesMode">): boolean {
  return state.rulesMode === "taiwan";
}

function isTaiwanRuleEnabled(
  state: Pick<GameState, "rulesMode" | "rulesOptions">,
  option: "sevenZeroEnabled" | "jumpInEnabled" | "drawToMatchEnabled",
): boolean {
  return isTaiwanRules(state) && state.rulesOptions[option];
}

function mustContinueDrawing(state: GameState): boolean {
  return isTaiwanRuleEnabled(state, "drawToMatchEnabled") &&
    state.hasDrawnThisTurn &&
    state.drawnCardId === null &&
    state.lastAction.type === "draw-card" &&
    (state.lastAction.amount ?? 0) > 0;
}

/**
 * Resolves whether the next penalty card is allowed by the selected Taiwan
 * stacking relation: same type, +4 over +2, or mixed.
 */
export function isDrawCardStackable(
  pendingType: PendingDrawType | null,
  nextValue: CardValue,
  rulesOptions: Pick<GameRuleOptions, "stackingEnabled" | "stackingMode">,
): boolean {
  if (!rulesOptions.stackingEnabled || pendingType === null) return false;
  const nextType = nextValue === "draw-two" || nextValue === "wild-draw-four"
    ? nextValue
    : null;
  if (nextType === null) return false;
  if (rulesOptions.stackingMode === "mixed") return true;
  if (rulesOptions.stackingMode === "draw-four-over-two") {
    return pendingType === "draw-two" || nextType === "wild-draw-four";
  }
  return pendingType === nextType;
}

function canStackPendingDraw(state: GameState, nextValue: CardValue): boolean {
  return isTaiwanRules(state) && isDrawCardStackable(
    state.pendingDrawType,
    nextValue,
    state.rulesOptions,
  );
}

function isMultiCardValue(value: CardValue): boolean {
  return typeof value === "number" ||
    value === "skip" ||
    value === "reverse" ||
    value === "draw-two";
}

function isJumpInMatch(card: Card, discard: Card): boolean {
  return card.color === discard.color && card.value === discard.value;
}

function canPlayFromHand(
  card: Card,
  hand: readonly Card[],
  discard: Card,
  currentColor: CardColor,
): boolean {
  return isCardPlayable(card, discard, currentColor) &&
    (card.value !== "wild-draw-four" || isWildDrawFourLegal(hand, currentColor, card.id));
}

function clearPendingDraw(state: GameState): void {
  state.pendingDrawAmount = 0;
  state.pendingDrawType = null;
  state.pendingDrawResumePlayerId = null;
  state.pendingWinnerId = null;
  state.queuedDrawPenalty = null;
}

/** Starts a penalty that the target must draw one click at a time. */
function beginPendingDraw(
  state: GameState,
  targetIndex: number,
  amount: number,
  type: PendingDrawType | null,
  resumeIndex: number,
  pendingWinnerId: string | null = null,
): void {
  const target = state.players[targetIndex];
  const resumePlayer = state.players[resumeIndex];
  if (!target || !resumePlayer) throw new RangeError("Draw penalty references an unknown player");
  state.currentPlayerIndex = targetIndex;
  state.pendingDrawAmount = amount;
  state.pendingDrawType = type;
  state.pendingDrawResumePlayerId = resumePlayer.id;
  state.pendingWinnerId = pendingWinnerId;
  state.hasDrawnThisTurn = false;
  state.drawnCardId = null;
  state.unoVulnerablePlayerId = null;
}

/** Restores an interrupted penalty or resumes the turn after its final card. */
function completePendingDraw(state: GameState): void {
  const resumePlayerId = state.pendingDrawResumePlayerId;
  const pendingWinnerId = state.pendingWinnerId;
  const queued = state.queuedDrawPenalty;
  clearPendingDraw(state);

  if (queued) {
    const targetIndex = playerIndex(state, queued.playerId);
    const resumeIndex = playerIndex(state, queued.resumePlayerId);
    if (targetIndex < 0 || resumeIndex < 0) throw new RangeError("Queued draw penalty references an unknown player");
    state.phase = queued.phase;
    beginPendingDraw(
      state,
      targetIndex,
      queued.amount,
      queued.type,
      resumeIndex,
      queued.pendingWinnerId,
    );
    return;
  }

  const resumeIndex = resumePlayerId ? playerIndex(state, resumePlayerId) : -1;
  if (resumeIndex < 0) throw new RangeError("Draw penalty has no valid resume player");
  state.currentPlayerIndex = resumeIndex;
  state.hasDrawnThisTurn = false;
  state.drawnCardId = null;
  if (pendingWinnerId) {
    state.phase = "finished";
    state.winnerId = pendingWinnerId;
  }
}

/** Updates UNO after card effects, including Taiwan hand exchanges and passes. */
function updateUnoStatus(
  state: GameState,
  player: GamePlayer,
  playerId: string,
  declareUno: boolean,
): void {
  state.unoVulnerablePlayerId = null;
  if (player.hand.length !== 1) return;
  if (declareUno) {
    state.lastAction.declaredUno = true;
  } else {
    state.unoVulnerablePlayerId = playerId;
  }
}

function validatePlayingTurn(state: GameState, playerId: string): RuleResult | null {
  if (state.phase !== "playing") {
    return rejected(state, "GAME_NOT_PLAYING", "The game is not accepting turn actions");
  }
  if (state.currentColor === null) {
    return rejected(
      state,
      "STARTING_COLOR_REQUIRED",
      "The starting wild color must be chosen first",
    );
  }
  if (currentPlayer(state).id !== playerId) {
    return rejected(state, "NOT_YOUR_TURN", "It is not this player's turn");
  }
  return null;
}

export function isCardPlayable(
  card: Card,
  discard: Card,
  currentColor: CardColor,
): boolean {
  return (
    card.color === null ||
    card.color === currentColor ||
    card.value === discard.value
  );
}

export function isWildDrawFourLegal(
  hand: readonly Card[],
  currentColor: CardColor,
  playedCardId?: string,
): boolean {
  return !hand.some(
    (card) => card.id !== playedCardId && card.color === currentColor,
  );
}

export function startGame(
  playerIds: readonly string[],
  options: StartGameOptions = {},
): GameState {
  if (playerIds.length < MIN_GAME_PLAYERS || playerIds.length > MAX_GAME_PLAYERS) {
    throw new RangeError(
      `UNO requires between ${MIN_GAME_PLAYERS} and ${MAX_GAME_PLAYERS} players`,
    );
  }
  if (new Set(playerIds).size !== playerIds.length) {
    throw new TypeError("Player IDs must be unique");
  }

  const random = options.random ?? Math.random;
  const handSize = options.handSize ?? 7;
  const rulesMode: GameRulesMode = options.rulesMode ?? DEFAULT_GAME_RULES_MODE;
  const rulesOptions: GameRuleOptions = {
    ...DEFAULT_GAME_RULE_OPTIONS,
    ...(options.rulesOptions ?? {}),
  };
  const drawPile = options.deck
    ? options.deck.map((card) => ({ ...card }))
    : shuffleDeck(createDeck(), random);
  const minimumCards = playerIds.length * handSize + 1;

  if (!Number.isInteger(handSize) || handSize < 1) {
    throw new RangeError("Hand size must be a positive integer");
  }
  if (drawPile.length < minimumCards) {
    throw new RangeError(`The deck must contain at least ${minimumCards} cards`);
  }
  if (new Set(drawPile.map((card) => card.id)).size !== drawPile.length) {
    throw new TypeError("Card IDs must be unique");
  }
  if (!drawPile.every(isValidCard)) {
    throw new TypeError("The deck contains an invalid card");
  }

  const players = playerIds.map((id) => ({ id, hand: [] as Card[] }));
  for (let count = 0; count < handSize; count += 1) {
    for (const player of players) {
      const card = drawPile.pop();
      if (!card) {
        throw new RangeError("The deck ran out while dealing");
      }
      player.hand.push(card);
    }
  }

  let initialCard = drawPile.pop();
  if (initialCard?.value === "wild-draw-four") {
    drawPile.push(initialCard);
    let validInitialIndex = drawPile.length - 1;
    while (
      validInitialIndex >= 0 &&
      drawPile[validInitialIndex]?.value === "wild-draw-four"
    ) {
      validInitialIndex -= 1;
    }
    if (validInitialIndex < 0) {
      throw new RangeError("The deck has no valid starting discard");
    }
    [initialCard] = drawPile.splice(validInitialIndex, 1);
    const shuffled = shuffleDeck(drawPile, random);
    drawPile.splice(0, drawPile.length, ...shuffled);
  }
  if (!initialCard) {
    throw new RangeError("The deck has no valid starting discard");
  }

  const state: GameState = {
    rulesMode,
    rulesOptions,
    players,
    drawPile,
    discardPile: [initialCard],
    currentColor: initialCard.color,
    currentPlayerIndex: 0,
    direction: 1,
    phase: "playing",
    hasDrawnThisTurn: false,
    drawnCardId: null,
    pendingDrawAmount: 0,
    pendingDrawType: null,
    pendingDrawResumePlayerId: null,
    pendingWinnerId: null,
    queuedDrawPenalty: null,
    unoVulnerablePlayerId: null,
    pendingDrawFour: null,
    winnerId: null,
    lastAction: {
      type: "start",
      playerId: null,
      cardId: initialCard.id,
      shuffle: "initial",
    },
    version: 1,
  };

  if (initialCard.value === "skip") {
    state.currentPlayerIndex = 1;
  } else if (initialCard.value === "reverse") {
    state.direction = -1;
    state.currentPlayerIndex = players.length - 1;
  } else if (initialCard.value === "draw-two") {
    beginPendingDraw(state, 0, 2, null, nextPlayerIndex(state, 0));
    state.lastAction.amount = 2;
  }

  return state;
}

export function chooseStartingColor(
  state: GameState,
  playerId: string,
  color: CardColor,
): RuleResult {
  if (!isCardColor(color)) {
    return rejected(state, "INVALID_COLOR", "The chosen color is invalid");
  }
  if (state.phase !== "playing") {
    return rejected(state, "GAME_NOT_PLAYING", "The game is not accepting turn actions");
  }
  if (state.currentColor !== null || topDiscard(state).value !== "wild") {
    return rejected(
      state,
      "COLOR_NOT_ALLOWED",
      "There is no starting wild color to choose",
    );
  }
  if (currentPlayer(state).id !== playerId) {
    return rejected(state, "NOT_YOUR_TURN", "Only the starting player can choose the color");
  }

  const next = cloneState(state);
  next.currentColor = color;
  next.lastAction = { type: "choose-color", playerId, chosenColor: color };
  return accepted(next);
}

/** Applies a permitted Taiwan draw-card stack before the accumulated penalty is resolved. */
function playStackedDrawCard(
  state: GameState,
  playerId: string,
  cardId: string,
  options: PlayCardOptions,
): RuleResult {
  const actingPlayerIndex = playerIndex(state, playerId);
  const player = state.players[actingPlayerIndex];
  const cardIndex = player?.hand.findIndex((card) => card.id === cardId) ?? -1;
  const card = cardIndex >= 0 ? player?.hand[cardIndex] : undefined;
  if (!player || cardIndex < 0 || !card) {
    return rejected(state, "CARD_NOT_IN_HAND", "The player does not own this card");
  }
  if (!canStackPendingDraw(state, card.value)) {
    return rejected(state, "CARD_NOT_PLAYABLE", "這張抽牌不能疊在目前的抽牌懲罰上");
  }
  if (options.targetPlayerId !== undefined) {
    return rejected(state, "INVALID_TARGET_PLAYER", "Only a 7 can choose an exchange target");
  }
  const isDrawFour = card.value === "wild-draw-four";
  if (isDrawFour && options.chosenColor === undefined) {
    return rejected(state, "COLOR_REQUIRED", "A color is required for a wild card");
  }
  if (!isDrawFour && options.chosenColor !== undefined) {
    return rejected(state, "COLOR_NOT_ALLOWED", "A color can only be chosen for a wild card");
  }
  if (options.chosenColor !== undefined && !isCardColor(options.chosenColor)) {
    return rejected(state, "INVALID_COLOR", "The chosen color is invalid");
  }

  const next = cloneState(state);
  const nextPlayer = next.players[actingPlayerIndex];
  const [playedCard] = nextPlayer!.hand.splice(cardIndex, 1);
  if (!playedCard) throw new RangeError("Card disappeared while stacking a draw card");

  const pendingWinnerId = state.pendingWinnerId ??
    state.pendingDrawFour?.pendingWinnerId ??
    (nextPlayer!.hand.length === 0 ? playerId : null);
  const wasLegal = isDrawFour && isWildDrawFourLegal(player.hand, state.currentColor!, cardId);
  next.discardPile.push(playedCard);
  next.currentColor = options.chosenColor ?? playedCard.color;
  const targetIndex = nextPlayerIndex(next, actingPlayerIndex);
  const amount = next.pendingDrawAmount + (isDrawFour ? 4 : 2);
  beginPendingDraw(
    next,
    targetIndex,
    amount,
    isDrawFour ? "wild-draw-four" : "draw-two",
    nextPlayerIndex(next, targetIndex),
    pendingWinnerId,
  );
  const target = next.players[targetIndex];
  if (!target) throw new RangeError("Stacked draw card has no target");
  next.phase = isDrawFour ? "awaiting-draw-four-challenge" : "playing";
  next.pendingDrawFour = isDrawFour
    ? {
        attackerId: playerId,
        targetId: target.id,
        wasLegal,
        pendingWinnerId,
      }
    : null;
  next.lastAction = {
    type: "play-card",
    playerId,
    cardId,
    ...(options.chosenColor ? { chosenColor: options.chosenColor } : {}),
    amount,
    ...(options.declareUno && nextPlayer!.hand.length === 1 ? { declaredUno: true } : {}),
  };
  if (!isDrawFour && nextPlayer!.hand.length === 0) {
    next.pendingDrawType = null;
  } else if (nextPlayer!.hand.length === 1 && !options.declareUno) {
    next.unoVulnerablePlayerId = playerId;
  }
  return accepted(next);
}

/** Plays same-value non-wild cards as one atomic Taiwan-mode action. */
function playMultipleCards(
  state: GameState,
  playerId: string,
  firstCardId: string,
  additionalCardIds: readonly string[],
  options: PlayCardOptions,
): RuleResult {
  if (state.rulesMode !== "taiwan" || !state.rulesOptions.multiCardPlayEnabled) {
    return rejected(state, "CARD_NOT_PLAYABLE", "目前規則未開啟同回合多張連出");
  }
  if (state.phase !== "playing") {
    return rejected(state, "GAME_NOT_PLAYING", "The game is not accepting turn actions");
  }
  const actingPlayerIndex = playerIndex(state, playerId);
  if (state.currentPlayerIndex !== actingPlayerIndex) {
    return rejected(state, "NOT_YOUR_TURN", "It is not this player's turn");
  }
  if (state.hasDrawnThisTurn) {
    return rejected(state, "MUST_PLAY_DRAWN_CARD", "抽牌後不能一次連出多張牌");
  }

  const cardIds = [firstCardId, ...additionalCardIds];
  if (new Set(cardIds).size !== cardIds.length || cardIds.length < 2) {
    return rejected(state, "CARD_NOT_PLAYABLE", "多張連出的牌不能重複");
  }
  const player = state.players[actingPlayerIndex];
  if (!player) return rejected(state, "PLAYER_NOT_IN_GAME", "The player is not in this game");

  const playedCards = cardIds.map((id) => player.hand.find((card) => card.id === id));
  if (playedCards.some((card) => !card)) {
    return rejected(state, "CARD_NOT_IN_HAND", "The player does not own this card");
  }
  const cards = playedCards as Card[];
  const firstCard = cards[0]!;
  if (!isMultiCardValue(firstCard.value) || cards.some((card) => card.value !== firstCard.value)) {
    return rejected(state, "CARD_NOT_PLAYABLE", "多張連出必須是相同數字或相同功能牌，且不能包含萬用牌");
  }

  const firstIsPlayable = state.pendingDrawAmount > 0
    ? canStackPendingDraw(state, firstCard.value)
    : isCardPlayable(firstCard, topDiscard(state), state.currentColor!);
  if (!firstIsPlayable) {
    return rejected(state, "CARD_NOT_PLAYABLE", "第一張牌不能接在目前牌面上");
  }
  if (options.chosenColor !== undefined) {
    return rejected(state, "COLOR_NOT_ALLOWED", "多張連出不能包含選色");
  }
  if (firstCard.value === 7 && isTaiwanRuleEnabled(state, "sevenZeroEnabled")) {
    if (!options.targetPlayerId) {
      return rejected(state, "TARGET_PLAYER_REQUIRED", "Choose a player to exchange hands with");
    }
    const targetIndex = playerIndex(state, options.targetPlayerId);
    if (targetIndex < 0 || targetIndex === actingPlayerIndex) {
      return rejected(state, "INVALID_TARGET_PLAYER", "Choose another player in this game");
    }
  } else if (options.targetPlayerId !== undefined) {
    return rejected(state, "INVALID_TARGET_PLAYER", "Only a 7 can choose an exchange target");
  }

  const next = cloneState(state);
  const nextPlayer = next.players[actingPlayerIndex]!;
  const playedIdSet = new Set(cardIds);
  nextPlayer.hand = nextPlayer.hand.filter((card) => !playedIdSet.has(card.id));
  next.discardPile.push(...cards.map((card) => ({ ...card })));
  next.currentColor = cards.at(-1)!.color;
  next.hasDrawnThisTurn = false;
  next.drawnCardId = null;
  next.lastAction = {
    type: "play-card",
    playerId,
    cardId: firstCardId,
    cardIds: [...cardIds],
    ...(options.targetPlayerId ? { targetPlayerId: options.targetPlayerId } : {}),
  };

  if (firstCard.value === 7 && isTaiwanRuleEnabled(next, "sevenZeroEnabled")) {
    const target = next.players[playerIndex(next, options.targetPlayerId!)];
    if (!target) throw new RangeError("Seven has no exchange target");
    [nextPlayer.hand, target.hand] = [target.hand, nextPlayer.hand];
  } else if (firstCard.value === 0 && isTaiwanRuleEnabled(next, "sevenZeroEnabled")) {
    const hands = next.players.map((candidate) => candidate.hand);
    next.players.forEach((candidate, index) => {
      candidate.hand = hands[nextPlayerIndex(next, index, -1)]!;
    });
  }

  const fromIndex = actingPlayerIndex;
  if (firstCard.value === "draw-two") {
    const targetIndex = nextPlayerIndex(next, fromIndex);
    const amount = next.pendingDrawAmount + 2 * cards.length;
    beginPendingDraw(
      next,
      targetIndex,
      amount,
      "draw-two",
      nextPlayerIndex(next, targetIndex),
    );
    next.lastAction.amount = amount;
  } else if (firstCard.value === "skip") {
    completeTurn(next, fromIndex, 2);
  } else if (firstCard.value === "reverse") {
    next.direction = next.direction === 1 ? -1 : 1;
    completeTurn(next, fromIndex, next.players.length === 2 ? 2 : 1);
  } else {
    completeTurn(next, fromIndex);
  }

  updateUnoStatus(next, nextPlayer, playerId, options.declareUno === true);
  if (nextPlayer.hand.length === 0) {
    if (next.pendingDrawAmount > 0) {
      next.pendingWinnerId = playerId;
      next.pendingDrawType = null;
    } else {
      next.phase = "finished";
      next.winnerId = playerId;
      clearPendingDraw(next);
    }
  }
  return accepted(next);
}

export function playCard(
  state: GameState,
  playerId: string,
  cardId: string,
  options: PlayCardOptions = {},
): RuleResult {
  if (options.additionalCardIds && options.additionalCardIds.length > 0) {
    return playMultipleCards(state, playerId, cardId, options.additionalCardIds, options);
  }
  if (
    state.rulesMode === "taiwan" &&
    state.phase === "awaiting-draw-four-challenge" &&
    state.pendingDrawFour?.targetId === playerId
  ) {
    return playStackedDrawCard(state, playerId, cardId, options);
  }

  const actingPlayerIndex = playerIndex(state, playerId);
  const player = state.players[actingPlayerIndex];
  const cardIndex = player?.hand.findIndex((card) => card.id === cardId) ?? -1;
  const card = cardIndex >= 0 ? player?.hand[cardIndex] : undefined;
  const isCurrentTurn = actingPlayerIndex === state.currentPlayerIndex;
  const isJumpIn = Boolean(
    !isCurrentTurn &&
    player &&
    card &&
    isTaiwanRuleEnabled(state, "jumpInEnabled") &&
    state.phase === "playing" &&
    state.currentColor !== null &&
    state.pendingDrawAmount === 0 &&
    isJumpInMatch(card, topDiscard(state)),
  );
  const turnError = validatePlayingTurn(state, playerId);
  if (turnError && !isJumpIn) {
    return turnError;
  }

  if (!player || cardIndex < 0 || !card) {
    return rejected(state, "CARD_NOT_IN_HAND", "The player does not own this card");
  }
  if (isCurrentTurn && state.hasDrawnThisTurn && state.drawnCardId !== cardId) {
    return rejected(
      state,
      "MUST_PLAY_DRAWN_CARD",
      "Only the card drawn this turn may be played",
    );
  }
  if (state.pendingDrawAmount > 0 && !canStackPendingDraw(state, card.value)) {
    return rejected(state, "CARD_NOT_PLAYABLE", "這張抽牌不能疊在目前的抽牌懲罰上");
  }
  if (!isJumpIn && !isCardPlayable(card, topDiscard(state), state.currentColor!)) {
    return rejected(state, "CARD_NOT_PLAYABLE", "The card cannot be played here");
  }
  if (isJumpIn && !isJumpInMatch(card, topDiscard(state))) {
    return rejected(state, "CARD_NOT_PLAYABLE", "Only an identical card can be used to jump in");
  }

  if (card.value === 7 && isTaiwanRuleEnabled(state, "sevenZeroEnabled")) {
    if (!options.targetPlayerId) {
      return rejected(state, "TARGET_PLAYER_REQUIRED", "Choose a player to exchange hands with");
    }
    const targetIndex = playerIndex(state, options.targetPlayerId);
    if (targetIndex < 0 || targetIndex === actingPlayerIndex) {
      return rejected(state, "INVALID_TARGET_PLAYER", "Choose another player in this game");
    }
  } else if (options.targetPlayerId !== undefined) {
    return rejected(state, "INVALID_TARGET_PLAYER", "Only a 7 can choose an exchange target");
  }

  const isWild = card.value === "wild" || card.value === "wild-draw-four";
  if (isWild && options.chosenColor === undefined) {
    return rejected(state, "COLOR_REQUIRED", "A color is required for a wild card");
  }
  if (!isWild && options.chosenColor !== undefined) {
    return rejected(
      state,
      "COLOR_NOT_ALLOWED",
      "A color can only be chosen for a wild card",
    );
  }
  if (options.chosenColor !== undefined && !isCardColor(options.chosenColor)) {
    return rejected(state, "INVALID_COLOR", "The chosen color is invalid");
  }

  const next = cloneState(state);
  if (isJumpIn) next.currentPlayerIndex = actingPlayerIndex;
  const nextPlayer = next.players[actingPlayerIndex];
  if (!nextPlayer) throw new RangeError("Player disappeared while applying a play");
  const [playedCard] = nextPlayer.hand.splice(cardIndex, 1);
  if (!playedCard) {
    throw new RangeError("Card disappeared while applying a play");
  }

  const previousColor = next.currentColor!;
  const wildDrawFourWasLegal = isWildDrawFourLegal(
    player.hand,
    previousColor,
    cardId,
  );
  next.discardPile.push(playedCard);
  next.currentColor = options.chosenColor ?? playedCard.color;
  next.hasDrawnThisTurn = false;
  next.drawnCardId = null;
  next.lastAction = {
    type: "play-card",
    playerId,
    cardId,
    ...(options.chosenColor ? { chosenColor: options.chosenColor } : {}),
    ...(options.targetPlayerId ? { targetPlayerId: options.targetPlayerId } : {}),
    ...(isJumpIn ? { jumpIn: true } : {}),
  };

  const fromIndex = actingPlayerIndex;

  if (playedCard.value === 7 && isTaiwanRuleEnabled(next, "sevenZeroEnabled")) {
    const targetIndex = playerIndex(next, options.targetPlayerId!);
    const target = next.players[targetIndex];
    if (!target) throw new RangeError("Seven has no exchange target");
    [nextPlayer.hand, target.hand] = [target.hand, nextPlayer.hand];
  } else if (playedCard.value === 0 && isTaiwanRuleEnabled(next, "sevenZeroEnabled")) {
    const hands = next.players.map((player) => player.hand);
    next.players.forEach((player, index) => {
      player.hand = hands[nextPlayerIndex(next, index, -1)]!;
    });
  }

  if (playedCard.value === "wild-draw-four") {
    const targetIndex = nextPlayerIndex(next, fromIndex);
    const target = next.players[targetIndex];
    if (!target) {
      throw new RangeError("Draw four has no target");
    }
    next.phase = "awaiting-draw-four-challenge";
    const amount = next.pendingDrawAmount + 4;
    beginPendingDraw(
      next,
      targetIndex,
      amount,
      "wild-draw-four",
      nextPlayerIndex(next, targetIndex),
    );
    next.lastAction.amount = amount;
    next.pendingDrawFour = {
      attackerId: playerId,
      targetId: target.id,
      wasLegal: wildDrawFourWasLegal,
      pendingWinnerId: nextPlayer.hand.length === 0 ? playerId : null,
    };
    updateUnoStatus(next, nextPlayer, playerId, options.declareUno === true);
    return accepted(next);
  }

  if (playedCard.value === "skip") {
    completeTurn(next, fromIndex, 2);
  } else if (playedCard.value === "reverse") {
    next.direction = next.direction === 1 ? -1 : 1;
    completeTurn(next, fromIndex, next.players.length === 2 ? 2 : 1);
  } else if (playedCard.value === "draw-two") {
    const targetIndex = nextPlayerIndex(next, fromIndex);
    const amount = next.pendingDrawAmount + 2;
    beginPendingDraw(
      next,
      targetIndex,
      amount,
      isTaiwanRules(next) ? "draw-two" : null,
      nextPlayerIndex(next, targetIndex),
    );
    next.lastAction.amount = amount;
  } else {
    completeTurn(next, fromIndex);
  }

  updateUnoStatus(next, nextPlayer, playerId, options.declareUno === true);
  if (nextPlayer.hand.length === 0) {
    if (next.pendingDrawAmount > 0) {
      next.pendingWinnerId = playerId;
      next.pendingDrawType = null;
    } else {
      next.phase = "finished";
      next.winnerId = playerId;
      clearPendingDraw(next);
    }
  }

  return accepted(next);
}

export function drawCard(
  state: GameState,
  playerId: string,
  random: RandomSource = Math.random,
): RuleResult {
  const turnError = validatePlayingTurn(state, playerId);
  if (turnError) {
    return turnError;
  }
  if (state.hasDrawnThisTurn && !mustContinueDrawing(state)) {
    return rejected(state, "ALREADY_DREW", "The player already drew this turn");
  }

  const next = cloneState(state);
  const drawingPenalty = next.pendingDrawAmount > 0;
  const drawResult = drawCards(next, next.currentPlayerIndex, 1, random);
  const drawn = drawResult.cards[0];
  next.lastAction = {
    type: "draw-card",
    playerId,
    amount: drawResult.cards.length,
    ...(drawResult.reshuffled ? { shuffle: "recycle" as const } : {}),
  };

  next.unoVulnerablePlayerId = null;
  if (drawingPenalty) {
    next.pendingDrawType = null;
    next.pendingDrawAmount = drawn ? next.pendingDrawAmount - 1 : 0;
    if (next.pendingDrawAmount === 0) completePendingDraw(next);
  } else {
    const canContinueDrawing = next.drawPile.length > 0 || next.discardPile.length > 1;
    const mustDrawAgain = isTaiwanRuleEnabled(next, "drawToMatchEnabled") &&
      drawn !== undefined &&
      !canPlayFromHand(drawn, currentPlayer(next).hand, topDiscard(next), next.currentColor!) &&
      canContinueDrawing;
    next.hasDrawnThisTurn = true;
    next.drawnCardId = mustDrawAgain ? null : drawn?.id ?? null;
  }

  return accepted(next);
}

export function passAfterDraw(state: GameState, playerId: string): RuleResult {
  const turnError = validatePlayingTurn(state, playerId);
  if (turnError) {
    return turnError;
  }
  if (!state.hasDrawnThisTurn) {
    return rejected(state, "NO_DRAWN_CARD", "請先抽牌，才能結束這個回合");
  }
  if (mustContinueDrawing(state)) {
    return rejected(state, "NO_DRAWN_CARD", "請繼續逐張抽牌，直到抽到可出的牌");
  }

  const next = cloneState(state);
  next.lastAction = { type: "pass", playerId };
  completeTurn(next, next.currentPlayerIndex);
  return accepted(next);
}

export function callUno(state: GameState, playerId: string): RuleResult {
  if (state.phase === "finished") {
    return rejected(state, "GAME_NOT_PLAYING", "The game has finished");
  }
  if (state.unoVulnerablePlayerId !== playerId) {
    return rejected(
      state,
      "NOT_UNO_VULNERABLE",
      "This player does not currently need to call UNO",
    );
  }

  const next = cloneState(state);
  next.unoVulnerablePlayerId = null;
  next.lastAction = { type: "call-uno", playerId };
  return accepted(next);
}

export function catchUno(
  state: GameState,
  catcherId: string,
): RuleResult {
  if (state.phase === "finished") {
    return rejected(state, "GAME_NOT_PLAYING", "The game has finished");
  }
  const offenderId = state.unoVulnerablePlayerId;
  if (offenderId === null) {
    return rejected(state, "NOT_UNO_VULNERABLE", "There is no player to catch");
  }
  if (offenderId === catcherId) {
    return rejected(state, "CANNOT_CATCH_SELF", "A player cannot catch themselves");
  }
  if (playerIndex(state, catcherId) < 0) {
    return rejected(
      state,
      "PLAYER_NOT_IN_GAME",
      "Only a player in the game can catch UNO",
    );
  }

  const offenderIndex = playerIndex(state, offenderId);
  if (offenderIndex < 0) {
    throw new RangeError("UNO offender is not in the game");
  }

  const next = cloneState(state);
  const interruptedPlayerId = currentPlayer(next).id;
  const interruptedPenalty: QueuedDrawPenalty | null = next.pendingDrawAmount > 0
    ? {
        playerId: interruptedPlayerId,
        amount: next.pendingDrawAmount,
        type: next.pendingDrawType,
        resumePlayerId: next.pendingDrawResumePlayerId ?? interruptedPlayerId,
        pendingWinnerId: next.pendingWinnerId,
        phase: next.phase === "awaiting-draw-four-challenge"
          ? "awaiting-draw-four-challenge"
          : "playing",
      }
    : null;
  next.phase = "playing";
  next.queuedDrawPenalty = interruptedPenalty;
  beginPendingDraw(next, offenderIndex, 2, null, playerIndex(next, interruptedPlayerId));
  next.queuedDrawPenalty = interruptedPenalty;
  next.lastAction = {
    type: "catch-uno",
    playerId: catcherId,
    targetPlayerId: offenderId,
    amount: 2,
    successful: true,
  };
  return accepted(next);
}

export function resolveDrawFour(
  state: GameState,
  playerId: string,
  challenge: boolean,
): RuleResult {
  if (state.phase !== "awaiting-draw-four-challenge" || !state.pendingDrawFour) {
    return rejected(
      state,
      "NOT_AWAITING_DRAW_FOUR",
      "There is no draw four to resolve",
    );
  }
  if (state.pendingDrawFour.targetId !== playerId) {
    return rejected(
      state,
      "NOT_DRAW_FOUR_TARGET",
      "Only the targeted player can resolve the draw four",
    );
  }
  if (challenge && !state.rulesOptions.drawFourChallengeEnabled) {
    return rejected(state, "DRAW_FOUR_CHALLENGE_DISABLED", "目前規則未開啟 +4 質疑");
  }

  const next = cloneState(state);
  const pending = next.pendingDrawFour!;
  const targetIndex = playerIndex(next, pending.targetId);
  const attackerIndex = playerIndex(next, pending.attackerId);
  if (targetIndex < 0 || attackerIndex < 0) {
    throw new RangeError("Draw four references an unknown player");
  }

  let amount = next.pendingDrawAmount || 4;
  let drawPlayerIndex = targetIndex;
  let resumeIndex = nextPlayerIndex(next, targetIndex);
  let successful: boolean | undefined;
  const penalty = next.pendingDrawAmount || 4;
  if (challenge && pending.wasLegal) {
    amount = penalty + 2;
    successful = false;
  } else if (challenge) {
    drawPlayerIndex = attackerIndex;
    resumeIndex = targetIndex;
    successful = true;
  }

  next.phase = "playing";
  next.pendingDrawFour = null;
  clearPendingDraw(next);
  const pendingWinnerId = pending.pendingWinnerId &&
    (!challenge || pending.wasLegal || pending.pendingWinnerId !== pending.attackerId)
    ? pending.pendingWinnerId
    : null;
  beginPendingDraw(
    next,
    drawPlayerIndex,
    amount,
    null,
    resumeIndex,
    pendingWinnerId,
  );
  next.lastAction = {
    type: challenge ? "challenge-draw-four" : "accept-draw-four",
    playerId,
    amount,
    ...(successful === undefined ? {} : { successful }),
  };

  return accepted(next);
}
