/**
 * _p5-wire.mjs —— 接线：推送卡被点 → 打开枪店；待机时放队。
 */
import fs from 'node:fs';

const fail = [];
const rep = (file, a, b, label) => {
  let src = fs.readFileSync(file, 'utf8');
  if (src.includes(b)) { console.log('… ' + label + '（已应用，跳过）'); return; }
  const n = src.split(a).length - 1;
  if (n !== 1) { fail.push(`${label}（${file}）：命中 ${n} 次`); return; }
  fs.writeFileSync(file, src.replace(a, b));
  console.log('✓ ' + label);
};

rep('src/game.js',
`    this.ui = new UI();`,
`    this.ui = new UI();
    // 新货推送被点 → 打开枪店（红点在那一步消失）。"开哪个 App"的判断留在 game 层，
    // UI 只负责"我被点了" —— 否则这个判断又会散到界面里去。
    this.ui.onNewsTap = () => {
      if (this.state === STATE.IDLE && !this.phoneOpen) this.openPhone('gunshop');
    };`, 'game 接推送点击');

rep('src/game.js',
`    this.spawnFish();
    this._syncCall();                     // 待机 = "玩家在做决定"的那一屏，电话只在这里响
  }`,
`    this.spawnFish();
    this._syncCall();                     // 待机 = "玩家在做决定"的那一屏，电话只在这里响
    // 待机也是"新货上架"该出现的时刻：深度纪录在一竿结束时落库，
    // 但推送要等结算面板收掉、回到待机才弹出来（不打架）。
    this._syncGunNews();
    this.ui.pumpNews();
  }`, 'game showIdle 放队');

rep('src/ui.js',
`    this._newsQueue = [];
    this._newsShowing = false;
    this._newsT = 0;`,
`    this._newsQueue = [];
    this._newsShowing = false;
    this._newsT = 0;
    // 点推送卡 = 收起它并让 game 层打开枪店（onNewsTap 由 game 注入）
    this.el.newsBanner.onclick = () => {
      if (!this.el.newsBanner.classList.contains('on')) return;
      clearTimeout(this._newsT);
      this._hideNews();
      this.onNewsTap && this.onNewsTap();
    };`, 'ui 推送卡点击');

if (fail.length) { console.error('\n✗✗ 未写盘：\n  ' + fail.join('\n  ')); process.exit(1); }
console.log('\n✓ 接线完成');
