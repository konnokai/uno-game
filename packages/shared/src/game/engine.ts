import { createDeck, shuffleDeck } from "./deck.js";
import type {
  Card,
  CardColor,
  GamePlayer,
  GameState,
  PlayCardOptions,
  RandomSource,
  RuleErrorCode,
  RuleResult,
  StartGameOptions,
} from "./types.js";
import { CARD_COLORS, MAX_GAME_PLAYERS, MIN_GAME_PLAYERS } from "./types.js";

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
    pendingDrawFour: state.pendingDrawFour
      ? { ...state.pendingDrawFour }
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
    players,
    drawPile,
    discardPile: [initialCard],
    currentColor: initialCard.color,
    currentPlayerIndex: 0,
    direction: 1,
    phase: "playing",
    hasDrawnThisTurn: false,
    drawnCardId: null,
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
    const drawn = drawCards(state, 0, 2, random);
    state.currentPlayerIndex = 1;
    state.lastAction.amount = drawn.cards.length;
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

export function playCard(
  state: GameState,
  playerId: string,
  cardId: string,
  options: PlayCardOptions = {},
): RuleResult {
  const turnError = validatePlayingTurn(state, playerId);
  if (turnError) {
    return turnError;
  }

  const player = currentPlayer(state);
  const cardIndex = player.hand.findIndex((card) => card.id === cardId);
  if (cardIndex < 0) {
    return rejected(state, "CARD_NOT_IN_HAND", "The player does not own this card");
  }
  if (state.hasDrawnThisTurn && state.drawnCardId !== cardId) {
    return rejected(
      state,
      "MUST_PLAY_DRAWN_CARD",
      "Only the card drawn this turn may be played",
    );
  }

  const card = player.hand[cardIndex];
  if (!card || !isCardPlayable(card, topDiscard(state), state.currentColor!)) {
    return rejected(state, "CARD_NOT_PLAYABLE", "The card cannot be played here");
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
  const nextPlayer = currentPlayer(next);
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
  next.unoVulnerablePlayerId =
    nextPlayer.hand.length === 1 && !options.declareUno ? playerId : null;
  next.lastAction = {
    type: "play-card",
    playerId,
    cardId,
    ...(options.chosenColor ? { chosenColor: options.chosenColor } : {}),
    ...(options.declareUno && nextPlayer.hand.length === 1
      ? { declaredUno: true }
      : {}),
  };

  const random = options.random ?? Math.random;
  const fromIndex = next.currentPlayerIndex;

  if (playedCard.value === "wild-draw-four") {
    const targetIndex = nextPlayerIndex(next, fromIndex);
    const target = next.players[targetIndex];
    if (!target) {
      throw new RangeError("Draw four has no target");
    }
    next.phase = "awaiting-draw-four-challenge";
    next.currentPlayerIndex = targetIndex;
    next.pendingDrawFour = {
      attackerId: playerId,
      targetId: target.id,
      wasLegal: wildDrawFourWasLegal,
      pendingWinnerId: nextPlayer.hand.length === 0 ? playerId : null,
    };
    return accepted(next);
  }

  if (playedCard.value === "skip") {
    completeTurn(next, fromIndex, 2);
  } else if (playedCard.value === "reverse") {
    next.direction = next.direction === 1 ? -1 : 1;
    completeTurn(next, fromIndex, next.players.length === 2 ? 2 : 1);
  } else if (playedCard.value === "draw-two") {
    const targetIndex = nextPlayerIndex(next, fromIndex);
    const drawn = drawCards(next, targetIndex, 2, random);
    next.lastAction.amount = drawn.cards.length;
    if (drawn.reshuffled) next.lastAction.shuffle = "recycle";
    completeTurn(next, fromIndex, 2);
  } else {
    completeTurn(next, fromIndex);
  }

  if (nextPlayer.hand.length === 0) {
    next.phase = "finished";
    next.winnerId = playerId;
  } else if (nextPlayer.hand.length === 1 && !options.declareUno) {
    next.unoVulnerablePlayerId = playerId;
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
  if (state.hasDrawnThisTurn) {
    return rejected(state, "ALREADY_DREW", "The player already drew this turn");
  }

  const next = cloneState(state);
  const drawResult = drawCards(next, next.currentPlayerIndex, 1, random);
  const drawn = drawResult.cards[0];
  next.lastAction = {
    type: "draw-card",
    playerId,
    amount: drawn ? 1 : 0,
    ...(drawResult.reshuffled ? { shuffle: "recycle" as const } : {}),
  };

  // Keep the turn after every draw so opponents cannot infer whether the
  // player had a matching card from an automatic pass.
  next.hasDrawnThisTurn = true;
  next.drawnCardId = drawn?.id ?? null;
  next.unoVulnerablePlayerId = null;

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
  random: RandomSource = Math.random,
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
  const drawResult = drawCards(next, offenderIndex, 2, random);
  const amount = drawResult.cards.length;
  next.unoVulnerablePlayerId = null;
  next.lastAction = {
    type: "catch-uno",
    playerId: catcherId,
    targetPlayerId: offenderId,
    amount,
    successful: true,
    ...(drawResult.reshuffled ? { shuffle: "recycle" as const } : {}),
  };
  return accepted(next);
}

export function resolveDrawFour(
  state: GameState,
  playerId: string,
  challenge: boolean,
  random: RandomSource = Math.random,
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

  const next = cloneState(state);
  const pending = next.pendingDrawFour!;
  const targetIndex = playerIndex(next, pending.targetId);
  const attackerIndex = playerIndex(next, pending.attackerId);
  if (targetIndex < 0 || attackerIndex < 0) {
    throw new RangeError("Draw four references an unknown player");
  }

  let amount = 0;
  let successful: boolean | undefined;
  let reshuffled = false;
  if (!challenge) {
    const drawResult = drawCards(next, targetIndex, 4, random);
    amount = drawResult.cards.length;
    reshuffled = drawResult.reshuffled;
    next.currentPlayerIndex = nextPlayerIndex(next, targetIndex);
  } else if (pending.wasLegal) {
    const drawResult = drawCards(next, targetIndex, 6, random);
    amount = drawResult.cards.length;
    reshuffled = drawResult.reshuffled;
    next.currentPlayerIndex = nextPlayerIndex(next, targetIndex);
    successful = false;
  } else {
    const drawResult = drawCards(next, attackerIndex, 4, random);
    amount = drawResult.cards.length;
    reshuffled = drawResult.reshuffled;
    next.currentPlayerIndex = targetIndex;
    successful = true;
  }

  next.phase = "playing";
  next.pendingDrawFour = null;
  next.hasDrawnThisTurn = false;
  next.drawnCardId = null;
  next.unoVulnerablePlayerId = null;
  next.lastAction = {
    type: challenge ? "challenge-draw-four" : "accept-draw-four",
    playerId,
    amount,
    ...(successful === undefined ? {} : { successful }),
    ...(reshuffled ? { shuffle: "recycle" as const } : {}),
  };

  if (pending.pendingWinnerId && (!challenge || pending.wasLegal)) {
    next.phase = "finished";
    next.winnerId = pending.pendingWinnerId;
  }

  return accepted(next);
}
