/**
 * _p6-fix.mjs —— 自查抓到的两个问题：
 *   ① `isNew` 没排除"已拥有" → 买下新枪后 NEW 角标永挂
 *   ② 老存档升级（gunAnnounced 不存在）时会突然收到一堆"新货上架" —— 迁移要把
 *      **当前已解锁**的枪全部标成"播报过"；同时把这段迁移挪到 chart/boats 兜底**之后**
 *      （它依赖 s.chart / s.boats 才能算"当前已解锁"）
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

// ① 从 guns 段后面把迁移**挪走**（那段算不了"当前已解锁"，因为 chart 还没读进来）
rep(`      // ── 未读新枪（v0.7 第三批）：同样只保留现在还存在的枪 id ──
      // ⚠ 老存档**故意不回填**：一把已经解锁了很久的枪不该在升级后突然变成"新货"。
      if (Array.isArray(raw.gunNews)) {
        s.gunNews = raw.gunNews.filter((x) => typeof x === 'string' && GUNS.some((g) => g.id === x));
      }
      if (Array.isArray(raw.gunAnnounced)) {
        s.gunAnnounced = raw.gunAnnounced.filter((x) => typeof x === 'string' && GUNS.some((g) => g.id === x));
      }`,
`      // （未读新枪的迁移挪到了下面 chart / boats 兜底之后 —— 它要先知道"到过哪张图"）`,
  '迁移搬走');

// ② 在 chart / boats 兜底之后补上完整迁移
rep(`      // ⚠ 海图也不许"丢"：如果存档里船都买了却没有海图（不可能由正常流程产生），
      //   补上海图，免得玩家卡在"有船但进不去极地"的死状态里。
      if (s.boats.owned.length && !s.chart) s.chart = true;
    }`,
`      // ⚠ 海图也不许"丢"：如果存档里船都买了却没有海图（不可能由正常流程产生），
      //   补上海图，免得玩家卡在"有船但进不去极地"的死状态里。
      if (s.boats.owned.length && !s.chart) s.chart = true;
      // ── 未读新枪（v0.7 第三批）：只保留现在还存在的枪 id ──
      // ⚠⚠ **老存档升级要把"当前已解锁"的枪全部标成"播报过"** ——
      //   不然这次更新一上线，所有老玩家会同时收到五六条"新货上架"，
      //   一个本来是好消息的功能第一次露面就成了骚扰。只有 fresh install
      //   （连存档都没有）才从空白开始。
      if (Array.isArray(raw.gunNews)) {
        s.gunNews = raw.gunNews.filter((x) => typeof x === 'string' && GUNS.some((g) => g.id === x));
      }
      if (Array.isArray(raw.gunAnnounced)) {
        s.gunAnnounced = raw.gunAnnounced.filter((x) => typeof x === 'string' && GUNS.some((g) => g.id === x));
      } else {
        const hasBoat = s.boats.owned.length > 0;
        const reached = (id) => id === MAPS[0].id || (s.chart && hasBoat);
        for (const g of GUNS) {
          if (g.price <= 0) continue;
          if (g.unlockMap && !reached(g.unlockMap)) continue;
          if (g.unlockDepth != null && (s.mapBest[g.unlockMap] || 0) < g.unlockDepth) continue;
          s.gunAnnounced.push(g.id);
        }
      }
    }`, '迁移挪位 + 老档回填');

// ③ isNew 排除"已拥有"
rep(`  gunEntry(g) {
    const lv = this.save.guns.levels[g.id] || 0;
    const unlocked = this.gunUnlocked(g);
    return {
      gun: g,
      lv,
      unlocked,
      locked: !unlocked,
      isNew: unlocked && this._gunAnnounced().includes(g.id),
      lockText: unlocked ? '' : this.gunLockText(g),
      owned: g.price <= 0 || this.save.guns.owned.includes(g.id),
      current: this.save.guns.current === g.id,`,
`  gunEntry(g) {
    const lv = this.save.guns.levels[g.id] || 0;
    const owned = g.price <= 0 || this.save.guns.owned.includes(g.id);
    const unlocked = this.gunUnlocked(g);
    return {
      gun: g,
      lv,
      unlocked,
      locked: !unlocked,
      // ⚠ 必须排除"已拥有"：否则买下新枪的那一刻 NEW 角标会**永远挂在卡片上**
      //   （announced 只增不减，就是为"还没买"的窗口服务的）。
      isNew: unlocked && !owned && this._gunAnnounced().includes(g.id),
      lockText: unlocked ? '' : this.gunLockText(g),
      owned,
      current: this.save.guns.current === g.id,`, 'isNew 排除已拥有');

if (fail.length) { console.error('\n✗✗ 未写盘：\n  ' + fail.join('\n  ')); process.exit(1); }
fs.writeFileSync(F, src);
console.log('\n✓ game.js 已写盘');
