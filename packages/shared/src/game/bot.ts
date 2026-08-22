import {
  CARD_COLORS,
  type Card,
  type CardColor,
  type GamePhase,
} from "./types.js";
import { isCardPlayable } from "./engine.js";

export interface BotGameView {
  hand: readonly Card[];
  phase: Exclude<GamePhase, "lobby">;
  pendingDrawFour: { targetId: string } | null;
  currentPlayerId: string;
  currentColor: CardColor | null;
  hasDrawnThisTurn: boolean;
  drawnCardId: string | null;
  topDiscard: Card;
}

export type BotDecision =
  | { type: "choose-color"; color: CardColor }
  | { type: "resolve-draw-four" }
  | { type: "play"; cardId: string; chosenColor?: CardColor; declareUno: boolean }
  | { type: "draw" }
  | { type: "pass" }
  | { type: "none" };

function chooseColor(hand: readonly Card[], excludedCardId?: string): CardColor {
  const counts = new Map<CardColor, number>(CARD_COLORS.map((color) => [color, 0]));
  for (const card of hand) {
    if (card.id !== excludedCardId && card.color) {
      counts.set(card.color, (counts.get(card.color) ?? 0) + 1);
    }
  }
  return CARD_COLORS.reduce((best, color) =>
    (counts.get(color) ?? 0) > (counts.get(best) ?? 0) ? color : best,
  );
}

function playDecision(card: Card, hand: readonly Card[]): BotDecision {
  const isWild = card.value === "wild" || card.value === "wild-draw-four";
  return {
    type: "play",
    cardId: card.id,
    ...(isWild ? { chosenColor: chooseColor(hand, card.id) } : {}),
    declareUno: hand.length === 2,
  };
}

/** Selects one server-validated action without knowing any other player's hand. */
export function decideBotAction(
  game: BotGameView,
  botId: string,
  random: () => number = Math.random,
): BotDecision {
  if (game.phase === "finished") return { type: "none" };

  if (game.phase === "awaiting-draw-four-challenge") {
    return game.pendingDrawFour?.targetId === botId
      ? { type: "resolve-draw-four" }
      : { type: "none" };
  }

  if (game.currentPlayerId !== botId) return { type: "none" };
  if (game.currentColor === null) {
    return { type: "choose-color", color: chooseColor(game.hand) };
  }

  if (game.hasDrawnThisTurn) {
    const drawn = game.drawnCardId
      ? game.hand.find((card) => card.id === game.drawnCardId)
      : undefined;
    return drawn && isCardPlayable(drawn, game.topDiscard, game.currentColor!)
      ? playDecision(drawn, game.hand)
      : { type: "pass" };
  }

  // Keep the challenge rule meaningful: a bot may select a playable +4 even
  // when it still holds a card matching the current color.
  const playable = game.hand.filter((card) =>
    isCardPlayable(card, game.topDiscard, game.currentColor!),
  );
  const preferred =
    playable.find((card) => card.color !== null) ??
    playable.find((card) => card.value === "wild") ??
    playable[0];
  if (!preferred) return { type: "draw" };

  const drawFours = playable.filter((card) => card.value === "wild-draw-four");
  const candidates = drawFours.length > 0
    ? [preferred, ...drawFours.filter((card) => card.id !== preferred.id)]
    : [preferred];
  const selected = candidates[Math.floor(random() * candidates.length)] ?? preferred;
  return playDecision(selected, game.hand);
}
