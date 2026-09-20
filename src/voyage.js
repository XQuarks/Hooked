/**
 * voyage.js — 航线：地图 / 海图 / 船厂 / 海床宝箱
 *
 * 为什么单独一个文件：这三件事是**同一条进度链**，原先散在 `game.js` 的三个相隔很远的段落里
 * （地图访问器在 550 行上下、船厂与换图在 650~850、宝箱在 1580 上下）。
 * 链条是：**潜到上一张图的底 → 撞开宝箱拿到海图 → 去船厂买船 → 航线 App 换图**，
 * 而"换图门槛"（`mapProgress`）是这条链上唯一的判定点 —— 拆开后整条链在一个文件里可读完。
 *
 * ⚠⚠ **这是「原型挂载」，不是普通模块**：本文件把方法写成一个 **`Voyage` 类**
 *   （**类体里方法之间不需要逗号** —— 所以这些方法是从 `game.js` **原样搬过来的、零改动**），
 *   `game.js` 在类定义之后用 `mountMixin(Voyage)` 把它们逐个挂到 `Game.prototype` 上。
 *   所以这里的方法**照旧写 `this.xxx`**（this 就是 Game 实例），调用点一行都不用改。
 *   ⚠ 踩过的坑（和 narrative.js 同一个）：写成**对象字面量**时方法之间必须加逗号，
 *     而 **`node --check` 对本项目的 `.js` 是哑的**（按扩展名猜成 CJS 就不校验 ESM 语法）——
 *     改完一定要**真加载一次页面**（跑一套回归最快）。
 *
 * ⚠ 依赖方向：只依赖 `config` / `hook` / `save` / `audio`（都是更低层），
 *   **不 import `game.js`，也不 import `narrative.js`** —— 它俩与本文件同层。
 *   （`enterMap()` 会调 `this._syncSms()` / `this.cutsceneFor()`，那是 narrative 挂在同一原型上的方法，
 *   运行期取得到；**但不能写成模块级 import**，否则 narrative ↔ voyage 成环。）
 * ⚠ 改这里之前先看 `ARCHITECTURE.md`：§1（原型挂载的三条静默失效）、§2（换图门槛只有"海图 + 船"、
 *   本图纪录要按图口径、`save.licenses` 已整条退役 —— B10 的教训）。
 */
import {
  WORLD, MODEL_SCALE, TUNING, SIREN, STATE,
  MAPS, mapById, mapMaxDepth, levelCapForMap,
  BOATS, boatById, chartFrom, chartById,
} from './config.js';
import { distToSegment } from './hook.js';
import { persist } from './save.js';
import { SFX } from './audio.js';

/** 航线的方法集（由 `game.js` 挂到 `Game.prototype` 上，见文件头说明） */
export class Voyage {
  // ══════ 地图 · 本图纪录 · 海图 ══════

// ── 地图 ────────────────────────────────────────────────────
/** 当前所在地图。**唯一真相是 save.currentMap**，换图只改它。 */
get map() { return mapById(this.save.currentMap); }

/** 当前地图在 MAPS 里的下标（分段等级闸门 levelCapForMap 用） */
get mapIndex() { return Math.max(0, MAPS.findIndex((m) => m.id === this.map.id)); }

/** 当前地图的等级闸门 */
get mapCap() { return levelCapForMap(this.mapIndex); }

/**
 * 「本图最深纪录」这张表的读写入口 —— **唯一入口**，不要直接碰 `save.mapBest`。
 *
 * 为什么要包一层：手写的存档夹具、以及将来的旧版本存档，都可能整张表都不存在。
 * `save.mapBest[id]` 会直接抛 `Cannot read properties of undefined`，
 * 而且抛在 `_seaTarget()` 里 —— 症状是"点开始钓鱼没反应"，
 * 离病因（换图进度）隔了一整个界面层。（同一个坑在 `levels` 上踩过一次，
 * 那次是 NaN 顺着物理链污染，更隐蔽。）
 */
_mapBest() {
  const mb = this.save.mapBest;
  if (!mb || typeof mb !== 'object') this.save.mapBest = {};
  return this.save.mapBest;
}

/**
 * 某张图到过的最深处。
 * ⚠ 换图条件②要的是**本图**的深度，不是全局 bestDepth ——
 *   混用的话在冰封极地潜到 600m 会顺手满足宁静海湾的换图条件。
 */
mapBestOf(id = this.map.id) {
  return Math.max(0, Math.round(this._mapBest()[id] || 0));
}

/**
 * 已拿到的海图表（`{ polar: true, lava: true }`）。
 * ⚠ 同样包一层：手写的存档夹具、以及 v0.7 的老存档都可能整张表都不存在。
 *   `this.save.charts[id]` 会直接抛 `Cannot read properties of undefined`，
 *   而且抛在 `applyUpgrades()` 里 —— 症状是"读档之后画面直接不刷"，
 *   离病因（换图进度）隔着一整个界面层。
 */
_charts() {
  if (!this.save.charts || typeof this.save.charts !== 'object') this.save.charts = {};
  return this.save.charts;
}

/** 是否已经拿到某张海图（海图 id 见 config 的 CHARTS） */
hasChart(id) { return !!this._charts()[id]; }

  // ══════ 船厂 · 换图进度 · 换图 ══════

// ── 船厂（v0.7）─────────────────────────────────────────────
/**
 * 船厂列表：**界面只渲染，不做判断** —— 拥有 / 当前 / 买得起 / 外观全在这里算好
 * （和枪店同一条原则：判断留在 UI 里的话，"按钮亮着却买不了"会散得到处都是）。
 */
boatList() {
  const b = this._boats();
  return BOATS.map((def) => ({
    def,
    owned: b.owned.includes(def.id),
    current: b.current === def.id,
    affordable: this.save.coins >= def.price,
  }));
}

/**
 * 买一艘船：扣 10,000、记进存档、**当场开出去**（current 直接切到新船）。
 * 三艘船同价，所以这是一个"挑玩法"的选择，不是"攒更多钱买更好的"的阶梯（见 config 的 BOATS）。
 */
buyBoat(id) {
  const def = boatById(id);
  if (!def) return false;
  const b = this._boats();
  if (b.owned.includes(id)) return this.setBoat(id);       // 已经有的船 → 当成"换船"
  if (this.save.coins < def.price) { SFX.deny(); this.world.addShake(2); return false; }
  this.save.coins -= def.price;
  b.owned.push(id);
  b.current = id;
  this.save.boatApp = true;
  persist(this.save);
  this.applyUpgrades();            // 效果 + 外观一起换
  this.ui.setCoins(this.save.coins);
  this.world.burstSparks(this.hook.x, WORLD.surfaceY, 18, 1.4);
  this.ui.floatText(this.hook.x, WORLD.surfaceY + 16 * MODEL_SCALE, `${def.name} 已下水`, 'good');
  SFX.buy();
  return true;
}

/**
 * 换一艘**已经拥有**的船：免费。
 * 为什么免费：三艘船是"三种玩法"，不是"三条升级路线" —— 买断之后应该允许随便试，
 * 否则玩家会先去查攻略再买，那就把一个选择变成了算术题。
 */
setBoat(id) {
  const b = this._boats();
  if (!b.owned.includes(id)) return false;
  b.current = id;
  persist(this.save);
  this.applyUpgrades();
  SFX.tap();
  return true;
}

/**
 * 某张地图的换图进度 —— v0.7 起**只剩两条条件**，而且不再看图鉴 / 深度 / 许可证。
 *
 *   ① **钓到海图**（首图海沟底部的宝箱里，见 `_getChart()`）
 *      —— 它替代了"图鉴 90% + 潜到上限"两条：海图就在最底下，
 *         "潜到上限"成了它的**前提**而不是并列条件，而"钓到 90% 的鱼种"
 *         实测靠刷竿数就能满足（一竿覆盖五层，见 GAMEPLAY §4.6 结论 2）。
 *   ② **至少拥有一艘船**（船厂，10,000）—— 钱必须有出口，
 *      而且这个出口是一件**真的能用的东西**（金币 / 鱼护 / 护钩），比一笔过路费更像奖励。
 *
 * 首图（`MAPS[0]`）是出生地，**没有任何条件**。
 *
 * ⚠ `conds` 由 game 算好交给界面渲染 —— 界面不做任何判断（和枪店同一条原则）。
 */
mapProgress(map) {
  const first = map.id === MAPS[0].id;
  const maxD = mapMaxDepth(map);
  const reached = Math.min(this.mapBestOf(map.id), maxD);
  // ⚠ 通往**这张图**的海图 = id 恰好等于这张图 id 的那张（见 config 的 CHARTS）。
  //   它的宝箱藏在 `chart.from`（上一张图）的**底部**，所以条件文案里的深度
  //   要报**上一张图**的上限 —— 报成本图的会让玩家在错误的海里潜到底。
  const need = chartById(map.id);
  const hasChart = !!need && this.hasChart(need.id);
  const fromMap = need ? mapById(need.from) : null;
  const fromDepth = fromMap ? mapMaxDepth(fromMap) : maxD;
  const boats = this._boats();
  const hasBoat = boats.owned.length > 0;
  const cur = boatById(boats.current);

  const conds = first ? [] : [
    {
      id: 'chart', ok: hasChart,
      text: hasChart
        ? `已持有${need ? need.name : '海图'}`
        : `潜到 −${fromDepth}m，找到海底的宝箱`,
    },
    {
      id: 'boat', ok: hasBoat,
      text: hasBoat ? `已拥有船只 · ${cur ? cur.name : ''}` : '在船厂买一艘船（10,000）',
    },
  ];
  const gateOk = conds.every((c) => c.ok);

  return {
    map, first, maxD, reached,
    // `owned` 的语义 = "这张图已经属于你（可以自由往返）"。
    // 首图恒真；其余图由 gateOk 决定 —— 门槛一旦满足就永久成立（船只/海图都不会消失）。
    owned: first || gateOk, conds, gateOk, hasChart, hasBoat,
    depthOk: reached >= maxD,
    canBuy: !first && gateOk,
  };
}

/** 进某张图（门槛过了就直接过去）。条件不够返回 false。 */
buyMap(id) {
  const map = mapById(id);
  if (!this.mapProgress(map).gateOk) return false;
  // ⚠ 这里原先还有一段「许可证扣钱 + 写 `save.licenses`」。
  //   许可证 v0.7 第二批退役之后 5 张图的 `license` 全是 0，那段**从来没执行过** ——
  //   所以老 `save.licenses` 恒为空数组，而**这正是 B10 的病灶**（见 GAMEPLAY §6.2）。
  //   2026-09-20 整段删除：进图门槛只有「海图 + 船」，且不再有任何代码读 `save.licenses`。
  return this.enterMap(id);
}

/**
 * 换到某张地图：清场、换世界主题、刷新尺子总量与界面。
 *
 * 顺序有讲究：`world.applyMap` / `ui.setMap` 必须在 `spawnFish` 之前 ——
 * 刷鱼读的是 `this.map`（存档已经改了，没问题），但尺子的总量和分区
 * 要等 ui.setMap 之后才对齐，`refreshApp` 又必须在 ui.setMap 之后。
 *
 * ⚠ 门槛（**海图 + 船**）由 `mapProgress` 判定；这里再兜一次是防"数据在两次渲染之间变了"。
 *   放行条件只有两条：① 当前所在的那张图（出生地 / 老存档）**无条件放行**；
 *   ② 换到**别的**图必须过门槛（海图 + 船）。
 * ⚠ **这里原先还有第三条「许可证 > 0 时必须已持有」** —— 它是旧的许可证机制留下的
 *   口子（`save.licenses` 里有 id 就放行，留给回归脚本 / 存档迁移）。许可证退役后
 *   `license` 恒为 0，这条**永远不生效**，2026-09-20 删除。
 *   ⚠ 注意：删掉它之后，测试 / 出图脚本**不能再用 `save.licenses` 当换图钥匙**
 *     （`.dev/shots-polar.mjs` 原来就是这么干的，已改成直接设 `currentMap`）。
 */
enterMap(id) {
  const map = mapById(id);
  // ① 当前所在的那张图**无条件放行**：存档里的图必须能继续玩（老档 / 手改存档）
  // ② 换到**别的**图：必须过门槛（海图 + 船，见 mapProgress）
  if (map.id !== this.save.currentMap && !this.mapProgress(map).gateOk) return false;
  this.save.currentMap = map.id;
  this._syncSms();
  // 海妖之歌（批 8b）：换图重排节拍，别让玩家一进来就正好赶上
  this.sirenT = SIREN.period;
  this.sirenOnT = 0;
  // 过场（批 5）：这张图**第一次**进入时放一次三行故事卡。
  // ⚠ 用回调而不是"先放再换图"：过场是盖在**换完之后**的画面上的，
  //   先播过场的话玩家会看到旧图的背景在故事卡底下。
  const cut = this.cutsceneFor(map.id);
  if (cut) { this.markCutscene(map.id); this.ui.showCutscene(cut, () => this.ui.refreshApp()); }
  // ⚠ 换图要重置"本竿捡过宝箱"的标记：`_chestTaken` 是**按竿**去重的，
  //   而每张图的箱子是独立的一只 —— 不重置的话，在首图捡过之后换到极地，
  //   底部的熔岩海图宝箱会碰不到（症状：潜到底了但没反应）。
  this._chestTaken = false;
  this.fish.releaseAll();
  this.world.applyMap(map);
  this.ui.setMap(map);
  this.spawnFish();
  this.applyUpgrades();
  persist(this.save);
  this.ui.setCoins(this.save.coins);
  // 待机时主界面大标题写的是**地图名** —— 换图之后必须立刻换掉，
  // 否则会出现"船已经开到北极了，标题还写着宁静海湾"。
  if (this.state === STATE.IDLE) this.ui.setSeaTitle(this._seaTarget());
  this.ui.refreshApp();
  // 到过一张新图 → 那张图的枪立刻上架（散弹枪），并触发播报（v0.7 第三批）
  this._syncGunNews();
  return true;
}

/**
 * 「航线」App 里的按钮回调：当前图 → 忽略；门槛过了（首图 / 海图 + 船）→ 直接过去；
 * 否则 → 拒绝音效。界面那边已经按同样的条件把按钮置灰了，这里再判一次是防"数据变了"。
 *
 * ⚠ v0.7 起**换图不花钱**（许可证全 0）：那 10,000 是花在**船**上的，
 *   而船是在船厂买的 —— 花的钱变成了一件真的能用的东西。
 */
_goMap(id) {
  const map = mapById(id);
  if (map.id === this.map.id) return;
  const p = this.mapProgress(map);
  if (!p.gateOk) { SFX.deny(); this.world.addShake(2); return; }
  SFX.tap();
  this.buyMap(map.id);
}

/**
 * 主界面大标题要显示的内容：
 *   name = **当前地图的名字**（不随深度或升级变化）
 *   sub  = 这张地图的探索进度（玩家在**这张图里**到过的最深处）
 *   color= 地图配色，用作标题辉光
 */
_seaTarget() {
  const map = this.map;
  const maxD = mapMaxDepth(map);
  const reached = Math.min(this.mapBestOf(map.id), maxD);
  return {
    name: map.name,
    sub: reached > 0 ? `已探索至 −${reached}m` : `可下潜至 −${maxD}m`,
    color: map.color,
  };
}

  // ══════ 海床宝箱 · 捡到海图 ══════

/**
 * 海床上的宝箱（v0.7）：钩子**碰到就捡**。
 *
 * 为什么不走"钓上来 → 抛向天空 → 打下来"那条链：宝箱是**剧情道具**不是渔获。
 * 让玩家打丢了还得重潜一次海沟底部，那不是设计意图 —— 拿到海图这件事本身
 * 已经由"你能潜到 860m"证明了。
 *
 * ⚠ 它**不占鱼护**、不进空中结算、也不计入图鉴（见 config 的 CHEST 注释）。
 */
_checkChest(prevX, prevY) {
  // ⚠ 按图判定：冰封极地底部那只箱子装的是**熔岩海图**，和首图那只互不影响。
  const chart = chartFrom(this.map.id);
  if (!chart) return;                      // 本图没有海床（最后一张图）
  if (this._chestTaken) return;            // 本竿已经捡过了
  if (this.hasChart(chart.id)) return;     // 这张海图早就拿过了
  const c = this.world.chestAt;
  if (!c) return;
  if (distToSegment(c.x, c.y, prevX, prevY, this.hook.x, this.hook.y) > c.r + TUNING.bumpRadius) return;
  this._chestTaken = true;
  this._getChart(c, chart);
}

/**
 * 捡到海图 —— 换图门槛的前一半（另一半是船，见 `mapProgress`）。三件事一起做：
 *   ① 把这张海图写进 `save.charts`；② **直接解锁船厂 App**；③ 回待机时"码头管理员"会打来电话
 *      （`CALLS` 里 `when:{ chart:'polar' }` 的两通，按"有没有船"分流）。
 *
 * ⚠ 为什么这里直接解锁船厂：需求原话是"若是玩家没有解锁船厂 App 则直接给玩家解锁，
 *   并去掉船厂 NPC 引导"。也就是说 —— 如果玩家**先**钓到海图（还没到第 10 竿），
 *   那通"推荐新船"的电话就不该再打了；实现靠的是电话表里的 `when.appLocked: 'boat'`
 *   （App 已解锁 → 这通电话永远不响），而不是在这里改电话。
 */
_getChart(c, chart) {
  this._charts()[chart.id] = true;
  this.save.boatApp = true;
  const gold = chart.gold;
  this.save.coins += gold;
  persist(this.save);
  this.ui.setCoins(this.save.coins);
  this.world.hideChest();
  this.world.burstCoins(c.x, c.y, 18);
  this.world.burstSparks(c.x, c.y, 24, 1.6);
  this.world.addShake(12);
  this.ui.floatText(c.x, c.y + 18 * MODEL_SCALE, `获得${chart.name}！`, 'good');
  if (gold > 0) this.ui.floatText(c.x, c.y + 36 * MODEL_SCALE, `+${gold}`, 'good sm');
  // 提示语跟着"这张海图通向哪张图"走（第 2 张 / 第 3 张…），不再写死"极地"。
  const to = mapById(chart.id);
  this.ui.setHint(this._boats().owned.length
    ? `拿到${chart.name}了 —— 去航线开往「${to.name}」`
    : `拿到${chart.name}了 —— 去船厂买艘船就能开去「${to.name}」`);
  SFX.buy();
}
}
