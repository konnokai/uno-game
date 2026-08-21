import { describe, expect, it } from "vitest";
import type { Card } from "./types.js";
import { decideBotAction, type BotGameView } from "./bot.js";

function card(id: string, color: Card["color"], value: Card["value"]): Card {
  return { id, color, value };
}

function gameWithBot(hand: Card[], overrides: Partial<BotGameView> = {}): BotGameView {
  return {
    hand,
    topDiscard: card("discard-1", "red", 5),
    currentColor: "red",
    currentPlayerId: "bot",
    phase: "playing",
    drawnCardId: null,
    pendingDrawFour: null,
    ...overrides,
  };
}

describe("bot player", () => {
  it("plays a regular matching card before a wild and calls UNO", () => {
    expect(decideBotAction(gameWithBot([
      card("wild", null, "wild"),
      card("red-7", "red", 7),
    ]), "bot")).toEqual({
      type: "play",
      cardId: "red-7",
      declareUno: true,
    });
  });

  it("draws when it has no playable card", () => {
    expect(decideBotAction(gameWithBot([card("blue-2", "blue", 2)]), "bot"))
      .toEqual({ type: "draw" });
  });

  it("can randomly play a draw four while holding the current color", () => {
    expect(decideBotAction(gameWithBot([
      card("red-2", "red", 2),
      card("draw-four", null, "wild-draw-four"),
      card("blue-3", "blue", 3),
    ]), "bot", () => 0.99)).toEqual({
      type: "play",
      cardId: "draw-four",
      chosenColor: "red",
      declareUno: false,
    });
  });

  it("immediately plays a playable drawn wild and chooses its strongest color", () => {
    const hand = [
      card("drawn-wild", null, "wild"),
      card("green-1", "green", 1),
      card("green-2", "green", 2),
      card("blue-3", "blue", 3),
    ];
    expect(decideBotAction(gameWithBot(hand, { drawnCardId: "drawn-wild" }), "bot"))
      .toEqual({
        type: "play",
        cardId: "drawn-wild",
        chosenColor: "green",
        declareUno: false,
      });
  });

  it("chooses a color for an initial wild", () => {
    expect(decideBotAction(gameWithBot([
      card("blue-1", "blue", 1),
      card("blue-2", "blue", 2),
      card("yellow-1", "yellow", 1),
    ], { currentColor: null }), "bot")).toEqual({
      type: "choose-color",
      color: "blue",
    });
  });

  it("accepts a draw four without reading its hidden legality", () => {
    expect(decideBotAction(gameWithBot([card("blue-2", "blue", 2)], {
      phase: "awaiting-draw-four-challenge",
      pendingDrawFour: { targetId: "bot" },
    }), "bot")).toEqual({ type: "resolve-draw-four" });
  });
});
