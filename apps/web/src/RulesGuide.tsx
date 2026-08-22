import { useEffect, useState } from "react";
import { MAX_GAME_PLAYERS, MIN_GAME_PLAYERS } from "@uno/shared";
import { previewGameSound, type GameSound } from "./sound-effects";

const CARD_RULES = [
  { color: "red", kind: "number", symbol: "7", name: "數字牌", description: "經典模式沒有額外效果；台灣模式出 7 可和指定玩家交換手牌，出 0 則全員依方向傳牌。" },
  { color: "yellow", kind: "skip", symbol: "⊘", name: "跳過", description: "下一位玩家跳過一個回合。" },
  { color: "green", kind: "reverse", symbol: "↻", name: "反轉", description: "改變出牌方向；兩人遊戲中等同跳過，出牌者再進行一回合。" },
  { color: "blue", kind: "draw-two", symbol: "+2", name: "抽二", description: "經典模式由下一位玩家抽兩張牌並跳過；台灣模式的疊牌方式與同回合多張連出由大廳細項設定決定。" },
  { color: "wild", kind: "wild", symbol: "", name: "萬用牌", description: "任何時候都能打出，並由出牌者指定接下來的顏色。" },
  { color: "wild", kind: "draw-four", symbol: "+4", name: "萬用抽四", description: "只有手上沒有目前顏色的牌時才能合法打出；指定顏色後，由下一位玩家接受、質疑，或依大廳細項設定疊牌。" },
] as const;

const SOUND_PREVIEWS: Array<{ sound: GameSound; label: string }> = [
  { sound: "play-card", label: "出牌" },
  { sound: "draw-card", label: "抽牌" },
  { sound: "uno", label: "喊 UNO" },
  { sound: "wild-draw-four", label: "+4" },
  { sound: "victory", label: "勝利" },
];

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
              <section className="sound-preview" id="rules-sounds">
                <div>
                  <p className="eyebrow">SOUND PREVIEW</p>
                  <h3>合成音效試聽</h3>
                  <p className="sound-preview-copy">點擊下方按鈕逐一試聽目前版本。遊戲內所有音效都使用合成版本。</p>
                  <div className="sound-preview-grid">
                    {SOUND_PREVIEWS.map(({ sound, label }) => (
                      <button
                        className="sound-preview-button"
                        key={sound}
                        onClick={() => previewGameSound(sound)}
                        type="button"
                      >
                        <span aria-hidden="true">▶</span>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </section>
              <section id="rules-basic">
                <span className="rules-number">01</span>
                <div>
                  <h3>基本規則</h3>
                  <ul>
                    <li>每局支援 {MIN_GAME_PLAYERS}–{MAX_GAME_PLAYERS} 位玩家，每人起手七張牌。</li>
                    <li>輪到你時，可打出與棄牌堆頂端相同顏色、數字或符號的牌；萬用牌不受此限制。</li>
                      <li>經典模式抽一張牌；台灣模式會持續抽牌直到抽到可出的牌。抽到的牌都可選擇保留，並手動結束回合。</li>
                    <li>第一位出完所有手牌的玩家獲勝，採單回合決勝。</li>
                    <li>台灣模式可在大廳開關 +4 質疑與同回合多張連出；細項說明以房間設定為準。</li>
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
                    <p>若大廳開啟 +4 質疑，例如目前顏色是<strong>紅色</strong>，玩家 A 打出萬用抽四，下一位玩家 B 可以懷疑 A 原本其實還有紅牌。關閉時只能直接接受。</p>
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
                       <p>玩家可在牌局中手動開啟代管；玩家斷線、離開房間或出牌逾時時也會自動啟用。房主可在等候室設定每回合時間，預設為 30 秒。只要房內還有真人連線，機器人就會沿用該玩家的座位與手牌，自動出牌、抽牌、選色及處理抽四；最後一位真人離開或失聯時，房間會立即清理。</p>
                    </article>
                      <article className="rules-extra-item">
                        <span>大廳切換</span>
                        <h4>經典官方規則</h4>
                       <p>每回合出一張牌，抽牌只抽一張；台灣細項在經典模式不生效。</p>
                      </article>
                      <article className="rules-extra-item rules-extra-item-taiwan">
                        <span>大廳切換</span>
                        <h4>台灣常見玩法</h4>
                        <p>大廳可分別開關疊牌、7-0、Jump-in、抽到能出的牌為止、+4 質疑與同回合多張連出。疊牌有三種：同類型（+2 接 +2、+4 接 +4）、大壓小（+4 可接 +2，但 +2 不可接 +4），以及混合疊牌（+2、+4 互相都能接）。多張連出限相同數字或相同功能的非萬用牌，第一張須合法。</p>
                      </article>
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
