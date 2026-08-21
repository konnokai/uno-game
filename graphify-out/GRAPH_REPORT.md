# Graph Report - uno-game  (2026-08-22)

## Corpus Check
- 40 files · ~17,414 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 611 nodes · 1079 edges · 29 communities (27 shown, 2 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 37 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Socket Server
- Bot Control
- UNO Engine
- Server TypeScript
- Project Requirements
- Room Manager
- React Application
- Server Package
- Development Dependencies
- Game Table UI
- Local Development
- Root Package Scripts
- Multiplayer Requirements
- Integration Testing
- UNO Game Rules
- Server Event Contract
- Client Event Contract
- Base TypeScript
- Unsupported Rules
- Shared Build Config
- Request Deduplication
- HTML Entry
- Workspace Layout
- Game Phases
- Rules Guide
- Web TypeScript
- In-Memory Rooms

## God Nodes (most connected - your core abstractions)
1. `UNO 網頁遊戲專案規格` - 69 edges
2. `RoomManager` - 38 edges
3. `GamePage()` - 21 edges
4. `playCard()` - 17 edges
5. `CardColor` - 14 edges
6. `GameActionResponse` - 14 edges
7. `客戶端 Socket 事件` - 14 edges
8. `App()` - 13 edges
9. `drawCard()` - 13 edges
10. `RoomActionResponse` - 13 edges

## Surprising Connections (you probably didn't know these)
- `UNO 網頁遊戲專案規格` --references--> `socket.io`  [EXTRACTED]
  AGENTS.md → apps/server/package.json
- `2 人 Socket.IO 即時遊戲` --references--> `socket.io`  [EXTRACTED]
  AGENTS.md → apps/server/package.json
- `decideBotAction()` --calls--> `isCardPlayable()`  [EXTRACTED]
  apps/server/src/bot-player.ts → packages/shared/src/game/engine.ts
- `DisconnectResult` --references--> `RoomSnapshot`  [EXTRACTED]
  apps/server/src/room-manager.ts → packages/shared/src/room.ts
- `GameRecipient` --references--> `GameSnapshot`  [EXTRACTED]
  apps/server/src/room-manager.ts → packages/shared/src/room.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **經典 UNO 牌組組成** — agents_classic_108_card_deck, agents_numeric_cards, agents_skip_cards, agents_reverse_cards, agents_draw_two_cards, agents_wild_cards, agents_wild_draw_four_cards [EXTRACTED 1.00]
- **GamePhase 階段集合** — agents_game_phase, agents_lobby_phase, agents_playing_phase, agents_awaiting_draw_four_challenge_phase, agents_finished_phase [EXTRACTED 1.00]
- **遊戲狀態欄位集合** — agents_room_host_state, agents_player_order_connection_state, agents_private_hands_state, agents_deck_discard_state, agents_current_color_state, agents_current_player_state, agents_direction_state, agents_game_phase, agents_uno_status_state, agents_last_action_state, agents_winner_state, agents_versioned_state [EXTRACTED 1.00]

## Communities (29 total, 2 thin omitted)

### Community 0 - "Socket Server"
Cohesion: 0.05
Nodes (39): acknowledge(), app, botTimers, botTurnDelayMs, clearReliabilityTimers(), createLimiter, httpServer, io (+31 more)

### Community 1 - "Bot Control"
Cohesion: 0.07
Nodes (41): BotDecision, BotGameView, chooseColor(), decideBotAction(), playDecision(), card(), gameWithBot(), botGameView() (+33 more)

### Community 2 - "UNO Engine"
Cohesion: 0.13
Nodes (39): coloredCard(), createDeck(), DOUBLE_VALUES, shuffleDeck(), accepted(), callUno(), catchUno(), chooseStartingColor() (+31 more)

### Community 3 - "Server TypeScript"
Cohesion: 0.05
Nodes (40): compilerOptions, module, moduleResolution, noEmit, types, extends, include, node (+32 more)

### Community 4 - "Project Requirements"
Cohesion: 0.06
Nodes (43): 所有真人離線立即清除房間, apps/server, 代管不得越過玩家與規則邊界, 當前顏色狀態, 當前玩家狀態, 牌庫及棄牌堆狀態, 桌面與手機尺寸測試, 遊戲進行方向狀態 (+35 more)

### Community 5 - "Room Manager"
Cohesion: 0.13
Nodes (13): publishGameStates(), requestScope(), runGameAction(), scheduleBotTurn(), failure(), isBotControlled(), Room, RoomManager (+5 more)

### Community 6 - "React Application"
Cohesion: 0.08
Nodes (30): App(), handleGameStarted(), handleRoomUpdated(), leaveRoom(), saveSession(), updateRoom(), HomePage(), createRoom() (+22 more)

### Community 7 - "Server Package"
Cohesion: 0.05
Nodes (39): dependencies, cors, express, socket.io, @uno/shared, name, private, scripts (+31 more)

### Community 8 - "Development Dependencies"
Cohesion: 0.05
Nodes (38): TypeScript, devDependencies, socket.io-client, tsup, tsx, @types/cors, @types/express, @types/node (+30 more)

### Community 9 - "Game Table UI"
Cohesion: 0.12
Nodes (27): actionMessage(), actionText(), CARD_SYMBOLS, cardLabel(), COLOR_LABELS, COLOR_ORDER, compareCards(), GamePage() (+19 more)

### Community 10 - "Local Development"
Cohesion: 0.09
Nodes (24): 後端 http://localhost:3001, 瀏覽器多人 UNO 遊戲, 開發環境需求, 前端固定埠號, 前端 http://localhost:5173, 本機正式版伺服器 http://localhost:3001, 正式版本機測試, Node.js 22.12 以上的 22 LTS (+16 more)

### Community 11 - "Root Package Scripts"
Cohesion: 0.12
Nodes (16): cross-env, devDependencies, cross-env, engines, node, pnpm, name, packageManager (+8 more)

### Community 12 - "Multiplayer Requirements"
Cohesion: 0.14
Nodes (14): 跨瀏覽器 2–8 人加入同房, 本機隨機連線權杖, 暱稱長度、空白與安全顯示驗證, 免註冊暱稱加入, 即時多人 UNO 網頁遊戲, 重新整理後恢復座位與私人手牌, 重新連線、斷線代管與房間清理, 重新整理後恢復座位與手牌 (+6 more)

### Community 13 - "Integration Testing"
Cohesion: 0.18
Nodes (13): 建房到遊戲結束的瀏覽器流程驗證, 手機與桌面完成整場遊戲, 桌面與手機操作支援, 開發順序, 房間建立、加入、準備及開始, 響應式牌桌與特殊操作介面, Socket 整合測試, 單元、Socket 整合及端對端流程通過 (+5 more)

### Community 14 - "UNO Game Rules"
Cohesion: 0.15
Nodes (13): 經典 108 張 UNO 牌組, 一致且即時的公開牌桌狀態, 抽二牌, 首版驗收標準, 不洩漏私人資料的錯誤回應, 數字牌, 私人手牌資訊隔離, 私人手牌與伺服器狀態保護 (+5 more)

### Community 15 - "Server Event Contract"
Cohesion: 0.15
Nodes (13): game:action-rejected, game:ended, game:started, game:state, player:disconnected, player:reconnected, 不依賴網路層的純 TypeScript 規則引擎, room:updated (+5 more)

### Community 16 - "Client Event Contract"
Cohesion: 0.17
Nodes (12): 客戶端 Socket 事件, game:bot-control, game:call-uno, game:catch-uno, game:challenge-draw-four, game:draw-card, game:play-card, game:rematch (+4 more)

### Community 17 - "Base TypeScript"
Cohesion: 0.20
Nodes (9): compilerOptions, allowSyntheticDefaultImports, esModuleInterop, forceConsistentCasingInFileNames, noFallthroughCasesInSwitch, noUncheckedIndexedAccess, skipLibCheck, strict (+1 more)

### Community 18 - "Unsupported Rules"
Cohesion: 0.22
Nodes (9): 帳號、戰績及排行榜, 聊天系統, 自訂規則, 抽二與抽四疊加, Jump-in 搶牌, 一次打出多張相同牌, 7-0 規則, 觀戰模式 (+1 more)

### Community 19 - "Shared Build Config"
Cohesion: 0.22
Nodes (8): compilerOptions, declaration, emitDeclarationOnly, outDir, exclude, extends, src/**/*.test.ts, ./tsconfig.json

### Community 20 - "Request Deduplication"
Cohesion: 0.32
Nodes (3): CachedResponse, RequestDeduplicator, RequestDeduplicatorOptions

### Community 21 - "HTML Entry"
Cohesion: 0.25
Nodes (8): Web HTML 入口文件, /src/main.tsx 模組入口, id=root 應用程式掛載點, #111827 主題色, UNO 頁面標題, UTF-8 字元編碼, 響應式 viewport 設定, zh-Hant 語系

### Community 22 - "Workspace Layout"
Cohesion: 0.33
Nodes (6): apps/web, packages/shared, apps/* workspace 範圍, pnpm workspace 設定, esbuild onlyBuiltDependencies, packages/* workspace 範圍

### Community 23 - "Game Phases"
Cohesion: 0.33
Nodes (6): awaiting-draw-four-challenge 階段, 萬用抽四合法性與質疑流程, finished 階段, GamePhase 遊戲階段, lobby 階段, playing 階段

### Community 24 - "Rules Guide"
Cohesion: 0.67
Nodes (4): 全站規則手冊, apps/web/src/RulesGuide.tsx, 規則手冊與引擎同步維護, packages/shared/src/game 規則引擎

## Knowledge Gaps
- **221 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+216 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `UNO 網頁遊戲專案規格` connect `Project Requirements` to `Development Dependencies`, `Multiplayer Requirements`, `Integration Testing`, `UNO Game Rules`, `Server Event Contract`, `Client Event Contract`, `Unsupported Rules`, `Workspace Layout`, `Game Phases`, `Rules Guide`, `In-Memory Rooms`?**
  _High betweenness centrality (0.129) - this node is a cross-community bridge._
- **Why does `TypeScript` connect `Development Dependencies` to `Project Requirements`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **Why does `OpenChamber web browser tools` connect `Integration Testing` to `Local Development`, `Project Requirements`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _221 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Socket Server` be split into smaller, more focused modules?**
  _Cohesion score 0.0514216575922565 - nodes in this community are weakly interconnected._
- **Should `Bot Control` be split into smaller, more focused modules?**
  _Cohesion score 0.07088989441930618 - nodes in this community are weakly interconnected._
- **Should `UNO Engine` be split into smaller, more focused modules?**
  _Cohesion score 0.12753623188405797 - nodes in this community are weakly interconnected._