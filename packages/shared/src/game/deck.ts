import type { Card, CardColor, CardValue, RandomSource } from "./types.js";
import { CARD_COLORS } from "./types.js";

const DOUBLE_VALUES: CardValue[] = [
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  "skip",
  "reverse",
  "draw-two",
];

function coloredCard(
  color: CardColor,
  value: CardValue,
  copy: number,
): Card {
  return {
    id: `${color}-${value}-${copy}`,
    color,
    value,
  };
}

export function createDeck(): Card[] {
  const deck: Card[] = [];

  for (const color of CARD_COLORS) {
    deck.push(coloredCard(color, 0, 1));

    for (const value of DOUBLE_VALUES) {
      deck.push(coloredCard(color, value, 1));
      deck.push(coloredCard(color, value, 2));
    }
  }

  for (let copy = 1; copy <= 4; copy += 1) {
    deck.push({ id: `wild-${copy}`, color: null, value: "wild" });
    deck.push({
      id: `wild-draw-four-${copy}`,
      color: null,
      value: "wild-draw-four",
    });
  }

  return deck;
}

export function shuffleDeck(
  cards: readonly Card[],
  random: RandomSource = Math.random,
): Card[] {
  const shuffled = [...cards];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = shuffled[index];
    const swap = shuffled[swapIndex];

    if (current === undefined || swap === undefined) {
      throw new RangeError("Random source produced an invalid shuffle index");
    }

    shuffled[index] = swap;
    shuffled[swapIndex] = current;
  }

  return shuffled;
}
