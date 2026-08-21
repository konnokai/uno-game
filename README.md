# UNO

瀏覽器多人 UNO 遊戲。前端使用 React、後端使用 Node.js 與 Socket.IO，房間資料只保存在伺服器記憶體中。

## 開發環境

- Node.js `22.12` 以上的 22 LTS，或 Node.js 24 以上
- pnpm `10.15.0` 以上且小於 11

先安裝依賴：

```sh
pnpm install
```

啟動開發環境：

```sh
pnpm dev
```

開啟 `http://localhost:5173`。後端預設使用 `http://localhost:3001`。

## 常用指令

```sh
pnpm typecheck
pnpm test
pnpm build
```

主要瀏覽器流程使用 OpenChamber web browser tools 驗證，不在專案內安裝瀏覽器測試套件。

## 正式版本機測試

本機啟動正式版：

```sh
pnpm host:local
```

開啟 `http://localhost:3001`。公開連線方式不包含在這個專案的啟動腳本內，之後可依部署環境接入其他工具。

## 埠號設定

開發環境預設使用前端 `5173`、後端 `3001`。前端埠號目前固定，若被其他程式占用會直接報錯，不會自動改埠。

正式版後端可透過 `PORT` 改變埠號；若前端要連到不同的後端，也要同時設定 `VITE_SERVER_URL`。
