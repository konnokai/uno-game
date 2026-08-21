import { describe, expect, it } from "vitest";

import { createDeck, shuffleDeck } from "./deck";
import { CARD_COLORS } from "./types";

describe("createDeck", () => {
  it("creates the classic 108-card deck with unique IDs", () => {
    const deck = createDeck();

    expect(deck).toHaveLength(108);
    expect(new Set(deck.map((card) => card.id))).toHaveLength(108);
    expect(deck.filter((card) => card.value === "wild")).toHaveLength(4);
    expect(deck.filter((card) => card.value === "wild-draw-four")).toHaveLength(4);

    for (const color of CARD_COLORS) {
      const cards = deck.filter((card) => card.color === color);
      expect(cards).toHaveLength(25);
      expect(cards.filter((card) => card.value === 0)).toHaveLength(1);

      for (let number = 1; number <= 9; number += 1) {
        expect(cards.filter((card) => card.value === number)).toHaveLength(2);
      }

      expect(cards.filter((card) => card.value === "skip")).toHaveLength(2);
      expect(cards.filter((card) => card.value === "reverse")).toHaveLength(2);
      expect(cards.filter((card) => card.value === "draw-two")).toHaveLength(2);
    }
  });
});

describe("shuffleDeck", () => {
  it("uses the supplied random source without changing the input", () => {
    const deck = createDeck().slice(0, 4);
    const originalIds = deck.map((card) => card.id);
    const shuffled = shuffleDeck(deck, () => 0);

    expect(deck.map((card) => card.id)).toEqual(originalIds);
    expect(shuffled.map((card) => card.id)).toEqual([
      originalIds[1],
      originalIds[2],
      originalIds[3],
      originalIds[0],
    ]);
  });
});
