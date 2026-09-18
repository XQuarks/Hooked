/**
 * _p4-ui.mjs —— v0.7 第三批 · 第 3 步：ui.js + icons.js + index.html + styles.css
 *
 *   ① iOS 式推送横幅（排队逐条播，点它打开枪店）
 *   ② 手机红点（phoneBtn）+ 枪店 App 红点（带数量）
 *   ③ 枪店：锁定枪 = 黑卡（无数值无价格）+ 新枪「NEW」角标
 *   ④ 渔具店：锁定的项 = 暗行 + 「待解锁」提示（保留行结构 —— verify7 B10/B12 还在守它）
 */
import fs from 'node:fs';

const fail = [];
const rep = (file, a, b, label) => {
  let src = fs.readFileSync(file, 'utf8');
  if (src.includes(b)) { console.log('… ' + label + '（已应用，跳过）'); return; }   // 幂等
  const n = src.split(a).length - 1;
  if (n !== 1) { fail.push(`${label}（${file}）：命中 ${n} 次`); return; }
  fs.writeFileSync(file, src.replace(a, b));
  console.log('✓ ' + label);
};

// ═══════════════════ icons.js：补一枚挂锁 ═══════════════════
rep('src/icons.js',
`  route: \`<path d="M5.2 18.6c0-4.4 3.2-6.2 7.2-6.2s7-1.8 7-6.2" fill="none"
    stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-dasharray="3.2 2.8"/>
  <circle cx="5.2" cy="18.6" r="2.3" fill="currentColor"/>
  <circle cx="19.4" cy="6.2" r="2.1" fill="none" stroke="currentColor" stroke-width="1.9"/>\`,
`,
`  route: \`<path d="M5.2 18.6c0-4.4 3.2-6.2 7.2-6.2s7-1.8 7-6.2" fill="none"
    stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-dasharray="3.2 2.8"/>
  <circle cx="5.2" cy="18.6" r="2.3" fill="currentColor"/>
  <circle cx="19.4" cy="6.2" r="2.1" fill="none" stroke="currentColor" stroke-width="1.9"/>\`,
  // 挂锁（v0.7 第三批）：枪店 / 渔具店里"还没上架"的那一项用它
  lock: \`<rect x="5.2" y="10.2" width="13.6" height="9.4" rx="2.4" fill="currentColor"/>
  <path d="M8.3 10.2V7.9a3.7 3.7 0 0 1 7.4 0v2.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>\`,
`, 'icons.js 加 lock 图标');

// ═══════════════════ index.html：推送卡 + 手机红点 ═══════════════════
rep('index.html',
`    <button id="phoneBtn" class="phone-btn" aria-label="打开手机">
      <span class="ph-body"><i class="ph-notch"></i><span class="ph-screen" id="phoneIco"></span></span>
    </button>`,
`    <button id="phoneBtn" class="phone-btn" aria-label="打开手机">
      <span class="ph-body"><i class="ph-notch"></i><span class="ph-screen" id="phoneIco"></span></span>
      <i class="ph-dot" id="phoneDot"></i>
    </button>`, 'index.html 手机红点');

rep('index.html',
`        <button class="ios-btn accept" id="callAccept" aria-label="接听"></button>
      </span>
    </div>`,
`        <button class="ios-btn accept" id="callAccept" aria-label="接听"></button>
      </span>
    </div>
    <!-- 新货上架推送（v0.7 第三批）：模仿 iPhone 的推送通知 —— 一把枪从"锁着"变"可见"
         的那一刻从顶部滑入，点它直接打开枪店（红点就是在那一步消失的）。
         ⚠ 和来电卡一样**不阻塞操作**；自动收起之后红点仍留在手机上，直到玩家点开枪店。
         ⚠ 与来电共用一套视觉语言但不共用一张卡：来电要你做选择，推送只是"有新东西可看"，
           两者长一样的话玩家会开始害怕每一次震动。 -->
    <button id="newsBanner" class="ios-news" aria-label="枪店新货上架">
      <span class="ios-ava news-ava" id="newsIco"></span>
      <span class="ios-txt"><b id="newsTitle">枪店 · 新货上架</b><i id="newsBody"></i></span>
      <span class="ios-now">现在</span>
    </button>`, 'index.html 推送卡');

// ═══════════════════ ui.js ═══════════════════
rep('src/ui.js',
`      callAccept: $('callAccept'),
      callDecline: $('callDecline'),`,
`      callAccept: $('callAccept'),
      callDecline: $('callDecline'),
      // 新货上架推送（v0.7 第三批）
      newsBanner: $('newsBanner'),
      newsIco: $('newsIco'),
      newsTitle: $('newsTitle'),
      newsBody: $('newsBody'),
      // 左下角手机的红点（有未读新枪 / 有没接的来电）
      phoneDot: $('phoneDot'),`, 'ui el 补五个');

rep('src/ui.js',
`    this.project = null;        // (worldX, worldY) => { nx, ny }`,
`    this.project = null;        // (worldX, worldY) => { nx, ny }
    // 新货推送的队列与去重（**不属于存档** —— 刷新页面后横幅不再补播，
    // 红点仍然在，因为那部分是 save.gunNews 的职责）
    this._newsQueue = [];
    this._newsShowing = false;
    this._newsT = 0;`, 'ui 推送队列状态');

rep('src/ui.js',
`    this.el.callBannerIco.innerHTML = glyph('call-in', 20);`,
`    this.el.callBannerIco.innerHTML = glyph('call-in', 20);
    this.el.newsIco.innerHTML = glyph('gunshop', 20);`, 'ui 推送头像图标');

// ── 推送三件套（挂在 ringPhone 后面，语义上是邻居）──
rep('src/ui.js',
`      this.el.iosState.textContent = '来电中…';
    }
  }

  /** 枪械条：只在空中射击阶段出现 */`,
`      this.el.iosState.textContent = '来电中…';
    }
  }

  // ── 新货上架推送（v0.7 第三批）─────────────────────────────
  /**
   * iOS 式推送：顶部滑入一张通知卡（App 图标 + 标题 + 正文 + 「现在」），
   * 4.2 秒后自动收起，排队的逐条播。**点它 = 打开枪店** —— 红点就是在那一步消失的。
   *
   * 为什么排队而不是一次全弹：潜到某个深度可能一次满足两把枪的 \`unlockDepth\`，
   * 两张卡叠在一起会互相盖住 —— iOS 的做法也是逐条轮播。
   *
   * 为什么不跟来电共用一张卡：来电是"有人在找你"（要接 / 不接，两个动作），
   * 推送是"有新东西可看"（点与不点都不影响进度）。两者长得一样的话，
   * 玩家会开始害怕每一次震动。
   */
  queueGunNews(ids) {
    for (const id of ids) {
      const g = gunById(id);
      if (g && !this._newsQueue.some((x) => x.id === g.id)) this._newsQueue.push(g);
    }
    this.pumpNews();
  }

  /** 放下一张推送卡（队列空 / 正在显示 / 手机开着 时不放） */
  pumpNews() {
    if (this._newsShowing || !this._newsQueue.length) return;
    if (this._phone && !this.el.phoneLayer.classList.contains('hidden')) return;  // 手机开着不打扰
    const g = this._newsQueue.shift();
    this._newsShowing = true;
    this.el.newsIco.innerHTML = glyph(g.icon || 'gunshop', 20);
    this.el.newsTitle.textContent = '枪店 · 新货上架';
    this.el.newsBody.textContent = \`「\${g.name}」已经到货 —— 手机里的枪店可以看看\`;
    this.el.newsBanner.classList.add('on');
    clearTimeout(this._newsT);
    this._newsT = setTimeout(() => this._hideNews(), 4200);
  }

  _hideNews() {
    this.el.newsBanner.classList.remove('on');
    this._newsShowing = false;
    // 稍等动画收完再放下一张，两张卡不会叠在一起
    setTimeout(() => this.pumpNews(), 520);
  }

  /** 左下角手机的红点：> 0 就亮（数量在手机桌面的枪店图标上显示） */
  setPhoneBadge(n) {
    this.el.phoneDot.classList.toggle('on', n > 0);
  }

  /** 枪械条：只在空中射击阶段出现 */`, 'ui 推送三件套 + 红点');

// ── 枪店：锁定黑卡 + NEW 角标 ──
rep('src/ui.js',
`      const tierHead = g.tier !== lastTier ? \`<div class="tier-h">\${g.tier}</div>\` : '';
      lastTier = g.tier;
      const stats = [`,
`      const tierHead = g.tier !== lastTier ? \`<div class="tier-h">\${g.tier}</div>\` : '';
      lastTier = g.tier;
      // ── 分段解锁（v0.7 第三批）：还没上架的枪 = 一张黑卡，**看不到任何数值** ──
      // 为什么连价格都不给：价格是一种承诺（"攒够就能买"），而对一把还没解锁的枪，
      // 攒钱根本不是当前的正确目标 —— 先把深度潜出来才是。名字保留，是因为
      // 玩家需要知道"有什么在等我"；伤害 / 半径 / 机制 / 价格全部藏起来。
      if (e.locked) {
        return \`\${tierHead}
        <div class="gs-item unreleased">
          <div class="gs-h">
            <span class="gs-ico">\${glyph(g.icon, 22)}</span>
            <div class="gs-t"><b>\${g.name}</b><i>\${g.en}</i></div>
            <span class="gs-tag">未解锁</span>
          </div>
          <div class="gs-lockrow">\${glyph('lock', 13)}<span>\${e.lockText}</span></div>
        </div>\`;
      }
      const stats = [`, '枪店锁定黑卡');

rep('src/ui.js',
`        <div class="gs-item\${e.current ? ' cur' : ''}\${e.owned ? ' owned' : ' locked'}">`,
`        <div class="gs-item\${e.current ? ' cur' : ''}\${e.owned ? ' owned' : ' locked'}">\${e.isNew ? '<i class="gs-new">NEW</i>' : ''}`, '枪店 NEW 角标');

// ── 渔具店：锁定行 = 暗行 + 待解锁提示（保留 .buy.lock 结构，verify7 B10/B12 在守）──
rep('src/ui.js',
`      return \`\${tierHead}
        <div class="item \${afford ? 'afford' : ''}">
          <div class="icon">\${glyph(u.icon, 19)}</div>
          <div class="info">
            <div class="nm">\${u.name}<span class="lv">\${oneShot ? (lv > 0 ? '已拥有' : '未拥有') : \`Lv.\${lv} / \${cap}\`}</span></div>
            <div class="ds">\${u.desc}\${nx ? \` · <span class="nx">\${nx}</span>\` : ''}</div>
            \${pips ? \`<div class="pips">\${pips}</div>\` : ''}
          </div>
          \${btn}
        </div>\${extra}\`;`,
`      return \`\${tierHead}
        <div class="item \${afford ? 'afford' : ''}\${locked ? ' locked-row' : ''}">
          <div class="icon">\${glyph(u.icon, 19)}</div>
          <div class="info">
            <div class="nm">\${u.name}<span class="lv">\${oneShot ? (lv > 0 ? '已拥有' : '未拥有') : \`Lv.\${lv} / \${cap}\`}</span></div>
            <div class="ds">\${u.desc}\${locked ? '' : (nx ? \` · <span class="nx">\${nx}</span>\` : '')}</div>
            \${locked ? \`<div class="lock-hint">\${glyph('lock', 11)}\${u.tier === '工具' ? '高级强化' : '进阶强化'} · 到过「冰封极地」后上架</div>\`
                     : (pips ? \`<div class="pips">\${pips}</div>\` : '')}
          </div>
          \${btn}
        </div>\${extra}\`;`, '渔具店锁定暗行');

// ── 手机桌面：枪店 App 的红点（带数量）──
rep('src/ui.js',
`    const ringing = !!this._phone.handlers.ringingCall?.();`,
`    const ringing = !!this._phone.handlers.ringingCall?.();
    // 未读新枪（v0.7 第三批）：枪店图标上挂一个红点，多于一把时显示数字
    const gunNews = (this._phone.handlers.gunNews && this._phone.handlers.gunNews()) || [];`, '桌面读未读数');

rep('src/ui.js',
`          <span class="p-ico \${id}">\${glyph(id, 28)}\${id === 'call' && ringing ? '<i class="p-badge"></i>' : ''}</span><span>\${nm}</span>`,
`          <span class="p-ico \${id}">\${glyph(id, 28)}\${id === 'call' && ringing ? '<i class="p-badge"></i>' : ''}\${id === 'gunshop' && gunNews.length ? \`<i class="p-badge num">\${gunNews.length > 1 ? gunNews.length : ''}</i>\` : ''}</span><span>\${nm}</span>`, '桌面枪店红点');

// ── 点开枪店 = 已读 ──
rep('src/ui.js',
`  openApp(id) {
    if (!this._phone) return;
    this._phone.app = id;`,
`  openApp(id) {
    if (!this._phone) return;
    // 点开枪店 = "已读"（v0.7 第三批）：手机红点 / 枪店 App 红点在这一步消失。
    // ⚠ 新枪身上的「NEW」角标**不**跟着消失 —— 它跟到那把枪被买下为止，
    //   否则玩家刚点进来角标就没了，"新货"这件事就没人记得了。
    if (id === 'gunshop' && this._phone.handlers.clearGunNews) this._phone.handlers.clearGunNews();
    this._phone.app = id;`, 'openApp 已读');

if (fail.length) { console.error('\n✗✗ 未写盘：\n  ' + fail.join('\n  ')); process.exit(1); }
console.log('\n✓ ui.js / icons.js / index.html 全部写盘');

// ═══════════════════ styles.css ═══════════════════
const css = fs.readFileSync('styles.css', 'utf8') + `
/* ── 新货上架推送（v0.7 第三批）──────────────────────────────
   与来电卡（.ios-call）同一套视觉语言：顶部滑入、圆角卡、左头像右时间。
   差别：来电卡常驻等待选择，推送卡 4.2s 自动收起。 */
.ios-news {
  position: absolute;
  left: 50%;
  top: calc(10px + var(--safe-t));
  transform: translate(-50%, -160%);
  pointer-events: none;
  opacity: 0;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  width: min(320px, calc(100% - 28px));
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 16px;
  background: rgba(24, 28, 36, 0.92);
  color: var(--txt);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.12);
  transition: transform 0.44s cubic-bezier(0.22, 1.2, 0.36, 1), opacity 0.3s ease;
  cursor: pointer;
  z-index: 7;
  text-align: left;
}
.ios-news.on { transform: translate(-50%, 0); opacity: 1; pointer-events: auto; }
.ios-news .news-ava { background: linear-gradient(160deg, #2b6f8f, #123246); }
.ios-news .ios-txt { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ios-news .ios-txt b { font-size: 12.5px; font-weight: 800; letter-spacing: 0.02em; }
.ios-news .ios-txt i { font-size: 11px; font-style: normal; color: var(--txt-dim); line-height: 1.4; }
.ios-news .ios-now { flex: 0 0 auto; font-size: 10px; color: var(--txt-dim); }
.ios-news:active { transform: translate(-50%, 2px) scale(0.99); }

/* 手机红点：挂在 .phone-btn 右上角（按钮本体是一部小手机） */
.phone-btn { position: absolute; }
.ph-dot {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 11px;
  height: 11px;
  border-radius: 999px;
  background: #ff3b30;
  border: 2px solid rgba(4, 16, 28, 0.9);
  opacity: 0;
  transform: scale(0.4);
  transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.3, 1.6, 0.5, 1);
  pointer-events: none;
}
.ph-dot.on { opacity: 1; transform: scale(1); }

/* 枪店 App 图标上的红点（带数量）—— 复用来电红点的定位，加一个数字变体 */
.p-badge.num { font-style: normal; }

/* 枪店：还没上架的枪 = 一张黑卡（看得到名字，看不到任何数值） */
.gs-item { position: relative; }
.gs-item.unreleased {
  border-style: dashed;
  background: rgba(4, 10, 18, 0.66);
  opacity: 0.82;
}
.gs-item.unreleased .gs-ico { filter: brightness(0.35) saturate(0.4); }
.gs-item.unreleased .gs-t b { color: var(--txt-dim); }
.gs-item.unreleased .gs-t i { color: rgba(160, 190, 215, 0.45); }
.gs-lockrow {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 700;
  color: rgba(200, 220, 240, 0.62);
}
.gs-lockrow svg { flex: 0 0 auto; opacity: 0.75; }

/* 新枪的「NEW」角标：挂在卡片右上角，买下之后自动消失（isNew 读的是 gunAnnounced） */
.gs-new {
  position: absolute;
  top: -7px;
  right: 10px;
  padding: 2px 7px 3px;
  border-radius: 999px;
  background: linear-gradient(180deg, #ffe17a, #e0a418);
  color: #3a2400;
  font-size: 9.5px;
  font-weight: 900;
  font-style: normal;
  letter-spacing: 0.08em;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
}

/* 渔具店：还没上架的项 = 暗行 + 待解锁提示（保留 .buy.lock 的结构 —— 回归在守它） */
.item.locked-row { opacity: 0.72; }
.item.locked-row .icon { filter: brightness(0.45) saturate(0.4); }
.item.locked-row .ds { color: var(--txt-dim); }
.lock-hint {
  margin-top: 5px;
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  font-weight: 700;
  color: rgba(200, 220, 240, 0.6);
}
.lock-hint svg { flex: 0 0 auto; opacity: 0.7; }
`;
fs.writeFileSync('styles.css', css);
console.log('✓ styles.css 追加推送 / 红点 / 黑卡 / NEW 样式');
