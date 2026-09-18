/**
 * _p2-game.mjs —— v0.7 第三批 · 第 2 步：game.js
 *   ① B10 修复（when.map 与分段解锁同源）
 *   ② 枪械解锁判定 + 枪店数据（locked / lockText / isNew）
 *   ③ 未读新枪（save.gunNews）+ iOS 式推送队列 + 红点
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

// ── ① 存档默认值：gunNews ──
rep(`  boats: { owned: [], current: null },
});`,
`  boats: { owned: [], current: null },
  // 未读"新枪上架"（v0.7 第三批）：枪店分段解锁之后，一把枪从"锁着"变"可见"时记进来，
  // 玩家**点开枪店**才清空 —— 手机红点 / 枪店 App 红点 / 新枪「New」角标都读它。
  gunNews: [],
});`, '存档默认 gunNews');

// ── ② 存档迁移 ──
rep(`      if (s.guns.current !== GUN_ORDER[0] && !s.guns.owned.includes(s.guns.current)) {
        s.guns.current = GUN_ORDER[0];
      }`,
`      if (s.guns.current !== GUN_ORDER[0] && !s.guns.owned.includes(s.guns.current)) {
        s.guns.current = GUN_ORDER[0];
      }
      // ── 未读新枪（v0.7 第三批）：同样只保留现在还存在的枪 id ──
      // ⚠ 老存档**故意不回填**：一把已经解锁了很久的枪不该在升级后突然变成"新货"。
      if (Array.isArray(raw.gunNews)) {
        s.gunNews = raw.gunNews.filter((x) => typeof x === 'string' && GUNS.some((g) => g.id === x));
      }`, '存档迁移 gunNews');

// ── ③ B10：when.map 与分段解锁同源 ──
rep(`    if (w.map != null && !this._licenses().includes(w.map)) return false;`,
`    // ⚠ v0.7 第二批把许可证退役之后，\`licenses\` 永远是空数组（buyMap 只在 license>0 时写它）
    //   —— 这里还读它的话，两通带 \`when.map\` 的电话就**永远不响**（GAMEPLAY §6.2 B10）。
    //   语义改成与分段解锁同源："已到过那张图" = \`mapProgress().owned\`。
    if (w.map != null && !this.mapProgress(mapById(w.map)).owned) return false;`, 'B10 修复');

// ── ④ 枪械解锁判定 + 枪店数据 ──
rep(`  gunEntry(g) {
    const lv = this.save.guns.levels[g.id] || 0;
    return {
      gun: g,
      lv,
      owned: g.price <= 0 || this.save.guns.owned.includes(g.id),
      current: this.save.guns.current === g.id,`,
`  /** ⚠ 未读新枪的读写入口（老存档里没有这个字段 —— 和 licenses / calls 同一个理由） */
  _gunNews() {
    if (!Array.isArray(this.save.gunNews)) this.save.gunNews = [];
    return this.save.gunNews;
  }

  /**
   * 一把枪现在**能不能在枪店看到**（v0.7 第三批，A2 = a + b）。
   *
   *   a) \`unlockMap\`   要「到过那张图」（= \`mapProgress().owned\`，与渔具店分段解锁同源）
   *   b) \`unlockDepth\` 在那张图**潜到过这个深度**（读 \`mapBest\`）
   *
   * ⚠ **已拥有的枪永远可见** —— 老存档兜底（B5 的教训）：
   *   一个在分段解锁落地之前就买过巴雷特的玩家，不能因为还没潜到 1100m
   *   就发现"我手里的枪在店里变成了黑影"。
   */
  gunUnlocked(g) {
    if (g.price <= 0 || this.save.guns.owned.includes(g.id)) return true;
    if (g.unlockMap && !this.mapProgress(mapById(g.unlockMap)).owned) return false;
    if (g.unlockDepth != null && this.mapBestOf(g.unlockMap) < g.unlockDepth) return false;
    return true;
  }

  /** 锁着的那把枪，卡片上要写的"怎么才能见到它" */
  gunLockText(g) {
    if (g.unlockMap && !this.mapProgress(mapById(g.unlockMap)).owned) {
      return \`到过「\${mapById(g.unlockMap).name}」后上架\`;
    }
    if (g.unlockDepth != null) return \`在这片海潜到 −\${g.unlockDepth}m 后上架\`;
    return '尚未解锁';
  }

  gunEntry(g) {
    const lv = this.save.guns.levels[g.id] || 0;
    const unlocked = this.gunUnlocked(g);
    return {
      gun: g,
      lv,
      unlocked,
      locked: !unlocked,
      isNew: unlocked && this._gunNews().includes(g.id),
      lockText: unlocked ? '' : this.gunLockText(g),
      owned: g.price <= 0 || this.save.guns.owned.includes(g.id),
      current: this.save.guns.current === g.id,`, 'gunEntry 解锁字段');

// ── ⑤ 买枪前先判锁 ──
rep(`    if (!g || g.price <= 0) return;
    if (this.save.guns.owned.includes(id)) return;
    if (this.save.coins < g.price) { SFX.deny(); this.world.addShake(2); return; }`,
`    if (!g || g.price <= 0) return;
    if (this.save.guns.owned.includes(id)) return;
    // 分段解锁（v0.7 第三批）：还没上架的枪**买不了** —— 界面虽然不给按钮，
    // 这里再兜一次（探针 / 手改 DOM 也能拦住）。
    if (!this.gunUnlocked(g)) { SFX.deny(); this.world.addShake(2); return; }
    if (this.save.coins < g.price) { SFX.deny(); this.world.addShake(2); return; }`, '_buyGun 锁定守卫');

// ── ⑥ 新枪检测 / 清零 / 红点（挂在 _licenses() 后面，和船厂那一段做邻居）──
rep(`  /** 已购许可证的 id 列表（同样是"表可能不存在"的字段，包一层） */
  _licenses() {
    if (!Array.isArray(this.save.licenses)) this.save.licenses = [];
    return this.save.licenses;
  }`,
`  /** 已购许可证的 id 列表（同样是"表可能不存在"的字段，包一层） */
  _licenses() {
    if (!Array.isArray(this.save.licenses)) this.save.licenses = [];
    return this.save.licenses;
  }

  // ── 新枪上架播报（v0.7 第三批）─────────────────────────────
  /**
   * 检测"有哪些枪刚刚从锁着变可见"，把它们记进 \`save.gunNews\` 并推给 UI 播报。
   *
   * **为什么在三个地方调用**：解锁条件有两类，各自的变更时机不同 ——
   *   · \`unlockDepth\`（潜到更深）→ 只会在**一竿结束写纪录**时变（\`enterResult\`）
   *   · \`unlockMap\`（到过那张图）→ 在**换图**那一刻变（\`enterMap\`）
   *   · 收起手机回到待机 → 再兜一次（\`closePhone\`，覆盖"在店里买东西导致解锁"的边角）
   *
   * **只在这里判定一次**：界面（横幅 / 红点 / New 角标）全部只读 \`save.gunNews\`，
   * 不自己算"这把算不算新"—— 否则同一把枪会在三处被判三次，迟早判得不一样。
   */
  _syncGunNews() {
    const news = this._gunNews();
    const fresh = GUNS.filter((g) => {
      if (g.price <= 0) return false;                        // 初始枪不是"新货"
      if (this.save.guns.owned.includes(g.id)) return false; // 已经买过的更不是
      if (news.includes(g.id)) return false;                 // 已经在待读列表里
      return this.gunUnlocked(g);
    });
    if (fresh.length) {
      for (const g of fresh) news.push(g.id);
      persist(this.save);
      this.ui.queueGunNews(fresh.map((g) => g.id));
    }
    this.syncBadges();
    return fresh.map((g) => g.id);
  }

  /** 玩家点开枪店 → 未读清零：手机红点消失、枪店 App 红点消失、店里不再挂「New」 */
  _clearGunNews() {
    if (!this._gunNews().length) return;
    this.save.gunNews = [];
    persist(this.save);
    this.syncBadges();
  }

  /** 左下角那部手机的红点：有未读新枪，或者有还没接的来电 */
  syncBadges() {
    const n = this._gunNews().length + (this.ringingCall ? 1 : 0);
    this.ui.setPhoneBadge(n);
  }`, '新枪播报三件套');

// ── ⑦ 三个调用点 + openPhone 的红点 ──
rep(`    const mb = this._mapBest();
    const mid = this.map.id;
    if (depth > (mb[mid] || 0)) mb[mid] = depth;`,
`    const mb = this._mapBest();
    const mid = this.map.id;
    if (depth > (mb[mid] || 0)) mb[mid] = depth;
    // 深度纪录刚刚落库 —— 这正是"某把枪的 unlockDepth 被满足"的唯一时机（v0.7 第三批）
    this._syncGunNews();`, 'enterResult 挂钩');

rep(`    if (this.state === STATE.IDLE) this.ui.setSeaTitle(this._seaTarget());
    this.ui.refreshApp();
    return true;
  }`,
`    if (this.state === STATE.IDLE) this.ui.setSeaTitle(this._seaTarget());
    this.ui.refreshApp();
    // 到过一张新图 → 那张图的枪立刻上架（散弹枪），并触发播报（v0.7 第三批）
    this._syncGunNews();
    return true;
  }`, 'enterMap 挂钩');

rep(`    // 收起手机之后重新评估要不要响铃（比如刚听完一通，下一通可能已经满足条件了）
    this._syncCall();
  }`,
`    // 收起手机之后重新评估要不要响铃（比如刚听完一通，下一通可能已经满足条件了）
    this._syncCall();
    // 回到待机 → 把排队的"新枪上架"横幅放出来（v0.7 第三批）
    this._syncGunNews();
    this.ui.pumpNews();
  }`, 'closePhone 挂钩');

rep(`  openPhone(app) {`,
`  openPhone(app) {
    // 打开手机那一刻先刷一次红点（可能刚好有新枪 / 有来电）
    this.syncBadges();`, 'openPhone 红点');

// ── ⑧ handlers ──
rep(`      gunList: () => GUNS.map((g) => this.gunEntry(g)),
      buyGun: (id) => this._buyGun(id),`,
`      gunList: () => GUNS.map((g) => this.gunEntry(g)),
      buyGun: (id) => this._buyGun(id),
      // ── 新枪播报（v0.7 第三批）──
      gunNews: () => this._gunNews(),
      clearGunNews: () => this._clearGunNews(),`, 'handlers 补两个回调');

if (fail.length) { console.error('\n✗✗ 未写盘：\n  ' + fail.join('\n  ')); process.exit(1); }
fs.writeFileSync(F, src);
console.log('\n✓ game.js 已写盘');
