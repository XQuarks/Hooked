/**
 * _p3-game2.mjs —— game.js 补一个字段：`gunAnnounced`（" ever 播报过的新枪"）
 *
 * 为什么需要两个列表：
 *   · `gunNews`     = 还没**读过**的（驱动手机红点 / 枪店 App 红点 / 推送横幅）→ 点开枪店清空
 *   · `gunAnnounced`= 播报**过**的（驱动店里那枚「NEW」角标）→ **不清空**，
 *                     跟到那把枪被买下为止（owned 之后 `isNew` 自然为 false）
 * 用户原话："点开枪店app新枪加个角标显示New。玩家点开枪店后红点消失。"
 * —— 红点和角标的生命周期不一样，一个字段装不下两种语义。
 */
import fs from 'node:fs';

const F = 'src/game.js';
let src = fs.readFileSync(F, 'utf8');
const fail = [];
const rep = (a, b, label) => {
  const n = src.split(a).length - 1;
  if (n !== 1) { fail.push(`${label}: 命中 ${n} 次`); return; }
  src = src.replace(a, b);
  console.log('✓ ' + label);
};

rep(`  // 未读"新枪上架"（v0.7 第三批）：枪店分段解锁之后，一把枪从"锁着"变"可见"时记进来，
  // 玩家**点开枪店**才清空 —— 手机红点 / 枪店 App 红点 / 新枪「New」角标都读它。
  gunNews: [],`,
`  // 未读"新枪上架"（v0.7 第三批）：枪店分段解锁之后，一把枪从"锁着"变"可见"时记进来，
  // 玩家**点开枪店**才清空 —— 手机红点 / 枪店 App 红点 / 推送横幅读它。
  gunNews: [],
  // 播报**过**的新枪（不清空）：驱动店里那枚「NEW」角标，
  // 一直挂到那把枪被买下为止（owned 之后 isNew 自然为 false）。
  gunAnnounced: [],`, '存档默认 gunAnnounced');

rep(`      // ── 未读新枪（v0.7 第三批）：同样只保留现在还存在的枪 id ──
      // ⚠ 老存档**故意不回填**：一把已经解锁了很久的枪不该在升级后突然变成"新货"。
      if (Array.isArray(raw.gunNews)) {
        s.gunNews = raw.gunNews.filter((x) => typeof x === 'string' && GUNS.some((g) => g.id === x));
      }`,
`      // ── 未读新枪（v0.7 第三批）：同样只保留现在还存在的枪 id ──
      // ⚠ 老存档**故意不回填**：一把已经解锁了很久的枪不该在升级后突然变成"新货"。
      if (Array.isArray(raw.gunNews)) {
        s.gunNews = raw.gunNews.filter((x) => typeof x === 'string' && GUNS.some((g) => g.id === x));
      }
      if (Array.isArray(raw.gunAnnounced)) {
        s.gunAnnounced = raw.gunAnnounced.filter((x) => typeof x === 'string' && GUNS.some((g) => g.id === x));
      }`, '存档迁移 gunAnnounced');

rep(`      isNew: unlocked && this._gunNews().includes(g.id),`,
`      isNew: unlocked && this._gunAnnounced().includes(g.id),`, 'gunEntry isNew 改读 announced');

rep(`  /** ⚠ 未读新枪的读写入口（老存档里没有这个字段 —— 和 licenses / calls 同一个理由） */
  _gunNews() {
    if (!Array.isArray(this.save.gunNews)) this.save.gunNews = [];
    return this.save.gunNews;
  }`,
`  /** ⚠ 未读新枪的读写入口（老存档里没有这个字段 —— 和 licenses / calls 同一个理由） */
  _gunNews() {
    if (!Array.isArray(this.save.gunNews)) this.save.gunNews = [];
    return this.save.gunNews;
  }

  /** ⚠ 播报过的新枪（「NEW」角标的来源）—— 只增不减，买下之后 isNew 自己变 false */
  _gunAnnounced() {
    if (!Array.isArray(this.save.gunAnnounced)) this.save.gunAnnounced = [];
    return this.save.gunAnnounced;
  }`, '_gunAnnounced 入口');

rep(`    if (fresh.length) {
      for (const g of fresh) news.push(g.id);
      persist(this.save);
      this.ui.queueGunNews(fresh.map((g) => g.id));
    }`,
`    if (fresh.length) {
      const ann = this._gunAnnounced();
      for (const g of fresh) { news.push(g.id); if (!ann.includes(g.id)) ann.push(g.id); }
      persist(this.save);
      this.ui.queueGunNews(fresh.map((g) => g.id));
      SFX.record();          // 轻轻一声提示音 —— 不是"做对了事"的那种奖励音
    }`, '_syncGunNews 同时记 announced + 提示音');

if (fail.length) { console.error('\n✗✗ 未写盘：\n  ' + fail.join('\n  ')); process.exit(1); }
fs.writeFileSync(F, src);
console.log('\n✓ game.js 已写盘');
