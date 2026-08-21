import { useEffect, useState } from "react";
import { MAX_GAME_PLAYERS, MIN_GAME_PLAYERS } from "@uno/shared";

const CARD_RULES = [
  { color: "red", kind: "number", symbol: "7", name: "數字牌", description: "可接在相同顏色或相同數字的牌上，沒有額外效果。" },
  { color: "yellow", kind: "skip", symbol: "⊘", name: "跳過", description: "下一位玩家跳過一個回合。" },
  { color: "green", kind: "reverse", symbol: "↻", name: "反轉", description: "改變出牌方向；兩人遊戲中等同跳過，出牌者再進行一回合。" },
  { color: "blue", kind: "draw-two", symbol: "+2", name: "抽二", description: "下一位玩家抽兩張牌並跳過回合，不可疊加抽牌。" },
  { color: "wild", kind: "wild", symbol: "", name: "萬用牌", description: "任何時候都能打出，並由出牌者指定接下來的顏色。" },
  { color: "wild", kind: "draw-four", symbol: "+4", name: "萬用抽四", description: "只有手上沒有目前顏色的牌時才能合法打出；指定顏色後，由下一位玩家決定接受或質疑。" },
] as const;

export function RulesGuide() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className="rules-trigger"
        onClick={() => setOpen(true)}
        type="button"
      >
        <span className="rules-trigger-icon">?</span>
        <span className="rules-trigger-label">遊戲規則</span>
      </button>

      {open && (
        <div
          className="rules-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setOpen(false);
          }}
          role="presentation"
        >
          <article aria-labelledby="rules-title" aria-modal="true" className="rules-guide" role="dialog">
            <header className="rules-header">
              <div>
                <p className="eyebrow">HOW TO PLAY</p>
                <h2 id="rules-title">UNO 規則手冊</h2>
              </div>
              <button aria-label="關閉規則" className="rules-close" onClick={() => setOpen(false)} type="button">×</button>
            </header>

            <nav aria-label="規則章節" className="rules-index">
              <a href="#rules-basic">基本規則</a>
              <a href="#rules-cards">卡片效果</a>
              <a href="#rules-uno">UNO 與質疑</a>
              <a href="#rules-extra">額外玩法</a>
            </nav>

            <div className="rules-content">
              <section id="rules-basic">
                <span className="rules-number">01</span>
                <div>
                  <h3>基本規則</h3>
                  <ul>
                    <li>每局支援 {MIN_GAME_PLAYERS}–{MAX_GAME_PLAYERS} 位玩家，每人起手七張牌。</li>
                    <li>輪到你時，可打出與棄牌堆頂端相同顏色、數字或符號的牌；萬用牌不受此限制。</li>
                    <li>你可以抽一張牌。若新牌合法，可立即打出；否則回合直接結束。即使新牌合法，也可以保留並結束回合。</li>
                    <li>第一位出完所有手牌的玩家獲勝，採單回合決勝。</li>
                    <li>抽牌堆耗盡時，保留目前棄牌，將其餘棄牌洗回抽牌堆。</li>
                  </ul>
                </div>
              </section>

              <section id="rules-cards">
                <span className="rules-number">02</span>
                <div>
                  <h3>各卡片效果</h3>
                  <div className="card-rule-list">
                    {CARD_RULES.map((rule) => (
                      <article className="card-rule" key={rule.name}>
                        <span aria-hidden="true" className={`rule-card-symbol rule-${rule.color} rule-${rule.kind}`}>
                          {rule.kind === "draw-two"
                            ? <span className="rule-draw-symbol"><i /><i /></span>
                            : rule.kind === "draw-four"
                              ? <span className="rule-draw-four-symbol"><i /><i /><i /><i /></span>
                              : <strong>{rule.symbol}</strong>}
                        </span>
                        <div>
                          <h4>{rule.name}</h4>
                          <p>{rule.description}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              </section>

              <section id="rules-uno">
                <span className="rules-number">03</span>
                <div>
                  <h3>UNO、質疑與起始牌</h3>
                  <ul>
                    <li>打出倒數第二張牌、手上剩一張時必須喊 UNO。</li>
                    <li>若未喊 UNO，其他玩家可在下一位玩家完成動作前抓取；被抓到者罰抽兩張。</li>
                    <li>首張跳過、反轉或抽二會立即生效；首張萬用牌由起始玩家觀察自己的起手牌後選色；首張抽四會洗回牌庫並重新翻牌。</li>
                  </ul>
                  <article className="challenge-explainer">
                    <p className="eyebrow">DRAW FOUR CHALLENGE</p>
                    <h4>抽四質疑是什麼意思？</h4>
                    <p>例如目前顏色是<strong>紅色</strong>，玩家 A 打出萬用抽四，下一位玩家 B 可以懷疑 A 原本其實還有紅牌。</p>
                    <div className="challenge-rule-note">
                      <strong>判定只看目前顏色</strong>
                      <span>A 有任何紅牌，抽四就是違規；A 沒有紅牌，抽四就是合法。即使 A 有相同數字或符號但顏色不同的牌，仍可合法打出抽四。</span>
                    </div>
                    <div className="challenge-outcomes">
                      <section>
                        <span>質疑成功</span>
                        <strong>A 原本有紅牌</strong>
                        <p>A 罰抽四張；B 不用抽牌，繼續自己的回合。</p>
                      </section>
                      <section>
                        <span>質疑失敗</span>
                        <strong>A 原本沒有紅牌</strong>
                        <p>B 因錯誤質疑改抽六張，並失去回合。</p>
                      </section>
                      <section>
                        <span>不提出質疑</span>
                        <strong>直接接受抽四</strong>
                        <p>B 抽四張，並失去回合。</p>
                      </section>
                    </div>
                    <p className="challenge-privacy">實體牌由出牌者展示手牌供質疑者確認；本遊戲改由伺服器私下驗證，只公布結果，不洩漏完整手牌。</p>
                  </article>
                </div>
              </section>

              <section id="rules-extra">
                <span className="rules-number">04</span>
                <div>
                  <h3>額外玩法</h3>
                  <div className="rules-extra-list">
                    <article className="rules-extra-item">
                      <span>已啟用</span>
                      <h4>機器人代管</h4>
                      <p>玩家可在牌局中手動開啟代管；玩家斷線時也會自動啟用。機器人沿用該玩家的座位與手牌，自動出牌、抽牌、選色及處理抽四，玩家關閉代管或重新連線後立即取回控制。只要房內仍有真人在線，座位與手牌會保留到玩家返回或牌局結束；所有真人都離線時房間會自動清除。</p>
                    </article>
                    <div className="rules-empty">
                      <strong>其他額外玩法尚未啟用</strong>
                      <p>目前不支援抽牌疊加、7-0、Jump-in、一次打出多張同牌等自訂規則。日後新增的玩法與啟用條件會列在這裡。</p>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </article>
        </div>
      )}
    </>
  );
}
