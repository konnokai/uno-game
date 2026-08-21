import { randomBytes, randomUUID } from "node:crypto";
import {
  callUno,
  catchUno,
  chooseStartingColor,
  drawCard,
  normalizeNickname,
  passAfterDraw,
  playCard,
  MAX_GAME_PLAYERS,
  resolveDrawFour,
  ROOM_CODE_LENGTH,
  startGame,
  type CardColor,
  type GameActionResponse,
  type GameHistoryEntry,
  type GameSnapshot,
  type GameState,
  type PlayCardPayload,
  type RuleResult,
  type RoomActionResponse,
  type RoomError,
  type RoomListItem,
  type RoomSessionResponse,
  type RoomSnapshot,
} from "@uno/shared";
import { decideBotAction, type BotGameView } from "./bot-player.js";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

interface RoomMember {
  id: string;
  nickname: string;
  token: string;
  socketId: string;
  isReady: boolean;
  isConnected: boolean;
  isBot: boolean;
  isBotManaged: boolean;
}

interface Room {
  code: string;
  hostId: string;
  players: RoomMember[];
  game: GameState | null;
  actionHistory: GameHistoryEntry[];
  version: number;
}

export interface RoomManagerOptions {
  createId?: () => string;
  createToken?: () => string;
  createCode?: () => string;
}

export interface DisconnectResult {
  roomCode: string;
  room: RoomSnapshot | null;
}

interface GameRecipient {
  socketId: string;
  state: GameSnapshot;
}

function failure(code: RoomError["code"], message: string): { ok: false; error: RoomError } {
  return { ok: false, error: { code, message } };
}

function isBotControlled(player: RoomMember): boolean {
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

function defaultRoomCode(): string {
  const bytes = randomBytes(ROOM_CODE_LENGTH);
  return Array.from(bytes, (byte) => ROOM_ALPHABET[byte & 31]).join("");
}

export function normalizeRoomCode(value: string): string | null {
  const code = value.trim().toUpperCase();
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code) ? code : null;
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly memberships = new Map<string, string>();
  private readonly createId: () => string;
  private readonly createToken: () => string;
  private readonly createCode: () => string;

  constructor(options: RoomManagerOptions = {}) {
    this.createId = options.createId ?? randomUUID;
    this.createToken = options.createToken ?? (() => randomBytes(32).toString("base64url"));
    this.createCode = options.createCode ?? defaultRoomCode;
  }

  create(socketId: string, nicknameInput: string): RoomSessionResponse {
    if (this.memberships.has(socketId)) {
      return failure("ALREADY_IN_ROOM", "你已經在一個房間內");
    }
    const nickname = normalizeNickname(nicknameInput);
    if (!nickname) {
      return failure("INVALID_NICKNAME", "暱稱須為 2–20 個有效字元，且不可只包含標點符號");
    }

    let code = this.createCode();
    for (let attempt = 0; this.rooms.has(code) && attempt < 20; attempt += 1) {
      code = this.createCode();
    }
    if (this.rooms.has(code)) {
      throw new Error("Unable to generate a unique room code");
    }

    const player: RoomMember = {
      id: this.createId(),
      nickname,
      token: this.createToken(),
      socketId,
      isReady: false,
      isConnected: true,
      isBot: false,
      isBotManaged: false,
    };
    const room: Room = {
      code,
      hostId: player.id,
      players: [player],
      game: null,
      actionHistory: [],
      version: 1,
    };
    this.rooms.set(code, room);
    this.memberships.set(socketId, code);
    return this.sessionSuccess(room, player);
  }

  join(
    socketId: string,
    roomCodeInput: string,
    nicknameInput: string,
    playerToken?: string,
  ): RoomSessionResponse {
    const existingMembership = this.memberships.get(socketId);
    if (existingMembership) {
      return failure("ALREADY_IN_ROOM", "你已經在一個房間內");
    }
    const code = normalizeRoomCode(roomCodeInput);
    if (!code) {
      return failure("INVALID_ROOM_CODE", "房號格式不正確");
    }
    const nickname = normalizeNickname(nicknameInput);
    if (!nickname) {
      return failure("INVALID_NICKNAME", "暱稱須為 2–20 個有效字元，且不可只包含標點符號");
    }
    const room = this.rooms.get(code);
    if (!room) {
      return failure("ROOM_NOT_FOUND", "找不到這個房間");
    }

    if (playerToken) {
      const returningPlayer = room.players.find((player) => !player.isBot && player.token === playerToken);
      if (returningPlayer) {
        if (returningPlayer.isConnected) this.memberships.delete(returningPlayer.socketId);
        returningPlayer.socketId = socketId;
        returningPlayer.isConnected = true;
        returningPlayer.isBotManaged = false;
        this.memberships.set(socketId, code);
        room.version += 1;
        return this.sessionSuccess(room, returningPlayer);
      }
    }

    if (room.game !== null) {
      return failure("GAME_ALREADY_STARTED", "遊戲已經開始");
    }
    if (room.players.length >= MAX_GAME_PLAYERS) {
      return failure("ROOM_FULL", "房間已滿");
    }
    if (room.players.some((player) => player.nickname.localeCompare(nickname, undefined, { sensitivity: "accent" }) === 0)) {
      return failure("NICKNAME_TAKEN", "此暱稱已有人使用");
    }

    const player: RoomMember = {
      id: this.createId(),
      nickname,
      token: this.createToken(),
      socketId,
      isReady: false,
      isConnected: true,
      isBot: false,
      isBotManaged: false,
    };
    room.players.push(player);
    room.version += 1;
    this.memberships.set(socketId, code);
    return this.sessionSuccess(room, player);
  }

  setReady(socketId: string, isReady: boolean): RoomActionResponse {
    const found = this.findBySocket(socketId);
    if (!found) {
      return failure("NOT_IN_ROOM", "你不在房間內");
    }
    if (found.room.game !== null) {
      return failure("GAME_ALREADY_STARTED", "遊戲已經開始");
    }
    if (found.player.id === found.room.hostId) {
      return failure("HOST_CANNOT_READY", "房主不需要準備");
    }
    found.player.isReady = isReady;
    found.room.version += 1;
    return { ok: true, room: this.snapshot(found.room) };
  }

  addBot(socketId: string): RoomActionResponse {
    const found = this.findBySocket(socketId);
    if (!found) return failure("NOT_IN_ROOM", "你不在房間內");
    if (found.player.id !== found.room.hostId) {
      return failure("HOST_ONLY", "只有房主可以加入機器人");
    }
    if (found.room.game !== null) {
      return failure("GAME_ALREADY_STARTED", "遊戲已經開始");
    }
    if (found.room.players.length >= MAX_GAME_PLAYERS) {
      return failure("ROOM_FULL", "房間已滿");
    }

    let botNumber = 1;
    let botNickname = "UNO Bot";
    while (found.room.players.some((player) =>
      player.nickname.localeCompare(botNickname, undefined, { sensitivity: "accent" }) === 0,
    )) {
      botNumber += 1;
      botNickname = `UNO Bot ${botNumber}`;
    }
    const id = this.createId();
    found.room.players.push({
      id,
      nickname: botNickname,
      token: "",
      socketId: `bot:${id}`,
      isReady: true,
      isConnected: true,
      isBot: true,
      isBotManaged: false,
    });
    found.room.version += 1;
    return { ok: true, room: this.snapshot(found.room) };
  }

  removeBot(socketId: string, botId: string): RoomActionResponse {
    const found = this.findBySocket(socketId);
    if (!found) return failure("NOT_IN_ROOM", "你不在房間內");
    if (found.player.id !== found.room.hostId) {
      return failure("HOST_ONLY", "只有房主可以移除機器人");
    }
    if (found.room.game !== null) {
      return failure("GAME_ALREADY_STARTED", "遊戲已經開始");
    }
    const botIndex = found.room.players.findIndex((player) => player.id === botId && player.isBot);
    if (botIndex < 0) return failure("BOT_NOT_FOUND", "找不到這個機器人");
    found.room.players.splice(botIndex, 1);
    found.room.version += 1;
    return { ok: true, room: this.snapshot(found.room) };
  }

  setBotControl(socketId: string, enabled: boolean): RoomActionResponse {
    const found = this.findBySocket(socketId);
    if (!found) return failure("NOT_IN_ROOM", "你不在房間內");
    if (!found.room.game || found.room.game.phase === "finished") {
      return failure("BOT_CONTROL_UNAVAILABLE", "只有進行中的牌局可以使用機器人代管");
    }
    if (found.player.isBot) {
      return failure("BOT_CONTROL_UNAVAILABLE", "機器人座位不需要代管");
    }
    if (found.player.isBotManaged === enabled) {
      return { ok: true, room: this.snapshot(found.room) };
    }

    found.player.isBotManaged = enabled;
    found.room.version += 1;
    return { ok: true, room: this.snapshot(found.room) };
  }

  start(socketId: string): RoomActionResponse {
    const found = this.findBySocket(socketId);
    if (!found) {
      return failure("NOT_IN_ROOM", "你不在房間內");
    }
    if (found.player.id !== found.room.hostId) {
      return failure("HOST_ONLY", "只有房主可以開始遊戲");
    }
    if (found.room.game !== null) {
      return failure("GAME_ALREADY_STARTED", "遊戲已經開始");
    }
    if (found.room.players.length < 2) {
      return failure("NOT_ENOUGH_PLAYERS", "至少需要 2 位玩家");
    }
    if (found.room.players.some((player) =>
      !player.isConnected || (player.id !== found.room.hostId && !player.isBot && !player.isReady),
    )) {
      return failure("PLAYERS_NOT_READY", "所有其他玩家都必須準備完成");
    }
    found.room.game = startGame(found.room.players.map((player) => player.id));
    found.room.actionHistory = [this.historyEntry(found.room.game)];
    found.room.players.forEach((player) => {
      player.isReady = player.isBot;
      player.isBotManaged = false;
    });
    found.room.version += 1;
    return { ok: true, room: this.snapshot(found.room) };
  }

  rematch(socketId: string): RoomActionResponse {
    const found = this.findBySocket(socketId);
    if (!found) {
      return failure("NOT_IN_ROOM", "你不在房間內");
    }
    if (found.player.id !== found.room.hostId) {
      return failure("HOST_ONLY", "只有房主可以重新開始遊戲");
    }
    if (found.room.game?.phase !== "finished") {
      return failure("GAME_NOT_FINISHED", "遊戲尚未結束");
    }
    if (found.room.players.some((player) => !player.isConnected)) {
      return failure("GAME_PAUSED", "有玩家連線中斷，暫時無法重新開始");
    }
    found.room.game = startGame(found.room.players.map((player) => player.id));
    found.room.actionHistory = [this.historyEntry(found.room.game)];
    found.room.players.forEach((player) => {
      player.isBotManaged = false;
    });
    found.room.version += 1;
    return { ok: true, room: this.snapshot(found.room) };
  }

  leave(socketId: string): RoomActionResponse {
    const result = this.removeSocket(socketId, true);
    if (!result) {
      return failure("NOT_IN_ROOM", "你不在房間內");
    }
    if (!result.room) {
      return { ok: true, room: null };
    }
    return { ok: true, room: result.room };
  }

  disconnect(socketId: string): DisconnectResult | null {
    return this.removeSocket(socketId, false);
  }

  getRoom(code: string): RoomSnapshot | null {
    const room = this.rooms.get(code);
    return room ? this.snapshot(room) : null;
  }

  listRooms(): RoomListItem[] {
    return [...this.rooms.values()]
      .filter((room) => room.game === null)
      .map((room) => {
        const host = room.players.find((player) => player.id === room.hostId);
        if (!host) throw new RangeError("Room has no host");
        return {
          code: room.code,
          hostNickname: host.nickname,
          playerCount: room.players.length,
          maxPlayers: MAX_GAME_PLAYERS,
          isFull: room.players.length >= MAX_GAME_PLAYERS,
        };
      });
  }

  getRoomCode(socketId: string): string | null {
    return this.memberships.get(socketId) ?? null;
  }

  canReconnect(roomCodeInput: string, playerToken: string): boolean {
    const code = normalizeRoomCode(roomCodeInput);
    const room = code ? this.rooms.get(code) : undefined;
    return room?.players.some((player) => !player.isBot && player.token === playerToken) ?? false;
  }

  getPlayerId(socketId: string): string | null {
    return this.findBySocket(socketId)?.player.id ?? null;
  }

  getGameRecipients(code: string): GameRecipient[] {
    const room = this.rooms.get(code);
    if (!room?.game) return [];
    return room.players
      .filter((player) => player.isConnected && !player.isBot)
      .map((player) => ({
        socketId: player.socketId,
        state: this.gameSnapshot(room.game!, player.id, room.actionHistory),
      }));
  }

  play(socketId: string, payload: PlayCardPayload): GameActionResponse {
    return this.applyGameAction(socketId, (game, playerId) =>
      playCard(game, playerId, payload.cardId, {
        ...(payload.chosenColor ? { chosenColor: payload.chosenColor } : {}),
        declareUno: payload.declareUno,
      }),
    );
  }

  draw(socketId: string): GameActionResponse {
    return this.applyGameAction(socketId, drawCard);
  }

  pass(socketId: string): GameActionResponse {
    return this.applyGameAction(socketId, passAfterDraw);
  }

  chooseColor(socketId: string, color: CardColor): GameActionResponse {
    return this.applyGameAction(socketId, (game, playerId) =>
      chooseStartingColor(game, playerId, color),
    );
  }

  callUno(socketId: string): GameActionResponse {
    return this.applyGameAction(socketId, callUno);
  }

  catchUno(socketId: string): GameActionResponse {
    return this.applyGameAction(socketId, catchUno);
  }

  resolveDrawFour(socketId: string, challenge: boolean): GameActionResponse {
    return this.applyGameAction(socketId, (game, playerId) =>
      resolveDrawFour(game, playerId, challenge),
    );
  }

  hasPendingBotAction(code: string): boolean {
    const room = this.rooms.get(code);
    if (
      !room?.game ||
      room.players.some((player) => !player.isConnected && !player.isBotManaged)
    ) return false;
    if (
      room.game.unoVulnerablePlayerId &&
      room.players.some(isBotControlled)
    ) {
      return true;
    }
    if (room.game.phase === "awaiting-draw-four-challenge") {
      return room.players.some((player) =>
        isBotControlled(player) && player.id === room.game!.pendingDrawFour?.targetId,
      );
    }
    const current = room.game.players[room.game.currentPlayerIndex];
    return room.game.phase === "playing" &&
      room.players.some((player) => isBotControlled(player) && player.id === current?.id);
  }

  performBotAction(code: string): boolean {
    const room = this.rooms.get(code);
    if (
      !room?.game ||
      room.players.some((player) => !player.isConnected && !player.isBotManaged)
    ) return false;

    const vulnerablePlayer = room.players.find((player) =>
      player.id === room.game!.unoVulnerablePlayerId,
    );
    if (vulnerablePlayer && isBotControlled(vulnerablePlayer)) {
      return this.applyRoomGameAction(room, vulnerablePlayer.id, callUno).ok;
    }

    const catcher = room.players.find((player) =>
      isBotControlled(player) && player.id !== room.game!.unoVulnerablePlayerId,
    );
    if (room.game.unoVulnerablePlayerId && catcher) {
      return this.applyRoomGameAction(room, catcher.id, catchUno).ok;
    }

    const currentId = room.game.phase === "awaiting-draw-four-challenge"
      ? room.game.pendingDrawFour?.targetId
      : room.game.players[room.game.currentPlayerIndex]?.id;
    const bot = room.players.find((player) =>
      isBotControlled(player) && player.id === currentId,
    );
    if (!bot) return false;
    const decision = decideBotAction(botGameView(room.game, bot.id), bot.id);
    let result: RuleResult;
    switch (decision.type) {
      case "choose-color":
        result = chooseStartingColor(room.game, bot.id, decision.color);
        break;
      case "resolve-draw-four":
        result = resolveDrawFour(room.game, bot.id, false);
        break;
      case "play":
        result = playCard(room.game, bot.id, decision.cardId, {
          ...(decision.chosenColor ? { chosenColor: decision.chosenColor } : {}),
          declareUno: decision.declareUno,
        });
        break;
      case "draw":
        result = drawCard(room.game, bot.id);
        break;
      case "pass":
        result = passAfterDraw(room.game, bot.id);
        break;
      case "none":
        return false;
    }
    return this.acceptRoomGameResult(room, result).ok;
  }

  private removeSocket(socketId: string, explicit: boolean): DisconnectResult | null {
    const found = this.findBySocket(socketId);
    if (!found) {
      return null;
    }
    this.memberships.delete(socketId);

    if (found.room.game !== null && !explicit) {
      found.player.isConnected = false;
      found.player.isBotManaged = true;
      if (found.room.hostId === found.player.id) {
        const nextHost = found.room.players.find((player) =>
          !player.isBot && player.isConnected && player.id !== found.player.id,
        );
        if (nextHost) found.room.hostId = nextHost.id;
      }
      if (!found.room.players.some((player) => !player.isBot && player.isConnected)) {
        this.rooms.delete(found.room.code);
        return { roomCode: found.room.code, room: null };
      }
      found.room.version += 1;
      return {
        roomCode: found.room.code,
        room: this.snapshot(found.room),
      };
    }

    found.room.players.splice(found.playerIndex, 1);
    if (found.room.players.length === 0 || found.room.players.every((player) => player.isBot)) {
      this.rooms.delete(found.room.code);
      return { roomCode: found.room.code, room: null };
    }
    if (explicit && found.room.game !== null) {
      found.room.game = null;
      found.room.actionHistory = [];
      found.room.players = found.room.players.filter((player) => player.isConnected);
      found.room.players.forEach((player) => {
        player.isReady = player.isBot;
        player.isBotManaged = false;
      });
    }
    if (found.room.players.length === 0) {
      this.rooms.delete(found.room.code);
      return { roomCode: found.room.code, room: null };
    }
    if (!found.room.players.some((player) => player.id === found.room.hostId)) {
      found.room.hostId = found.room.players.find((player) => !player.isBot)!.id;
    }
    found.room.version += 1;
    return { roomCode: found.room.code, room: this.snapshot(found.room) };
  }

  private findBySocket(socketId: string) {
    const code = this.memberships.get(socketId);
    const room = code ? this.rooms.get(code) : undefined;
    const playerIndex = room?.players.findIndex((player) => player.socketId === socketId) ?? -1;
    const player = playerIndex >= 0 ? room?.players[playerIndex] : undefined;
    return room && player ? { room, player, playerIndex } : null;
  }

  private applyGameAction(
    socketId: string,
    action: (game: GameState, playerId: string) => RuleResult,
  ): GameActionResponse {
    const found = this.findBySocket(socketId);
    if (!found) return failure("NOT_IN_ROOM", "你不在房間內");
    if (!found.room.game) {
      return failure("GAME_NOT_FINISHED", "遊戲尚未開始");
    }
    if (found.player.isBotManaged) {
      return failure("BOT_CONTROL_ACTIVE", "機器人正在代管，請先取回控制");
    }
    if (
      found.room.game.phase !== "finished" &&
      found.room.players.some((player) => !player.isConnected && !player.isBotManaged)
    ) {
      return failure("GAME_PAUSED", "有玩家連線中斷，牌局已暫停");
    }
    return this.applyRoomGameAction(found.room, found.player.id, action);
  }

  private applyRoomGameAction(
    room: Room,
    playerId: string,
    action: (game: GameState, playerId: string) => RuleResult,
  ): GameActionResponse {
    if (!room.game) return failure("GAME_NOT_FINISHED", "遊戲尚未開始");
    return this.acceptRoomGameResult(room, action(room.game, playerId));
  }

  private acceptRoomGameResult(room: Room, result: RuleResult): GameActionResponse {
    if (!result.ok) return { ok: false, error: result.error };
    room.game = result.state;
    room.actionHistory.push(this.historyEntry(room.game));
    room.actionHistory = room.actionHistory.slice(-40);
    if (room.game.phase === "finished") {
      room.players = room.players.filter((player) => player.isBot || player.isConnected);
      room.players.forEach((player) => {
        if (!player.isBot) player.isBotManaged = false;
      });
      if (!room.players.some((player) => player.id === room.hostId)) {
        room.hostId = room.players.find((player) => !player.isBot)!.id;
      }
      room.game.players.forEach((player) => {
        player.hand = [];
      });
      room.game.drawPile = [];
      room.game.discardPile = room.game.discardPile.slice(-1);
      room.game.drawnCardId = null;
    }
    room.version += 1;
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

  private gameSnapshot(
    game: GameState,
    playerId: string,
    actionHistory: readonly GameHistoryEntry[],
  ): GameSnapshot {
    const player = game.players.find((candidate) => candidate.id === playerId);
    const topDiscard = game.discardPile.at(-1);
    const currentPlayer = game.players[game.currentPlayerIndex];
    if (!player || !topDiscard || !currentPlayer) {
      throw new RangeError("Cannot create a game snapshot from invalid state");
    }
    return {
      players: game.players.map((candidate) => ({
        id: candidate.id,
        handCount: candidate.hand.length,
      })),
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
        ? {
            attackerId: game.pendingDrawFour.attackerId,
            targetId: game.pendingDrawFour.targetId,
          }
        : null,
      winnerId: game.winnerId,
      lastAction: { ...game.lastAction },
      actionHistory: actionHistory.map((entry) => ({
        version: entry.version,
        action: { ...entry.action },
        ...(entry.card ? { card: { ...entry.card } } : {}),
      })),
      version: game.version,
    };
  }

  private sessionSuccess(room: Room, player: RoomMember): RoomSessionResponse {
    return {
      ok: true,
      room: this.snapshot(room),
      session: {
        roomCode: room.code,
        playerId: player.id,
        playerToken: player.token,
        nickname: player.nickname,
      },
    };
  }

  private snapshot(room: Room): RoomSnapshot {
    const canStart =
      room.game === null &&
      room.players.length >= 2 &&
      room.players.every((player) =>
        player.isConnected && (player.id === room.hostId || player.isBot || player.isReady),
      );
    return {
      code: room.code,
      phase: room.game?.phase ?? "lobby",
      hostId: room.hostId,
      players: room.players.map((player) => ({
        id: player.id,
        nickname: player.nickname,
        isBot: player.isBot,
        isHost: player.id === room.hostId,
        isReady: player.isReady,
        isConnected: player.isConnected,
        isBotManaged: player.isBotManaged,
      })),
      canStart,
      winnerId: room.game?.winnerId ?? null,
      version: room.version,
    };
  }
}
