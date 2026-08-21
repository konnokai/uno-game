import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const CARD_SELECTOR = '.card-hand button[aria-pressed]';

async function waitForServer(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(".connection-status")).toContainText("伺服器已連線");
}

async function closeToast(page: Page): Promise<void> {
  const closeButton = page.getByRole("button", { name: "關閉提示" });
  if (await closeButton.isVisible()) await closeButton.click();
}

async function resolveDialog(page: Page): Promise<boolean> {
  const challenge = page.getByRole("dialog", { name: "要質疑這張抽四嗎？" });
  if (await challenge.isVisible()) {
    await challenge.getByRole("button", { name: "接受並抽四" }).click();
    return true;
  }

  const colorDialog = page.getByRole("dialog", { name: "選擇接下來的顏色" });
  if (await colorDialog.isVisible()) {
    await colorDialog.getByRole("button", { name: "選擇紅色" }).click();
    return true;
  }

  const callUno = page.getByRole("button", { name: "喊 UNO！" });
  if (await callUno.isVisible()) {
    await callUno.click();
    return true;
  }

  return false;
}

async function playTurn(page: Page): Promise<boolean> {
  if (!await page.getByText("輪到你了", { exact: true }).isVisible()) return false;

  const hand = page.getByRole("region", { name: "你的手牌" });
  const cards = hand.locator(CARD_SELECTOR);
  const playButton = page.locator("button.play-action");
  const cardCount = await cards.count();

  for (let index = 0; index < cardCount; index += 1) {
    const card = cards.nth(index);
    if (!await card.isEnabled()) continue;
    await card.click();
    if (!await playButton.isEnabled()) continue;

    const declareUno = page.getByRole("button", { name: "一起喊 UNO" });
    if (await declareUno.isVisible()) await declareUno.click();
    await playButton.click();
    return true;
  }

  const drawButton = page.getByRole("button", { name: /^抽牌，牌庫剩餘 \d+ 張$/ });
  if (await drawButton.isEnabled()) {
    await drawButton.click();
    return true;
  }

  const passButton = page.getByRole("button", { name: "保留並結束" });
  if (await passButton.isVisible() && await passButton.isEnabled()) {
    await passButton.click();
    return true;
  }

  return false;
}

async function createPlayer(
  browser: Browser,
  viewport: { width: number; height: number },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  return { context, page };
}

test("two friends can play a complete game on desktop and mobile", async ({ browser }) => {
  const host = await createPlayer(browser, { width: 1440, height: 900 });
  const guest = await createPlayer(browser, { width: 390, height: 844 });
  const browserErrors: string[] = [];

  for (const page of [host.page, guest.page]) {
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
  }

  try {
    await waitForServer(host.page);
    await host.page.getByRole("textbox", { name: "你的暱稱" }).fill("測試房主");
    await host.page.getByRole("button", { name: "建立新房間" }).click();
    await expect(host.page).toHaveURL(/\/lobby\/[A-HJ-NP-Z2-9]{6}$/);
    const roomCode = new URL(host.page.url()).pathname.split("/").at(-1)!;

    await guest.page.goto(`/?room=${roomCode}`);
    await expect(guest.page.locator(".connection-status")).toContainText("伺服器已連線");
    await guest.page.getByRole("textbox", { name: "你的暱稱" }).fill("測試好友");
    await expect(guest.page.getByRole("textbox", { name: "六碼房號" })).toHaveValue(roomCode);
    await guest.page.getByRole("button", { name: "加入房間" }).click();

    await expect(guest.page).toHaveURL(`/lobby/${roomCode}`);
    await expect(host.page.locator(".player-list")).toContainText("測試好友");
    await expect(guest.page.locator(".player-list")).toContainText("測試房主");

    await guest.page.getByRole("button", { name: "我準備好了" }).click();
    await expect(host.page.locator(".player-list")).toContainText("已準備");
    await expect(host.page.getByRole("button", { name: "開始遊戲" })).toBeEnabled();
    await host.page.getByRole("button", { name: "開始遊戲" }).click();

    await Promise.all([
      expect(host.page).toHaveURL(`/game/${roomCode}`),
      expect(guest.page).toHaveURL(`/game/${roomCode}`),
    ]);
    await expect(host.page.getByRole("region", { name: "你的手牌" })).toBeVisible();
    await expect(guest.page.getByRole("region", { name: "你的手牌" })).toBeVisible();

    const players = [host.page, guest.page];
    const deadline = Date.now() + 150_000;
    let actions = 0;

    while (Date.now() < deadline) {
      const hostFinished = await host.page.locator(".result-panel").isVisible();
      const guestFinished = await guest.page.locator(".result-panel").isVisible();
      if (hostFinished || guestFinished) break;

      let progressed = false;
      for (const page of players) {
        await closeToast(page);
        if (await resolveDialog(page)) {
          progressed = true;
          actions += 1;
          break;
        }
      }

      if (!progressed) {
        for (const page of players) {
          if (await playTurn(page)) {
            progressed = true;
            actions += 1;
            break;
          }
        }
      }

      await host.page.waitForTimeout(progressed ? 80 : 150);
    }

    await expect(host.page.locator(".result-panel")).toBeVisible();
    await expect(guest.page.locator(".result-panel")).toBeVisible();
    await expect(host.page.locator(".result-panel").getByRole("heading")).toHaveText(/你贏了！|.+ 獲勝/);
    await expect(guest.page.locator(".result-panel").getByRole("heading")).toHaveText(/你贏了！|.+ 獲勝/);
    expect(actions).toBeGreaterThan(0);
    expect(browserErrors).toEqual([]);
  } finally {
    await Promise.all([host.context.close(), guest.context.close()]);
  }
});
