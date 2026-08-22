# UNO

瀏覽器多人 UNO 遊戲。前端使用 React/Vite，後端使用 Cloudflare Worker、Durable Objects 與原生 WebSocket。

## 開發環境

- Node.js `22.12` 以上的 22 LTS，或 Node.js 24 以上
- pnpm `10.15.0` 以上且小於 11

安裝依賴：

```sh
pnpm install
```

啟動前端和本機 Worker：

```sh
pnpm dev
```

開啟 `http://localhost:5173`。Vite 會連到 `http://localhost:8787` 的 Wrangler Worker。

分開啟動：

```sh
pnpm dev:web
pnpm dev:worker
```

前端 API 位址可用 `VITE_SERVER_URL` 覆寫：

```sh
VITE_SERVER_URL=http://localhost:8787 pnpm dev:web
```

## 常用指令

```sh
pnpm typecheck
pnpm test
pnpm build
```

主要瀏覽器流程使用 OpenChamber web browser tools 驗證，不在專案內安裝瀏覽器測試套件。

## Cloudflare 部署

前端部署到 Cloudflare Pages，Worker 部署到 Cloudflare Workers。房間狀態由每房一個 SQLite-backed Durable Object 保存，連線使用原生 WebSocket Hibernation。

Worker 部署前先登入 Wrangler：

```sh
pnpm wrangler login
pnpm deploy:worker
```

Cloudflare Workers Builds 的設定：

- Root directory：repository root `/`
- Build command：`pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm build`
- Deploy command：`pnpm deploy:worker`
- Production branch：`main`
- Watch paths：`apps/worker/**`、`packages/shared/**`、`apps/web/**`、workspace 設定與 lockfile

Cloudflare Pages 的設定：

- Root directory：`/`
- Build command：`pnpm install --frozen-lockfile && pnpm --filter @uno/shared build && pnpm --filter @uno/web build`
- Output directory：`apps/web/dist`
- Production branch：`main`
- `NODE_VERSION=22.12.0`
- `PNPM_VERSION=10.15.0`
- Production `VITE_SERVER_URL=https://uno-api.konnokai.me`

目前手動 production deployment：`https://9e9d3d9d.uno-game-8em.pages.dev`。Pages custom domain `uno.konnokai.me` 已建立，DNS 請新增 `uno CNAME uno-game-8em.pages.dev`；驗證完成後該網域才會切換到 UNO。

Worker 的 `ALLOWED_ORIGINS` 必須包含 Pages production 網域及需要使用的 preview 網域。正式環境建議使用：

```text
uno.konnokai.me      -> Cloudflare Pages
uno-api.konnokai.me  -> Cloudflare Worker
```

Pages 與 Workers Builds 都使用 GitHub integration，不在 repository 保存 Cloudflare API token。

GitHub Actions 會在 `main` push 及 Pull Request 執行相同的 install、typecheck、test 與 build 檢查；建議在 repository branch protection 將 `verify` 設為必要檢查。

完整遷移決策、DNS、preview、Durable Object migration 及驗收項目見 `CLOUDFLARE_DEPLOYMENT_PLAN.md`。
