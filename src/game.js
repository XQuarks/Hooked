/**
 * game.js — 主循环 + 状态机
 *
 *   TITLE ─▶ IDLE ─▶ DESCEND ─▶ ASCEND ─▶ AIR ─▶ RESULT ─┐
 *             ▲   │                                        │
 *             │   └─▶ PHONE（手机：渔具店 / 枪店 / 图鉴 / 航线 / 设置）│
 *             └────────────────────────────────────────────┘
 *
 * 三个阶段的玩法（和《Ridiculous Fishing》一致）：
 *   DESCEND 鱼是障碍 —— 碰到鱼鱼线就被扯住、自动收线，这一竿到此为止
 *   ASCEND  同一批鱼变成奖励 —— 左右移动鱼钩，撞到就串上鱼线
 *   AIR     渔获按身价飞向天空 —— 点哪儿炸哪儿，把空中的鱼打下来换钱
 *
 * 手机不是独立状态：它开着的时候世界继续按 IDLE 跑（船在浪里晃、鱼在游），
 * 只是多了一个 phoneOpen 开关来屏蔽抛竿输入 —— 这样"打开手机"看起来就像
 * 在船上看手机，而不是切进另一个界面。
 */
import * as THREE from 'three';
import {
  WORLD, CAMERA, ZONES, SPECIES, TUNING, FISH_DENSITY, HAZARD_SPAWN, SCHOOL, ICEBERG,
  SPAWN_TOP_MARGIN, MODEL_SCALE,
  UPGRADES, UPGRADE_ORDER, MAX_LEVEL, maxLvOf, levelCapForMap, upgradeCost, SAVE_KEY, altitudeAt,
  DEFAULT_MAP, MAPS, mapById, mapMaxDepth, zoneAtDepth, zonesOfMap,
  GUNS, GUN_ORDER, GUN_MAX_LEVEL, gunById, gunStats, gunUpgradeCost,
  CALLS, CALL_GAP,
  BOATS, BOAT_ORDER, boatById, CHART, CHEST, SEABED,
} from './config.js';
import { World, clamp, lerp } from './world.js';
import { FishManager, FISH_STATE } from './fish.js';
import { Hook, distToSegment } from './hook.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { SFX, unlockAudio, setMuted, isMuted } from './audio.js';

const STATE = {
  TITLE: 'title', IDLE: 'idle', DESCEND: 'descend',
  ASCEND: 'ascend', AIR: 'air', RESULT: 'result',
};

/**
 * 铅坠·直达深度：本竿最多能把钩子直接放到多深（正数米数）。
 *
 * 两个上限取小：
 *   ① 铅坠等级给的上限（`LEVELS.dropDepth`，Lv0 = 80 → Lv20 = 1540）
 *   ② **鱼线极限 × DROP_MAX_RATIO（70%）**
 *
 * ② 是这套机制能存在的**前提**：不加它，铅坠升满之后"跳到底"就等于把整个下潜阶段删掉，
 * 而"下潜躲鱼"是这个游戏三段循环里的第一段（见 GAMEPLAY.md 支柱 P1）。
 * 它同时也是唯一挡住"在深图把铅坠升满、然后回浅图跳到底"的那道闸 ——
 * 传入的 `maxDepth` 已经在 `applyUpgrades()` 里按**当前地图**封顶过了。
 *
 * ⚠ 调用点在 `applyUpgrades()` 而不是开竿时：换图 / 买鱼线之后它必须立刻跟着变，
 *   否则玩家会看到"选了 500m，换到浅图之后还能跳 500m"。
 */
function dropDepthCap(save, map, maxDepth) {
  const byLevel = TUNING.dropDepth(save.levels.sinker);
  const byLine = Math.max(0, maxDepth) * TUNING.DROP_MAX_RATIO;
  return Math.max(0, Math.min(byLevel, byLine));
}

/**
 * 本竿实际要跳到的深度（正数米数，0 = 不跳）。
 *
 * 只有"开关打开 + 玩家选的目标深度有效"才跳。目标深度被钳进
 * `[DROP_MIN_DEPTH, cap]` —— 上限来自 `dropDepthCap()`，
 * 下限保证钩子不会停在贴着水面的那一段空白里（见 config 的 DROP_MIN_DEPTH）。
 */
function resolveDropDepth(save, cap) {
  const d = save.drop;
  if (!d || !d.on) return 0;
  if (!(cap > 0)) return 0;
  const want = Number(d.depth) || 0;
  return clamp(want, TUNING.DROP_MIN_DEPTH, cap);
}

// ─────────────────────────────────────────────────────────────
// 存档
// ─────────────────────────────────────────────────────────────
const freshSave = () => ({
  coins: 0, bestDepth: 0, bestAlt: 0, casts: 0, totalEarned: 0,
  // 等级表由 UPGRADE_ORDER 生成 —— 加升级项时只改 config，不会漏掉存档字段
  levels: Object.fromEntries(UPGRADE_ORDER.map((k) => [k, 0])),
  muted: false,
  // 图鉴：{ [speciesId]: { n: 钓到次数, best: 最高身价 } }
  codex: {},
  // 玩家当前在哪片海。**这是"当前地图"的唯一真相** ——
  // 以前各处直接读 DEFAULT_MAP，多地图之后必须改成读它（见 Game.map）。
  currentMap: DEFAULT_MAP.id,
  // 已买下许可证的地图 id（初始地图 license = 0，不需要在这里）
  licenses: [],
  // 每张图各自到过的最深处 { [mapId]: 米数 }。
  // bestDepth 仍是"全游戏最深记录"（结算面板用），换图条件②要的是**本图**的，
  // 两者不能混 —— 否则在冰封极地潜到 600m 会顺手满足宁静海湾的换图条件。
  mapBest: {},
  // ── 枪械（v0.4）──
  //   owned   已买下的枪 id（初始手枪不在这里，它永远可用）
  //   current 当前装备的枪 id —— **这是"当前枪械"的唯一真相**
  //   levels  每把枪各自的等级（0 ~ GUN_MAX_LEVEL）
  //
  // ⚠ 为什么不把枪械等级塞进 `levels` 那张表：那张表的键是**升级项**（鱼线/鱼钩/…），
  //   走 lvAt() 取绝对值曲线；枪械等级是"这把枪自己的档位"，取值走 gunStats()。
  //   两张表混在一起，加一把枪就会让 `lvAt` 的越界钳制把枪械等级当成升级等级。
  guns: { owned: [], current: GUN_ORDER[0], levels: Object.fromEntries(GUN_ORDER.map((id) => [id, 0])) },
  // ── 铅坠·直达深度（v0.5）──
  //   on    这一竿开竿时要不要跳过一段下潜
  //   depth 玩家指定的目标深度（正数米，实际会被钳到 [DROP_MIN_DEPTH, dropDepthCap]）
  //
  // ⚠ 这是**玩家偏好**而不是装备等级，所以不放进 `levels`：
  //   `levels` 的每一项都对应一条 LEVELS 曲线，而这两个是"开关 + 一个数"。
  //   混进去的话 lvAt() 会把它们当成曲线名去查表，直接抛错。
  drop: { on: false, depth: 0 },
  // ── 来电引导（v0.6）──
  //   calls        已听过的电话 id（听完就不再响）
  //   lastCallCast 上一通电话发生在第几竿 —— 用来实现"两通之间至少隔 CALL_GAP 竿"
  calls: [],
  lastCallCast: -999,
  // ── 海图 / 船只（v0.7）──
  //   chart    是否已经钓到极地海图（首图海沟底部的宝箱里）
  //   boatApp  船厂 App 是否已解锁（第 10 竿的电话 或 钓到海图时解锁）
  //   boats    { owned: 已买下的船 id[], current: 当前用的那艘 }
  //
  // ⚠ 换图门槛 = `chart` + `boats.owned.length > 0`（见 mapProgress）。
  //   许可证机制保留在 MAPS 里（将来加图可能还要），但当前两张图都是 0。
  chart: false,
  boatApp: false,
  boats: { owned: [], current: null },
  // 未读"新枪上架"（v0.7 第三批）：枪店分段解锁之后，一把枪从"锁着"变"可见"时记进来，
  // 玩家**点开枪店**才清空 —— 手机红点 / 枪店 App 红点 / 推送横幅读它。
  gunNews: [],
  // 播报**过**的新枪（不清空）：驱动店里那枚「NEW」角标，
  // 一直挂到那把枪被买下为止（owned 之后 isNew 自然为 false）。
  gunAnnounced: [],
});

function loadSave() {
  const s = freshSave();
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      s.coins = Number(raw.coins) || 0;
      s.bestDepth = Number(raw.bestDepth) || 0;
      s.bestAlt = Number(raw.bestAlt) || 0;
      s.casts = Number(raw.casts) || 0;
      s.totalEarned = Number(raw.totalEarned) || 0;
      s.muted = !!raw.muted;
      for (const k of UPGRADE_ORDER) {
        // ⚠ 钳到**该项自己的上限**（maxLvOf）而不是 MAX_LEVEL：
        //   一次性工具（绞盘）的上限是 1，用 MAX_LEVEL 会让手改存档把它写成 20，
        //   于是商店显示一个"已拥有但 Lv.20"的错位状态。
        s.levels[k] = clamp(Math.round(Number(raw.levels?.[k]) || 0), 0, maxLvOf(k));
      }
      if (raw.codex && typeof raw.codex === 'object') {
        for (const [id, v] of Object.entries(raw.codex)) {
          const n = Math.max(0, Math.round(Number(v?.n) || 0));
          const best = Math.max(0, Math.round(Number(v?.best) || 0));
          if (n > 0) s.codex[id] = { n, best };
        }
      }
      if (Array.isArray(raw.licenses)) {
        s.licenses = raw.licenses.filter((x) => typeof x === 'string');
      }
      // ⚠ 存档里的地图 id 可能是**已经不存在的地图**（改名 / 删图 / 手改存档），
      //   mapById 会退回第一张，这里存回它的 id，免得每次读档都要兜一次。
      s.currentMap = mapById(raw.currentMap).id;
      if (raw.mapBest && typeof raw.mapBest === 'object') {
        for (const [id, v] of Object.entries(raw.mapBest)) {
          const d = Math.max(0, Math.round(Number(v) || 0));
          if (d > 0 && MAPS.some((m) => m.id === id)) s.mapBest[id] = d;
        }
      }
      // 老存档迁移（v0.1 只有全局 bestDepth，没有 per-map 的表）。
      // 把全局纪录当成初始地图的纪录补进去 —— 否则老玩家回来会发现大标题
      // 从「已探索至 −430m」退回「可下潜至 −430m」、航线 App 的深度条件也变红，
      // 看起来像进度被清了。只在表是空的时候补，不会覆盖真实数据。
      if (!Object.keys(s.mapBest).length && s.bestDepth > 0) {
        s.mapBest[DEFAULT_MAP.id] = Math.round(s.bestDepth);
      }
      // ── 枪械：逐字段兜底，任何一项坏掉都不影响其它项 ──
      // ⚠ v0.4 之前的老存档整个 `guns` 字段都不存在 —— 上面的 freshSave() 已经铺好了
      //   默认值（手枪 + 全 0 级），这里只覆盖"读得出来的"部分。
      //   verify9 的 D4 专门盯这条路径。
      const rg = raw.guns;
      if (rg && typeof rg === 'object') {
        if (Array.isArray(rg.owned)) {
          // 只保留**现在还存在的枪 id**：删过枪 / 改过 id 的存档不会留下一堆幽灵
          s.guns.owned = rg.owned.filter((x) => typeof x === 'string' && GUNS.some((g) => g.id === x));
        }
        if (typeof rg.current === 'string' && GUNS.some((g) => g.id === rg.current)) {
          s.guns.current = rg.current;
        }
        if (rg.levels && typeof rg.levels === 'object') {
          for (const id of GUN_ORDER) {
            s.guns.levels[id] = clamp(Math.round(Number(rg.levels[id]) || 0), 0, GUN_MAX_LEVEL);
          }
        }
      }
      // current 指向一把没买的枪（手改存档 / 上面被过滤掉了）→ 退回手枪。
      // 不兜这一下的话，玩家会拿着一把"没拥有却能开火"的枪，枪店里还看不到它。
      if (s.guns.current !== GUN_ORDER[0] && !s.guns.owned.includes(s.guns.current)) {
        s.guns.current = GUN_ORDER[0];
      }
      // （未读新枪的迁移挪到了下面 chart / boats 兜底之后 —— 它要先知道"到过哪张图"）
      // ── 铅坠·直达深度：逐字段兜底（老存档整个 drop 字段都不存在）──
      const rd = raw.drop;
      if (rd && typeof rd === 'object') {
        s.drop.on = !!rd.on;
        s.drop.depth = Math.max(0, Math.round(Number(rd.depth) || 0));
      }
      // ── 来电引导：同样逐字段兜底，并且**只保留现在还存在的电话 id** ──
      // （删过一通电话 / 改过 id 的存档不会留下幽灵条目）
      if (Array.isArray(raw.calls)) {
        s.calls = raw.calls.filter((x) => typeof x === 'string' && CALLS.some((c) => c.id === x));
      }
      const lcc = Number(raw.lastCallCast);
      if (Number.isFinite(lcc)) s.lastCallCast = Math.round(lcc);
      // ── 海图 / 船只（v0.7）：逐字段兜底，并且**只保留现在还存在的船 id** ──
      s.chart = !!raw.chart;
      s.boatApp = !!raw.boatApp;
      const rb = raw.boats;
      if (rb && typeof rb === 'object') {
        const owned = (Array.isArray(rb.owned) ? rb.owned : [])
          .filter((id) => typeof id === 'string' && boatById(id));
        s.boats.owned = [...new Set(owned)];
        s.boats.current = s.boats.owned.includes(rb.current) ? rb.current : (s.boats.owned[0] || null);
      }
      // ⚠ 兜底：有船却没解锁船厂（手改存档 / 将来删过 App）→ 补上解锁。
      //   不补的话桌面看不到船厂，玩家拥有一艘**买不到也换不了**的船。
      if (s.boats.owned.length) s.boatApp = true;
      // ⚠ 海图也不许"丢"：如果存档里船都买了却没有海图（不可能由正常流程产生），
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
    }
  } catch (_) { /* 存档损坏则用默认值 */ }
  return s;
}

function persist(save) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (_) { /* 隐私模式忽略 */ }
}

// ─────────────────────────────────────────────────────────────
// 飞鸟（射击阶段的奖励目标）
// ─────────────────────────────────────────────────────────────
function buildBird() {
  const g = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xfbfdff, flatShading: true });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), white);
  body.scale.set(4.4, 2.1, 2.1);
  g.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(1.75, 10, 8), white);
  head.position.set(4.1, 1.3, 0);
  g.add(head);

  const beak = new THREE.Mesh(
    new THREE.ConeGeometry(0.75, 2.6, 5),
    new THREE.MeshLambertMaterial({ color: 0xffab2e })
  );
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(6.3, 1.0, 0);
  g.add(beak);

  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1f26 });
  for (const zs of [1, -1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), eyeMat);
    e.position.set(4.9, 1.8, zs * 1.0);
    g.add(e);
  }

  // 翅膀：单个对称剪影，用 scale.y 模拟扑翼
  const s = new THREE.Shape();
  const pts = [[-1, 0], [-0.34, -0.62], [0, -0.12], [0.34, -0.62], [1, 0], [0.42, 0.3], [-0.42, 0.3]];
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const wing = new THREE.Mesh(
    new THREE.ShapeGeometry(s),
    new THREE.MeshLambertMaterial({ color: 0xf2f6fa, side: THREE.DoubleSide, flatShading: true })
  );
  wing.scale.set(11, 8, 1);
  wing.position.y = 1.0;
  g.add(wing);
  g.userData.wing = wing;
  return g;
}

// ─────────────────────────────────────────────────────────────
// Game
// ─────────────────────────────────────────────────────────────
class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    // 存档必须先读：世界要按存档里的地图来建（水体渐变 / 极光 / 冰柱 / 浮冰），
    // 否则读档直接进冰封极地时会先闪一帧宁静海湾。
    this.save = loadSave();
    this.world = new World(this.canvas, this.map);
    this.fish = new FishManager(this.world.scene);
    this.hook = new Hook(this.world.scene, this.world.rodTip);
    this.ui = new UI();
    // 新货推送被点 → 打开枪店（红点在那一步消失）。"开哪个 App"的判断留在 game 层，
    // UI 只负责"我被点了" —— 否则这个判断又会散到界面里去。
    this.ui.onNewsTap = () => {
      if (this.state === STATE.IDLE && !this.phoneOpen) this.openPhone('gunshop');
    };
    this.ui.setMap(this.map);
    this.input = new Input(this.canvas);

    this.state = STATE.TITLE;
    this.phoneOpen = false;                // 手机是否展开（不占用 state，世界照常在 IDLE 跑）
    this.time = 0;
    this.timeScale = 1;
    this.slowmoT = 0;
    this.hitCd = 0;
    this.bottomT = 0;
    this.reelPre = 0;
    this.ascendRampT = 0;   // 回拉起步缓动剩余时长（只有 _beginAscend 会把它点着）
    this.airT = 0;
    this.airClearT = 0;   // 场上没有可打的鱼之后过了多久（结算停留用）
    this.birdT = 0;
    this.castT = 0;
    this.castAir = false;                  // 抛竿滞空：这段时间玩家能左右移动鱼钩
    this.castV = { x: 0, y: 0 };
    this.birds = [];
    this.airFish = [];
    this.caught = [];
    this.maxDepth = TUNING.maxDepth(this.save.levels.line);
    // ⚠ v0.5：下潜 / 收线速度、撞鱼判定、罚款都变成**常量**（它们原来的升级轴已移除）。
    //   仍然写成实例字段而不是直接用 TUNING.xxx —— 热路径上每帧读一次字段比读两层对象快，
    //   而且调试时 `g.descendSpeed` 一眼能看见。
    this.descendSpeed = TUNING.DESCEND_SPEED;
    // 下面几项由 applyUpgrades() 统一赋值，这里先给个初值免得 applyUpgrades 之前被读到
    this.ascendSpeed = TUNING.ASCEND_SPEED;   // 基准收线速度；快速回收时临时乘 FAST_REEL_MUL
    this.creelLimit = TUNING.creelLimit(this.save.levels.creel);
    this.bumpRadius = TUNING.bumpRadius;
    this.pufferPenalty = TUNING.pufferPenalty;
    this.baitBonus = TUNING.bait(this.save.levels.bait);
    // 铅坠·直达深度：本竿开竿时把钩子直接放到多深（0 = 不跳，正常从水面沉下去）
    this.dropDepth = 0;
    // 浮冰减速剩余时间（冰封极地）。> 0 时下潜速度乘 ICEBERG.slowScale ——
    // 撞浮冰的代价是"这一段变慢"，不是"这一竿结束"（和撞鱼区分开）。
    this.iceSlowT = 0;
    // ── 枪械状态（只在 AIR 阶段有意义，每次进空中都重置）──
    // 为什么是散装字段而不是一个对象：这几个值每帧都要读写，散装字段的读写
    // 在热路径上没有属性查找开销；而且调试时 `g.gunCd` 一眼能看见，不用展开对象。
    this.gunCd = 0;         // 距离下一发的冷却（秒）
    this.gunAmmo = 0;       // 弹匣剩余发数（burst 用；激光不用）
    this.gunReloadT = 0;    // 换弹 / 强制冷却剩余（秒），> 0 时不能开火
    this.gunHeat = 0;       // 激光连续照射时长（同时是伤害递增公式里的 t）
    this.gunSpin = 0;       // 加特林转速预热（0 → spinup）
    this.camY = WORLD.surfaceY + this.world.viewH * CAMERA.idleAnchor;
    this.world.camY = this.camY;

    this._resetRun();
    this._bindInput();
    this._bindDom();

    this.applyUpgrades();
    setMuted(!!this.save.muted);
    this.spawnFish();
    this.hook.setPosition(0, WORLD.surfaceY - 14 * MODEL_SCALE);
    this.ui.project = (wx, wy) => {
      const w = this.world;
      return {
        nx: (wx - w.camX) / w.viewW + 0.5,
        ny: 0.5 - (wy - w.camY) / w.viewH,
      };
    };
    this.ui.setMuteIcon(isMuted());
    this.ui.setCoins(this.save.coins);
    this.ui.setLineLimit(this.maxDepth);

    window.addEventListener('resize', () => this.world.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.world.resize(), 120));

    this.showTitle();
    this._last = performance.now();
    requestAnimationFrame(this._loop);
  }

  /**
   * 把存档里的等级同步到实际手感参数上（买完东西、读档后都要调）。
   *
   * 所有会随升级变化的量在这里**一次性**落到 game 实例上，
   * **不要在下潜/上升的循环里现查 LEVELS** —— 那样每帧要读好几次表，
   * 而且"哪一项在哪生效"会散得满代码都是。
   */
  applyUpgrades() {
    const L = this.save.levels;
    // ⚠ 线长是"玩家能力"，但必须按**当前地图的深度上限**封顶。
    //
    //   不封的话：在冰封极地升到 Lv9（线长 620m）再回宁静海湾（只有 430m 深），
    //   能一路潜到 620m —— 海底早过了，画面里只剩虚空；
    //   而且深度尺的量程还是 430m，HUD 的数字和尺子对不上（实测出图就撞见过 740/620）。
    //
    //   商店的等级闸门（levelCapForMap）只挡"在这张图能升到几级"，
    //   挡不住"带着在别处升的长线跨图过来"。所以这里必须再钳一次。
    this.maxDepth = Math.min(TUNING.maxDepth(L.line), mapMaxDepth(this.map));
    this.creelLimit = TUNING.creelLimit(L.creel);            // 鱼护
    this.baitBonus = TUNING.bait(L.bait);                    // 鱼饵（spawnFish 抽签时用）
    // ── 船只效果（v0.7）──────────────────────────────────────
    // 三艘船各带一个效果，**只取当前那艘**（不是把已拥有的船叠起来）——
    // 叠加的话"把三艘都买了"就成了唯一正解，而这套设计的意图是
    // **三选一：挑你喜欢的玩法**（多卖钱 / 装得多 / 护钩子）。
    // ⚠ 换船是免费的（已拥有的船随便换），所以这不是"永久绑定"，可以随便试。
    {
      const boat = boatById(this._boats().current);
      const eff = boat ? boat.effect : null;
      this.boatGoldMul = eff && eff.kind === 'gold' ? eff.mul : 1;
      if (eff && eff.kind === 'creel') this.creelLimit += eff.add;
      this.hookGuardMax = eff && eff.kind === 'guard' ? eff.count : 0;
      // 外观：把**船的数据**交给世界层（世界层不认识 config，见 world.setBoatSkin 注释）
      this.world.setBoatSkin(boat);
    }
    // 宝箱：拿到海图之后就收起来（它是一次性的剧情道具）
    this.world.showChest(!this.save.chart);
    // 铅坠·直达深度：等级给的是"最多能跳多深"，实际还要和鱼线极限、70% 上限取小。
    // 这个钳制放在这里（而不是开竿时现算）—— 换图 / 买鱼线之后它必须立刻跟着变。
    this.dropMax = dropDepthCap(this.save, this.map, this.maxDepth);
    this.hook.setRadius(TUNING.hookRadius(L.hook));
    this.world.setLamp(L.lamp);
    this.ui.setLineLimit(this.maxDepth);
    // ⚠ 三个参数都要给全：漏了 `min` 的话界面会把下限当成 0，
    //   于是"直达 · 关"时显示 `−0m`，而实际落点会被 resolveDropDepth 钳到 20m —— 显示和实际不一致。
    this.ui.setDropControl(this.save.drop, this.dropMax, TUNING.DROP_MIN_DEPTH);
  }

  // ── 一局数据 ─────────────────────────────────────────────
  _resetRun() {
    this.caught = [];
    this.run = {
      caught: 0, lost: 0, shot: 0, earned: 0,
      bestCombo: 0, depth: 0, alt: 0, escaped: [], birds: 0,
      // 超时收竿时还挂在天上、没打下来的条数（v0.6）。单独记一个数是因为
      // 「逃走了」那条链是按名字逐条列的，几十条一起列会把结算面板撑爆。
      timedOut: 0,
    };
    this.combo = 0;
    this.mult = 1;
    this.maxDepthReached = 0;
    this.maxAltReached = 0;
    // 快速回收（绞盘）：**每竿重置**。买下绞盘不等于永久加速 ——
    // 它是一个"我现在够了"的决策，见 config 的 FAST_REEL_MUL。
    this.fastReel = false;
    // 本竿实际跳到的深度（0 = 没跳）。结算 / 提示用，也让 verify 能直接断言。
    this.dropUsed = 0;
    // 直达深度落地后的撞鱼缓冲（见 config 的 DROP_GRACE）
    this.dropGraceT = 0;
    // 鱼护满了只提示一次（v0.7，见 _creelFull）—— 每竿重置
    this._creelFullDone = false;
    // 船只「装甲号」的护钩次数：**每竿重置**（本竿第一次撞鱼不强制收线，第二次照常）
    this.hookGuardLeft = this.hookGuardMax || 0;
    // 宝箱每竿只能被"捡"一次（捡到之后就没了，但这条防的是同一帧重复触发）
    this._chestTaken = false;
    // 被「忽略」的那一通电话：抛新的一竿就允许它再响（见 pendingCall）
    this.ignoredCall = null;
  }

  get multOfCombo() {
    return Math.min(TUNING.comboMax, 1 + Math.floor(this.combo / TUNING.comboStep) * 0.25);
  }

  // ── 输入绑定 ─────────────────────────────────────────────
  _bindInput() {
    this.targetX = 0;

    this.input.onDown = (nx, ny) => {
      unlockAudio();
      if (this.phoneOpen) return;                 // 手机开着的时候不抛竿
      if (this.state === STATE.IDLE) {
        this.enterDescend();
      } else if (this.state === STATE.DESCEND || this.state === STATE.ASCEND) {
        this._steer(nx);
      } else if (this.state === STATE.AIR) {
        // 空中：点一下 = 开一枪。长按连发不在这里 —— 那种枪由 _updateGun 每帧驱动，
        // 这里只负责"按下瞬间的第一发"，保证手感没有延迟。
        this._tapFire();
      }
    };
    this.input.onDrag = (nx) => {
      if (this.state === STATE.DESCEND || this.state === STATE.ASCEND) this._steer(nx);
    };
    this.input.onKey = (code, down) => {
      if (!down) return;
      if (code === 'Space' && this.state === STATE.DESCEND) this._reel();
      if (code === 'KeyM') this._toggleMute();
    };
  }

  _bindDom() {
    const el = this.ui.el;
    el.reelBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (this.state === STATE.DESCEND) this._reel();
    });
    el.mute.addEventListener('click', (e) => { e.stopPropagation(); this._toggleMute(); });
    // 快速回收（绞盘）：上升阶段按一下，本竿剩下的上升段全速收线。
    // ⚠ 必须 stopPropagation + preventDefault：它压在游戏画面上，
    //   不拦的话这一下会同时被 Input 当成"点屏幕"（上升阶段会去 _steer）。
    el.fastReelBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.fastReelNow();
    });
    // 手机入口：渔具店 / 枪店 / 图鉴 / 航线 / 设置 五个 App 都在这台手机里
    el.phoneBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.state === STATE.IDLE && !this.phoneOpen) { SFX.tap(); this.openPhone(); }
    });
    // 来电卡片（v0.7：iPhone 式）：点**卡片本身** = 接听；两个圆钮分别是忽略 / 接听。
    // ⚠ 必须 stopPropagation —— 它压在游戏画面上，不拦的话这一下会同时被 Input
    //   当成"点屏幕"，玩家本来只想接个电话，结果顺手抛了一竿。
    el.callBanner.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (this.state === STATE.IDLE && !this.phoneOpen && this.ringingCall) this._answerCall();
    });
    el.callAccept.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (this.state === STATE.IDLE && !this.phoneOpen && this.ringingCall) this._answerCall();
    });
    // 「忽略」= 只是把这张卡收起来，**不记为已听** —— 下一次回待机它还会响。
    // 这是刻意的：忽略不等于听过，"还没处理的电话"必须还能找回来（见 config 的 CALLS 硬约束②）。
    el.callDecline.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.ignoredCall = this.ringingCall ? this.ringingCall.id : null;
      this.ringingCall = null;
      this.ui.ringPhone(false, null);
      this.ui.setHint('电话先不接 —— 下一竿回待机它还会响');
    });
  }

  _toggleMute() { this._setMuted(!isMuted()); }

  /** 静音状态同时写进存档 —— 手机里的「设置」App 会读它 */
  _setMuted(v) {
    setMuted(v);
    this.save.muted = v;
    persist(this.save);
    this.ui.setMuteIcon(isMuted());
  }

  // ── 手机（商店 / 图鉴 / 设置）─────────────────────────────
  /** 打开手机：世界继续按 IDLE 跑，只是把抛竿输入收起来（手机里没有抛竿入口） */
  openPhone(app) {
    // 打开手机那一刻先刷一次红点（可能刚好有新枪 / 有来电）
    this.syncBadges();
    if (this.state !== STATE.IDLE || this.phoneOpen) return;
    this.phoneOpen = true;
    this.ui.showPhoneBtn(false);
    this.ui.setHint('');
    this.ui.openPhone(this.save, this._phoneHandlers());
    // 有来电时**直接进来电界面** —— 玩家点手机本来就是为了接电话，
    // 让他再在桌面上找一次「电话」App 是多余的。
    if (app) this.ui.openApp(app);
    else if (this.ringingCall) this.ui.openApp('call');
  }

  closePhone() {
    if (!this.phoneOpen) return;
    this.phoneOpen = false;
    this.ui.closePhone();
    if (this.state === STATE.IDLE) {
      this.ui.showPhoneBtn(true);
      this.ui.setHint('点击屏幕 · 抛竿下潜');
    }
    // 收起手机之后重新评估要不要响铃（比如刚听完一通，下一通可能已经满足条件了）
    this._syncCall();
    // 回到待机 → 把排队的"新枪上架"横幅放出来（v0.7 第三批）
    this._syncGunNews();
    this.ui.pumpNews();
  }

  /** 手机里各 App 的回调，全部回到 game 这一层执行 */
  _phoneHandlers() {
    return {
      tap: () => SFX.tap(),
      buy: (k) => this._buy(k),
      // ── 铅坠·直达深度（v0.5）──
      // 界面只管"我要开/关"和"我要跳到多深"，**钳制一律在 setDropDepth 里做**。
      setDropOn: (v) => this.setDropEnabled(v),
      setDropDepth: (v) => this.setDropDepth(v),
      // ── 来电引导（v0.6）──
      // 界面只负责"要不要接 / 接完去哪"，**标记已听、写存档、跳 App 都在 game 这一层**。
      ringingCall: () => this.ringingCall,
      answerCall: () => this._answerCall(),
      endCall: (goTo) => this._endCall(goTo),
      callLog: () => this._calls(),
      mapList: () => MAPS.map((m) => this.mapProgress(m)),
      goMap: (id) => this._goMap(id),
      // ── 船厂（v0.7）──
      apps: () => this._apps(),
      boatList: () => this.boatList(),
      buyBoat: (id) => this.buyBoat(id),
      setBoat: (id) => this.setBoat(id),
      // ── 枪店 ──
      // UI 拿到的是一份**已经算好的**列表（拥有 / 装备中 / 等级 / 下一级数值 / 价格），
      // 界面里不做任何判断 —— 否则"按钮亮了却买不了"这类不一致会散在 UI 里，还没人测得到。
      gunList: () => GUNS.map((g) => this.gunEntry(g)),
      buyGun: (id) => this._buyGun(id),
      // ── 新枪播报（v0.7 第三批）──
      gunNews: () => this._gunNews(),
      clearGunNews: () => this._clearGunNews(),
      equipGun: (id) => this._equipGun(id),
      upgradeGun: (id) => this._upgradeGun(id),
      close: () => this.closePhone(),
      reset: () => this._confirmReset(),
      getMuted: () => isMuted(),
      setMute: (v) => this._setMuted(v),
    };
  }

  _confirmReset() {
    this.ui.confirm(
      '清空存档',
      '金币、升级、纪录与图鉴都会被重置，<br>此操作不可撤销。',
      () => this._resetSave(),
      '确认清空'
    );
  }

  _resetSave() {
    this.save = freshSave();
    persist(this.save);
    setMuted(false);
    this.ui.setMuteIcon(false);
    this.applyUpgrades();
    this.ui.setCoins(0);
    this.ui.hideOverlay();
    if (this.state === STATE.TITLE) this.showTitle();
    else { this.ui.refreshApp(); this.ui.showPhoneHome(); }
  }

  _steer(nx) {
    const w = this.world.screenToWorld(nx, 0.5);
    if (!Number.isFinite(w.x)) return;
    this.targetX = clamp(w.x, -WORLD.playHalfWidth, WORLD.playHalfWidth);
  }

  // ── 状态切换 ─────────────────────────────────────────────
  showTitle() {
    this.state = STATE.TITLE;
    this.phoneOpen = false;
    this.ui.closePhone();
    this.ui.showHud(false);
    this.ui.showPhoneBtn(false);
    this.ui.showGunBar(false);
    this.ui.setDepthChip(false);
    this.ui.setSeaTitle(null);
    this.ui.hideOverlay();
    this.ui.showTitle(this.save, {
      start: () => { unlockAudio(); SFX.tap(); this.showIdle(); },
      reset: () => this._confirmReset(),
    });
    this.hook.setVisible(true);
    this._parkHook();
  }

  /**
   * 待机：默认的游戏界面。
   * 整条船 + 渔夫都在画面里，点屏幕才抛竿；左下角是手机入口。
   */
  showIdle() {
    this.state = STATE.IDLE;
    this.phoneOpen = false;
    this.ui.closePhone();
    this.ui.hideOverlay();
    this.ui.showHud(true);
    this.ui.showPhoneBtn(true);
    this.ui.showGunBar(false);
    this.ui.showFastReel(false);
    this.ui.setDepthChip(false);          // 待机时先藏起来
    this.ui.setCombo(0, 1);
    this.ui.showReel(false);
    this.ui.setCatchVisible(false);
    this.ui.setRulerVisible(false);
    this.ui.setZone(null);
    this.ui.clearFloats();
    this.ui.setHint('点击屏幕 · 抛竿下潜');
    this.ui.setSeaTitle(this._seaTarget());
    this.hook.setVisible(true);
    this._parkHook();
    this.spawnFish();
    this._syncCall();                     // 待机 = "玩家在做决定"的那一屏，电话只在这里响
    // 待机也是"新货上架"该出现的时刻：深度纪录在一竿结束时落库，
    // 但推送要等结算面板收掉、回到待机才弹出来（不打架）。
    this._syncGunNews();
    this.ui.pumpNews();
  }

  // ── 来电引导（v0.6）────────────────────────────────────────
  /**
   * 已听过的电话 id。
   *
   * ⚠ 和 `licenses` 一样，包一层是因为**老存档里这个字段根本不存在** ——
   *   直接 `this.save.calls.includes(...)` 会抛异常。
   */
  _calls() {
    if (!Array.isArray(this.save.calls)) this.save.calls = [];
    return this.save.calls;
  }

  /**
   * 一条电话的触发条件是否**全部**满足。
   * 条件字段的含义见 `config.js` 的 `CALLS` 注释。
   */
  _callReady(c) {
    const w = c.when || {};
    if (w.casts != null && this.save.casts < w.casts) return false;
    // 深度用**本图**纪录：在浅图刷竿数不该把"你已经下到 390m"这条播报出去
    if (w.depth != null && this.mapBestOf(this.map.id) < w.depth) return false;
    if (w.codex != null && Object.keys(this.save.codex).length < w.codex) return false;
    // ⚠ v0.7 第二批把许可证退役之后，`licenses` 永远是空数组（buyMap 只在 license>0 时写它）
    //   —— 这里还读它的话，两通带 `when.map` 的电话就**永远不响**（GAMEPLAY §6.2 B10）。
    //   语义改成与分段解锁同源："已到过那张图" = `mapProgress().owned`。
    if (w.map != null && !this.mapProgress(mapById(w.map)).owned) return false;
    // ── v0.7：海图 / 船 / App 解锁态（三个都能正反两向用）──
    if (w.chart != null && !!this.save.chart !== !!w.chart) return false;
    if (w.boat != null && (this._boats().owned.length > 0) !== !!w.boat) return false;
    if (w.appLocked != null && this._apps().includes(w.appLocked)) return false;
    if (w.level) {
      for (const [k, n] of Object.entries(w.level)) {
        if ((this.save.levels[k] || 0) < n) return false;
      }
    }
    return true;
  }

  /** 已解锁的 App id 列表（船厂是 v0.7 起唯一"要解锁"的 App） */
  _apps() {
    const base = ['call', 'shop', 'gunshop', 'codex', 'route', 'settings'];
    return this.save.boatApp ? [...base, 'boat'] : base;
  }

  /** 船只存档的读写入口（表可能不存在 —— 和 licenses / calls 同一个理由） */
  _boats() {
    if (!this.save.boats || typeof this.save.boats !== 'object') this.save.boats = { owned: [], current: null };
    if (!Array.isArray(this.save.boats.owned)) this.save.boats.owned = [];
    return this.save.boats;
  }

  /**
   * 现在该响哪一通电话（没听过的里，**数组顺序最靠前**且条件满足的那一条）。null = 不响。
   *
   * 三条门：① 没听过；② 条件满足；③ 距上一通至少 `CALL_GAP` 竿。
   * 第 ③ 条是关键 —— 玩家可能在第 5 竿就连着满足三个条件，
   * 不隔开的话会一次待机收到三通电话，直接变成骚扰。
   */
  pendingCall() {
    const done = this._calls();
    const last = Number(this.save.lastCallCast);
    if (Number.isFinite(last) && this.save.casts < last + CALL_GAP) return null;
    for (const c of CALLS) {
      if (done.includes(c.id)) continue;
      // 玩家按过「忽略」的那一通：**这一竿之内不再响**，抛下一竿时重新响
      // （`ignoredCall` 在 _resetRun 里清空）—— 忽略 ≠ 听过。
      if (c.id === this.ignoredCall) continue;
      if (this._callReady(c)) return c;
    }
    return null;
  }

  /**
   * 把"现在该不该响铃"同步给界面。
   *
   * ⚠ **只在待机、且手机没打开时响。** 这是这套系统的第一条硬约束：
   *   一竿中间插电话会把三段式循环切断，而待机本来就是玩家做决定的那一屏。
   * ⚠ 响铃**不阻塞任何操作** —— 玩家想无视就无视，照样能点画面抛竿；
   *   下一次回待机它还会响（因为还没听）。
   */
  _syncCall() {
    const c = (this.state === STATE.IDLE && !this.phoneOpen) ? this.pendingCall() : null;
    this.ringingCall = c;
    this.ui.ringPhone(!!c, c);
  }

  /** 接听：打开手机并直接进入来电界面 */
  _answerCall() {
    if (!this.ringingCall) return;
    SFX.tap();
    this.openPhone('call');
  }

  /**
   * 挂断 / 听完。**标记为已听**（不会再响），并按需跳到目标 App。
   *
   * `goto` 是"引导"和"告知"的分界线：只说一句"去枪店看看"然后让玩家自己找，
   * 多数人不会去；接听完直接把他送到那个 App 前面，才算真的引导。
   */
  _endCall(goTo) {
    const c = this.ringingCall;
    if (!c) return;
    this._calls().push(c.id);
    this.save.lastCallCast = this.save.casts;
    // ── v0.7：听完这通电话要解锁的 App（船厂）──
    // ⚠ 解锁必须发生在**接听之后**：解锁早了，桌面上会出现一个从没被介绍过的 App，
    //   而"这通电话就是介绍"正是它的意义（见 config 的 CALLS 注释）。
    if (c.unlock === 'boat' && !this.save.boatApp) this.save.boatApp = true;
    persist(this.save);
    this.ringingCall = null;
    this.ui.ringPhone(false, null);
    SFX.buy();
    const dest = goTo ? c.goto : null;
    if (dest) this.ui.openApp(dest);
    else this.ui.showPhoneHome();
  }

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

  /** 已购许可证的 id 列表（同样是"表可能不存在"的字段，包一层） */
  _licenses() {
    if (!Array.isArray(this.save.licenses)) this.save.licenses = [];
    return this.save.licenses;
  }

  // ── 新枪上架播报（v0.7 第三批）─────────────────────────────
  /**
   * 检测"有哪些枪刚刚从锁着变可见"，把它们记进 `save.gunNews` 并推给 UI 播报。
   *
   * **为什么在三个地方调用**：解锁条件有两类，各自的变更时机不同 ——
   *   · `unlockDepth`（潜到更深）→ 只会在**一竿结束写纪录**时变（`enterResult`）
   *   · `unlockMap`（到过那张图）→ 在**换图**那一刻变（`enterMap`）
   *   · 收起手机回到待机 → 再兜一次（`closePhone`，覆盖"在店里买东西导致解锁"的边角）
   *
   * **只在这里判定一次**：界面（横幅 / 红点 / New 角标）全部只读 `save.gunNews`，
   * 不自己算"这把算不算新"—— 否则同一把枪会在三处被判三次，迟早判得不一样。
   */
  _syncGunNews() {
    const news = this._gunNews();
    const fresh = GUNS.filter((g) => {
      if (g.price <= 0) return false;                        // 初始枪不是"新货"
      if (this.save.guns.owned.includes(g.id)) return false; // 已经买过的更不是
      // ⚠ 必须查 **gunAnnounced（播报过）** 而不是 gunNews（未读）：
      //   未读在玩家点开枪店那一刻就清空了 —— 查它的话，同一把枪会在
      //   每次回待机时被当成"新货"再推一遍，红点永远灭不掉（N4 抓的）。
      if (this._gunAnnounced().includes(g.id)) return false;   // 已经播报过
      return this.gunUnlocked(g);
    });
    if (fresh.length) {
      const ann = this._gunAnnounced();
      for (const g of fresh) { news.push(g.id); if (!ann.includes(g.id)) ann.push(g.id); }
      persist(this.save);
      this.ui.queueGunNews(fresh.map((g) => g.id));
      SFX.record();          // 轻轻一声提示音 —— 不是"做对了事"的那种奖励音
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
  }

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
    const hasChart = !!this.save.chart;
    const boats = this._boats();
    const hasBoat = boats.owned.length > 0;
    const cur = boatById(boats.current);

    const conds = first ? [] : [
      {
        id: 'chart', ok: hasChart,
        text: hasChart ? `已持有${CHART.name}` : `潜到 −${maxD}m，找到海底的宝箱`,
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
      price: map.license, affordable: this.save.coins >= map.license,
      canBuy: !first && gateOk,
    };
  }

  /** 进某张图（门槛过了就直接过去；许可证机制保留给将来的图）。条件不够返回 false。 */
  buyMap(id) {
    const map = mapById(id);
    const p = this.mapProgress(map);
    if (!p.gateOk) return false;
    if (map.license > 0 && !this._licenses().includes(map.id)) {
      if (this.save.coins < map.license) return false;
      this.save.coins -= map.license;
      this._licenses().push(map.id);
    }
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
   *   放行条件：① 首图（出生地，无条件）；② 手里有这张图的许可证 ——
   *   v0.7 之后两张图的许可证都是 0（没有地图会发证），这条是留给**回归脚本 /
   *   存档迁移**的口子：`save.licenses` 里有 id 就允许进去。
   */
  enterMap(id) {
    const map = mapById(id);
    // ① 当前所在的那张图**无条件放行**：存档里的图必须能继续玩（老档 / 手改存档）
    // ② 换到**别的**图：必须过门槛（海图 + 船，见 mapProgress）
    // ③ 许可证（将来加图可能用）：> 0 时必须已经持有
    if (map.id !== this.save.currentMap && !this.mapProgress(map).gateOk) return false;
    if (map.license > 0 && !this._licenses().includes(map.id)) return false;
    this.save.currentMap = map.id;
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

  /** 待机时鱼钩挂在竿梢下面轻轻晃（贴着竿梢，别让光晕糊到船上） */
  _parkHook() {
    const tip = this.world.rodTip;
    const sway = Math.sin(this.time * 1.1) * 2.6 * MODEL_SCALE;
    this.hook.setPosition(tip.x + 0.5 + sway, tip.y - 11 * MODEL_SCALE + Math.sin(this.time * 1.7) * 1.2 * MODEL_SCALE);
  }

  _buy(key) {
    if (!UPGRADE_ORDER.includes(key)) return;
    const lv = this.save.levels[key];
    // ⚠ 用 maxLvOf 而不是 MAX_LEVEL：一次性工具（绞盘）的上限是 1，
    //   直接比 MAX_LEVEL 会让它在 lv=1 时还能"再买一次"（价格是 Infinity，按钮永远点不动）。
    if (lv >= maxLvOf(key)) return;
    const cost = upgradeCost(key, lv);
    if (this.save.coins < cost) { SFX.deny(); this.world.addShake(2); return; }
    this.save.coins -= cost;
    this.save.levels[key] += 1;
    persist(this.save);
    SFX.buy();
    this.applyUpgrades();
    this.ui.setCoins(this.save.coins);
    this.ui.refreshApp();                  // 商店 App 原地重绘（价格 / 等级 / 可买状态）
  }

  // ── 铅坠·直达深度（v0.5）─────────────────────────────────
  /**
   * 开关「直达深度」。
   *
   * ⚠ 开关状态存在**存档**里（`save.drop.on`），不是 session 状态 ——
   *   它是一个玩家偏好（"我懒得看表层了"），每次开游戏都要重设一次会很烦。
   *   但它的**效果**是每竿现算的：`applyUpgrades` 里算出的 `dropMax` 一变
   *   （买鱼线 / 换图），目标深度就会被重新钳制。
   */
  setDropEnabled(on) {
    this.save.drop.on = !!on;
    persist(this.save);
    SFX.tap();
    this.applyUpgrades();
    this.ui.refreshApp();
  }

  /** 设定目标深度（会被钳到 [DROP_MIN_DEPTH, dropMax]）。`delta` 为 0 时表示直接设值。 */
  setDropDepth(v) {
    const cap = this.dropMax || 0;
    const want = clamp(Math.round(Number(v) || 0), TUNING.DROP_MIN_DEPTH, Math.max(TUNING.DROP_MIN_DEPTH, cap));
    this.save.drop.depth = want;
    persist(this.save);
    SFX.tap();
    this.ui.setDropControl(this.save.drop, cap, TUNING.DROP_MIN_DEPTH);
  }

  // ── 枪店（v0.4）──────────────────────────────────────────
  /**
   * 枪店里一把枪要显示的全部信息。
   *
   * **UI 只负责排版，不做任何判断** —— 拥有 / 装备中 / 能否买得起 / 下一级数值
   * 全在这里算好。为什么不把这些判断放进 ui.js：那些判断散在界面里之后，
   * "按钮亮着却点不动"这类不一致会同时出现在好几个地方，而且没人测得到。
   */
  /** ⚠ 未读新枪的读写入口（老存档里没有这个字段 —— 和 licenses / calls 同一个理由） */
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

  // ── ① 下潜（鱼是障碍） ────────────────────────────────────
  enterDescend() {
    this.state = STATE.DESCEND;
    this._resetRun();
    this.spawnFish();
    this.ui.hideOverlay();
    this.ui.showHud(true);
    this.ui.showPhoneBtn(false);
    this.ui.showGunBar(false);
    this.ui.showFastReel(false);
    this.ui.setDepthChip(true);           // 开始游戏后深度 chip 才出现（需求⑨）
    this.ui.clearCatch();
    this.ui.clearFloats();
    // 两侧 UI（左深度尺 / 右渔获面板）在这里滑入（需求⑩）
    this.ui.setCatchVisible(true);
    this.ui.setRulerVisible(true);
    this.ui.showReel(true);
    this.ui.setSeaTitle(null);
    this.ui.setCombo(0, 1);
    this.ui.setHint('空中就能左右拖动 · 决定落点');

    this.applyUpgrades();
    this.hook.setVisible(true);
    this.bottomT = 0;
    this.reelPre = 0;
    this.iceSlowT = 0;
    this.maxDepthReached = 0;
    this.world.clearParticles();

    // ── 抛竿：鱼钩从竿梢被甩到空中 ──
    // 之后走抛物线（见 _updateCast）。滞空这一秒多玩家就能左右移动鱼钩，
    // 落点由玩家自己决定 —— 这样"从空中抛下"就不只是动画，而是操作的一部分。
    const tip = this.world.rodTip;
    this.hook.setPosition(tip.x, tip.y);
    this.hook.x = tip.x;
    this.hook.y = tip.y;
    this.targetX = clamp(tip.x, -WORLD.playHalfWidth, WORLD.playHalfWidth);
    this.castAir = true;
    this.castT = TUNING.castTime;
    this.castV.x = 0;
    this.castV.y = TUNING.castSpeed;
    SFX.cast();

    this.save.casts += 1;
    persist(this.save);
  }

  /**
   * 抛竿滞空：鱼钩划一道抛物线，玩家在空中就能左右移动它。
   *
   * 水平方向不是直接设坐标，而是给一个"朝 targetX 加速"的力 + 阻尼 ——
   * 这样操控有惯性、手感更像甩出去的东西，而不是瞬移。
   * 落水（vy < 0 且碰到水面）时溅水花并交接给正常下潜。
   */
  _updateCast(dt) {
    // 空中操控
    if (this.input.isDown('KeyA', 'ArrowLeft')) {
      this.targetX = clamp(this.targetX - 100 * dt, -WORLD.playHalfWidth, WORLD.playHalfWidth);
    }
    if (this.input.isDown('KeyD', 'ArrowRight')) {
      this.targetX = clamp(this.targetX + 100 * dt, -WORLD.playHalfWidth, WORLD.playHalfWidth);
    }

    const v = this.castV;
    v.x += (this.targetX - this.hook.x) * TUNING.castSteer * dt;
    v.x -= v.x * Math.min(1, TUNING.castDrag * dt);          // 阻尼
    v.x = clamp(v.x, -TUNING.castMaxVx, TUNING.castMaxVx);
    v.y += TUNING.castGravity * dt;

    this.castT -= dt;

    let nx = this.hook.x + v.x * dt;
    let ny = this.hook.y + v.y * dt;

    // 落水：已经开始下坠并且碰到水面（或保险丝烧断）
    const landed = (v.y < 0 && ny <= WORLD.surfaceY - 4 * MODEL_SCALE) || this.castT <= 0;
    if (landed) {
      nx = clamp(nx, -WORLD.playHalfWidth, WORLD.playHalfWidth);
      ny = Math.min(ny, WORLD.surfaceY - 4 * MODEL_SCALE);
      this.hook.setPosition(nx, ny);
      this.castAir = false;
      this.castT = 0;
      this.targetX = nx;
      this.hook.x = nx;
      this.hook.y = ny;
      this.world.burstSplash(nx, WORLD.surfaceY, TUNING.castSplash);
      SFX.splash();

      // ── 铅坠·直达深度（v0.5）──────────────────────────────
      // 落水之后如果开了直达深度，钩子**直接出现在玩家选的深度**，省掉这一段下潜。
      //
      // ⚠ 两个必须注意的点：
      //   ① 必须放在"落水坐标已经定完"之后 —— 否则抛物线终点会被覆盖掉，落点变成深度点。
      //   ② 这一帧**不能**让下潜的线段扫掠判定把 `0m → 目标深度` 当成"扫过的路径"：
      //      那会一路串鱼、一路撞鱼。这里直接改坐标，并给 `dropGraceT` 一段落地缓冲
      //      （见 config 的 DROP_GRACE：玩家是盲选深度的，一落地就撞鱼是运气不是操作）。
      //      扫掠判定的 `prevY` 在**下一帧**才会重新取，所以跨帧不会连成一条长线段。
      const drop = resolveDropDepth(this.save, this.dropMax || 0);
      if (drop > 0) {
        this.hook.y = WORLD.surfaceY - drop;
        this.hook.setPosition(this.hook.x, this.hook.y);
        this.maxDepthReached = Math.max(this.maxDepthReached, drop);
        this.dropUsed = drop;
        this.dropGraceT = TUNING.DROP_GRACE;
        this.world.burstBubbles(this.hook.x, this.hook.y, 18, 26);
        this.ui.floatText(this.hook.x, this.hook.y + 26 * MODEL_SCALE,
          `直达 −${Math.round(drop)}m`, 'good sm');
      }

      this.ui.setHint('左右拖动躲开鱼 · 碰到就收线');
      return;
    }

    this.hook.setPosition(nx, ny);
  }

  /**
   * 收线：下潜结束。
   *
   * 不直接切到上升 —— 先进入「上拉预备」：鱼钩缓动再往下探一小段（需求③），
   * 同时弹一句提示告诉玩家马上要被拉上去了。预备结束才真正转入 ASCEND。
   * 这么做有两个好处：一是给玩家一个可预期的信号（尤其是被鱼撞到强制收线时），
   * 二是让"下潜 → 上升"这个反向切换不再是一帧内的硬拐弯。
   */
  _reel(reason = '', v0 = 0) {
    if (this.state !== STATE.DESCEND) return;
    // 抛竿滞空期间不能收线 —— 钩子还在天上，收线没有意义
    if (this.castAir) return;
    if (this.reelPre > 0) return;                 // 已经在预备了，别重复触发

    // ── 刹停距离 ──
    // 位置曲线 y(u) = y0 − D·(2u − u²)，起手速度 |y'(0)| = 2D/T。
    // 要让它**正好等于**刚才的下潜速度 v0，就得 D = v0·T/2 ——
    // 也就是"时长是设计参数、距离由速度推出来"。触底（v0 = 0）时 D = 0，
    // 退化成纯粹的停顿，和改之前一样。
    const y0 = this.hook.y;
    const room = y0 + this.maxDepth;              // 还能往下走多少（别越过鱼线极限）
    // ⚠ v0.3.2：距离是设计参数，时长反推 —— 见 config 里 reelPreDepth 的说明。
    //   这样「刹停」在屏幕上永远滑同样长的一段，慢铅坠下也不会短到看不见。
    const D = Math.max(0, Math.min(TUNING.reelPreDepth, room));
    const dur = D > 0 ? Math.max(0.3, (2 * D) / Math.max(v0, 1e-3)) : TUNING.reelPreDur;

    this.reelPre = dur;
    this.reelDur = dur;
    this.reelReason = reason;
    this.reelFrom = { x: this.hook.x, y: y0 };
    this.reelTo = { x: this.hook.x, y: y0 - D };

    this.ui.showReel(false);
    // 文案里保留「即将上拉」四个字：它是玩家唯一的『马上要反向』信号，
    // 换成别的说法会让老玩家失去这个锚点（verify5 E3 也钉着它）。
    this.ui.setHint(reason === 'bump' ? '勾住了 · 即将上拉' : '鱼线到顶 · 即将上拉');
    this.ui.floatText(this.hook.x, this.hook.y + 22 * MODEL_SCALE, '即将上拉 ▲', 'sm');
    if (reason === 'bump') {
      this.ui.floatText(this.hook.x, this.hook.y + 40 * MODEL_SCALE, '勾住了！', 'good');
    }
  }

  /** 预备动画走完，真正进入上升阶段 */
  _beginAscend() {
    if (this.state !== STATE.DESCEND) return;
    this.reelPre = 0;
    // 回拉起步缓动：从**当前位置**开始（刹停的终点），带 easeInBack 的 anticipation
    this.ascendFrom = this.hook.y;
    this.ascendRampT = TUNING.ascendRamp;
    this.state = STATE.ASCEND;
    this.ui.showReel(false);
    // 快速回收按钮：**只有买了绞盘才有**（levels.winch > 0）。
    // 它是本竿唯一的"加速"入口，所以必须在进入上升的第一帧就出现 ——
    // 晚一帧的话玩家会先看到钩子动了一下、按钮才冒出来。
    this.ui.showFastReel(this.save.levels.winch > 0);
    this.ui.setHint('左右拖动 · 撞到鱼就串上来');
    this.run.depth = Math.round(this.maxDepthReached);
    this.world.burstBubbles(this.hook.x, this.hook.y, 18, 26);
    SFX.reel();
    this.world.addShake(4);
  }

  // ── 浮冰（冰封极地专属障碍）──────────────────────────────
  /**
   * 浮冰碰撞。和撞鱼的区别：
   *   撞鱼   → 强制收线，**这一竿结束**（惩罚的是"路线没选好"）
   *   撞浮冰 → 横向弹开 + 上顶 + 1.5s 减速，**这一竿继续**（惩罚的是"这一段变慢"）
   *
   * 为什么不做成第二种"碰到就收线"：那只是把鱼换个样子，玩家学不到新东西。
   * 而"被横向顶偏"制造的是一种新的失误 —— 你还在往下走，路线却被推到了没鱼的地方，
   * 接下来那一段就白放。代价是速度，不是这一竿，挫败感低得多。
   *
   * 冰块自己也在漂，所以判定必须用 `mesh.position`（每帧被 world 更新过的），
   * 不能用生成时的初始坐标 —— 否则玩家会看到"明明躲开了却被撞"。
   */
  _bumpIcebergs() {
    const list = this.world.icebergColliders;
    if (!list || !list.length) return;
    const hr = this.hook.radius;

    for (const b of list) {
      if (b.hitT > 0) continue;                    // 同一块冰的重复触发间隔
      const bp = b.mesh.position;
      const dx = this.hook.x - bp.x;
      const dy = this.hook.y - bp.y;
      if (dx * dx + dy * dy >= (hr + b.r) * (hr + b.r)) continue;

      // 横向推开：把鱼钩和 targetX 一起搬走。
      // 只推 hook.x 是不够的 —— 下潜的操控是"hook.x 追着 targetX 走"，
      // 下一帧就会把它拽回原来的位置，看起来像根本没被撞到。
      const away = dx < 0 ? -1 : 1;
      const nx = clamp(bp.x + away * (hr + b.r + 2 * MODEL_SCALE), -WORLD.playHalfWidth, WORLD.playHalfWidth);
      this.hook.x = nx;
      this.targetX = nx;
      // 往上顶回一段（"弹开"），但不能顶出水面
      this.hook.y = Math.min(this.hook.y + ICEBERG.pushY, WORLD.surfaceY - 8 * MODEL_SCALE);
      this.hook.setPosition(this.hook.x, this.hook.y);

      this.iceSlowT = ICEBERG.slowTime;
      b.hitT = ICEBERG.cooldown;

      this.world.addShake(TUNING.hitShake * 0.7);
      this.world.burstChunks(bp.x, bp.y, 10);
      this.world.burstBubbles(bp.x, bp.y, 8, 16);
      this.ui.floatText(this.hook.x, this.hook.y + 20, '撞上浮冰 · 减速', 'bad sm');
      SFX.escape();
      break;
    }
  }

  // ── ② 上升（鱼是奖励） ───────────────────────────────────
  /**
   * 本竿当前的实际收线速度。
   *
   * 快速回收（绞盘，v0.5）：买下之后玩家可以在上升阶段按 HUD 上的按钮，
   * 把收线速度乘 `FAST_REEL_MUL` 直到出水。
   *
   * ⚠ 它是**玩家主动触发**的，不是自动的：上升阶段串鱼是主要收入来源，
   *   无脑加速会让玩家一路跳过鱼群。加速必须是一个"我现在够了"的决策 ——
   *   这也是为什么绞盘值得买（省时间）但不会让玩法退化（少抓鱼）。
   */
  get reelSpeed() {
    return this.fastReel ? this.ascendSpeed * TUNING.FAST_REEL_MUL : this.ascendSpeed;
  }

  /** 按下「快速回收」：本竿剩下的上升段全速收线。没买绞盘 / 不在上升阶段时无效。 */
  fastReelNow() {
    if (this.state !== STATE.ASCEND) return false;
    if (!(this.save.levels.winch > 0)) return false;   // 没买绞盘
    if (this.fastReel) return false;                   // 本竿已经按过了
    this.fastReel = true;
    this.ui.setFastReel(true);
    this.ui.floatText(this.hook.x, this.hook.y + 24 * MODEL_SCALE, '快速回收 ▲▲', 'good sm');
    SFX.reel();
    this.world.addShake(5);
    return true;
  }

  _updateAscend(dt) {
    const prevY = this.hook.y;
    const prevX = this.hook.x;
    const spd = this.reelSpeed;
    // ── 回拉起步缓动（v0.3.1 需求③）──
    // 位置曲线 y(u) = y0 + D·(3u³ − 2u²)：
    //   起手速度 0（接住前面刹停的"静止"）、末端速度 5D/T（接上满速上拉），
    //   中间在 u ≈ 0.44 处**先往下沉 13%·D** —— 这就是 anticipation，
    //   也是"easeInBack 的感觉"的来源。令末端速度 = 收线速度得 D = 收线速度·T/5。
    // ⚠ 直接置 state='ascend' 的夹具（verify5 C8）不走 _beginAscend，
    //   ascendRampT ≤ 0，会直接落到下面的满速分支 —— 那些断言因此不受影响。
    if (this.ascendRampT > 0) {
      this.ascendRampT -= dt;
      const T = TUNING.ascendRamp;
      const u = clamp(1 - Math.max(0, this.ascendRampT) / T, 0, 1);
      const D = (spd * T) / 5;
      this.hook.y = this.ascendFrom + D * u * u * (3 * u - 2);
    } else {
      this.hook.y += spd * dt;                 // 收线速度（含快速回收倍率）
    }
    this.hook.setPosition(this.hook.x, this.hook.y);
    this.hook.layoutCatch(this.caught);

    if (this.hitCd > 0) this.hitCd -= dt;

    const hr = this.hook.radius;
    for (const f of this.fish.active) {
      if (f.state !== FISH_STATE.SWIM) continue;
      if (f.immuneT > 0) continue;             // 刚被鱼护挤下来，给它一点时间游开
      const p = f.mesh.position;
      const d = distToSegment(p.x, p.y, prevX, prevY, this.hook.x, this.hook.y);
      if (d < hr + f.radius) this._catch(f);
    }

    // 上升途中路过海床宝箱：同样能捡（碰到即得，见 `_checkChest`）
    this._checkChest(prevX, prevY);

    // 出水
    if (this.hook.y >= WORLD.surfaceY - 2 * MODEL_SCALE) this.enterAir();
  }

  /**
   * 串上一条鱼（或一件物品）。
   *
   * **鱼护满了之后怎么办 —— v0.7 改过口径**：
   *   旧：超过上限时"最早串上的那条挣脱"（挤掉最老的）。当时的理由是"制造取舍"。
   *   新：**不挤、不丢**，直接**自动加速收线**（见 `_creelFull()`）。
   *
   * 为什么改（旧口径的两个实际问题）：
   *   ① 玩家明明碰到了鱼，却看着一条已到手的鱼飞走 —— 负反馈，而且**账算不平**
   *      （"我明明碰到了却没拿到"）；
   *   ② 鱼护那个数字玩家得一直盯着，"还剩几条"变成一道心算题。
   *   改成"满了就回家"之后：**串满 = 该出水了**，节奏反而更利落 ——
   *   而且它和"上升阶段撞鱼不会掉鱼"是同一条规则的两面（见 `_catch` 的调用点）。
   */
  _catch(f) {
    // 鱼护满 → 不再收新的（也不再挤掉旧的），并触发一次"自动收线"
    if (this.caught.length >= this.creelLimit) {
      this._creelFull();
      return;
    }

    const p = f.mesh.position;
    f.hook();
    // 串上时**抽一次**倾角 / 朝向并固定下来（v0.3.5）：
    // 一堆鱼挤在钩子上时，各转各的角度才像「一捆」，整齐划一像码货。
    f.lineSpin = (Math.random() - 0.5) * 1.8;   // 画面内倾角 ±0.9 rad
    f.lineFlip = (Math.random() - 0.5) * 1.2;   // 左右朝向 ±0.6 rad
    this.caught.push(f);
    this.run.caught += 1;
    this.ui.addCatch(f, this.caught.length);
    this._recordCodex(f);
    // 勾中的鱼在鱼钩附近弹一下名字（需求②）：
    // 扣钱鱼用红色警示，值钱的用金色，普通鱼白色 —— 让玩家一眼知道"刚勾到了什么"。
    this.ui.floatText(
      p.x, p.y, f.def.name,
      f.def.hazard ? 'bad' : (f.value >= 120 ? 'good sm' : 'sm')
    );
    this.world.burstBubbles(p.x, p.y, 6, 10);
    this.world.burstSparks(p.x, p.y, 5, 0.6);
    SFX.hookUp(this.caught.length);
    this.hook.layoutCatch(this.caught);
  }

  /**
   * 鱼护满了（v0.7）：提示一次 + **自动加速收线**。代替了旧的"最早那条挣脱"。
   *
   * ⚠ 这一条**不走绞盘的闸门**：`fastReelNow()` 会先检查 `levels.winch`，
   *   而这里是**规则**（串满就该回家），不是玩家买的工具 —— 所以直接置 `fastReel`。
   *   它也**不消耗**玩家手里那次手动机会（同竿还能按，只是已经没有意义了）。
   *
   * ⚠ 每竿只提示一次（`_creelFullDone`）：不然后面每碰到一条鱼都会刷一行飘字，
   *   上升段会变成刷屏。
   */
  _creelFull() {
    if (this._creelFullDone) return;
    this._creelFullDone = true;
    this.fastReel = true;
    this.ui.setFastReel(true);      // 按钮变灰 = "这一竿的加速已经替你按了"
    const p = this.hook;
    this.ui.floatText(p.x, p.y + 18 * MODEL_SCALE, '鱼护满了 · 自动收线', 'good');
    this.ui.setHint('鱼护满了 —— 直接收线，这一段不会再掉鱼');
    this.world.addShake(4);
  }

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
    if (this.save.chart || this._chestTaken) return;
    const c = this.world.chestAt;
    if (!c) return;
    if (distToSegment(c.x, c.y, prevX, prevY, this.hook.x, this.hook.y) > c.r + TUNING.bumpRadius) return;
    this._chestTaken = true;
    this._getChart(c);
  }

  /**
   * 捡到海图 —— 换图门槛的前一半（另一半是船，见 `mapProgress`）。三件事一起做：
   *   ① `save.chart = true`；② **直接解锁船厂 App**；③ 回待机时"码头管理员"会打来电话
   *      （`CALLS` 里 `when:{ chart:true }` 的两通，按"有没有船"分流）。
   *
   * ⚠ 为什么这里直接解锁船厂：需求原话是"若是玩家没有解锁船厂 App 则直接给玩家解锁，
   *   并去掉船厂 NPC 引导"。也就是说 —— 如果玩家**先**钓到海图（还没到第 10 竿），
   *   那通"推荐新船"的电话就不该再打了；实现靠的是电话表里的 `when.appLocked: 'boat'`
   *   （App 已解锁 → 这通电话永远不响），而不是在这里改电话。
   */
  _getChart(c) {
    this.save.chart = true;
    this.save.boatApp = true;
    const gold = CHEST.gold;
    this.save.coins += gold;
    persist(this.save);
    this.ui.setCoins(this.save.coins);
    this.world.hideChest();
    this.world.burstCoins(c.x, c.y, 18);
    this.world.burstSparks(c.x, c.y, 24, 1.6);
    this.world.addShake(12);
    this.ui.floatText(c.x, c.y + 18 * MODEL_SCALE, `获得${CHART.name}！`, 'good');
    if (gold > 0) this.ui.floatText(c.x, c.y + 36 * MODEL_SCALE, `+${gold}`, 'good sm');
    this.ui.setHint(`拿到${CHART.name}了 —— 去船厂买艘船就能开去极地`);
    SFX.buy();
  }

  /** 记入图鉴：首次钓到才算「解锁」，之后只累加次数与最高身价 */  _recordCodex(f) {
    const id = f.def.id;
    const rec = this.save.codex[id];
    if (rec) {
      rec.n += 1;
      rec.best = Math.max(rec.best, Math.round(f.value));
    } else {
      this.save.codex[id] = { n: 1, best: Math.round(f.value) };
      this.ui.floatText(f.mesh.position.x, f.mesh.position.y + 16 * MODEL_SCALE, '图鉴 +1', 'good sm', 'codex');
    }
    persist(this.save);
  }

  // ── ③ 水面：把渔获抛向天空 ───────────────────────────────
  enterAir() {
    this.state = STATE.AIR;
    this.hook.setVisible(false);
    this.ui.showReel(false);
    this.ui.showFastReel(false);   // 绞盘只在上升阶段有意义
    this.ui.setHint(this._gunHint());
    this.ui.showGunBar(true);
    this.ui.setZone(null);
    this.ui.setCatchVisible(false);

    this.world.burstSplash(this.hook.x, WORLD.surfaceY, 34);
    SFX.splash();
    this.world.addShake(10);

    this.airFish = [];
    const n = this.caught.length;
    const g = Math.abs(TUNING.airGravity);

    for (let i = 0; i < n; i++) {
      const f = this.caught[i];
      // 扇形展开：渔获越多，扇面越宽
      const spread = n > 1 ? (i / (n - 1) - 0.5) : 0;

      // 初速决定最高点：apex = v0² / (2g)
      const v0 = TUNING.launchBase + Math.sqrt(f.value) * TUNING.launchPerSqrtValue;
      const flight = (2 * v0) / g;
      // 先定「这条鱼总共该飘多远」，再反推水平速度，
      // 否则滞空久的贵鱼会飘到画面外面去
      const drift = TUNING.launchDriftBase + Math.sqrt(f.value) * TUNING.launchDriftPerSqrt;
      const vx = (spread * 2 * drift) / flight + (Math.random() - 0.5) * 6;
      const vy = v0 * (0.95 + Math.random() * 0.1);

      f.launch(vx, vy);
      this.airFish.push(f);
    }
    this.caught = [];

    this.airT = 0;
    this.airClearT = 0;
    this._airHold = null;   // 清空后的"定格"瞄准点缓存
    this.birdT = 0.9;
    this._resetGun();
    this.combo = 0;
    this.mult = 1;
    this.maxAltReached = 0;
    this.ui.setCombo(0, 1);

    // 慢动作：制造"哇"的一瞬
    this.timeScale = TUNING.slowmoScale;
    this.slowmoT = TUNING.slowmoTime;
  }

  // ── ③ 空中：枪械（v0.4）────────────────────────────────────
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

    switch (g.mech) {
      case 'shotgun': this._shootShotgun(p, s, dmg); break;
      case 'pierce': this._shootPierce(p, s, dmg); break;
      case 'laser': this._shootLaser(p, s, dmg); break;
      default: this._shootBlast(p, s, dmg, g.mech === 'single'); break;
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

  /** 对一个圆内的所有空中鱼结算伤害 */
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
      const shots = Math.max(1, Math.ceil(f.hp / Math.max(0.05, dmg)));
      this.ui.floatText(p.x, p.y + 10 * MODEL_SCALE, `还差 ${shots} 枪`, 'sm');
    }
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

  _hitFish(f) {
    const p = f.mesh.position;

    if (f.def.hazard) {
      // 扣钱鱼：爆炸扣钱。
      // 金币不会扣成负数；本竿收入按「实际扣掉的数额」记，
      // 否则身上没钱时两个账对不上（结算显示的收入会莫名其妙少一截）。
      // ⚠ v0.5：「保险」已移除 —— 罚款是固定值，没有减免路径（见 config 的 pufferPenalty）。
      this.combo = 0; this.mult = 1;
      const fine = this.pufferPenalty;
      const before = this.save.coins;
      this.save.coins = Math.max(0, before - fine);
      this.run.earned -= before - this.save.coins;
      this.world.burstChunks(p.x, p.y, 22);
      this.world.burstSparks(p.x, p.y, 26, 1.6);
      this.world.addShake(16);
      this.ui.floatText(p.x, p.y, `${f.def.name} −${fine}`, 'bad');
      this.ui.setCombo(0, 1);
      this.ui.setCoins(this.save.coins);
      SFX.puffer();
      f.kill();
      return;
    }

    this.combo += 1;
    this.mult = this.multOfCombo;
    this.run.bestCombo = Math.max(this.run.bestCombo, this.combo);

    // 船只「黄金号」的金币加成落在这里（v0.7）：**乘在结算金额上**，
    // 而不是改鱼的身价 —— 后者会连带影响"身价决定弹道"（贵鱼更难打），
    // 买条船就顺手改难度，那不是我们想要的。
    const gain = Math.max(1, Math.round(f.value * this.mult * (this.boatGoldMul || 1)));
    this.save.coins += gain;
    this.run.earned += gain;
    this.run.shot += 1;

    this.world.burstCoins(p.x, p.y, f.value >= 150 ? 14 : 8);
    this.world.burstSparks(p.x, p.y, 12, 1.2);
    this.world.addShake(2.4);
    this.ui.floatText(p.x, p.y, `+${gain}`, this.mult > 1 ? 'good' : '');
    this.ui.setCoins(this.save.coins);
    this.ui.setCombo(this.combo, this.mult);
    SFX.hit(this.combo);
    if (this.combo % 3 === 0) SFX.coin(this.combo / 3);
    f.kill();
  }

  _spawnBird() {
    const dir = Math.random() < 0.5 ? 1 : -1;
    const g = buildBird();
    const y = this.world.camY + this.world.viewH * (0.18 + Math.random() * 0.22);
    g.position.set(this.world.camX - dir * this.world.viewW * 0.7, y, 8);
    g.scale.setScalar((0.85 + Math.random() * 0.4) * MODEL_SCALE);
    this.world.scene.add(g);
    this.birds.push({ mesh: g, dir, speed: (55 + Math.random() * 45) * MODEL_SCALE, flap: Math.random() * 6.28, alive: true });
  }

  _hitBird(b) {
    const p = b.mesh.position;
    this.save.coins += TUNING.birdBonus;
    this.run.earned += TUNING.birdBonus;
    this.run.birds += 1;
    this.world.burstCoins(p.x, p.y, 10);
    this.world.burstSparks(p.x, p.y, 16, 1.3);
    this.ui.floatText(p.x, p.y, `海鸟 +${TUNING.birdBonus}`, 'good');
    this.ui.setCoins(this.save.coins);
    SFX.bird();
    this.world.scene.remove(b.mesh);
    b.alive = false;
  }

  _updateAir(dt, t) {
    this.airT += dt;
    // 枪械：冷却 / 换弹 / 预热 / 过热全在这里推进，连发枪的开火也在这里发生
    this._updateGun(dt);

    // 鸟：在相机视野两侧掠过（飞进太空就没有鸟了）
    this.birdT -= dt;
    if (this.birdT <= 0 && this.world.camY < 620 && this.birds.filter((b) => b.alive).length < 2) {
      this.birdT = 1.8 + Math.random() * 2.4;
      this._spawnBird();
    }
    const cullDist = this.world.viewW * 0.95;
    for (const b of this.birds) {
      if (!b.alive) continue;
      b.mesh.position.x += b.dir * b.speed * dt;
      b.flap += dt * 9;
      b.mesh.userData.wing.scale.y = 8 * (0.45 + Math.abs(Math.sin(b.flap)) * 0.85);
      b.mesh.rotation.z = Math.sin(b.flap * 0.5) * 0.08;
      if (Math.abs(b.mesh.position.x - this.world.camX) > cullDist) { this.world.scene.remove(b.mesh); b.alive = false; }
    }
    this.birds = this.birds.filter((b) => b.alive);

    // 空中鱼
    for (const f of this.airFish) {
      if (f.state !== FISH_STATE.AIR) continue;
      if (f.knockT > 0) f.knockT -= dt;      // 逐鱼的上顶冷却（见 _applyDamage）
      f.update(dt, t, this.world.viewRange());
      if (f.mesh.position.y > this.maxAltReached) this.maxAltReached = f.mesh.position.y;
      if (f.mesh.position.y <= WORLD.surfaceY) {
        // 落回水里 → 逃走
        this.run.escaped.push(f.def.name);
        this.world.burstBubbles(f.mesh.position.x, WORLD.surfaceY, 8, 12);
        this.ui.floatText(f.mesh.position.x, WORLD.surfaceY + 18 * MODEL_SCALE, '逃走了', 'bad sm');
        SFX.escape();
        f.kill();
      }
    }
    this.airFish = this.airFish.filter((f) => f.state === FISH_STATE.AIR);
    // ⚠ airClearT 计的是「场上没有可打的鱼之后过了多久」，airT 计的是「空中阶段总共多久」。
    //   两者混用会让"打完最后一条鱼"和"进空中阶段 0.9s"撞车 —— 见下面的结算判定。

    // 结算判定。
    // 之前这里把「还有飞鸟在场」也算进未完成条件 —— 鸟只要还在屏幕上就永远不结算，
    // 玩家只能干等 20 多秒。现在只要没有可打的鱼，短暂缓冲后立刻结算；
    // 鸟只是彩蛋，不该拦住结算。
    const aliveFish = this.airFish.filter((f) => f.state === FISH_STATE.AIR);
    if (aliveFish.length === 0) {
      // 场上清空 → 停留 airSettleGrace 秒再结算。
      // ⚠ 必须用 airClearT（从清空那一刻起算），不能用 airT（进空中阶段就开始算）：
      //   用 airT 的话，打完最后一条鱼时它早就超过 grace 了，结算会**立刻**弹出，
      //   最后那一下击落根本看不清（需求③）。
      this.airClearT += dt;
      if (this.airClearT > TUNING.airSettleGrace) this.enterResult();
    } else {
      this.airClearT = 0;
      if (aliveFish.every((f) => f.def.hazard) && this._allAboveScreen(aliveFish)) {
        // 只剩扣钱鱼（河豚/电鳗/狮子鱼）→ 不等 airTimeout（需求①）。
        // 它们打掉要赔钱、放着又只会一直往上飞，所以只要全部跳出画面顶部就直接结算。
        this.enterResult();
      } else if (this.airT > TUNING.airTimeout) {
        this.enterResult();
      }
    }
  }

  /** 这一批鱼是不是全都飞出画面顶部了 */
  _allAboveScreen(list) {
    const top = this.world.viewRange().top;
    return list.every((f) => f.mesh.position.y > top + f.radius + 6);
  }

  /**
   * 空中相机：锁定**最低的那条非扣钱鱼**，把它放在画面中间并推近。
   *
   * "最低" = y 最小 = 最快落回水里的那条，也就是最该优先打掉的。
   * 它被击落（`_hitFish` → `kill`）或落水（`_updateAir` → `kill`）之后
   * `state` 就不再是 AIR，下一帧自然换成剩下的最低那条 ——
   * **不需要额外的"切换"逻辑**，这里每帧重算即可。
   *
   * 河豚（扣分鱼）不参与：它掉下来也不值得把镜头拽走（见 verify3 T21）。
   */
  _airCamera() {
    const baseH = this.world.baseViewH;
    const scale = TUNING.airCamFollowScale;
    const rate = TUNING.airCamRate;
    const viewH = baseH * scale;

    // ── 瞄准**最低的那条非扣钱鱼** ──
    // ⚠ v0.3.2 试过"瞄鱼群质心"，**必须回退**：鱼群在空中能拉开 5 个可见高度，
    //   质心经常落在"两条鱼之间"的空白处 —— 画面里一条鱼都看不到（玩家实机反馈）。
    //   最低那条永远是一条**真实存在**的鱼，瞄它至少保证画面里一定有目标。
    //   之前"最下方的鱼跑到屏幕上方"的问题，真正的原因是**跟随滞后**（见下面的 lead），
    //   不是瞄错了人 —— 加 lead 之后实测偏移是 (0, −0.02)，已经正中。
    let tx = 0, ty = null, tvx = 0, tvy = 0;
    for (const f of this.airFish) {
      if (f.state !== FISH_STATE.AIR) continue;
      if (f.def.hazard) continue;              // 扣分鱼不跟随
      const p = f.mesh.position;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (ty === null || p.y < ty) {
        tx = p.x; ty = p.y;
        tvx = Number.isFinite(f.vx) ? f.vx : 0;
        tvy = Number.isFinite(f.vy) ? f.vy : 0;
      }
    }

    // 一条可打的都没有（只剩河豚 / 全飞走了）→ 兜底看向水面之上。
    // ⚠ 但如果这是"刚清空、正在结算停留"，就**把画面定格**在清空那一刻的瞄准点：
    //   否则镜头会平滑飘向水面，画面一直在动，玩家根本感觉不到"停了一下"。
    if (ty === null) {
      if (this.airClearT > 0 && this._airHold) return { ...this._airHold, rate };
      const fb = { x: 0, y: WORLD.surfaceY + 80 * MODEL_SCALE, scale, rate };
      this._airHold = { x: fb.x, y: fb.y, scale };
      return fb;
    }

    // ── 速度前置补偿（lead）──
    // 相机的 y 是**指数平滑**跟过去的：dcamY/dt = rate·(ty − camY)。
    // 目标匀速 v 时的稳态误差是 camY = ty − v/rate —— 镜头永远落在鱼后面 v/rate。
    // 上升段的鱼有 400~600 单位/秒，滞后能到 70~110 单位（可见高度的一大半），
    // 鱼就飘到画面中心上方去了。把瞄准点提前 v/rate，稳态误差正好抵消。
    // 水平方向的平滑系数是 rate×0.75（见 world.setCamera），所以那边除以 0.75。
    const aimY = ty + tvy / rate;
    const aimX = tx + tvx / (rate * 0.75);

    const out = {
      x: clamp(aimX, -640, 640),
      y: aimY + viewH * TUNING.airCamFollowBias,
      scale, rate,
    };
    this._airHold = { x: out.x, y: out.y, scale };   // 给"清空后定格"用
    return out;
  }

  // ── ④ 结算 ───────────────────────────────────────────────
  enterResult() {
    this.state = STATE.RESULT;
    this.ui.showHud(false);
    this.ui.showPhoneBtn(false);
    this.ui.showGunBar(false);
    this.ui.showFastReel(false);
    this.ui.setCombo(0, 1);
    this.ui.setHint('');
    this.ui.setCatchVisible(false);
    this.ui.setRulerVisible(false);
    this.ui.setZone(null);
    for (const b of this.birds) this.world.scene.remove(b.mesh);
    this.birds = [];

    // ── 收竿前先把"还挂在天上、没打下来"的鱼记账（v0.6）──
    //
    // ⚠ 原来这里直接 `this.airFish = []`，那些鱼**既不进 `run.escaped`、结算面板也不显示**。
    //   症状：玩家看到"天上明明还有鱼，怎么就结算了"，而且面板一个字都不解释 ——
    //   他会以为是自己卡了或者游戏出 bug 了。
    //
    // 为什么单独记 `timedOut` 而不是全推进 `escaped`：
    //   ① `escaped` 那条链是**按名字逐条列**的（"皇带鱼 逃走了"），
    //      超时那一刻可能还挂着十几条，全列出来会把结算面板撑爆；
    //   ② 两者的语义也不一样 —— `escaped` 是"我没打中，它掉回水里了"，
    //      `timedOut` 是"时间到了，我还没打完"。混在一起玩家读不出区别。
    //
    // ⚠ 只算**非扣钱鱼**：扣钱鱼打掉是扣钱，留着它是玩家的正确选择，
    //   把它算进"没打完"会让玩家觉得系统在指责他做对了的事。
    const leftOver = this.airFish.filter((f) => f.state === FISH_STATE.AIR && !f.def.hazard);
    this.run.timedOut = leftOver.length;
    this.airFish = [];

    const depth = this.run.depth || Math.round(this.maxDepthReached);
    const alt = Math.round(this.maxAltReached);
    const newRecord = depth > this.save.bestDepth;
    if (newRecord) this.save.bestDepth = depth;
    // 本图最深记录：换图条件②读的是它。和全局 bestDepth 分开存 ——
    // 否则在深图里潜一次就把浅图的换图条件白送了。
    const mb = this._mapBest();
    const mid = this.map.id;
    if (depth > (mb[mid] || 0)) mb[mid] = depth;
    // 深度纪录刚刚落库 —— 这正是"某把枪的 unlockDepth 被满足"的唯一时机（v0.7 第三批）
    this._syncGunNews();
    if (alt > this.save.bestAlt) this.save.bestAlt = alt;
    this.save.totalEarned += Math.max(0, this.run.earned);
    persist(this.save);

    SFX.settle();
    if (newRecord && depth > 0) setTimeout(() => SFX.record(), 320);

    setTimeout(() => {
      this.ui.showResult({ ...this.run, depth, alt, newRecord }, {
        next: () => { SFX.tap(); this.showIdle(); },
      });
    }, 420);
  }

  // ── 鱼类生成 ─────────────────────────────────────────────
  /**
   * 按海域分层刷鱼。
   *
   * 需求①「降低扣钱鱼占比」在这里落地：抽签用的权重 = 鱼种 weight ×
   * （扣钱鱼再乘 HAZARD_SPAWN.weightScale），并且每层海域最多刷 HAZARD_SPAWN.maxPerZone 条。
   * 抽到扣钱鱼但已经到上限时，退回非扣钱鱼池重抽 —— 这样"这一层有哪些鱼"的配比
   * 仍然由 SPECIES 的 weight 表达，只有"风险密度"被单独压下来。
   *
   * 迭代 7 追加「鱼饵」：按"本层内部的相对贵重程度"给鱼种加权，Lv20 时本层最贵的鱼
   * 权重 ×2、最便宜的不变。用**本层区间归一**而不是绝对身价 —— 否则浅层那些身价
   * 个位数的鱼永远吃不到加成，鱼饵在前期就形同虚设。
   */
  spawnFish() {
    this.fish.releaseAll();
    const baitK = this.baitBonus || 0;
    const baseW = (s) => s.weight * (s.hazard ? HAZARD_SPAWN.weightScale : 1);
    // 只刷**当前地图**的海域。两张图的表层都在 0~70m 附近，
    // 不按地图过滤的话，在冰封极地会刷出一堆宁静海湾的沙丁鱼。
    const zones = zonesOfMap(this.map.id);
    // 最深能刷到哪里：本图上限再留 12m 余量，别让鱼贴在"钩子永远够不到"的底上
    const deepest = -(mapMaxDepth(this.map) - 12 * MODEL_SCALE);

    for (const zone of zones) {
      const pool = SPECIES.filter((s) => s.zones.includes(zone.id));
      if (!pool.length) continue;
      const safe = pool.filter((s) => !s.hazard);

      // 鱼饵的基准：本层**可钓的鱼**里最便宜 / 最贵的身价，按区间归一取"相对贵重程度"。
      //
      // 为什么不用"身价 ÷ 本层平均"：身价跨度小的层里它几乎不动 —— 海沟尽头最贵的
      // 黄金鱼王(680) 只有平均值的 1.4 倍，钳位后只拿到 +41% 权重，满级鱼饵看起来像没生效。
      // 区间归一的语义也直白得多：「本层最便宜的鱼权重不变，最贵的鱼权重 ×(1+baitK)」。
      const minV = safe.length ? Math.min(...safe.map((s) => s.value)) : 0;
      const maxV = safe.length ? Math.max(...safe.map((s) => s.value)) : 0;
      const span = maxV - minV;

      const wOf = (s) => {
        let w = baseW(s);
        if (baitK > 0 && !s.hazard && span > 0) {
          const rel = (s.value - minV) / span;      // 0 = 本层最便宜，1 = 本层最贵
          w *= 1 + baitK * rel;
        }
        return w;
      };
      const pick = (list) => {
        if (!list.length) return null;
        const total = list.reduce((a, s) => a + wOf(s), 0);
        let r = Math.random() * total;
        for (const s of list) { r -= wOf(s); if (r <= 0) return s; }
        return list[list.length - 1];
      };

      const lo = Math.max(zone.bottom, deepest);
      // 上界往下让 SPAWN_TOP_MARGIN：别让鱼贴着水面刷。
      // 否则鱼钩一入水就撞上（下潜撞鱼 = 强制收线），一竿还没开始就结束。
      // 只有整张图最浅的那层会真的被抬高，其他层的 top 本来就低于 -10。
      const hi = Math.max(lo + 2 * MODEL_SCALE, Math.min(zone.top, -SPAWN_TOP_MARGIN));
      // 密度倍率：把「基准数量」缩放到实际数量（至少留 1 条，不然整层空荡荡）
      const n = Math.max(1, Math.round(zone.count * FISH_DENSITY));

      // ── 鱼群 ──
      // 一个海域有一定概率整层刷出"一群同种鱼"，沿一条微微下斜的直线排开。
      // 排成线而不是围成一团：上升阶段鱼钩是竖直扫上去的，一条横线能一次串好几条，
      // 而一团散鱼会因为间距不均匀，一半都碰不到。
      //
      // 领头鱼只从**非扣钱鱼**里挑（`safe`）：一群 5 条河豚从下面压上来，
      // 那不是"机会"而是"死路"，玩家只能放弃这一竿。
      let groupLeft = 0, groupDef = null;
      let gx = 0, gy = 0, gstep = 0, gdir = 1, sdir = 1, sspd = 0;
      let extras = n;
      if (safe.length && Math.random() < SCHOOL.chance) {
        groupDef = pick(safe);
        const want = groupDef.school
          || Math.round(lerp(SCHOOL.count[0], SCHOOL.count[1], Math.random()));
        groupLeft = Math.max(2, want);

        // 间距先取随机值，再按「整群必须完整落在鱼钩够得到的横向范围里」收紧。
        // ⚠ 这一步不能省：不收紧的话 6 条 × 13 间距 = 65 宽，起点再偏一点就出界，
        //   出界的那几条会被 clamp 压在同一条竖线上 —— 鱼群变成"一坨"而不是"一串"，
        //   而且 clamp 之后间距不再相等，看起来像穿模。
        const usable = WORLD.playHalfWidth * 2 * 0.94;
        gstep = Math.min(
          lerp(SCHOOL.gap[0], SCHOOL.gap[1], Math.random()),
          usable / Math.max(1, groupLeft - 1)
        );
        // 先定整群的中心，再反推第一条的位置 —— 这样两端都留得下
        const half = ((groupLeft - 1) * gstep) / 2;
        const cx = (Math.random() - 0.5) * Math.max(0, WORLD.playHalfWidth * 2 - half * 2);
        gdir = Math.random() < 0.5 ? -1 : 1;
        gx = cx - gdir * half;
        // 鱼群整体偏本层中上部：太靠底的话上升时只剩几条还在画面里
        gy = lo + (hi - lo) * (0.6 + Math.random() * 0.25);

        // 同一群的鱼共享朝向和速度 —— 不共享的话它们会在两秒内散开，
        // 下潜时看到的"一群鱼"还没等玩家反应就变成了一盘散沙。
        // 起伏相位仍然各随各的（保持一点生物感，不要像一排贴纸）。
        sdir = Math.random() < 0.5 ? -1 : 1;
        sspd = groupDef.speed * (0.9 + Math.random() * 0.16);
        extras = Math.max(1, Math.round(lerp(SCHOOL.extras[0], SCHOOL.extras[1], Math.random())));
      }

      let hazardUsed = 0;
      const total = groupLeft + extras;
      for (let i = 0; i < total; i++) {
        if (i < groupLeft) {
          // 鱼群：第 i 条沿斜线往后排。斜率 0.34 是试出来的 ——
          // 完全水平看起来像一根绳子，太陡（>0.6）在窄海域里会顶到上下边界被 clamp。
          const k = i;
          const f = this.fish.acquire(groupDef);
          f.reset(
            clamp(gx + gdir * k * gstep, -WORLD.playHalfWidth, WORLD.playHalfWidth),
            clamp(gy - k * gstep * 0.34, lo, hi)
          );
          f.dir = sdir;          // 编队：同群共享朝向 / 速度（见上面的注释）
          f.speed = sspd;
          continue;
        }
        let def = pick(pool);
        if (def && def.hazard) {
          if (hazardUsed >= HAZARD_SPAWN.maxPerZone) def = pick(safe) || def;
          else hazardUsed += 1;
        }
        if (!def) continue;
        const f = this.fish.acquire(def);
        // 只生成在鱼钩够得到的横向范围内 —— 鱼已经这么少了，不能有"看得到钓不到"的
        f.reset(
          (Math.random() - 0.5) * WORLD.playHalfWidth * 2,
          lo + Math.random() * (hi - lo)
        );
      }
    }
  }

  /** 给定世界高度落在哪一层海域（深度尺 / 区域横幅用，实现在 config.js） */
  _zoneAt(y) { return zoneAtDepth(y, this.map.id); }

  // ── 主循环 ───────────────────────────────────────────────
  _loop = (now) => {
    requestAnimationFrame(this._loop);
    let raw = (now - this._last) / 1000;
    this._last = now;
    if (raw > 0.06) raw = 0.06;          // 防止切后台回来时物理炸掉

    if (this.slowmoT > 0) {
      this.slowmoT -= raw;
      if (this.slowmoT <= 0) this.timeScale = 1;
    }
    const dt = raw * this.timeScale;
    this.time += dt;

    this._update(dt);
    this.world.render();
  };

  _update(dt) {
    const st = this.state;
    const vh = this.world.viewH;
    // 所有相机锚点都按可见高度取比例，保证不同屏幕比例下的画面构图一致
    const anchor = (r) => WORLD.surfaceY + vh * r;
    let cam = { x: 0, y: anchor(CAMERA.shopAnchor), rate: 2.5, scale: 1 };

    // ── 状态逻辑 ──
    if (st === STATE.DESCEND) {
      const prevY = this.hook.y, prevX = this.hook.x;

      // 抛竿滞空：鱼钩还在空中划抛物线
      if (this.castAir) {
        this._updateCast(dt);
        // 镜头跟着飞起来的鱼钩。上限比下潜宽松得多 ——
        // 否则钩子飞到 74m 时会被"浅水钳制"顶出画面顶部。
        cam.y = this.hook.y + vh * CAMERA.castLeadRatio;
        cam.y = Math.min(cam.y, WORLD.surfaceY + vh * CAMERA.castTopRatio);
        cam.rate = CAMERA.descendRate;
      } else if (this.reelPre > 0) {
        // ── 上拉预备：带着原来的下潜速度继续滑一段，刹停，然后上升（需求③）──
        // 曲线 e = 2k − k² 而不是 smoothstep(k²(3−2k))：
        //   smoothstep 起手速度是 0 → 看起来像"顿一下再往下"，和下潜动势断开；
        //   这条曲线起手速度正好等于下潜速度 → 是**纯粹的刹停**，衔接最自然。
        //
        // ⚠ v0.3.3：这段刹停**玩家还能左右移动去勾鱼** —— 它是"这一竿最后的机会"。
        //   所以横向照常响应输入，撞到鱼也照常串上（只是不再重新触发收线）。
        if (this.input.isDown('KeyA', 'ArrowLeft')) this.targetX = clamp(this.targetX - 90 * dt, -WORLD.playHalfWidth, WORLD.playHalfWidth);
        if (this.input.isDown('KeyD', 'ArrowRight')) this.targetX = clamp(this.targetX + 90 * dt, -WORLD.playHalfWidth, WORLD.playHalfWidth);
        this.hook.x += (this.targetX - this.hook.x) * Math.min(1, 16 * dt);

        this.reelPre -= dt;
        const k = clamp(1 - Math.max(0, this.reelPre) / (this.reelDur || TUNING.reelPreDur), 0, 1);
        const e = k * (2 - k);
        // 纵向走刹停曲线；横向由上面的输入决定，所以这里**不再插值 x**
        this.hook.y = lerp(this.reelFrom.y, this.reelTo.y, e);
        this.hook.setPosition(this.hook.x, this.hook.y);
        this.hook.layoutCatch(this.caught);
        this.maxDepthReached = Math.max(this.maxDepthReached, -this.hook.y);

        // 刹停期间的撞鱼：串上，但**不再**触发收线（已经在收了）
        const bumpPre = this.bumpRadius;
        for (const f of this.fish.active) {
          if (f.state !== FISH_STATE.SWIM) continue;
          const p = f.mesh.position;
          if (distToSegment(p.x, p.y, prevX, prevY, this.hook.x, this.hook.y) < bumpPre + f.radius) {
            this.world.addShake(TUNING.hitShake);
            this.world.burstBubbles(p.x, p.y, 10, 14);
            this._catch(f);
            break;
          }
        }

        if (this.reelPre <= 0) this._beginAscend();

        cam.y = this.hook.y + vh * CAMERA.descendLeadRatio;
        cam.y = Math.min(cam.y, WORLD.surfaceY + vh * CAMERA.shallowClampRatio - vh / 2);
        cam.rate = CAMERA.descendRate;
      } else {
        // 键盘微调
        if (this.input.isDown('KeyA', 'ArrowLeft')) this.targetX = clamp(this.targetX - 90 * dt, -WORLD.playHalfWidth, WORLD.playHalfWidth);
        if (this.input.isDown('KeyD', 'ArrowRight')) this.targetX = clamp(this.targetX + 90 * dt, -WORLD.playHalfWidth, WORLD.playHalfWidth);

        this.hook.x += (this.targetX - this.hook.x) * Math.min(1, 16 * dt);

        // 浮冰减速：撞上之后这一段下潜会变慢（不是收线，只是变慢）
        if (this.iceSlowT > 0) this.iceSlowT -= dt;
        const dspd = this.descendSpeed * (this.iceSlowT > 0 ? ICEBERG.slowScale : 1);

        let ny = this.hook.y - dspd * dt;
        const reached = ny <= -this.maxDepth;
        if (reached) ny = -this.maxDepth;
        this.hook.y = ny;
        this.hook.setPosition(this.hook.x, this.hook.y);
        this.hook.layoutCatch(this.caught);

        this.maxDepthReached = Math.max(this.maxDepthReached, -this.hook.y);

        // 浮冰碰撞（只有带 hook:'iceberg' 的地图才有这组碰撞体）
        this._bumpIcebergs();

        // 下潜撞鱼 → 自动收线。
        // 判定半径是**固定值**（TUNING.bumpRadius），不跟着鱼钩等级涨 ——
        // 否则升级鱼钩会让下潜变得寸步难行，等于花钱买罪受。
        // ⚠ v0.5：「加固」已移除，所以这里**没有**任何减免路径 ——
        //   下潜的难度完全由走位决定（这是刻意的，见 config 的 bumpRadius 注释）。
        //
        // ⚠ 落地缓冲：铅坠·直达深度跳下来之后 `dropGraceT` 还没走完时**不判撞鱼**。
        //   玩家是盲选深度的，一落地就撞鱼属于运气，不该由他承担（见 config 的 DROP_GRACE）。
        if (this.dropGraceT > 0) this.dropGraceT -= dt;
        const bump = this.bumpRadius;
        // 海床上的宝箱（v0.7）：下潜路过也能捡 —— 碰到即得，不强制收线
        this._checkChest(prevX, prevY);
        if (this.dropGraceT <= 0) {
          for (const f of this.fish.active) {
            if (f.state !== FISH_STATE.SWIM) continue;
            const p = f.mesh.position;
            if (distToSegment(p.x, p.y, prevX, prevY, this.hook.x, this.hook.y) < bump + f.radius) {
              this.world.addShake(TUNING.hitShake);
              this.world.burstBubbles(p.x, p.y, 10, 14);
              // v0.3：撞到鱼不再只是"惩罚"—— 先把它**直接串上鱼线**，
              //   然后带着当前下潜速度滑一小段刹停，再上升。撞鱼依然是"这一竿到此为止"
              //   （路线没选好的代价），但至少不是白撞：这条鱼归你。
              this._catch(f);
              // ── 船只「装甲号」的护钩（v0.7）──
              // 本竿**第一次**撞击不强制收线，钩子继续往下走；第二次照常收线。
              // ⚠ 只保护一次是刻意的：全程保护等于把整个下潜阶段变成无风险通道，
              //   而"下潜躲鱼"是循环的第一段（§2.3 那条铁律的延续）。
              if (this.hookGuardLeft > 0) {
                this.hookGuardLeft -= 1;
                this.world.burstSparks(p.x, p.y, 12, 1.2);
                this.ui.floatText(p.x, p.y + 16 * MODEL_SCALE, '装甲护钩 · 继续下潜', 'good sm');
              } else {
                this._reel('bump', dspd);
              }
              break;
            }
          }
        }

        // 触底自动收线
        if (this.state === STATE.DESCEND && reached) {
          this.bottomT += dt;
          if (this.bottomT > TUNING.bottomPause) this._reel();
        }

        cam.y = this.hook.y + vh * CAMERA.descendLeadRatio;
        // 浅水时别把整条船拉进画面
        cam.y = Math.min(cam.y, WORLD.surfaceY + vh * CAMERA.shallowClampRatio - vh / 2);
        cam.rate = CAMERA.descendRate;
      }

    } else if (st === STATE.ASCEND) {
      // 上升阶段也要能左右移动 —— 这就是"尽量多碰到鱼"的操作
      if (this.input.isDown('KeyA', 'ArrowLeft')) this.targetX = clamp(this.targetX - 110 * dt, -WORLD.playHalfWidth, WORLD.playHalfWidth);
      if (this.input.isDown('KeyD', 'ArrowRight')) this.targetX = clamp(this.targetX + 110 * dt, -WORLD.playHalfWidth, WORLD.playHalfWidth);
      this.hook.x += (this.targetX - this.hook.x) * Math.min(1, 16 * dt);

      this._updateAscend(dt);
      cam.y = this.hook.y + vh * CAMERA.ascendLeadRatio;
      cam.rate = CAMERA.ascendRate;

    } else if (st === STATE.AIR) {
      this._updateAir(dt, this.time);
      cam = this._airCamera();

    } else if (st === STATE.IDLE || st === STATE.TITLE) {
      // 待机：整条船 + 渔夫
      cam.y = anchor(CAMERA.idleAnchor);
      cam.rate = 3;
      cam.scale = CAMERA.idleScale;
      this._parkHook();

    } else {
      // RESULT：海面待机（手机开着时走的是 IDLE 分支，世界继续动）
      cam.y = anchor(CAMERA.shopAnchor);
      cam.rate = 2.2;
      cam.scale = CAMERA.idleScale;
    }

    // ── 通用更新 ──
    // 注意：空中鱼由 _updateAir 单独推进，这里必须跳过，
    // 否则同一条鱼一帧内被积分两次（重力翻倍、速度翻倍）。
    const view = this.world.viewRange();
    for (const f of this.fish.active) {
      if (f.immuneT > 0) f.immuneT -= dt;      // 被鱼护挤下来的鱼的免疫计时
      if (f.state === FISH_STATE.AIR) continue;
      f.update(dt, this.time, view);
    }

    this.world.update(dt, {
      x: cam.x, y: cam.y, rate: cam.rate, scale: cam.scale,
      hookY: this.hook.y,
    });

    if (st === STATE.DESCEND || st === STATE.ASCEND) {
      this.hook.update(dt, this.time, this.world.darkness);
      // 第三个参数是鱼钩**当前**深度 —— 深度尺上的游标跟着它走，而不是跟着"已潜最深"。
      this.ui.setDepth(this.maxDepthReached, this.maxDepth, -this.hook.y);
      // 抛竿滞空时钩子还在天上，没有"所在海域"可言（否则会被算成最深的一层）
      if (!this.castAir) this.ui.setZone(this._zoneAt(this.hook.y));
    } else if (st === STATE.AIR) {
      this.ui.setAltitude(altitudeAt(this.world.camY));
    }
  }
}

// 启动：等布局生效（正交相机需要正确的画布尺寸）后再创建
function boot(retry = 0) {
  const canvas = document.getElementById('game');
  if (!canvas) return;
  if (canvas.clientWidth === 0 && retry < 30) {
    requestAnimationFrame(() => boot(retry + 1));
    return;
  }
  window.__game = new Game();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => boot());
} else {
  boot();
}

export { Game };
