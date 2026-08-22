# Cloudflare Pages + Workers 遷移計畫

文件狀態：Worker/Pages 已部署，待 Pages DNS 驗證與 GitHub 自動部署設定
最後更新：2026-08-22

## 1. 目標

將 UNO 專案改成以下正式部署架構：

- React/Vite 前端部署到 Cloudflare Pages。
- 即時後端部署到 Cloudflare Workers。
- 每個遊戲房間使用一個 SQLite-backed Durable Object。
- 使用原生 WebSocket 與 Durable Object WebSocket Hibernation。
- GitHub 推送後由 Cloudflare 自動建置與部署。
- 不需要自己的電腦持續執行後端。
- 保留目前的 UNO 規則、私人手牌隔離、重新連線、機器人代管及房間清理行為。

目前程式已依本計畫完成遷移：`apps/worker` 提供 Worker、Room Durable Object、LobbyDirectory、原生 WebSocket protocol、SQLite-backed storage 及 Alarm；`apps/web` 使用 HTTP room API 與原生 WebSocket；舊 `apps/server` 已移除。Worker 已部署至 `uno-api.konnokai.me`，Durable Object migration 已建立；Pages project `uno-game` 也已有 production deployment。Pages custom domain 已建立，但 Cloudflare 回報 `CNAME record not set`，需先把 `uno.konnokai.me` 指向 `uno-game-8em.pages.dev`。剩餘 Cloudflare dashboard 工作是把 GitHub `konnokai/uno-game` 接到 Pages/Workers Builds。

目前帳戶已使用 Cloudflare Workers Paid plan，每月固定費用為 5 美元。依目前使用量，預期不會超過內含額度；實作仍需在 Cloudflare dashboard 觀察實際用量。

## 2. 不採用的方案

- 不把現有 `apps/server` 的 Express + Socket.IO server 直接部署到 Worker。
- 不使用 Pages Functions 承載整個遊戲後端。
- 不新增 Socket.IO 的非官方 Workers 相容層。
- 不保留正式環境的 Node.js 後端作為相容模式。
- 不使用 Redis、外部資料庫或其他長駐主機。
- 不把完整遊戲狀態交給前端保存或決定。

這次是一次完整遷移。遷移完成後，`apps/server` 的正式執行入口與 Socket.IO 依賴應移除；純遊戲規則與可重用邏輯應保留並移到共用模組。

## 3. 現況摘要

目前專案的主要結構：

```text
apps/web/       React + Vite + socket.io-client
apps/server/    Node.js + Express + Socket.IO
packages/shared UNO 規則、遊戲型別、房間型別與 Socket 事件型別
```

目前後端的部署阻礙：

- `apps/server/src/index.ts` 使用 `node:http`、Express、Socket.IO 及 `httpServer.listen()`。
- 房間由程序內的 `Map` 保存。
- 機器人回合由 Node.js `setTimeout` 執行。
- 房間廣播依賴 Socket.IO room。
- 目前的 rate limiter 與 request deduplicator 也是程序記憶體資料。
- 前端 `apps/web/src/socket.ts` 直接建立 Socket.IO client。

## 4. 目標架構

```text
玩家瀏覽器
  |
  +-- https://uno.example.com
  |       Cloudflare Pages
  |
  +-- https://uno-api.example.com/api/*
  |       Cloudflare Worker HTTP API
  |
  +-- wss://uno-api.example.com/ws/room/:roomCode
          Cloudflare Worker 路由
                    |
                    +-- RoomDurableObject(roomCode)
                            房間狀態
                            WebSocket 連線
                            廣播
                            遊戲動作
                            機器人 Alarm
```

### 4.1 Worker

Worker 只負責無狀態的入口工作：

- 驗證 HTTP method、路由、Origin 及基本 payload。
- 將房號轉換成 Durable Object ID。
- 將房間 API 與 WebSocket upgrade 轉給正確的 Durable Object。
- 提供 health endpoint。
- 對外隱藏 Durable Object 內部錯誤。

Worker 不保存遊戲狀態，也不保存跨請求的玩家連線資料。

### 4.2 RoomDurableObject

每一個房號固定對應一個 `RoomDurableObject`：

- 管理該房間所有玩家與 WebSocket。
- 執行所有房間及遊戲動作。
- 依伺服器規則驗證玩家身分、回合、手牌及特殊牌條件。
- 只向玩家送出允許該玩家看到的私人狀態。
- 向同房間玩家廣播公開牌桌狀態。
- 使用 Durable Object storage 保存可恢復的房間狀態。
- 使用 WebSocket Hibernation 讓閒置房間不持續執行 JavaScript。
- 使用 Alarm 執行延遲的機器人動作。

Durable Object 內的記憶體只作為目前事件處理的暫存。任何需要跨 hibernation、eviction 或重啟保留的資料都必須寫入 storage。

### 4.3 LobbyDirectory

目前首頁有公開房間清單。改成一房一 Durable Object 後，不能再用全域 `Map` 列出所有房間，因此新增一個小型 `LobbyDirectory` Durable Object：

- 建立新房號並避免房號碰撞。
- 保存仍處於大廳的公開房間摘要。
- 提供 `GET /api/rooms`。
- 在房間建立、加入、開始、離開及清理時更新摘要。
- 不保存遊戲牌局，也不處理遊戲動作。

這個物件只處理房間索引，不參與遊戲廣播。以目前預期流量，單一索引物件是刻意接受的簡化；若未來房間數量大幅增加，再考慮分片或移除公開房間清單。

## 5. HTTP 與 WebSocket 邊界

為了讓 Worker 能依房號直接路由，房間建立與加入改用 HTTP；進入房間後的即時狀態與遊戲操作使用 WebSocket。

### 5.1 HTTP API

建議 API：

```text
GET  /health
GET  /api/rooms
POST /api/rooms
POST /api/rooms/:roomCode/join
```

`POST /api/rooms` 與 `POST /api/rooms/:roomCode/join` 回傳：

- 房間 snapshot。
- 穩定的 player ID。
- player token。
- 玩家暱稱。
- 目前房間 phase。

player token 只在 HTTPS API 與已驗證 WebSocket attach 流程中傳遞，並由前端 localStorage 暫存，不放入公開房間 snapshot。建立/加入請求可帶同一個由瀏覽器 `crypto.getRandomValues` 產生的 token，讓回應遺失後的重試仍能恢復同一座位； Durable Object 與 lobby index 只保存 token hash。

### 5.2 WebSocket

建議路由：

```text
GET /ws/room/:roomCode
```

WebSocket 建立後，第一個訊息必須是 session attach/resume，攜帶 player token 及 request ID。完成驗證前不得收到房間資料，也不得執行其他動作。

採用可序列化的 discriminated union，不再使用 Socket.IO callback event map：

```ts
type ClientMessage = {
  type: "session:attach" | "room:ready" | "game:start" | ...;
  requestId: string;
  payload?: unknown;
};

type ServerMessage = {
  type: "session:attached" | "room:updated" | "game:state" | ...;
  payload: unknown;
};
```

實際型別應放在 `packages/shared`，並由 Worker/DO 與前端共用。所有外部訊息仍需執行期驗證，不能只依賴 TypeScript 型別。

前端的 `socket.ts` 應改成原生 WebSocket 封裝，維持單一的連線、重連、訊息解析及錯誤處理入口。不要在元件內分散建立 WebSocket。

## 6. 狀態與資料設計

### 6.1 房間狀態

沿用目前領域資料，但移除 Socket.IO 專屬欄位：

- 房號。
- 房主 ID。
- 玩家順序。
- 穩定 player ID。
- player token 的雜湊或不可逆識別資料。
- 暱稱與連線狀態。
- 機器人及 bot-managed 狀態。
- 遊戲 phase。
- 私人手牌。
- 牌庫與棄牌堆。
- 當前顏色、回合玩家及方向。
- UNO 狀態。
- 抽四質疑狀態。
- 最後動作、勝者及版本號。

### 6.2 Storage

優先使用 SQLite-backed Durable Object Storage 的簡單版本化 JSON record：

- `room-state`：目前完整房間狀態。
- `request-dedup:room`：以玩家、動作及 request ID 組成 scope 的近期 request 與可重播結果。
- `room-meta`：房間清單需要的公開摘要。

每個接受的狀態變更都要以一致的順序完成：驗證、套用規則、更新版本、寫入 storage、廣播結果。任何 storage 失敗都不能先向客戶端宣稱成功。

房間在所有真人離線且符合目前清理規則時清除 storage。Durable Object namespace 本身不需要也不能由應用程式刪除；重點是清除房間內容及停止連線與 Alarm。

### 6.3 重新連線

- 前端以 localStorage 保存現有 session。
- WebSocket 斷線後使用 player token 重新 attach。
- DO 依 player token 恢復原座位與手牌。
- 重新連線成功後關閉該座位的 bot control。
- 不依賴舊 WebSocket ID 或舊 Socket.IO ID。

## 7. 遊戲與機器人遷移

### 7.1 規則引擎

- 保留 `packages/shared/src/game` 的純 TypeScript 規則引擎。
- 不在 Worker 或 DO 重寫 UNO 規則。
- 將 `RoomManager` 拆成不依賴連線層的房間/遊戲服務，以及 DO 的連線適配層。
- 所有動作仍由伺服器驗證，前端只送意圖。

### 7.2 機器人

- 將目前 `decideBotAction` 保留在共用或 Worker 可載入的純模組。
- 以 `RoomDurableObject.alarm()` 取代 `setTimeout`。
- Alarm 執行前重新從 storage 載入狀態並確認仍有待處理的 bot action。
- Alarm 可能重複執行，因此 bot action 必須具備 request ID 或狀態檢查，不能重複出牌。
- 一個房間只保留目前必要的下一個 Alarm。

## 8. 安全與可靠性

- Worker 僅接受正式 Pages 網域及已設定的 preview 網域 Origin。
- WebSocket attach 前不送出任何房間或手牌資料。
- player token 不接受任意玩家 ID 取代。
- 暱稱、房號、request ID、顏色及所有 payload 都要執行期驗證。
- 私人遊戲 snapshot 只送給對應 WebSocket。
- 公開 snapshot 不包含其他玩家手牌或抽牌內容。
- 目前程序內 rate limiter 不能直接搬到 Worker；改成 Worker 邊緣的粗略 IP 防護，加上 DO 內以玩家/房間為單位的操作限制。
- request deduplication 必須存於 DO storage，不可只放記憶體。
- 對外錯誤只回傳明確的遊戲錯誤，不回傳 storage、DO 或內部 stack trace。
- 所有房間動作由單一 Room Durable Object 序列化處理，避免同房間競爭寫入。

## 9. 預計檔案調整

### 新增

```text
apps/worker/
  package.json
  src/index.ts
  src/room-durable-object.ts
  src/lobby-directory.ts
  src/validation.ts
  wrangler.jsonc
```

實際檔名可依實作需要微調，但 Worker 入口、房間 DO 及 lobby index 應保持分離。

### 修改

```text
apps/web/src/socket.ts       原生 WebSocket client 封裝
apps/web/src/App.tsx         HTTP room API、session attach、重連流程
apps/web/src/GameTable.tsx   改用新的 realtime command API
packages/shared/src/room.ts  移除 Socket.IO callback 型別，改用可序列化 protocol
packages/shared/src/index.ts 匯出新的 protocol 型別
package.json                 新增 worker 及 deployment scripts
README.md                    更新本機、Cloudflare、環境變數及部署說明
AGENTS.md                    更新正式架構、資料保存及部署規則
.gitignore                   忽略 Wrangler 本機產物
```

### 移除或停止使用

```text
apps/server/src/index.ts     Express + Socket.IO 正式入口
apps/server/package.json     cors、express、socket.io、tsup、tsx 等正式依賴
apps/server/                  遷移完成並通過測試後移除整個舊 Node server
```

現有 `apps/server` 測試中的規則與房間案例應移到 Worker/DO 測試，不應因刪除 Node server 而遺失覆蓋範圍。

## 10. 本機開發

建議本機流程：

```text
pnpm install
pnpm dev:web       Vite 前端
pnpm dev:worker    wrangler dev
```

Vite 與 Wrangler dev 使用固定的本機 URL。前端使用 `VITE_SERVER_URL` 指向本機 Worker；正式 Pages 使用 `https://uno-api.example.com`，原生 WebSocket 路由則使用相同 host 下的 `/ws/room/:roomCode`。

本機測試不應依賴正式 Cloudflare 資料。使用 Wrangler/Miniflare 的 Workers 測試環境建立隔離的 Durable Object storage。

## 11. Cloudflare 自動部署

### 11.1 Pages

在 Cloudflare Pages 建立一個 GitHub 連線專案：

- Root directory：`/`
- Build command：`pnpm --filter @uno/shared build && pnpm --filter @uno/web build`
- Output directory：`apps/web/dist`
- Production branch：`main`
- `NODE_VERSION=22.12.0`
- `PNPM_VERSION=10.15.0`
- Production `VITE_SERVER_URL=https://uno-api.konnokai.me`
- Preview 使用 Worker preview URL 或專用 preview API 網域
- Watch paths：`apps/web/**`、`packages/shared/**`、workspace 設定與 lockfile

目前已建立 Pages project `uno-game`，手動 production deployment：

```text
https://9e9d3d9d.uno-game-8em.pages.dev
```

該 deployment 已以 `VITE_SERVER_URL=https://uno-api.konnokai.me` 建置。Pages custom domain `uno.konnokai.me` 已註冊但仍在等待 DNS CNAME 驗證；完成前該網域仍回傳既有個人網站。

### 11.2 Workers Builds

在 Cloudflare Workers Builds 連接同一個 GitHub repository：

- Worker name 與 Wrangler 設定一致。
- Root directory 以 workspace root 為主，避免 `@uno/shared` 解析失敗。
- Deploy command 使用目前 Wrangler 版本的 `wrangler deploy`。
- Build command 先執行 typecheck、單元測試及 Worker 測試。
- Production branch：`main`。
- Watch paths：`apps/worker/**`、`packages/shared/**`、Wrangler 設定、workspace 設定與 lockfile。
- Pull request 可建立 preview，但 Durable Object migration 不應在未審核的 production namespace 執行。

正式環境網域建議：

```text
uno.konnokai.me -> Cloudflare Pages
uno-api.konnokai.me  -> Cloudflare Worker
```

`.github/workflows/ci.yml` 會執行完整 repository CI，並用 branch protection 阻止未通過 typecheck、unit test 及 build 的 commit 進入 `main`。部署本身由 Pages Git integration 與 Workers Builds 負責，不在 repository 放 Cloudflare API token。

## 12. 測試計畫

### 純規則與資料測試

- 現有牌組數量及分布測試全部保留。
- 現有合法/不合法出牌、特殊牌、抽牌、UNO、抽四質疑、重洗及勝利測試全部保留。
- 驗證房間狀態能序列化及從 Durable Object storage 還原。

### Worker/DO 測試

- HTTP API payload 驗證與錯誤回應。
- 建房、加入、列出房間及房間清單更新。
- WebSocket attach、斷線、重連及錯誤關閉。
- 2 至 8 位玩家的同房間廣播與回合順序。
- 私人手牌只送給正確玩家。
- 舊版本封包不能覆蓋新版本狀態。
- 重複 request ID 不重複套用遊戲動作。
- Durable Object hibernation 後狀態可恢復。
- 機器人 Alarm、重複 Alarm 及斷線代管。
- 所有真人離線後房間清理。
- rate limit、Origin 驗證及錯誤資訊隔離。

### 瀏覽器驗證

使用 OpenChamber web browser tools 驗證：

- 桌面尺寸：建房、另一個瀏覽器加入、開始遊戲、完成一局。
- 手機尺寸：加入房間、出牌、抽牌、喊 UNO、重新連線。
- 重新整理後恢復座位與私人手牌。
- 邀請連結直接開啟 lobby/game 路由。
- Pages preview 連到 Worker preview。
- 正式 Pages 連到正式 Worker。

## 13. 實作階段

### Phase 1：整理共用領域層

- 確認 shared game engine 不含 Node、Express、Socket.IO 或 DOM 依賴。
- 將房間操作從 Socket ID 中解耦。
- 定義新的 serializable client/server protocol。
- 將既有房間與遊戲測試改成可供 DO 呼叫的形式。

### Phase 2：建立 Worker 與 Durable Objects

- 建立 `apps/worker` 及 Wrangler 設定。
- 建立 `RoomDurableObject`。
- 建立 SQLite-backed storage、版本化狀態及 request deduplication。
- 建立 WebSocket Hibernation 連線生命週期。
- 建立 `LobbyDirectory` 與房間清單 API。

### Phase 3：接上遊戲流程

- 接入 create、join、ready、start、leave、rematch。
- 接入 play、draw、pass、choose-color、UNO、抓 UNO、抽四質疑。
- 接入 bot control、disconnect delegation 及 Alarm。
- 完成公開/私人 snapshot 分流。

### Phase 4：改寫前端

- 移除 `socket.io-client`。
- 建立 HTTP API client 與原生 WebSocket client。
- 保留目前頁面與操作流程。
- 更新斷線、重連、版本號及錯誤處理。
- 確認邀請連結及 BrowserRouter deep link 在 Pages 正常工作。

### Phase 5：CI/CD 與正式驗證

- 設定 Pages Git integration。
- 設定 Workers Builds 與 watch paths。
- 設定 production/preview `VITE_SERVER_URL`。
- 加入 GitHub Actions CI 與 branch protection。
- 執行 typecheck、unit test、Worker test、build 及瀏覽器流程。
- 觀察 Cloudflare Workers/DO usage，確認沒有非預期的高頻 ping 或 storage 寫入。
- 更新 README，移除舊 Node server 正式部署說明。

## 14. 驗收標準

完成後必須符合：

1. 不啟動本機 Node server 時，正式 Pages 仍可連到正式 Worker。
2. 2 至 8 位玩家可以加入同一房間並看到一致的公開牌桌狀態。
3. 玩家無法查看其他玩家手牌、偽造抽牌或使用其他玩家 token。
4. 所有目前已支援的 UNO 規則行為與測試保持通過。
5. WebSocket 斷線後可用 player token 恢復座位與手牌。
6. Durable Object hibernation 或重新啟動後，進行中的房間狀態可恢復。
7. 斷線玩家由機器人代管，重新連線後取回控制權。
8. 所有真人離線後，房間資料會被清理。
9. 桌面與手機瀏覽器都能完成從建房到遊戲結束的流程。
10. GitHub push 到 `main` 後，Pages 與 Worker 都能按各自 watch paths 自動部署。
11. typecheck、unit test、Worker/DO test、build 及主要瀏覽器流程全部通過。
12. Cloudflare 用量符合預期，沒有不必要的常駐執行或高頻應用層 heartbeat。

## 15. 審閱時請特別確認

- 是否接受以 HTTP API 處理建房/加入，以 WebSocket 處理遊戲即時操作。
- 是否保留首頁公開房間清單；本計畫保留，並以 `LobbyDirectory` 實作。
- 是否接受房間狀態由原本的純記憶體改為 SQLite-backed Durable Object storage。
- 是否接受正式環境完全移除 Socket.IO 與 Node server。
- 正式 Pages 網域及 Worker API 網域要使用哪些名稱。
- GitHub repository 的 production branch 是否為 `main`。

## 16. 參考文件

- [Cloudflare Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Durable Objects Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Durable Objects WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [SQLite-backed Durable Object Storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Durable Object Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Cloudflare Pages Monorepos](https://developers.cloudflare.com/pages/configuration/monorepos/)
- [Cloudflare Workers Builds GitHub Integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)
