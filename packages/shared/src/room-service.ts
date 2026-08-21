import {
  callUno,
  catchUno,
  chooseStartingColor,
  drawCard,
  passAfterDraw,
  playCard,
  resolveDrawFour,
  startGame,
} from "./game/engine.js";
import type {
  CardColor,
  GameState,
  RuleResult,
} from "./game/types.js";
import { MAX_GAME_PLAYERS } from "./game/types.js";
import type {
  GameActionResponse,
  GameHistoryEntry,
  GameSnapshot,
  PlayCardPayload,
  RoomActionResponse,
  RoomError,
  RoomSnapshot,
} from "./room.js";
import { decideBotAction, type BotGameView } from "./game/bot.js";
import { normalizeNickname } from "./room.js";

export interface StoredRoomPlayer {
  id: string;
  nickname: string;
  tokenHash: string;
  isReady: boolean;
  isConnected: boolean;
  isBot: boolean;
  isBotManaged: boolean;
  reservedAt?: number;
}

export interface StoredRoom {
  code: string;
  hostId: string;
  players: StoredRoomPlayer[];
  game: GameState | null;
  actionHistory: GameHistoryEntry[];
  version: number;
}

export interface NewRoomPlayer {
  id: string;
  nickname: string;
  tokenHash: string;
}

export interface RoomServiceOptions {
  createId?: () => string;
}

export interface PlayerOperationResult {
  ok: true;
  playerId: string;
  reconnected: boolean;
}

export interface DisconnectResult {
  room: RoomSnapshot | null;
  deleted: boolean;
}

function failure(code: RoomError["code"], message: string): { ok: false; error: RoomError } {
  return { ok: false, error: { code, message } };
}

function isBotControlled(player: StoredRoomPlayer): boolean {
  return player.isBot || player.isBotManaged;
}

function botGameView(game: GameState, botId: string): BotGameView {
  const bot = game.players.find((player) => player.id === botId);
  const currentPlayer = game.players[game.currentPlayerIndex];
  const topDiscard = game.discardPile.at(-1);
  if (!bot || !currentPlayer || !topDiscard) {
    throw new RangeError("Cannot create a bot view from invalid game state");
  }
  return {
    hand: bot.hand,
    phase: game.phase,
    pendingDrawFour: game.pendingDrawFour
      ? { targetId: game.pendingDrawFour.targetId }
      : null,
    currentPlayerId: currentPlayer.id,
    currentColor: game.currentColor,
    drawnCardId: game.drawnCardId && bot.hand.some((card) => card.id === game.drawnCardId)
      ? game.drawnCardId
      : null,
    topDiscard,
  };
}

export function createRoomState(code: string, player: NewRoomPlayer): StoredRoom {
  return {
    code,
    hostId: player.id,
    players: [{
      ...player,
      isReady: false,
      isConnected: false,
      isBot: false,
      isBotManaged: false,
      reservedAt: Date.now(),
    }],
    game: null,
    actionHistory: [],
    version: 1,
  };
}

/**
 * Applies room and game mutations without knowing how a request is connected.
 * The Durable Object owns persistence and calls this service one event at a time.
 */
export class RoomService {
  private readonly createId: () => string;

  constructor(
    private readonly room: StoredRoom,
    options: RoomServiceOptions = {},
  ) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  get code(): string {
    return this.room.code;
  }

  get state(): StoredRoom {
    return this.room;
  }

  join(
    nicknameInput: string,
    reconnectTokenHash: string | undefined,
    newPlayer: NewRoomPlayer,
  ): PlayerOperationResult | { ok: false; error: RoomError } {
    const nickname = normalizeNickname(nicknameInput);
    if (!nickname) {
      return failure("INVALID_NICKNAME", "暱稱須為 2–20 個有效字元，且不可只包含標點符號");
    }

    if (reconnectTokenHash) {
      const returningPlayer = this.room.players.find((player) =>
        !player.isBot && player.tokenHash === reconnectTokenHash,
      );
      if (returningPlayer) {
        return { ok: true, playerId: returningPlayer.id, reconnected: true };
      }
    }

    if (this.room.game !== null) {
      return failure("GAME_ALREADY_STARTED", "遊戲已經開始");
    }
    if (this.room.players.length >= MAX_GAME_PLAYERS) {
      return failure("ROOM_FULL", "房間已滿");
    }
    if (this.room.players.some((player) =>
      player.nickname.localeCompare(nickname, undefined, { sensitivity: "accent" }) === 0,
    )) {
      return failure("NICKNAME_TAKEN", "此暱稱已有人使用");
    }

    this.room.players.push({
      ...newPlayer,
      nickname,
      isReady: false,
      isConnected: false,
      isBot: false,
      isBotManaged: false,
      reservedAt: Date.now(),
    });
    this.room.version += 1;
    return { ok: true, playerId: newPlayer.id, reconnected: false };
  }

  attach(playerId: string, tokenHash: string): PlayerOperationResult | { ok: false; error: RoomError } {
    const player = this.room.players.find((candidate) =>
      !candidate.isBot && candidate.id === playerId && candidate.tokenHash === tokenHash,
    );
    if (!player) return failure("NOT_IN_ROOM", "房間連線權杖無效");
    const changed = !player.isConnected || player.isBotManaged;
    player.isConnected = true;
    player.isBotManaged = false;
    delete player.reservedAt;
    if (changed) this.room.version += 1;
    return { ok: true, playerId: player.id, reconnected: changed };
  }

  isDisconnected(playerId: string): boolean {
    const player = this.room.players.find((candidate) => candidate.id === playerId);
    return Boolean(player && !player.isConnected && player.isBotManaged);
  }

  setReady(playerId: string, isReady: boolean): RoomActionResponse {
    const found = this.findPlayer(playerId);
    if (!found) return failure("NOT_IN_ROOM", "你不在房間內");
    if (this.room.game !== null) return failure("GAME_ALREADY_STARTED", "遊戲已經開始");
    if (found.player.id === this.room.hostId) return failure("HOST_CANNOT_READY", "房主不需要準備");
    found.player.isReady = isReady;
    this.room.version += 1;
    return { ok: true, room: this.snapshot() };
  }

  addBot(playerId: string): RoomActionResponse {
    const found = this.findPlayer(playerId);
    if (!found) return failure("NOT_IN_ROOM", "你不在房間內");
    if (found.player.id !== this.room.hostId) return failure("HOST_ONLY", "只有房主可以加入機器人");
    if (this.room.game !== null) return failure("GAME_ALREADY_STARTED", "遊戲已經開始");
    if (this.room.players.length >= MAX_GAME_PLAYERS) return failure("ROOM_FULL", "房間已滿");

    let botNumber = 1;
    let nickname = "UNO Bot";
    while (this.room.players.some((player) =>
      player.nickname.localeCompare(nickname, undefined, { sensitivity: "accent" }) === 0,
    )) {
      botNumber += 1;
      nickname = `UNO Bot ${botNumber}`;
    }
    const id = this.createId();
    this.room.players.push({
      id,
      nickname,
      tokenHash: "",
      isReady: true,
      isConnected: true,
      isBot: true,
      isBotManaged: false,
    });
    this.room.version += 1;
    return { ok: true, room: this.snapshot() };
  }

  removeBot(playerId: string, botId: string): RoomActionResponse {
    const found = this.findPlayer(playerId);
    if (!found) return failure("NOT_IN_ROOM", "你不在房間內");
    if (found.player.id !== this.room.hostId) return failure("HOST_ONLY", "只有房主可以移除機器人");
    if (this.room.game !== null) return failure("GAME_ALREADY_STARTED", "遊戲已經開始");
    const botIndex = this.room.players.findIndex((player) => player.id === botId && player.isBot);
    if (botIndex < 0) return failure("BOT_NOT_FOUND", "找不到這個機器人");
    this.room.players.splice(botIndex, 1);
    this.room.version += 1;
    return { ok: true, room: this.snapshot() };
  }

  setBotControl(playerId: string, enabled: boolean): RoomActionResponse {
    const found = this.findPlayer(playerId);
    if (!found) return failure("NOT_IN_ROOM", "你不在房間內");
    if (!this.room.game || this.room.game.phase === "finished") {
      return failure("BOT_CONTROL_UNAVAILABLE", "只有進行中的牌局可以使用機器人代管");
    }
    if (found.player.isBot) return failure("BOT_CONTROL_UNAVAILABLE", "機器人座位不需要代管");
    if (found.player.isBotManaged === enabled) return { ok: true, room: this.snapshot() };
    found.player.isBotManaged = enabled;
    this.room.version += 1;
    return { ok: true, room: this.snapshot() };
  }

  start(playerId: string): RoomActionResponse {
    const found = this.findPlayer(playerId);
    if (!found) return failure("NOT_IN_ROOM", "你不在房間內");
    if (found.player.id !== this.room.hostId) return failure("HOST_ONLY", "只有房主可以開始遊戲");
    if (this.room.game !== null) return failure("GAME_ALREADY_STARTED", "遊戲已經開始");
    if (this.room.players.length < 2) return failure("NOT_ENOUGH_PLAYERS", "至少需要 2 位玩家");
    if (this.room.players.some((player) =>
      !player.isConnected || (player.id !== this.room.hostId && !player.isBot && !player.isReady),
    )) {
      return failure("PLAYERS_NOT_READY", "所有其他玩家都必須準備完成");
    }
    this.room.game = startGame(this.room.players.map((player) => player.id));
    this.room.actionHistory = [this.historyEntry(this.room.game)];
    this.room.players.forEach((player) => {
      player.isReady = player.isBot;
      player.isBotManaged = false;
      delete player.reservedAt;
    });
    this.room.version += 1;
    return { ok: true, room: this.snapshot() };
  }

  rematch(playerId: string): RoomActionResponse {
    const found = this.findPlayer(playerId);
    if (!found) return failure("NOT_IN_ROOM", "你不在房間內");
    if (found.player.id !== this.room.hostId) return failure("HOST_ONLY", "只有房主可以重新開始遊戲");
    if (this.room.game?.phase !== "finished") return failure("GAME_NOT_FINISHED", "遊戲尚未結束");
    if (this.room.players.length < 2) return failure("NOT_ENOUGH_PLAYERS", "至少需要 2 位玩家");
    if (this.room.players.some((player) => !player.isConnected)) {
      return failure("GAME_PAUSED", "有玩家連線中斷，暫時無法重新開始");
    }
    this.room.game = startGame(this.room.players.map((player) => player.id));
    this.room.actionHistory = [this.historyEntry(this.room.game)];
    this.room.players.forEach((player) => {
      player.isBotManaged = false;
      delete player.reservedAt;
    });
    this.room.version += 1;
    return { ok: true, room: this.snapshot() };
  }

  leave(playerId: string): DisconnectResult {
    const playerIndex = this.room.players.findIndex((player) => player.id === playerId);
    if (playerIndex < 0) return { room: null, deleted: false };

    this.room.players.splice(playerIndex, 1);
    if (this.room.game !== null) {
      this.room.game = null;
      this.room.actionHistory = [];
      this.room.players = this.room.players.filter((player) => player.isConnected);
      this.room.players.forEach((player) => {
        player.isReady = player.isBot;
        player.isBotManaged = false;
      });
    }
    return this.finishPlayerRemoval();
  }

  disconnect(playerId: string): DisconnectResult {
    const player = this.room.players.find((candidate) => candidate.id === playerId);
    if (!player) return { room: null, deleted: false };

    if (this.room.game?.phase !== "finished" && this.room.game !== null && !player.isBot) {
      if (!player.isConnected && player.isBotManaged) {
        return { room: this.snapshot(), deleted: false };
      }
      player.isConnected = false;
      player.isBotManaged = true;
      delete player.reservedAt;
      this.transferHost();
      if (!this.hasConnectedHuman()) return { room: null, deleted: true };
      this.room.version += 1;
      return { room: this.snapshot(), deleted: false };
    }

    const index = this.room.players.indexOf(player);
    this.room.players.splice(index, 1);
    return this.finishPlayerRemoval();
  }

  play(playerId: string, payload: PlayCardPayload): GameActionResponse {
    return this.applyGameAction(playerId, (game, id) => playCard(game, id, payload.cardId, {
      ...(payload.chosenColor ? { chosenColor: payload.chosenColor } : {}),
      declareUno: payload.declareUno,
    }));
  }

  draw(playerId: string): GameActionResponse {
    return this.applyGameAction(playerId, drawCard);
  }

  pass(playerId: string): GameActionResponse {
    return this.applyGameAction(playerId, passAfterDraw);
  }

  chooseColor(playerId: string, color: CardColor): GameActionResponse {
    return this.applyGameAction(playerId, (game, id) => chooseStartingColor(game, id, color));
  }

  callUno(playerId: string): GameActionResponse {
    return this.applyGameAction(playerId, callUno);
  }

  catchUno(playerId: string): GameActionResponse {
    return this.applyGameAction(playerId, catchUno);
  }

  resolveDrawFour(playerId: string, challenge: boolean): GameActionResponse {
    return this.applyGameAction(playerId, (game, id) => resolveDrawFour(game, id, challenge));
  }

  hasPendingBotAction(): boolean {
    if (!this.hasConnectedHuman() || !this.room.game) return false;
    if (this.room.game.unoVulnerablePlayerId && this.room.players.some(isBotControlled)) return true;
    if (this.room.game.phase === "awaiting-draw-four-challenge") {
      return this.room.players.some((player) =>
        isBotControlled(player) && player.id === this.room.game!.pendingDrawFour?.targetId,
      );
    }
    const current = this.room.game.players[this.room.game.currentPlayerIndex];
    return this.room.game.phase === "playing" && this.room.players.some((player) =>
      isBotControlled(player) && player.id === current?.id,
    );
  }

  /** Removes HTTP seats that never completed WebSocket attach. */
  cleanupReservations(now: number, ttlMs: number): DisconnectResult {
    if (this.room.game !== null) return { room: this.snapshot(), deleted: false };
    const originalCount = this.room.players.length;
    this.room.players = this.room.players.filter((player) =>
      player.isBot || player.isConnected || player.reservedAt === undefined ||
      now - player.reservedAt < ttlMs,
    );
    if (this.room.players.length === originalCount) return { room: this.snapshot(), deleted: false };
    return this.finishPlayerRemoval();
  }

  /** Returns the next lobby reservation deadline so the DO can share its alarm with bot turns. */
  nextReservationAt(ttlMs: number): number | null {
    if (this.room.game !== null) return null;
    const reservations = this.room.players
      .filter((player) => !player.isBot && !player.isConnected && player.reservedAt !== undefined)
      .map((player) => player.reservedAt! + ttlMs);
    return reservations.length > 0 ? Math.min(...reservations) : null;
  }

  performBotAction(): boolean {
    if (!this.hasConnectedHuman() || !this.room.game) return false;

    const vulnerablePlayer = this.room.players.find((player) =>
      player.id === this.room.game!.unoVulnerablePlayerId,
    );
    if (vulnerablePlayer && isBotControlled(vulnerablePlayer)) {
      return this.applyRoomGameAction(vulnerablePlayer.id, callUno).ok;
    }

    const catcher = this.room.players.find((player) =>
      isBotControlled(player) && player.id !== this.room.game!.unoVulnerablePlayerId,
    );
    if (this.room.game.unoVulnerablePlayerId && catcher) {
      return this.applyRoomGameAction(catcher.id, catchUno).ok;
    }

    const currentId = this.room.game.phase === "awaiting-draw-four-challenge"
      ? this.room.game.pendingDrawFour?.targetId
      : this.room.game.players[this.room.game.currentPlayerIndex]?.id;
    const bot = this.room.players.find((player) =>
      isBotControlled(player) && player.id === currentId,
    );
    if (!bot) return false;
    const decision = decideBotAction(botGameView(this.room.game, bot.id), bot.id);
    let result: RuleResult;
    switch (decision.type) {
      case "choose-color":
        result = chooseStartingColor(this.room.game, bot.id, decision.color);
        break;
      case "resolve-draw-four":
        result = resolveDrawFour(this.room.game, bot.id, false);
        break;
      case "play":
        result = playCard(this.room.game, bot.id, decision.cardId, {
          ...(decision.chosenColor ? { chosenColor: decision.chosenColor } : {}),
          declareUno: decision.declareUno,
        });
        break;
      case "draw":
        result = drawCard(this.room.game, bot.id);
        break;
      case "pass":
        result = passAfterDraw(this.room.game, bot.id);
        break;
      case "none":
        return false;
    }
    return this.acceptRoomGameResult(result).ok;
  }

  gameSnapshot(playerId: string): GameSnapshot | null {
    if (!this.room.game) return null;
    return this.gameSnapshotFromState(this.room.game, playerId);
  }

  snapshot(): RoomSnapshot {
    const canStart =
      this.room.game === null &&
      this.room.players.length >= 2 &&
      this.room.players.every((player) =>
        player.isConnected && (player.id === this.room.hostId || player.isBot || player.isReady),
      );
    return {
      code: this.room.code,
      phase: this.room.game?.phase ?? "lobby",
      hostId: this.room.hostId,
      players: this.room.players.map((player) => ({
        id: player.id,
        nickname: player.nickname,
        isBot: player.isBot,
        isHost: player.id === this.room.hostId,
        isReady: player.isReady,
        isConnected: player.isConnected,
        isBotManaged: player.isBotManaged,
      })),
      canStart,
      winnerId: this.room.game?.winnerId ?? null,
      version: this.room.version,
    };
  }

  private findPlayer(playerId: string): StoredRoom & { player: StoredRoomPlayer } | null {
    const player = this.room.players.find((candidate) => candidate.id === playerId);
    return player ? ({ ...this.room, player } as StoredRoom & { player: StoredRoomPlayer }) : null;
  }

  private finishPlayerRemoval(): DisconnectResult {
    if (this.room.players.length === 0 || this.room.players.every((player) => player.isBot)) {
      return { room: null, deleted: true };
    }
    this.transferHost();
    this.room.version += 1;
    return { room: this.snapshot(), deleted: false };
  }

  private transferHost(): void {
    if (this.room.players.some((player) => player.id === this.room.hostId)) return;
    const nextHost = this.room.players.find((player) => !player.isBot && player.isConnected) ??
      this.room.players.find((player) => !player.isBot);
    if (nextHost) this.room.hostId = nextHost.id;
  }

  private hasConnectedHuman(): boolean {
    return this.room.players.some((player) => !player.isBot && player.isConnected);
  }

  private applyGameAction(
    playerId: string,
    action: (game: GameState, playerId: string) => RuleResult,
  ): GameActionResponse {
    const found = this.findPlayer(playerId);
    if (!found) return failure("NOT_IN_ROOM", "你不在房間內");
    if (!this.room.game) return failure("GAME_NOT_FINISHED", "遊戲尚未開始");
    if (found.player.isBotManaged) return failure("BOT_CONTROL_ACTIVE", "機器人正在代管，請先取回控制");
    if (
      this.room.game.phase !== "finished" &&
      this.room.players.some((player) => !player.isConnected && !player.isBotManaged)
    ) {
      return failure("GAME_PAUSED", "有玩家連線中斷，牌局已暫停");
    }
    return this.applyRoomGameAction(playerId, action);
  }

  private applyRoomGameAction(
    playerId: string,
    action: (game: GameState, playerId: string) => RuleResult,
  ): GameActionResponse {
    if (!this.room.game) return failure("GAME_NOT_FINISHED", "遊戲尚未開始");
    return this.acceptRoomGameResult(action(this.room.game, playerId));
  }

  private acceptRoomGameResult(result: RuleResult): GameActionResponse {
    if (!result.ok) return { ok: false, error: result.error };
    this.room.game = result.state;
    this.room.actionHistory.push(this.historyEntry(this.room.game));
    this.room.actionHistory = this.room.actionHistory.slice(-40);
    if (this.room.game.phase === "finished") {
      this.room.players = this.room.players.filter((player) => player.isBot || player.isConnected);
      this.room.players.forEach((player) => {
        if (!player.isBot) player.isBotManaged = false;
      });
      this.transferHost();
      this.room.game.players.forEach((player) => {
        player.hand = [];
      });
      this.room.game.drawPile = [];
      this.room.game.discardPile = this.room.game.discardPile.slice(-1);
      this.room.game.drawnCardId = null;
    }
    this.room.version += 1;
    return { ok: true };
  }

  private historyEntry(game: GameState): GameHistoryEntry {
    const playedCard = game.lastAction.cardId
      ? game.discardPile.find((card) => card.id === game.lastAction.cardId)
      : undefined;
    return {
      version: game.version,
      action: { ...game.lastAction },
      ...(playedCard ? { card: { ...playedCard } } : {}),
    };
  }

  private gameSnapshotFromState(game: GameState, playerId: string): GameSnapshot {
    const player = game.players.find((candidate) => candidate.id === playerId);
    const topDiscard = game.discardPile.at(-1);
    const currentPlayer = game.players[game.currentPlayerIndex];
    if (!player || !topDiscard || !currentPlayer) {
      throw new RangeError("Cannot create a game snapshot from invalid state");
    }
    return {
      players: game.players.map((candidate) => ({ id: candidate.id, handCount: candidate.hand.length })),
      hand: player.hand.map((card) => ({ ...card })),
      topDiscard: { ...topDiscard },
      drawPileCount: game.drawPile.length,
      currentColor: game.currentColor,
      currentPlayerId: currentPlayer.id,
      direction: game.direction,
      phase: game.phase,
      drawnCardId: game.drawnCardId && player.hand.some((card) => card.id === game.drawnCardId)
        ? game.drawnCardId
        : null,
      unoVulnerablePlayerId: game.unoVulnerablePlayerId,
      pendingDrawFour: game.pendingDrawFour
        ? { attackerId: game.pendingDrawFour.attackerId, targetId: game.pendingDrawFour.targetId }
        : null,
      winnerId: game.winnerId,
      lastAction: { ...game.lastAction },
      actionHistory: this.room.actionHistory.map((entry) => ({
        version: entry.version,
        action: { ...entry.action },
        ...(entry.card ? { card: { ...entry.card } } : {}),
      })),
      version: game.version,
    };
  }
}
