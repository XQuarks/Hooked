/**
 * guns.js — 枪械：枪店（买 / 换 / 升）+ 开火管线（七把枪共用一条）
 *
 * 为什么单独一个文件：这两半原先隔着 750 行 —— 枪店在 650 行上下、开火管线在 1400 行上下，
 * 而它们共享同一批派生值（`GUNS` / `gunStats()` / `gunUpgradeCost()` / 存档里的 `save.guns`）。
 * 拆开后"加一把枪要动哪几处"在一个文件里可读完。
 *
 * ⚠⚠ **这是「原型挂载」，不是普通模块**：本文件把方法写成一个 **`Guns` 类**
 *   （**类体里方法之间不需要逗号** —— 所以这些方法是从 `game.js` **原样搬过来的、零改动**），
 *   `game.js` 在类定义之后用 `mountMixin(Guns)` 把它们逐个挂到 `Game.prototype` 上。
 *   所以这里的方法**照旧写 `this.xxx`**（this 就是 Game 实例），调用点一行都不用改。
 *   ⚠ 踩过的坑（与 narrative / voyage 同一个）：写成**对象字面量**时方法之间必须加逗号，
 *     而 **`node --check` 对本项目的 `.js` 是哑的**（按扩展名猜成 CJS 就不校验 ESM 语法）——
 *     改完一定要**真加载一次页面**（跑一套回归最快）。
 *
 * ⚠ 边界说明：**`_hitFish()` 留在 `game.js`** —— 它管的是"被打中之后发生什么"
 *   （Boss 血条 / 扣钱鱼罚款 / 连击 / 图鉴），属于结算与经济；本文件只管"子弹怎么飞、打中了谁"。
 *   开火管线通过 `this._hitFish()` 在运行期调它（同原型，不 import）。
 *
 * ⚠ 依赖方向：只依赖 `config` / `world` / `fish` / `hook` / `save` / `audio`（都是更低层），
 *   **不 import `game.js`，也不 import `narrative.js` / `voyage.js`** —— 它们同层。
 * ⚠ 改这里之前先看 `ARCHITECTURE.md` §5（枪械那 5 条硬约束，含
 *   "`_shoot()` 的判据是先看 `pellets` 再看 `mech`，而 `gen-docs` 的 `fireBranchOf()` 是它的镜像"）。
 */
import {
  TUNING, MODEL_SCALE, STATE,
  GUNS, GUN_MAX_LEVEL, gunById, gunStats, gunUpgradeCost,
  mapById,
} from './config.js';
import { clamp } from './world.js';
import { FISH_STATE } from './fish.js';
import { distToSegment } from './hook.js';
import { persist } from './save.js';
import { SFX } from './audio.js';

/** 枪械的方法集（由 `game.js` 挂到 `Game.prototype` 上，见文件头说明） */
export class Guns {
  // ══════ 枪店 · 上架判定 · 买卖升级 ══════

// ── 枪店（v0.4）──────────────────────────────────────────
/** ⚠ 未读新枪的读写入口（老存档里没有这个字段 —— 和 calls / boats 同一个理由） */
_gunNews() {
  if (!Array.isArray(this.save.gunNews)) this.save.gunNews = [];
  return this.save.gunNews;
}

/** ⚠ 播报过的新枪（「NEW」角标的来源）—— 只增不减，买下之后 isNew 自己变 false */
_gunAnnounced() {
  if (!Array.isArray(this.save.gunAnnounced)) this.save.gunAnnounced = [];
  return this.save.gunAnnounced;
}

/**
 * 一把枪现在**能不能在枪店看到**（v0.7 第三批，A2 = a + b）。
 *
 *   a) `unlockMap`   要「到过那张图」（= `mapProgress().owned`，与渔具店分段解锁同源）
 *   b) `unlockDepth` 在那张图**潜到过这个深度**（读 `mapBest`）
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
    return `到过「${mapById(g.unlockMap).name}」后上架`;
  }
  if (g.unlockDepth != null) return `在这片海潜到 −${g.unlockDepth}m 后上架`;
  return '尚未解锁';
}

/**
 * 枪店里一把枪要显示的全部信息。
 *
 * **UI 只负责排版，不做任何判断** —— 拥有 / 装备中 / 能否买得起 / 下一级数值
 * 全在这里算好。为什么不把这些判断放进 ui.js：那些判断散在界面里之后，
 * "按钮亮着却点不动"这类不一致会同时出现在好几个地方，而且没人测得到。
 */
gunEntry(g) {
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
    current: this.save.guns.current === g.id,
    stat: gunStats(g.id, lv),
    next: lv >= GUN_MAX_LEVEL ? null : gunStats(g.id, lv + 1),
    upCost: gunUpgradeCost(g.id, lv),
    maxed: lv >= GUN_MAX_LEVEL,
    canAffordBuy: this.save.coins >= g.price,
  };
}

_buyGun(id) {
  const g = GUNS.find((x) => x.id === id);
  if (!g || g.price <= 0) return;
  if (this.save.guns.owned.includes(id)) return;
  // 分段解锁（v0.7 第三批）：还没上架的枪**买不了** —— 界面虽然不给按钮，
  // 这里再兜一次（探针 / 手改 DOM 也能拦住）。
  if (!this.gunUnlocked(g)) { SFX.deny(); this.world.addShake(2); return; }
  if (this.save.coins < g.price) { SFX.deny(); this.world.addShake(2); return; }
  this.save.coins -= g.price;
  this.save.guns.owned.push(id);
  // 买完直接装上 —— 玩家刚花了一大笔，不该再让他多点一次「装备」
  this.save.guns.current = id;
  persist(this.save);
  SFX.buy();
  this.ui.setCoins(this.save.coins);
  this.ui.refreshApp();
}

_equipGun(id) {
  const g = GUNS.find((x) => x.id === id);
  if (!g) return;
  if (g.price > 0 && !this.save.guns.owned.includes(id)) return;   // 没买的枪不能装
  if (this.save.guns.current === id) return;
  this.save.guns.current = id;
  persist(this.save);
  SFX.buy();
  this.ui.refreshApp();
}

_upgradeGun(id) {
  const g = GUNS.find((x) => x.id === id);
  if (!g) return;
  const lv = this.save.guns.levels[id] || 0;
  if (lv >= GUN_MAX_LEVEL) return;
  const cost = gunUpgradeCost(id, lv);
  if (this.save.coins < cost) { SFX.deny(); this.world.addShake(2); return; }
  this.save.coins -= cost;
  this.save.guns.levels[id] = lv + 1;
  persist(this.save);
  SFX.buy();
  // 枪械数值是**现取**的（gunStats），不需要像 applyUpgrades 那样重新落一遍；
  // 只有金币和枪店界面要刷。
  this.ui.setCoins(this.save.coins);
  this.ui.refreshApp();
}

  // ══════ 空中 · 开火管线 ══════

// ── 开火管线（v0.4）：七把枪共用一条 ────────────────────────
//
// ⚠ 原先这里写着「③ 空中：枪械」—— 那个 ③ 是 `game.js` 早期阶段编号的残留，
//   而现在 `game.js` 的 ①②③④ 是「下潜 / 上升 / 水面 / 结算」，对不上。
//   本文件独立之后不再跟着 `game.js` 的阶段编号走（只在 `enterAir()` 里被调用一次）。
//
// 七把枪共用一条开火管线，差别全在 `GUNS[].mech` 和数值上：
//
//   single   点一下一发，**长按不连发**（普通手枪 / 散弹枪 / 巴雷特）
//   burst    按住连发到弹匣空 → 自动换弹 → 换完继续（Uzi）
//   auto     按住一直打，无弹匣，开火头 spinup 秒转速没上来（加特林）
//   laser    按住持续结算，伤害随连续照射时间递增，照久了过热（激光枪）
//   pierce   点一下打出一条贯穿屏幕的直线，线上全中（鱼叉枪）
//
// ⚠ 判定一律发生在**玩家指的那个世界坐标**上，和"枪口在哪"无关 ——
//   手机上手指会挡住枪口，如果判定挂在枪口上就必然打不准。
//   鱼叉是唯一的例外：它有一条真实的弹道，起点在画面下方（船的位置）。

/** 当前装备的枪（**唯一真相是 save.guns.current**） */
get gun() { return gunById(this.save.guns.current); }

/** 当前枪械的等级 */
get gunLv() { return this.save.guns.levels[this.gun.id] || 0; }

/** 当前枪械在该等级下的数值（已含枪械等级，**未乘**攻击力倍率） */
get gunStat() { return gunStats(this.gun.id, this.gunLv); }

/**
 * 当前瞄准的世界坐标。
 *
 * 用 `input.nx/ny` 而不是"开火那一刻记下来的点"：长按连发的枪必须
 * "手指拖到哪就打到哪"，瞄准点得每帧重读。
 * `-0.045` 是手机上的**手指偏移补偿** —— 指肚会盖住落点，把判定往上挪一点，
 * 玩家看到的才是"我指哪儿打哪儿"。
 */
_aimPoint() {
  const ny = clamp(this.input.ny - 0.045, 0, 1);
  return this.world.screenToWorld(this.input.nx, ny);
}

/** 空中阶段的操作提示 —— 按当前枪械的机制给，别让玩家自己去猜这把枪怎么用 */
_gunHint() {
  switch (this.gun.mech) {
    case 'auto': return '按住不放 · 持续开火';
    case 'burst': return '按住连发 · 打空自动换弹';
    case 'laser': return '按住持续照射 · 越照越疼';
    case 'pierce': return '点击射出鱼叉 · 线上的鱼全中';
    case 'shotgun': return '点击开火 · 扇形覆盖一大片';
    default: return '点击开火 · 单点射击';
  }
}

/** 进入空中阶段时把枪械状态清零（弹匣压满、无冷却、激光递增归零） */
_resetGun() {
  const s = this.gunStat;
  this.gunCd = 0;
  this.gunReloadT = 0;
  this.gunHeat = 0;
  this.gunSpin = 0;
  this.gunAmmo = s.mag || 0;
  this._syncGunHud(s);
}

/** 按下瞬间的那一发（保证手感零延迟；连发枪的后续子弹交给 _updateGun） */
_tapFire() {
  if (this.state !== STATE.AIR) return;
  const s = this.gunStat;
  if (this.gunReloadT > 0 || this.gunCd > 0) return;
  if (this.gun?.mech === 'burst' && s.mag && this.gunAmmo <= 0) { this._startReload(s); return; }
  this._shoot(s);
  this._syncGunHud(s);
}

/**
 * 每帧推进枪械状态：冷却 / 换弹 / 预热 / 过热，并在"该开火"的时候开火。
 * 单点枪（single / pierce）在这里**只降冷却、不开火** —— 那就是"不支持长按连发"。
 */
_updateGun(dt) {
  const g = this.gun;
  const s = gunStats(g.id, this.gunLv);

  if (this.gunCd > 0) this.gunCd = Math.max(0, this.gunCd - dt);

  // ── 换弹 / 强制冷却：这段时间什么都打不出去 ──
  if (this.gunReloadT > 0) {
    this.gunReloadT -= dt;
    if (this.gunReloadT <= 0) {
      this.gunReloadT = 0;
      if (s.mag) this.gunAmmo = s.mag;
      this.gunHeat = 0;
      SFX.reload();
    }
    this._syncGunHud(s);
    return;
  }

  const holdable = g.mech === 'auto' || g.mech === 'burst' || g.mech === 'laser';
  if (!this.input.pointerDown || !holdable) {
    // 松手（或者这本来就是单点枪）→ 预热与激光递增清零。
    // 激光的递增**必须**清零：不清的话"点一下停一下"也能一直吃满加成，
    // "越照越疼"就变成了"免费送满伤"。
    this.gunSpin = 0;
    if (g.mech === 'laser') this.gunHeat = 0;
    this._syncGunHud(s);
    return;
  }

  if (g.mech === 'auto') this.gunSpin = Math.min(s.spinup, this.gunSpin + dt);

  // 激光：先累计照射时长，再判过热。顺序不能反 ——
  // 反了的话"刚好照满"的那一帧会先结算一次伤害再过热，多白打一下。
  if (g.mech === 'laser') {
    this.gunHeat += dt;
    if (s.mag && this.gunHeat >= s.mag) { this._startReload(s); this._syncGunHud(s); return; }
  }

  if (this.gunCd > 0) { this._syncGunHud(s); return; }
  if (g.mech === 'burst' && s.mag && this.gunAmmo <= 0) { this._startReload(s); this._syncGunHud(s); return; }

  this._shoot(s);
  this._syncGunHud(s);
}

_startReload(s) {
  if (!s.reload || this.gunReloadT > 0) return;
  this.gunReloadT = s.reload;
  this.gunCd = 0;
  // 用一声低闷的"咔"而不是 deny() 的失败音：换弹 / 过热是**正常流程**
  // （Uzi 每 9 发就要换一次），用失败音会让玩家以为自己操作错了。
  SFX.thud();
}

/** 真正打出一发（或一次齐射）。`s` 是本枪当前档位的数值。 */
_shoot(s) {
  const g = this.gun;
  const p = this._aimPoint();
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;

  // 最终伤害 = 枪械当前档位的伤害，**没有别的乘数**。
  // ⚠ v0.5：「攻击力」那条全局倍率已并入枪械自身的 `dmg` 曲线（见 config 的 GUNS 注释），
  //   所以这里**不要**再乘任何系数 —— 想调攻击力就调 `GUNS[].dmg`。
  let dmg = s.damage;
  // 激光：伤害随连续照射时间递增，×rampMax 封顶（见 GUNS.laser 的注释）
  if (g.mech === 'laser') dmg *= 1 + Math.min(s.rampMax, s.ramp * this.gunHeat);

  // 冷却：加特林在转速没上来之前射速减半（冷机 2× 间隔 → 全速 1×）
  let cd = s.cooldown;
  if (g.mech === 'auto' && s.spinup > 0) {
    cd *= 1 + (1 - Math.min(1, this.gunSpin / s.spinup));
  }
  this.gunCd = cd;

  if (g.mech === 'burst') this.gunAmmo = Math.max(0, this.gunAmmo - 1);

  // 音效：激光每 0.15s 结算一次，逐次播音会变成噪音，只在"刚开火"那一下响
  if (g.mech === 'laser') { if (this.gunHeat < 0.03) SFX.shot(); }
  else if (g.mech === 'pierce') SFX.thud();
  else SFX.shot();

  // ⚠⚠ **分派规则：「怎么打」和「能不能长按」是两件事，先判前者。**
  //
  //   散弹枪的 `mech` 是 `'single'`（= 单点、不支持长按），但它一次要打出 `pellets` 颗弹丸。
  //   所以这里**先看"有没有多颗弹丸"**，再看 `mech` 决定走哪条管线。
  //
  //   🔴 v0.7 第四批之前这里是纯 `switch (g.mech)` + `case 'shotgun'`，
  //      而**没有任何一把枪的 `mech` 叫 `shotgun`** → 那个 case 永远匹配不到，
  //      `_shootShotgun()` 是死代码、`pellets` / `spread` 两个字段没有任何读者。
  //      后果：散弹枪一次开火只有 1 个爆炸圈，成了全场最弱的一把枪
  //      （伤害 1.6/发、半径 16 —— 比免费手枪的 2 / 24 还差），而它标价 8,000。
  //      实测与复盘见 `GAMEPLAY.md` §6.2 **B11**；验收 = `verify9` 的 **C9b**。
  //   ⚠ `.dev/gen-docs.mjs` 的 `gunOutputCeiling()` 里有一份**同源的镜像**，
  //     改这里的判据时必须同步改那边，否则 `docs/06` §4.2 会印出一个游戏里不存在的伤害。
  if (s.pellets > 1) { this._shootShotgun(p, s, dmg); return; }
  switch (g.mech) {
    case 'pierce': this._shootPierce(p, s, dmg); break;
    case 'laser': this._shootLaser(p, s, dmg); break;
    // 榴弹枪（批 4）：唯一一条**延迟结算**的管线 —— 见 `_shootLob`。
    case 'lob': this._shootLob(p, s, dmg); break;
    default: this._shootBlast(p, s, dmg, g.mech === 'single'); break;
  }
}

/**
 * 榴弹枪（批 4）：**延迟爆炸**。开火时不结算，而是把一颗"到点才炸"的弹挂到 `this.lobs`，
 * 由 `_updateLobs(dt)` 在 `s.fuse`（0.55s）之后引爆。
 *
 * 为什么值得单独一条管线：八把枪里只有它把"命中"从**瞬时**改成**有提前量** ——
 * 玩家得预判鱼 0.55 秒之后在哪。§5.2 的原则是"差异作用在**空间**上，不是数值上"，
 * 而时间也是空间的一种（这一枪打的是"鱼将会在的地方"）。
 *
 * ⚠ 引信没走完就结算的话，那颗弹**直接消失**（`_resetRun` 清空 `lobs`）——
 *   这是设计意图：打早了就是炸空，和"鱼飞走了"是同一类失败。
 */
_shootLob(p, s, dmg) {
  this.lobs.push({ x: p.x, y: p.y, r: s.radius, dmg, t: s.fuse });
  // 出膛的一点反馈（真正的爆炸在引信到点那一刻）：小震动 + 几颗火花
  this.world.addShake(3.5);
  this.world.burstSparks(p.x, p.y, 6, 0.8);
  SFX.thud();
}

/** 引信推进：到点就炸（每帧由 `_updateAir` 调一次） */
_updateLobs(dt) {
  if (!this.lobs.length) return;
  for (let i = this.lobs.length - 1; i >= 0; i--) {
    const b = this.lobs[i];
    b.t -= dt;
    if (b.t > 0) continue;
    this.lobs.splice(i, 1);
    this.world.burstExplosion(b.x, b.y, b.r);
    this.world.addShake(7);
    this._damageInRadius(b.x, b.y, b.r, b.dmg, false);
  }
}

/** 单发 / 连发的普通弹：瞄准点上一个爆炸圈 */
_shootBlast(p, s, dmg, heavy) {
  this.world.addShake(heavy && s.radius >= 50 ? 9 : 4.5);
  this.world.burstExplosion(p.x, p.y, s.radius);
  this._damageInRadius(p.x, p.y, s.radius, dmg, heavy);
}

/**
 * 散弹枪：一次打出 `pellets` 颗弹丸，以瞄准点为圆心铺开。
 *
 * 第一颗永远正中（保证"瞄准了就有反馈"），其余按随机角度+随机距离散开 ——
 * 用固定角度的话每次开火图案完全一样，看起来像"一个会转的图形"而不是霰弹。
 * 覆盖直径 ≈ 2×(spread + radius)，比手枪大得多，这就是它"大范围"的全部含义。
 */
_shootShotgun(p, s, dmg) {
  this.world.addShake(7);
  const n = Math.max(1, s.pellets);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.9;
    const d = i === 0 ? 0 : s.spread * (0.5 + Math.random() * 0.5);
    const px = p.x + Math.cos(a) * d;
    const py = p.y + Math.sin(a) * d;
    this.world.burstExplosion(px, py, s.radius);
    // quiet = true：一次齐射已经加过震屏了，不要 6 颗弹丸各加一次
    this._damageInRadius(px, py, s.radius, dmg, true);
  }
}

/** 激光：从画面下方射向瞄准点的一条持续光柱 */
_shootLaser(p, s, dmg) {
  const vr = this.world.viewRange();
  const x0 = this.world.camX;
  const y0 = vr.bottom - 12;
  // 伤害圈画在瞄准点上（判定和视觉一致），光柱只是"看得见的弹道"
  this.world.burstBeam(x0, y0, p.x, p.y, Math.max(3, s.radius * 0.55), 0xff5577, 0.09);
  this.world.burstExplosion(p.x, p.y, s.radius);
  this.world.addShake(3.2);
  this._damageInRadius(p.x, p.y, s.radius, dmg, true);
}

/**
 * 鱼叉：从画面下方（船的位置）朝瞄准方向甩出一条贯穿屏幕的直线，
 * **线上的鱼全部命中** —— 这就是它和"爆炸圈"的根本区别：
 * 爆炸吃的是"点周围的密度"，鱼叉吃的是"排成一条线的顺序"。
 */
_shootPierce(p, s, dmg) {
  const vr = this.world.viewRange();
  const x0 = this.world.camX;
  const y0 = vr.bottom - 20;
  let dx = p.x - x0, dy = p.y - y0;
  const len = Math.hypot(dx, dy);
  if (!(len > 0.001)) return;
  dx /= len; dy /= len;
  const L = this.world.viewH * 2.6;
  const x1 = x0 + dx * L, y1 = y0 + dy * L;

  this.world.addShake(6);
  this.world.burstBeam(x0, y0, x1, y1, Math.max(3, s.radius * 0.9), 0xbfe8ff, 0.24);

  for (const f of this.airFish) {
    if (f.state !== FISH_STATE.AIR) continue;
    const fp = f.mesh.position;
    if (distToSegment(fp.x, fp.y, x0, y0, x1, y1) > s.radius + f.radius) continue;
    this._applyDamage(f, dmg);
  }
  this.world.addShake(2.2);
}

/** 对一个圆内的所有空中目标（鱼 + 天空目标）结算伤害 */
_damageInRadius(x, y, radius, dmg, quiet = false) {
  let hitAny = false;
  for (const f of this.airFish) {
    if (f.state !== FISH_STATE.AIR) continue;
    const p = f.mesh.position;
    // 爆炸圈就是判定圈：圈碰到鱼身就是满额伤害，不做距离衰减
    //（做了衰减之后低伤害枪会变成"看着打中了却没掉血"，手感非常别扭）
    if (Math.hypot(p.x - x, p.y - y) > radius + f.radius) continue;
    hitAny = true;
    this._applyDamage(f, dmg);
  }
  // ⚠ 天空目标走**同一把尺子**（圈碰到就满额、同样不衰减）——
  //   两种目标的手感必须一致，否则"打鸟比打鱼难"会变成一个说不清的体验差。
  for (const s of this.sky) {
    if (!s.alive) continue;
    const p = s.mesh.position;
    if (Math.hypot(p.x - x, p.y - y) > radius + s.radius) continue;
    hitAny = true;
    this._applySkyDamage(s, dmg);
  }
  if (hitAny && !quiet) this.world.addShake(2.2);
  return hitAny;
}

/**
 * 一条鱼中弹：死了走结算，没死就往上顶一段 + 报"还差几枪"。
 *
 * ⚠ `knockT` 是**逐鱼的上顶冷却**（0.3s）。没有它的话，连发枪（加特林 13 发/秒）
 *   会把每次的初速**累加**到同一条鱼上：knockUp 是 `vy = max(vy,0) + boost`，
 *   一秒能叠到 2000+，鱼会直接飞出大气层。有了它，"血厚 → 被打得越来越高"
 *   这个手感照样成立（每秒最多顶 3 次），但不会失控。
 *   同一个计时器顺便节流"还差 N 枪"的飘字 —— 否则连发枪会刷屏。
 */
_applyDamage(f, dmg) {
  const p = f.mesh.position;
  if (f.damage(dmg) <= 0) { this._hitFish(f); return; }

  if (!(f.knockT > 0)) {
    f.knockT = 0.3;
    f.knockUp(TUNING.knockUpBase + Math.min(f.hp, TUNING.knockUpMaxHp) * TUNING.knockUpPerHp, 0);
    this.world.burstSparks(p.x, p.y, 6, 0.7);
    this._hitStop(f.hp);      // 命中定格（批 6）：血越厚停得越久
    const shots = Math.max(1, Math.ceil(f.hp / Math.max(0.05, dmg)));
    this.ui.floatText(p.x, p.y + 10 * MODEL_SCALE, `还差 ${shots} 枪`, 'sm');
  }
  // Boss（批 7）：血条 + 每跨过 1/segments 换一次行为模式。
  // ⚠ 放在 knockT 的 if **外面** —— 血条要每一枪都更新，不是每 0.3s 一次。
  if (f.boss) this._syncBossBar(f);
}

/** 把枪械状态推给 HUD（每帧最多一次，不重建 DOM 子树） */
_syncGunHud(s) {
  const g = this.gun;
  this.ui.setGunState({
    id: g.id, name: g.name, icon: g.icon, mech: g.mech,
    level: this.gunLv,
    // 伤害/发：v0.5 起这是"攻击力"的唯一体现（全局倍率已并入枪械的 dmg 曲线）
    damage: s.damage,
    mag: s.mag, ammo: this.gunAmmo,
    reloadT: this.gunReloadT, reloadMax: s.reload || 0,
    heat: this.gunHeat, heatMax: s.mag || 0,
    ramp: s.ramp, rampMax: s.rampMax,
  });
}
}
