# 在這台電腦公開 UNO

## 注意事項

- 電腦、Node.js 服務與 Cloudflare Tunnel 必須保持執行。
- 電腦休眠、網路中斷或關閉終端機時，好友會斷線。
- 更新並重新啟動後，記憶體中的房間與進行中牌局會消失。
- Quick Tunnel 每次啟動會產生新的 `https://*.trycloudflare.com` 網址。

## 公開遊戲

在專案根目錄執行：

```powershell
pnpm host:public
```

等待終端機顯示 `https://*.trycloudflare.com`，將該網址傳給好友。保持終端機開啟，按 `Ctrl+C` 可停止公開服務。

## 本機測試正式版

```powershell
pnpm host:local
```

開啟 `http://localhost:3001`。

## 更新

先請好友完成目前牌局，再停止服務並執行：

```powershell
pnpm test:all
pnpm host:public
```

新的服務啟動後，重新分享終端機顯示的 Quick Tunnel 網址。
