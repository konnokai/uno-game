import { describe, expect, it } from "vitest";

import {
  callUno,
  catchUno,
  chooseStartingColor,
  drawCard,
  isDrawCardStackable,
  isCardPlayable,
  isWildDrawFourLegal,
  nextPlayerIndex,
  passAfterDraw,
  playCard,
  resolveDrawFour,
  startGame,
} from "./engine";
import { DEFAULT_GAME_RULE_OPTIONS } from "./types";
import type {
  Card,
  CardColor,
  CardValue,
  Direction,
  GameRuleOptions,
  GameState,
} from "./types";

let cardSequence = 0;

function card(value: CardValue, color: CardColor | null = "red"): Card {
  cardSequence += 1;
  return { id: `test-${cardSequence}`, color, value };
}

function stateWith(options: {
  hands: Card[][];
  top?: Card;
  drawPile?: Card[];
  currentColor?: CardColor;
  currentPlayerIndex?: number;
  direction?: Direction;
  rulesMode?: "classic" | "taiwan";
  rulesOptions?: Partial<GameRuleOptions>;
}): GameState {
  const top = options.top ?? card(5, "red");
  return {
    rulesMode: options.rulesMode ?? "classic",
    rulesOptions: { ...DEFAULT_GAME_RULE_OPTIONS, ...(options.rulesOptions ?? {}) },
    players: options.hands.map((hand, index) => ({
      id: `p${index + 1}`,
      hand: [...hand],
    })),
    drawPile: [...(options.drawPile ?? [card(9, "blue"), card(8, "green")])],
    discardPile: [top],
    currentColor: options.currentColor ?? top.color ?? "red",
    currentPlayerIndex: options.currentPlayerIndex ?? 0,
    direction: options.direction ?? 1,
    phase: "playing",
    hasDrawnThisTurn: false,
    drawnCardId: null,
    pendingDrawAmount: 0,
    pendingDrawType: null,
    unoVulnerablePlayerId: null,
    pendingDrawFour: null,
    winnerId: null,
    lastAction: { type: "start", playerId: null, cardId: top.id },
    version: 1,
  };
}

function deckForStart(hands: Card[][], initial: Card, remaining: Card[] = []): Card[] {
  const dealOrder: Card[] = [];
  for (let cardIndex = 0; cardIndex < hands[0]!.length; cardIndex += 1) {
    for (const hand of hands) {
      dealOrder.push(hand[cardIndex]!);
    }
  }
  return [...remaining, initial, ...dealOrder.reverse()];
}

function expectAccepted(result: ReturnType<typeof playCard>): GameState {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.code);
  }
  return result.state;
}

describe("starting a game", () => {
  it("deals round-robin and leaves private hands in player order", () => {
    const hands = [
      [card(1), card(2), card(3)],
      [card(4, "blue"), card(5, "blue"), card(6, "blue")],
    ];
    const initial = card(7, "green");
    const state = startGame(["p1", "p2"], {
      deck: deckForStart(hands, initial, [card(8, "yellow")]),
      handSize: 3,
    });

    expect(state.players.map((player) => player.hand)).toEqual(hands);
    expect(state.discardPile).toEqual([initial]);
    expect(state.currentPlayerIndex).toBe(0);
    expect(state.currentColor).toBe("green");
    expect(state.lastAction.shuffle).toBe("initial");
  });

  it.each([
    [2, "skip", 1, 1],
    [3, "skip", 1, 1],
    [2, "reverse", -1, 1],
    [3, "reverse", -1, 2],
  ] as const)(
    "applies a starting %s-player %s card",
    (count, value, direction, currentPlayerIndex) => {
      const hands = Array.from({ length: count }, (_, index) => [
        card(index, "blue"),
      ]);
      const state = startGame(
        hands.map((_, index) => `p${index + 1}`),
        { deck: deckForStart(hands, card(value, "red")), handSize: 1 },
      );

      expect(state.direction).toBe(direction);
      expect(state.currentPlayerIndex).toBe(currentPlayerIndex);
    },
  );

  it("makes the first player draw two and skips their turn", () => {
    const hands = [[card(1)], [card(2, "blue")]];
    const state = startGame(["p1", "p2"], {
      deck: deckForStart(hands, card("draw-two", "red"), [
        card(8, "green"),
        card(9, "green"),
      ]),
      handSize: 1,
    });

    expect(state.players[0]!.hand).toHaveLength(3);
    expect(state.currentPlayerIndex).toBe(1);
    expect(state.lastAction.amount).toBe(2);
  });

  it("requires the first player to choose the color of a starting wild", () => {
    const hands = [[card(1)], [card(2, "blue")]];
    const state = startGame(["p1", "p2"], {
      deck: deckForStart(hands, card("wild", null)),
      handSize: 1,
    });

    expect(state.currentColor).toBeNull();
    expect(drawCard(state, "p1")).toMatchObject({
      ok: false,
      error: { code: "STARTING_COLOR_REQUIRED" },
    });

    const chosen = chooseStartingColor(state, "p1", "blue");
    expect(chosen.ok).toBe(true);
    if (chosen.ok) {
      expect(chosen.state.currentColor).toBe("blue");
      expect(chosen.state.currentPlayerIndex).toBe(0);
    }
  });

  it("does not allow a wild draw four to become the starting discard", () => {
    const hands = [[card(1)], [card(2, "blue")]];
    const validInitial = card(6, "yellow");
    const drawFour = card("wild-draw-four", null);
    const state = startGame(["p1", "p2"], {
      deck: deckForStart(hands, drawFour, [
        card(3, "green"),
        card(4, "blue"),
        validInitial,
      ]),
      handSize: 1,
      random: () => 0,
    });

    expect(state.discardPile).toEqual([validInitial]);
    expect(state.drawPile).toContainEqual(drawFour);
    expect(state.drawPile.at(-1)).not.toEqual(drawFour);
  });

  it("validates player count, IDs, and deck size", () => {
    expect(() => startGame(["p1"])).toThrow(/between 2 and 8/);
    expect(() => startGame(Array.from({ length: 9 }, (_, index) => `p${index + 1}`)))
      .toThrow(/between 2 and 8/);
    expect(startGame(Array.from({ length: 8 }, (_, index) => `p${index + 1}`)).players)
      .toHaveLength(8);
    expect(() => startGame(["p1", "p1"])).toThrow(/unique/);
    expect(() =>
      startGame(["p1", "p2"], { deck: [card(1)], handSize: 1 }),
    ).toThrow(/at least 3/);
    expect(() =>
      startGame(["p1", "p2"], {
        deck: [
          { id: "invalid", color: null, value: 5 },
          card(1),
          card(2),
        ],
        handSize: 1,
      }),
    ).toThrow(/invalid card/);
  });
});

describe("playability", () => {
  const discard = card(5, "red");

  it("allows matching color, value, and either wild", () => {
    expect(isCardPlayable(card(8, "red"), discard, "red")).toBe(true);
    expect(isCardPlayable(card(5, "blue"), discard, "red")).toBe(true);
    expect(isCardPlayable(card("wild", null), discard, "red")).toBe(true);
    expect(isCardPlayable(card("wild-draw-four", null), discard, "red")).toBe(true);
    expect(isCardPlayable(card(8, "blue"), discard, "red")).toBe(false);
  });

  it("only considers matching colors when checking draw-four legality", () => {
    const drawFour = card("wild-draw-four", null);
    expect(isWildDrawFourLegal([drawFour, card(5, "blue")], "red", drawFour.id)).toBe(
      true,
    );
    expect(isWildDrawFourLegal([drawFour, card(9, "red")], "red", drawFour.id)).toBe(
      false,
    );
  });

  it("rejects wrong turns, cards not owned, and illegal cards without mutation", () => {
    const playable = card(1, "red");
    const original = stateWith({
      hands: [[playable, card(2, "blue")], [card(3)]],
    });
    const snapshot = structuredClone(original);

    expect(playCard(original, "p2", original.players[1]!.hand[0]!.id)).toMatchObject({
      ok: false,
      error: { code: "NOT_YOUR_TURN" },
    });
    expect(playCard(original, "p1", "missing")).toMatchObject({
      ok: false,
      error: { code: "CARD_NOT_IN_HAND" },
    });
    expect(playCard(original, "p1", original.players[0]!.hand[1]!.id)).toMatchObject({
      ok: false,
      error: { code: "CARD_NOT_PLAYABLE" },
    });
    expect(original).toEqual(snapshot);
  });

  it("rejects an invalid wild color at runtime", () => {
    const wild = card("wild", null);
    const state = stateWith({ hands: [[wild, card(1)], [card(2)]] });

    expect(
      playCard(state, "p1", wild.id, {
        chosenColor: "purple" as CardColor,
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_COLOR" } });
  });

  it("does not mutate the previous state after a successful play", () => {
    const playable = card(7, "red");
    const state = stateWith({ hands: [[playable, card(1)], [card(2)]] });
    const snapshot = structuredClone(state);

    expect(playCard(state, "p1", playable.id).ok).toBe(true);
    expect(state).toEqual(snapshot);
  });
});

describe("turn order and effects", () => {
  it("skips the next player", () => {
    const skip = card("skip", "red");
    const state = stateWith({ hands: [[skip, card(1)], [card(2)], [card(3)]] });
    const next = expectAccepted(playCard(state, "p1", skip.id));

    expect(next.currentPlayerIndex).toBe(2);
  });

  it("reverses turn order in games with three to eight players", () => {
    for (const count of [3, 4, 5, 6, 7, 8]) {
      const reverse = card("reverse", "red");
      const state = stateWith({
        hands: Array.from({ length: count }, (_, index) =>
          index === 0 ? [reverse, card(1)] : [card(index + 2)],
        ),
      });
      const next = expectAccepted(playCard(state, "p1", reverse.id));

      expect(next.direction).toBe(-1);
      expect(next.currentPlayerIndex).toBe(count - 1);
      expect(nextPlayerIndex(next, next.currentPlayerIndex)).toBe(count - 2);
    }
  });

  it("treats reverse as skip in a two-player game", () => {
    const reverse = card("reverse", "red");
    const state = stateWith({ hands: [[reverse, card(1)], [card(2)]] });
    const next = expectAccepted(playCard(state, "p1", reverse.id));

    expect(next.direction).toBe(-1);
    expect(next.currentPlayerIndex).toBe(0);
  });

  it("makes the next player draw two and skips them", () => {
    const drawTwo = card("draw-two", "red");
    const state = stateWith({
      hands: [[drawTwo, card(1)], [card(2)], [card(3)]],
      drawPile: [card(7), card(8)],
    });
    const next = expectAccepted(playCard(state, "p1", drawTwo.id, { random: () => 0 }));

    expect(next.players[1]!.hand).toHaveLength(3);
    expect(next.currentPlayerIndex).toBe(2);
  });

  it("still applies an action card's effect when it is the winning card", () => {
    const drawTwo = card("draw-two", "red");
    const state = stateWith({
      hands: [[drawTwo], [card(2)], [card(3)]],
      drawPile: [card(7), card(8)],
    });
    const next = expectAccepted(playCard(state, "p1", drawTwo.id));

    expect(next.phase).toBe("finished");
    expect(next.winnerId).toBe("p1");
    expect(next.players[1]!.hand).toHaveLength(3);
  });

  it("stacks matching draw-two cards in Taiwan mode", () => {
    const first = card("draw-two", "red");
    const second = card("draw-two", "blue");
    const state = stateWith({
      rulesMode: "taiwan",
      hands: [[first, card(1)], [second, card(2)], [card(3)]],
      drawPile: Array.from({ length: 4 }, (_, index) => card(index, "green")),
    });

    const stacked = expectAccepted(playCard(state, "p1", first.id));
    expect(stacked.pendingDrawAmount).toBe(2);
    expect(stacked.currentPlayerIndex).toBe(1);

    const twiceStacked = expectAccepted(playCard(stacked, "p2", second.id));
    expect(twiceStacked.pendingDrawAmount).toBe(4);
    expect(twiceStacked.currentPlayerIndex).toBe(2);

    const drawn = drawCard(twiceStacked, "p3");
    expect(drawn).toMatchObject({
      ok: true,
      state: { pendingDrawAmount: 0, currentPlayerIndex: 0 },
    });
    if (drawn.ok) expect(drawn.state.players[2]!.hand).toHaveLength(5);
  });

  it("applies each Taiwan stacking mode to +2 and +4 combinations", () => {
    expect(isDrawCardStackable("draw-two", "draw-two", {
      stackingEnabled: true,
      stackingMode: "same-type",
    })).toBe(true);
    expect(isDrawCardStackable("draw-two", "wild-draw-four", {
      stackingEnabled: true,
      stackingMode: "same-type",
    })).toBe(false);
    expect(isDrawCardStackable("wild-draw-four", "draw-two", {
      stackingEnabled: true,
      stackingMode: "same-type",
    })).toBe(false);
    expect(isDrawCardStackable("draw-two", "wild-draw-four", {
      stackingEnabled: true,
      stackingMode: "draw-four-over-two",
    })).toBe(true);
    expect(isDrawCardStackable("wild-draw-four", "draw-two", {
      stackingEnabled: true,
      stackingMode: "draw-four-over-two",
    })).toBe(false);
    expect(isDrawCardStackable("draw-two", "wild-draw-four", {
      stackingEnabled: true,
      stackingMode: "mixed",
    })).toBe(true);
    expect(isDrawCardStackable("wild-draw-four", "draw-two", {
      stackingEnabled: true,
      stackingMode: "mixed",
    })).toBe(true);
    expect(isDrawCardStackable("draw-two", "draw-two", {
      stackingEnabled: false,
      stackingMode: "mixed",
    })).toBe(false);
  });

  it("rejects a disallowed mixed stack without mutating the state", () => {
    const drawTwo = card("draw-two", "red");
    const drawFour = card("wild-draw-four", null);
    const state = stateWith({
      rulesMode: "taiwan",
      rulesOptions: { stackingMode: "same-type" },
      hands: [[drawTwo, card(1)], [drawFour, card(2)], [card(3)]],
      drawPile: Array.from({ length: 8 }, (_, index) => card(index, "green")),
    });
    const pending = expectAccepted(playCard(state, "p1", drawTwo.id));
    const result = playCard(pending, "p2", drawFour.id, { chosenColor: "blue" });

    expect(result).toMatchObject({ ok: false, error: { code: "CARD_NOT_PLAYABLE" } });
    expect(pending.pendingDrawAmount).toBe(2);
    expect(pending.players[1]!.hand).toContainEqual(drawFour);
  });

  it("allows a +4 to stack on +2 only in the large-over-small mode", () => {
    for (const stackingMode of ["draw-four-over-two", "mixed"] as const) {
      const drawTwo = card("draw-two", "red");
      const drawFour = card("wild-draw-four", null);
      const state = stateWith({
        rulesMode: "taiwan",
        rulesOptions: { stackingMode },
        hands: [[drawTwo, card(1)], [drawFour, card(2)], [card(3)]],
        drawPile: Array.from({ length: 8 }, (_, index) => card(index, "green")),
      });
      const pending = expectAccepted(playCard(state, "p1", drawTwo.id));
      const stacked = playCard(pending, "p2", drawFour.id, { chosenColor: "blue" });

      expect(stacked).toMatchObject({
        ok: true,
        state: { pendingDrawAmount: 6, phase: "awaiting-draw-four-challenge" },
      });
    }
  });

  it("allows +2 to stack on +4 only in mixed mode", () => {
    for (const stackingMode of ["same-type", "draw-four-over-two"] as const) {
      const drawFour = card("wild-draw-four", null);
      const drawTwo = card("draw-two", "red");
      const state = stateWith({
        rulesMode: "taiwan",
        rulesOptions: { stackingMode },
        hands: [[drawFour, card(1)], [drawTwo, card(2)], [card(3)]],
        drawPile: Array.from({ length: 8 }, (_, index) => card(index, "green")),
      });
      const pending = expectAccepted(playCard(state, "p1", drawFour.id, { chosenColor: "blue" }));
      const result = playCard(pending, "p2", drawTwo.id);

      expect(result).toMatchObject({ ok: false, error: { code: "CARD_NOT_PLAYABLE" } });
    }

    const drawFour = card("wild-draw-four", null);
    const drawTwo = card("draw-two", "red");
    const state = stateWith({
      rulesMode: "taiwan",
      rulesOptions: { stackingMode: "mixed" },
      hands: [[drawFour, card(1)], [drawTwo, card(2)], [card(3)]],
      drawPile: Array.from({ length: 8 }, (_, index) => card(index, "green")),
    });
    const pending = expectAccepted(playCard(state, "p1", drawFour.id, { chosenColor: "blue" }));
    expect(playCard(pending, "p2", drawTwo.id)).toMatchObject({
      ok: true,
      state: { pendingDrawAmount: 6, phase: "playing" },
    });
  });

  it("keeps stacking disabled while still applying the first draw penalty", () => {
    const first = card("draw-two", "red");
    const second = card("draw-two", "blue");
    const state = stateWith({
      rulesMode: "taiwan",
      rulesOptions: { stackingEnabled: false },
      hands: [[first, card(1)], [second, card(2)], [card(3)]],
      drawPile: Array.from({ length: 8 }, (_, index) => card(index, "green")),
    });
    const pending = expectAccepted(playCard(state, "p1", first.id));
    const result = playCard(pending, "p2", second.id);

    expect(result).toMatchObject({ ok: false, error: { code: "CARD_NOT_PLAYABLE" } });
    expect(pending.pendingDrawAmount).toBe(2);
  });

  it("plays multiple matching cards as one Taiwan action", () => {
    const first = card(5, "red");
    const second = card(5, "blue");
    const state = stateWith({
      rulesMode: "taiwan",
      rulesOptions: { multiCardPlayEnabled: true },
      hands: [[first, second, card(1, "green")], [card(2, "yellow")]],
    });

    const result = playCard(state, "p1", first.id, {
      additionalCardIds: [second.id],
    });

    expect(result).toMatchObject({
      ok: true,
      state: {
        currentPlayerIndex: 1,
        currentColor: "blue",
        lastAction: { cardId: first.id, cardIds: [first.id, second.id] },
      },
    });
    if (result.ok) expect(result.state.players[0]!.hand.map((card) => card.value)).toEqual([1]);
  });

  it("finishes when a multi-card play removes the last hand cards", () => {
    const first = card(5, "red");
    const second = card(5, "blue");
    const state = stateWith({
      rulesMode: "taiwan",
      rulesOptions: { multiCardPlayEnabled: true },
      hands: [[first, second], [card(2, "yellow")]],
    });

    const result = expectAccepted(playCard(state, "p1", first.id, {
      additionalCardIds: [second.id],
    }));

    expect(result.phase).toBe("finished");
    expect(result.winnerId).toBe("p1");
    expect(result.currentColor).toBe("blue");
    expect(result.pendingDrawAmount).toBe(0);
    expect(result.unoVulnerablePlayerId).toBeNull();
  });

  it("rejects multi-card play when disabled or when values differ", () => {
    const first = card(5, "red");
    const second = card(5, "blue");
    const disabled = stateWith({
      rulesMode: "taiwan",
      hands: [[first, second], [card(2)]],
    });
    expect(playCard(disabled, "p1", first.id, { additionalCardIds: [second.id] })).toMatchObject({
      ok: false,
      error: { code: "CARD_NOT_PLAYABLE" },
    });

    const different = card(6, "green");
    const enabled = stateWith({
      rulesMode: "taiwan",
      rulesOptions: { multiCardPlayEnabled: true },
      hands: [[first, different], [card(2)]],
    });
    expect(playCard(enabled, "p1", first.id, { additionalCardIds: [different.id] })).toMatchObject({
      ok: false,
      error: { code: "CARD_NOT_PLAYABLE" },
    });
  });

  it("accumulates a multi-card draw-two penalty", () => {
    const first = card("draw-two", "red");
    const second = card("draw-two", "blue");
    const state = stateWith({
      rulesMode: "taiwan",
      rulesOptions: { multiCardPlayEnabled: true },
      hands: [[first, second, card(1)], [card(2)], [card(3)]],
    });

    const result = playCard(state, "p1", first.id, { additionalCardIds: [second.id] });

    expect(result).toMatchObject({
      ok: true,
      state: { pendingDrawAmount: 4, pendingDrawType: "draw-two", currentPlayerIndex: 1 },
    });
    if (result.ok) expect(result.state.unoVulnerablePlayerId).toBe("p1");
  });

  it("allows a Taiwan player to jump in with an identical card", () => {
    const jumpIn = card(5, "red");
    const state = stateWith({
      rulesMode: "taiwan",
      hands: [[card(1, "red")], [jumpIn, card(2)], [card(3)]],
    });

    const next = expectAccepted(playCard(state, "p2", jumpIn.id));

    expect(next.lastAction.jumpIn).toBe(true);
    expect(next.lastAction.playerId).toBe("p2");
    expect(next.currentPlayerIndex).toBe(2);
  });

  it("exchanges hands on seven and passes all hands on zero in Taiwan mode", () => {
    const seven = card(7, "red");
    const state = stateWith({
      rulesMode: "taiwan",
      hands: [[seven, card(1, "blue")], [card(2, "yellow"), card(3, "yellow")], [card(4, "green")]],
    });
    const exchanged = expectAccepted(playCard(state, "p1", seven.id, { targetPlayerId: "p2" }));

    expect(exchanged.players[0]!.hand.map((card) => card.value)).toEqual([2, 3]);
    expect(exchanged.players[1]!.hand.map((card) => card.value)).toEqual([1]);
    expect(exchanged.lastAction.targetPlayerId).toBe("p2");
    expect(exchanged.unoVulnerablePlayerId).toBeNull();

    const zero = card(0, "red");
    const passing = stateWith({
      rulesMode: "taiwan",
      hands: [[zero, card(1, "red")], [card(2, "blue")], [card(3, "green")]],
    });
    const passed = expectAccepted(playCard(passing, "p1", zero.id));

    expect(passed.players[0]!.hand.map((card) => card.value)).toEqual([3]);
    expect(passed.players[1]!.hand.map((card) => card.value)).toEqual([1]);
    expect(passed.players[2]!.hand.map((card) => card.value)).toEqual([2]);
    expect(passed.unoVulnerablePlayerId).toBe("p1");
  });

  it("applies 7-0 effects before deciding multi-card UNO status", () => {
    const seven = card(7, "red");
    const secondSeven = card(7, "blue");
    const exchanged = stateWith({
      rulesMode: "taiwan",
      rulesOptions: { multiCardPlayEnabled: true },
      hands: [[seven, secondSeven, card(1, "green")], [card(2), card(3)]],
    });
    const sevenResult = expectAccepted(playCard(exchanged, "p1", seven.id, {
      additionalCardIds: [secondSeven.id],
      declareUno: true,
      targetPlayerId: "p2",
    }));

    expect(sevenResult.currentColor).toBe("blue");
    expect(sevenResult.players[0]!.hand.map((card) => card.value)).toEqual([2, 3]);
    expect(sevenResult.unoVulnerablePlayerId).toBeNull();
    expect(sevenResult.lastAction.declaredUno).toBeUndefined();

    const zero = card(0, "red");
    const secondZero = card(0, "blue");
    const passed = stateWith({
      rulesMode: "taiwan",
      rulesOptions: { multiCardPlayEnabled: true },
      hands: [[zero, secondZero, card(1, "red")], [card(2, "yellow")], [card(3, "green"), card(4, "green")]],
    });
    const zeroResult = expectAccepted(playCard(passed, "p1", zero.id, {
      additionalCardIds: [secondZero.id],
      declareUno: true,
    }));

    expect(zeroResult.currentColor).toBe("blue");
    expect(zeroResult.players.map((player) => player.hand.map((card) => card.value))).toEqual([
      [3, 4],
      [1],
      [2],
    ]);
    expect(zeroResult.currentPlayerIndex).toBe(1);
    expect(zeroResult.unoVulnerablePlayerId).toBeNull();
    expect(zeroResult.lastAction.declaredUno).toBeUndefined();
  });

  it("treats 7 and 0 as ordinary numbers when 7-0 is disabled", () => {
    const seven = card(7, "red");
    const state = stateWith({
      rulesMode: "taiwan",
      rulesOptions: { sevenZeroEnabled: false },
      hands: [[seven, card(1, "blue")], [card(2, "yellow"), card(3, "yellow")], [card(4, "green")]],
    });
    const playedSeven = expectAccepted(playCard(state, "p1", seven.id));

    expect(playedSeven.players[0]!.hand.map((card) => card.value)).toEqual([1]);
    expect(playedSeven.players[1]!.hand.map((card) => card.value)).toEqual([2, 3]);

    const zero = card(0, "red");
    const zeroState = stateWith({
      rulesMode: "taiwan",
      rulesOptions: { sevenZeroEnabled: false },
      hands: [[zero, card(1, "red")], [card(2, "blue")], [card(3, "green")]],
    });
    const playedZero = expectAccepted(playCard(zeroState, "p1", zero.id));

    expect(playedZero.players.map((player) => player.hand.map((card) => card.value))).toEqual([[1], [2], [3]]);
  });

  it("requires the current turn when Jump-In is disabled", () => {
    const jumpIn = card(5, "red");
    const state = stateWith({
      rulesMode: "taiwan",
      rulesOptions: { jumpInEnabled: false },
      hands: [[card(1, "red")], [jumpIn, card(2)], [card(3)]],
    });

    expect(playCard(state, "p2", jumpIn.id)).toMatchObject({
      ok: false,
      error: { code: "NOT_YOUR_TURN" },
    });
  });

  it("stacks draw four cards before resolving the challenge in Taiwan mode", () => {
    const first = card("wild-draw-four", null);
    const second = card("wild-draw-four", null);
    const state = stateWith({
      rulesMode: "taiwan",
      hands: [[first], [second], [card(3)]],
      drawPile: Array.from({ length: 10 }, (_, index) => card(index, "green")),
    });

    const firstPending = expectAccepted(playCard(state, "p1", first.id, { chosenColor: "blue" }));
    const secondPending = expectAccepted(playCard(firstPending, "p2", second.id, { chosenColor: "yellow" }));
    expect(secondPending.pendingDrawAmount).toBe(8);
    expect(secondPending.pendingDrawFour?.attackerId).toBe("p2");

    const accepted = resolveDrawFour(secondPending, "p3", false);
    expect(accepted).toMatchObject({ ok: true, state: { currentPlayerIndex: 0, pendingDrawAmount: 0 } });
    if (accepted.ok) expect(accepted.state.players[2]!.hand).toHaveLength(9);
  });
});

describe("drawing and reshuffling", () => {
  it("allows only a playable newly drawn card to be played immediately", () => {
    const otherPlayable = card(3, "red");
    const drawn = card(7, "red");
    const state = stateWith({
      hands: [[otherPlayable, card(1, "blue")], [card(2)]],
      drawPile: [drawn],
    });
    const drawResult = drawCard(state, "p1");
    expect(drawResult.ok).toBe(true);
    if (!drawResult.ok) return;

    expect(drawResult.state.currentPlayerIndex).toBe(0);
    expect(drawResult.state.drawnCardId).toBe(drawn.id);
    expect(playCard(drawResult.state, "p1", otherPlayable.id)).toMatchObject({
      ok: false,
      error: { code: "MUST_PLAY_DRAWN_CARD" },
    });

    const played = expectAccepted(playCard(drawResult.state, "p1", drawn.id));
    expect(played.currentPlayerIndex).toBe(1);
  });

  it("draws until a playable card appears in Taiwan mode", () => {
    const playable = card(7, "red");
    const state = stateWith({
      rulesMode: "taiwan",
      hands: [[card(1, "green")], [card(2, "blue")]],
      drawPile: [playable, card(8, "blue")],
    });

    const drawn = drawCard(state, "p1");

    expect(drawn).toMatchObject({ ok: true, state: { currentPlayerIndex: 0, drawnCardId: playable.id } });
    if (drawn.ok) expect(drawn.state.players[0]!.hand).toHaveLength(3);
  });

  it("draws only one card when draw-to-match is disabled", () => {
    const drawnCard = card(8, "blue");
    const state = stateWith({
      rulesMode: "taiwan",
      rulesOptions: { drawToMatchEnabled: false },
      hands: [[card(1, "green")], [card(2, "blue")]],
      drawPile: [card(7, "red"), drawnCard],
    });

    const drawn = drawCard(state, "p1");

    expect(drawn).toMatchObject({ ok: true, state: { drawnCardId: drawnCard.id } });
    if (drawn.ok) expect(drawn.state.players[0]!.hand).toHaveLength(2);
  });

  it("lets a player pass after drawing a playable card", () => {
    const drawn = card(7, "red");
    const state = stateWith({ hands: [[card(1)], [card(2)]], drawPile: [drawn] });
    const drawResult = drawCard(state, "p1");
    if (!drawResult.ok) throw new Error(drawResult.error.code);

    const passed = passAfterDraw(drawResult.state, "p1");
    expect(passed.ok).toBe(true);
    if (passed.ok) {
      expect(passed.state.currentPlayerIndex).toBe(1);
      expect(passed.state.drawnCardId).toBeNull();
    }
  });

  it("keeps the turn until the player manually passes after a non-playable draw", () => {
    const state = stateWith({
      hands: [[card(1)], [card(2)]],
      drawPile: [card(8, "blue")],
    });
    const result = drawCard(state, "p1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.currentPlayerIndex).toBe(0);
      expect(result.state.drawnCardId).not.toBeNull();
      expect(passAfterDraw(result.state, "p1")).toMatchObject({
        ok: true,
        state: { currentPlayerIndex: 1, drawnCardId: null },
      });
    }
  });

  it("keeps the current discard and reshuffles older discards", () => {
    const oldOne = card(1, "blue");
    const oldTwo = card(2, "green");
    const top = card(5, "red");
    const state = stateWith({ hands: [[card(3)], [card(4)]], top, drawPile: [] });
    state.discardPile = [oldOne, oldTwo, top];

    const result = drawCard(state, "p1", () => 0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.discardPile).toEqual([top]);
      expect(result.state.players[0]!.hand).toContainEqual(oldOne);
      expect(result.state.drawPile).toEqual([oldTwo]);
      expect(result.state.lastAction.shuffle).toBe("recycle");
    }
  });

  it("still lets a player pass when the exhausted pile has no card to draw", () => {
    const state = stateWith({
      hands: [[card(1)], [card(2)]],
      drawPile: [],
    });
    const drawn = drawCard(state, "p1");

    expect(drawn.ok).toBe(true);
    if (drawn.ok) {
      expect(drawn.state.hasDrawnThisTurn).toBe(true);
      expect(drawn.state.drawnCardId).toBeNull();
      expect(passAfterDraw(drawn.state, "p1")).toMatchObject({
        ok: true,
        state: { currentPlayerIndex: 1 },
      });
    }
  });
});

describe("UNO", () => {
  it("marks a one-card player vulnerable and lets them call UNO", () => {
    const played = card(7, "red");
    const state = stateWith({ hands: [[played, card(1)], [card(2)]] });
    const next = expectAccepted(playCard(state, "p1", played.id));

    expect(next.unoVulnerablePlayerId).toBe("p1");
    const called = callUno(next, "p1");
    expect(called.ok).toBe(true);
    if (called.ok) {
      expect(called.state.unoVulnerablePlayerId).toBeNull();
    }
  });

  it("supports declaring UNO as part of playing the penultimate card", () => {
    const played = card(7, "red");
    const state = stateWith({ hands: [[played, card(1)], [card(2)]] });
    const next = expectAccepted(
      playCard(state, "p1", played.id, { declareUno: true }),
    );

    expect(next.unoVulnerablePlayerId).toBeNull();
    expect(next.lastAction.declaredUno).toBe(true);
  });

  it("lets another player catch a missed UNO for a two-card penalty", () => {
    const played = card(7, "red");
    const state = stateWith({
      hands: [[played, card(1)], [card(2)]],
      drawPile: [card(8), card(9)],
    });
    const vulnerable = expectAccepted(playCard(state, "p1", played.id));
    const caught = catchUno(vulnerable, "p2");

    expect(caught.ok).toBe(true);
    if (caught.ok) {
      expect(caught.state.players[0]!.hand).toHaveLength(3);
      expect(caught.state.unoVulnerablePlayerId).toBeNull();
      expect(caught.state.lastAction.targetPlayerId).toBe("p1");
    }
  });

  it("closes the catch window when the next player completes an action", () => {
    const played = card(7, "red");
    const reply = card(9, "red");
    const state = stateWith({
      hands: [[played, card(1)], [reply, card(2), card(3)]],
    });
    const vulnerable = expectAccepted(playCard(state, "p1", played.id));
    const replied = expectAccepted(playCard(vulnerable, "p2", reply.id));

    expect(catchUno(replied, "p2")).toMatchObject({
      ok: false,
      error: { code: "NOT_UNO_VULNERABLE" },
    });
  });

  it("closes the catch window when the next player draws a playable card", () => {
    const played = card(7, "red");
    const state = stateWith({
      hands: [[played, card(1)], [card(2), card(3)]],
      drawPile: [card(9, "red")],
    });
    const vulnerable = expectAccepted(playCard(state, "p1", played.id));
    const drawn = drawCard(vulnerable, "p2");
    if (!drawn.ok) throw new Error(drawn.error.code);

    expect(drawn.state.drawnCardId).not.toBeNull();
    expect(callUno(drawn.state, "p1")).toMatchObject({
      ok: false,
      error: { code: "NOT_UNO_VULNERABLE" },
    });
    expect(catchUno(drawn.state, "p2")).toMatchObject({
      ok: false,
      error: { code: "NOT_UNO_VULNERABLE" },
    });
  });

  it("rejects a catch attempt from someone outside the game", () => {
    const played = card(7, "red");
    const state = stateWith({ hands: [[played, card(1)], [card(2)]] });
    const vulnerable = expectAccepted(playCard(state, "p1", played.id));

    expect(catchUno(vulnerable, "outsider")).toMatchObject({
      ok: false,
      error: { code: "PLAYER_NOT_IN_GAME" },
    });
  });
});

describe("wild draw four challenges", () => {
  it("lets the target accept four cards and lose their turn", () => {
    const drawFour = card("wild-draw-four", null);
    const state = stateWith({
      hands: [[drawFour, card(2, "blue")], [card(3)], [card(4)]],
      drawPile: Array.from({ length: 6 }, (_, index) => card(index, "green")),
    });
    const pending = expectAccepted(
      playCard(state, "p1", drawFour.id, { chosenColor: "blue" }),
    );

    expect(pending.phase).toBe("awaiting-draw-four-challenge");
    expect(pending.currentColor).toBe("blue");
    const resolved = resolveDrawFour(pending, "p2", false);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.state.players[1]!.hand).toHaveLength(5);
      expect(resolved.state.currentPlayerIndex).toBe(2);
    }
  });

  it("makes the attacker draw four after a successful challenge", () => {
    const drawFour = card("wild-draw-four", null);
    const matchingColor = card(9, "red");
    const state = stateWith({
      hands: [[drawFour, matchingColor], [card(3)], [card(4)]],
      drawPile: Array.from({ length: 6 }, (_, index) => card(index, "green")),
    });
    const pending = expectAccepted(
      playCard(state, "p1", drawFour.id, { chosenColor: "blue" }),
    );
    const resolved = resolveDrawFour(pending, "p2", true);

    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.state.lastAction.successful).toBe(true);
      expect(resolved.state.players[0]!.hand).toHaveLength(5);
      expect(resolved.state.players[1]!.hand).toHaveLength(1);
      expect(resolved.state.currentPlayerIndex).toBe(1);
    }
  });

  it("makes the target draw six after a failed challenge", () => {
    const drawFour = card("wild-draw-four", null);
    const state = stateWith({
      hands: [[drawFour, card(9, "blue")], [card(3)], [card(4)]],
      drawPile: Array.from({ length: 7 }, (_, index) => card(index, "green")),
    });
    const pending = expectAccepted(
      playCard(state, "p1", drawFour.id, { chosenColor: "blue" }),
    );
    const resolved = resolveDrawFour(pending, "p2", true);

    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.state.lastAction.successful).toBe(false);
      expect(resolved.state.players[1]!.hand).toHaveLength(7);
      expect(resolved.state.currentPlayerIndex).toBe(2);
    }
  });

  it("rejects a challenge when the +4 challenge option is disabled", () => {
    const drawFour = card("wild-draw-four", null);
    const state = stateWith({
      rulesOptions: { drawFourChallengeEnabled: false },
      hands: [[drawFour, card(9, "blue")], [card(3)], [card(4)]],
      drawPile: Array.from({ length: 7 }, (_, index) => card(index, "green")),
    });
    const pending = expectAccepted(playCard(state, "p1", drawFour.id, { chosenColor: "blue" }));

    expect(resolveDrawFour(pending, "p2", true)).toMatchObject({
      ok: false,
      error: { code: "DRAW_FOUR_CHALLENGE_DISABLED" },
    });
    expect(pending.phase).toBe("awaiting-draw-four-challenge");
  });

  it("defers victory until a final draw four challenge is resolved", () => {
    const legalDrawFour = card("wild-draw-four", null);
    const legalState = stateWith({
      hands: [[legalDrawFour], [card(3)]],
      drawPile: Array.from({ length: 7 }, (_, index) => card(index, "green")),
    });
    const pendingLegal = expectAccepted(
      playCard(legalState, "p1", legalDrawFour.id, { chosenColor: "blue" }),
    );
    expect(pendingLegal.phase).toBe("awaiting-draw-four-challenge");
    expect(pendingLegal.winnerId).toBeNull();

    const failedChallenge = resolveDrawFour(pendingLegal, "p2", true);
    expect(failedChallenge.ok).toBe(true);
    if (failedChallenge.ok) {
      expect(failedChallenge.state.phase).toBe("finished");
      expect(failedChallenge.state.winnerId).toBe("p1");
    }
  });
});

describe("victory", () => {
  it("finishes immediately when a normal final card is played", () => {
    const finalCard = card(5, "red");
    const state = stateWith({ hands: [[finalCard], [card(2)]] });
    const next = expectAccepted(playCard(state, "p1", finalCard.id));

    expect(next.phase).toBe("finished");
    expect(next.winnerId).toBe("p1");
    expect(playCard(next, "p2", next.players[1]!.hand[0]!.id)).toMatchObject({
      ok: false,
      error: { code: "GAME_NOT_PLAYING" },
    });
  });
});
