

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
import {
  WORLD, CAMERA, SPECIES, TUNING, FISH_DENSITY, HAZARD_SPAWN, SCHOOL, ICEBERG, HEAT_VENT,
  TRAIT, BOSS, SIREN,
  SPAWN_TOP_MARGIN, MODEL_SCALE,
  UPGRADE_ORDER, MAX_LEVEL, maxLvOf, levelCapForMap, upgradeCost, altitudeAt,
  MAPS, mapMaxDepth, zoneAtDepth, zonesOfMap,
  GUNS,
  CALLS,
  boatById, chartFrom,
  SKY, SKY_MAX_ALIVE, SKY_GAP, STATE,
} from './config.js';
import { World, clamp, lerp } from './world.js';
// 剧情数据表：文案与触发条件在 story.js / config 的 CALLS，
// **驱动逻辑在 `src/narrative.js`**（原型挂载，见文件末尾的 `mountMixin()`）。
// 这里只用得到结局文案（`_beatGame`），其余交给 narrative.js。
import { ENDING } from './story.js';
import { FishManager, FISH_STATE, buildSkyModel } from './fish.js';
import { Hook, distToSegment } from './hook.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { SFX, unlockAudio, setMuted, isMuted } from './audio.js';
import { freshSave, loadSave, persist } from './save.js';
import { Narrative } from './narrative.js';
import { Voyage } from './voyage.js';
import { Guns } from './guns.js';

// 状态机常量 `STATE` 在 config.js（2026-09-20 挪过去：① 其余常量全在 config；
// ② narrative.js 也要判 `STATE.IDLE`，而它不能 import 本文件，否则成环）。

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
    // 命中定格剩余时长（批 6 特效 #1）
    this.hitStopT = 0;
    this.hitCd = 0;
    this.bottomT = 0;
    this.reelPre = 0;
    this.ascendRampT = 0;   // 回拉起步缓动剩余时长（只有 _beginAscend 会把它点着）
    this.airT = 0;
    this.airClearT = 0;   // 场上没有可打的鱼之后过了多久（结算停留用）
    this.skyT = 0;         // 距离下一次刷新天空目标的秒数（见 _spawnSky）
    this.castT = 0;
    this.castAir = false;                  // 抛竿滞空：这段时间玩家能左右移动鱼钩
    this.castV = { x: 0, y: 0 };
    // 天空目标（海鸟 / 飞机 / UFO，v0.8）：射击阶段的**加分项**。
    // ⚠ 它们不参与结算判定 —— 天上还有东西时照样能收竿（见 _updateAir）。
    this.sky = [];
    this.airFish = [];
    this.caught = [];
    this.maxDepth = TUNING.maxDepth(this.save.levels.line);
    // ⚠ v0.5：下潜 / 收线速度、撞鱼判定、罚款都变成**常量**（它们原来的升级轴已移除）。
    //   仍然写成实例字段而不是直接用 TUNING.xxx —— 热路径上每帧读一次字段比读两层对象快，
    //   而且调试时 `g.descendSpeed` 一眼能看见。
    this.descendSpeed = TUNING.DESCEND_SPEED;
    // 下面几项由 applyUpgrades() 统一赋值，这里先给个初值免得 applyUpgrades 之前被读到
    this.ascendSpeed = TUNING.ASCEND_SPEED;   // 基准收线速度；快速回收时临时乘 FAST_REEL_MUL
    // 空中阶段的硬顶（秒）—— 随「耐压舱」等级变，由 applyUpgrades() 落值（批 4）。
    // ⚠ 这里给的初值必须是 Lv0 的那个数，否则 applyUpgrades() 之前的帧会读到 undefined。
    this.airTimeout = TUNING.airTimeout(0);
    // 榴弹枪（批 4）：还在引信上的弹（`{x, y, r, dmg, t}`），每竿清空。
    this.lobs = [];
    // 冰冻（批 7）：本竿收线速度的额外倍率。串上带 `frozen` 的鱼之后降到 0.75，
    // **每竿重置回 1** —— 它是"这一竿的代价"，不是永久 debuff。
    this.ascendMul = 1;
    // Boss（批 7）：当前在场的那条 / 本图的候选 / 已经进到第几段
    this.boss = null;
    this.bossDefs = [];
    // 海妖之歌（批 8b）：距下一次开唱还有多久 / 当前歌声还剩多久
    this.sirenT = SIREN.period;
    this.sirenOnT = 0;
    this._bossPhase = 0;
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
    // 滞空时长（批 4，第 8 项升级「耐压舱」）：
    // ⚠ 落在 applyUpgrades 而不是空中循环里现查表 —— 和上面几项同一个理由
    //   （每帧读一次 LEVELS 既慢、又会把"哪一项在哪生效"散得满代码都是）。
    this.airTimeout = TUNING.airTimeout(L.tank);
    // 宝箱：拿到**本图的**海图之后就收起来（它是一次性的剧情道具）。
    // ⚠ 按图判定：冰封极地底部那只箱子装的是**熔岩海图**，和首图那只互不影响 ——
    //   写成"有任意一张海图就收起来"的话，玩家换到极地会发现箱子凭空消失了。
    const hereChart = chartFrom(this.map.id);
    this.world.showChest(!!hereChart && !this.hasChart(hereChart.id));
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
      bestCombo: 0, depth: 0, alt: 0, escaped: [], sky: 0,
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
    // 榴弹枪（批 4）：还在引信上的弹。**每竿清空** —— 上一竿没炸的弹不该跨竿炸。
    this.lobs = [];
    // ── 特殊状态（批 7）：这两条都是**每竿重置**的 ──
    // 冰冻：收线倍率回到 1（它是"这一竿的代价"）
    this.ascendMul = 1;
    // 灼热：鱼护上限 −1 每竿只触发一次，这个标记负责"只一次"
    this._traitCreelDone = false;
    // ── Boss（批 7）：每竿重置。`bossDefs` 由 spawnFish 填（它才知道当前是哪张图）──
    this.boss = null;
    this._bossPhase = 0;
    this._endBoss();
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
      sms: () => this.smsThreads(),
      smsUnread: () => this.smsUnread(),
      readSms: () => this.markSmsRead(),
      codexNote: (id) => this.codexNote(id),
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
    this._syncSms();
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


  /** 已解锁的 App id 列表（船厂是 v0.7 起唯一"要解锁"的 App） */
  _apps() {
    // 短信 / 电台（批 5）是**常驻**的 —— 它们不靠剧情解锁，一开始就在桌面上
    const base = ['call', 'sms', 'shop', 'gunshop', 'codex', 'route', 'radio', 'settings'];
    return this.save.boatApp ? [...base, 'boat'] : base;
  }

  /** 船只存档的读写入口（表可能不存在 —— 和 calls / charts 同一个理由） */
  _boats() {
    if (!this.save.boats || typeof this.save.boats !== 'object') this.save.boats = { owned: [], current: null };
    if (!Array.isArray(this.save.boats.owned)) this.save.boats.owned = [];
    return this.save.boats;
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
    // 批 5：未读短信也算手机红点（和未读新枪 / 来电同一个徽标）
    const n = this._gunNews().length + (this.ringingCall ? 1 : 0) + this.smsUnread();
    this.ui.setPhoneBadge(n);
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

  /**
   * 热泉上冲（批 4，熔岩海沟）：钩子在不在热泉柱里？在 → 返回收线速度倍率，不在 → 1。
   *
   * ⚠ 判据是**区间**（`x ± r` 且 `y0 ≤ y ≤ y1`），不是圆 —— 热泉是一根竖直的柱子，
   *   玩家"经过"它是靠上升时穿过那一段高度。这和浮冰的圆形判定不一样。
   * ⚠ 只影响**收线速度**，不碰横向：玩家仍然能自由走位，
   *   加速的代价是"从鱼群旁边飞过去"，所以它是一个选择而不是白送。
   */
  _ventBoost() {
    const list = this.world.heatVentColliders;
    if (!list || !list.length) return 1;
    const x = this.hook.x;
    const y = this.hook.y;
    for (const v of list) {
      if (x < v.x - v.r || x > v.x + v.r) continue;
      if (y < v.y0 || y > v.y1) continue;
      return HEAT_VENT.boost;
    }
    return 1;
  }
  /**
   * 钩子在不在**沉船格子**里（批 8，废弃沉船专属）。
   *
   * 在格子里 → **免疫下潜撞鱼**。这是全游戏第一个"空间策略"机制：
   * 格子给一条安全通道，但它很窄、而且不连续 —— 玩家得规划"哪一段走格子、哪一段自己躲"。
   *
   * ⚠ 只作用于**下潜阶段的撞鱼**。上升阶段的串鱼照常 —— 格子不是无敌区，
   *   它是"这一段的路线选择"。
   */
  _inWreckCell() {
    const list = this.world.wreckCellColliders;
    if (!list || !list.length) return false;
    const x = this.hook.x;
    const y = this.hook.y;
    for (const c of list) {
      if (Math.abs(x - c.x) > c.w / 2) continue;
      if (y < c.y0 || y > c.y1) continue;
      return true;
    }
    return false;
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
    // 冰冻（批 7）：串上带 `frozen` 的鱼之后，本竿收线变慢。
    // ⚠ 乘在**最外层**，所以它和快速回收（绞盘）是叠乘的 ——
    //   "被冻住时按加速"仍然比不按快，玩家的那一次决策没被废掉。
    const base = this.fastReel ? this.ascendSpeed * TUNING.FAST_REEL_MUL : this.ascendSpeed;
    return base * this.ascendMul;
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
    // 热泉上冲（批 4，熔岩海沟）：在热泉柱里就乘 HEAT_VENT.boost（不在里面时是 ×1）。
    // ⚠ 乘在**收线速度**上，所以快速回收（绞盘）和热泉是叠乘的 —— 两个都触发时最快。
    const spd = this.reelSpeed * this._ventBoost();
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
    // ⚠ 批 7 起按**占位**算（带电鱼占 2 个位），不是按条数 —— 见 `_creelUsed()`。
    const need = f.slots || 1;
    if (this._creelUsed() + need > this.creelLimit) {
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
    // 特殊状态（批 7）：被串上才生效的后果。放在最后 —— 它可能要改鱼护上限 / 收线速度，
    // 那些值这一帧剩下的代码（layoutCatch / UI）都该看到改完之后的结果。
    this._applyTrait(f);
  }

  /** 鱼护**已经占用的位数**（带电鱼占 2 个位，其余 1 个） */
  _creelUsed() {
    let n = 0;
    for (const f of this.caught) n += f.slots || 1;
    return n;
  }

  /**
   * 被串上时生效的特殊状态（批 7，见 config 的 `TRAIT`）。
   *
   * ⚠ `charged` 的那一条**不在这里** —— 它是"这条鱼占 2 个位"，已经写在 `f.slots` 上，
   *   由 `_creelUsed()` 统一算。这里只处理另外三条的一次性副作用。
   * ⚠ `burning` 的"鱼护上限 −1"**每竿只触发一次**：一串灼热鱼叠加的话，
   *   鱼护会被压到 0，玩家连一条鱼都带不回来。
   */
  _applyTrait(f) {
    const tr = f.trait ? TRAIT[f.trait] : null;
    if (!tr) return;
    const p = f.mesh.position;
    if (tr.ascendMul) {
      // 冰冻：本竿收线变慢。取 min 而不是连乘 —— 串第二条冰冻鱼不该变成 0.56×
      this.ascendMul = Math.min(this.ascendMul, tr.ascendMul);
    }
    if (tr.creel && !this._traitCreelDone) {
      this._traitCreelDone = true;
      this.creelLimit = Math.max(1, this.creelLimit + tr.creel);
    }
    if (tr.flash) this.ui.flashScreen();
    // 状态可视化（批 6 特效 #9）：没有视觉反馈的状态等于不存在
    this.world.burstTrait(p.x, p.y, f.trait);
    this.ui.floatText(p.x, p.y - 14 * MODEL_SCALE, tr.text, 'bad sm');
    this.world.addShake(3);
  }

  /**
   * 触发命中定格（批 6 特效 #1）。**鱼越大停得越久** —— 时长按血量算，
   * 所以打碎一条沙丁鱼几乎看不出来，而打中极夜之王会明显"顿"一下。
   *
   * ⚠ 取  而不是覆盖：连发枪一秒打十几发，覆盖的话后一枪会把前一枪的
   *   定格**缩短**，结果是射速越高越没有打击感 —— 和直觉相反。
   */
  _hitStop(hp) {
    const k = Math.min(1, Math.max(0, (hp || 0) / 200));
    const sec = TUNING.hitStopMin + (TUNING.hitStopMax - TUNING.hitStopMin) * k;
    this.hitStopT = Math.max(this.hitStopT, sec);
  }

  // ── Boss 框架（批 7）──────────────────────────────────────
  /**
   * Boss 的出场条件：`bossWhen = { depth, caught }`，两条**都**满足才刷。
   *
   * 为什么用"本竿已经串了几条"而不是"历史累计"：它让 Boss 成为**这一竿的奖励** ——
   * 玩家潜得够深、又已经串了一捆鱼，它才现身。历史累计的话它迟早会冒出来，
   * 那就退化成一个"早晚要打的过场"，不是"这一竿赚到了"。
   *
   * ⚠ 只在 `DESCEND` 里调：Boss 是"从更深处升上来的"，下潜阶段出现才说得通。
   */
  /**
   * 海妖之歌招来的 Boss（批 8b）：**不看深度、不看串鱼数**，随机挑本图的一个**常规** Boss。
   *
   * ⚠ 排除 ：终章 Boss 只能靠"潜到最底 + 打赢前面所有 Boss"拿到，
   *   让它被随机歌声摇出来会把整个终章的分量冲掉。
   */
  _sirenBoss() {
    if (this.boss) return;
    const cands = (this.bossDefs || []).filter((d) => !d.final);
    if (!cands.length) return;
    this._spawnBoss(cands[Math.floor(Math.random() * cands.length)]);
  }

  _checkBossTrigger() {
    if (this.boss || !this.bossDefs || !this.bossDefs.length) return;
    const depth = -this.hook.y;             // 钩子的世界 y 是负的，深度取正
    // ⚠ 选**条件满足的、触发深度最深**的那一个，而不是"第一个满足的"：
    //   终章 Boss 的触发深度比本图的常规 Boss 更深，所以"潜得够深"时它会顶掉常规 Boss ——
    //   两者不会在同一竿里打架（一个深度区间只出一个）。
    let pick = null;
    for (const def of this.bossDefs) {
      const w = def.bossWhen;
      if (depth < w.depth) continue;
      if (this.run.caught < (w.caught || 0)) continue;
      // 终章 Boss 的额外门槛：**先打赢另外几个 Boss**（
      if (w.afterBoss != null && (this.save.bossKills || 0) < w.afterBoss) continue;
      if (!pick || w.depth > pick.bossWhen.depth) pick = def;
    }
    if (pick) this._spawnBoss(pick);
  }

  _spawnBoss(def) {
    const f = this.fish.acquire(def);
    // 刷在钩子**下方** 60m：它是从更深处上来的，玩家会先看见它靠近，而不是"贴脸出现"
    const x = clamp(
      this.hook.x + (Math.random() < 0.5 ? -40 : 40),
      -WORLD.fishHalfWidth, WORLD.fishHalfWidth,
    );
    f.reset(x, this.hook.y - 60 * MODEL_SCALE);
    f.boss = true;
    this.boss = f;
    this._bossPhase = 0;
    this.world.addShake(BOSS.shake);
    this.world.burstSparks(x, f.y, 30, 2.0);
    // Boss 出场（批 6 特效 #10）：慢镜头 + 水体色偏。
    // ⚠ 复用**已有的**  /  机制（击杀结算用的那一套），
    //   不要为它另起一个时间缩放通道 —— 两个通道叠起来会互相覆盖。
    this.timeScale = BOSS.slowmoScale;
    this.slowmoT = BOSS.slowmoTime;
    this.ui.setBossShift(true);
    this.ui.setBossBar(def.name, 1, BOSS.segments);
    this.ui.setHint(`「${def.name}」出现了 —— 打掉它`);
    SFX.record();
  }

  /**
   * 每打掉 `1/BOSS.segments` 的血换一次行为模式 + 提速。
   * 阶段用 `Math.floor((1 - ratio) * segments)` 算，所以**血量比例**是唯一真相 ——
   * 不需要另存"已经进到第几段"以外的状态（`_bossPhase` 只用来判"是不是刚跨过一段"）。
   */
  _syncBossBar(f) {
    const ratio = Math.max(0, f.hp / f.maxHp);
    this.ui.setBossBar(f.def.name, ratio, BOSS.segments);
    const phase = Math.min(BOSS.segments - 1, Math.floor((1 - ratio) * BOSS.segments));
    if (phase <= this._bossPhase) return;
    this._bossPhase = phase;
    f.speed *= BOSS.phaseSpeedMul;
    f.behavior = BOSS.phases[phase % BOSS.phases.length];
    this.world.addShake(BOSS.shake * 0.6);
    this.ui.floatText(f.mesh.position.x, f.mesh.position.y + 14 * MODEL_SCALE, '它变快了', 'bad');
    SFX.record();
  }

  /**
   * **通关**（终章）：播结局过场 + 记 。
   *
   * ⚠ 结局**不是一条短信**，是全屏过场 —— 短信（ / ）在那之后才到。
   *   顺序是有意的：玩家先读完整段，再看到手机响。
   * ⚠  比普通过场长，但它走的是**同一个**  ——
   *   不另做一套演出系统（普通过场的"恰好 3 行"约束只管地图过场，见  A4）。
   */
  _beatGame() {
    this.save.beatGame = true;
    persist(this.save);
    this._syncSms();
    this.ui.setHint('债务已结清');
    this.ui.showCutscene(ENDING, () => this.ui.refreshApp());
  }

  /** Boss 离场（被打死 / 逃走）：把血条收起来 */
  _endBoss() {
    if (!this.boss) return;
    this.boss = null;
    this.ui.setBossBar(null, 0, 0);
    this.ui.setBossShift(false);
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
    // 天空目标：进场先给一段空窗（别一进空中阶段就贴脸刷一个），之后按 SKY_GAP 随机
    this.sky = [];
    this.skyT = 0.6;
    this._resetGun();
    this.combo = 0;
    this.mult = 1;
    this.maxAltReached = 0;
    this.ui.setCombo(0, 1);

    // 慢动作：制造"哇"的一瞬
    this.timeScale = TUNING.slowmoScale;
    this.slowmoT = TUNING.slowmoTime;
  }

  _hitFish(f) {
    const p = f.mesh.position;
    // Boss 被打死（或作为扣钱鱼被清掉）：先把血条收起来，再走原来的结算
    if (f.boss) {
      this._endBoss();
      this.save.bossKills = (this.save.bossKills || 0) + 1;   // 结局短信看它（批 5）
      // 终章（）：打完它 = 通关，播结局过场
      if (f.def.final) this._beatGame();
    }

    if (f.def.hazard) {
      // 扣钱鱼：爆炸扣钱。
      // 金币不会扣成负数；本竿收入按「实际扣掉的数额」记，
      // 否则身上没钱时两个账对不上（结算显示的收入会莫名其妙少一截）。
      // ⚠ v0.5：「保险」已移除 —— 罚款是固定值，没有减免路径（见 config 的 pufferPenalty）。
      this.combo = 0; this.mult = 1;
      this.save.hazards = (this.save.hazards || 0) + 1;   // 短信条件用（批 5）
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

  // ── 天空目标（v0.8：海鸟 / 飞机 / UFO）─────────────────────
  /**
   * 刷一个天空目标。
   *
   * 三件事**故意和鱼不一样**：
   *   ① 高度由 `SKY[].alt` 决定（相对相机视野的比例）—— 鸟贴低空、飞机在中层、UFO 最高；
   *   ② 运动是**水平匀速**（不是鱼的抛物线）：它们从画面一侧飞到另一侧；
   *   ③ 血量与身价**按地图取**（`SKY[].hp[mapIndex]` / `value[mapIndex]`），和 `SPECIES` 同一个思路。
   *
   * ⚠ 相机高过 `maxCamY` 就不再刷这一种 —— "飞进太空就没有鸟了"（飞机 / UFO 的额度更高）。
   */
  _spawnSky() {
    const pool = SKY.filter((s) => this.world.camY < s.maxCamY);
    if (!pool.length) return;

    // 按 weight 抽签（鸟最常见、UFO 最稀有）
    let total = 0;
    for (const s of pool) total += s.weight;
    let r = Math.random() * total;
    let def = pool[pool.length - 1];
    for (const s of pool) { r -= s.weight; if (r <= 0) { def = s; break; } }

    const mi = Math.min(this.mapIndex, def.hp.length - 1);
    const hp = def.hp[mi];
    const dir = Math.random() < 0.5 ? 1 : -1;
    const mesh = buildSkyModel(def.kind);
    const y0 = this.world.camY + this.world.viewH * (def.alt[0] + Math.random() * (def.alt[1] - def.alt[0]));

    mesh.position.set(this.world.camX - dir * this.world.viewW * 0.78, y0, 8);
    // ⚠ 朝向靠 `scale.x` 取负（镜像），不是 `rotation.y` —— 理由见 `fish.js` 里那段说明
    mesh.scale.set(dir * def.scale * MODEL_SCALE, def.scale * MODEL_SCALE, def.scale * MODEL_SCALE);
    this.world.scene.add(mesh);

    this.sky.push({
      def, kind: def.kind, name: def.name, mesh, dir, alive: true,
      hp, maxHp: hp,
      value: def.value[Math.min(this.mapIndex, def.value.length - 1)],
      radius: def.radius * MODEL_SCALE,
      speed: (def.speed[0] + Math.random() * (def.speed[1] - def.speed[0])) * MODEL_SCALE,
      y0, phase: Math.random() * 6.28,
      engaged: false,     // 中过弹 → 镜头会咬住它（见 _airCamera）
      tumbling: false,    // 中了弹 → 像鱼一样翻滚着往下掉
      spin: 0, spinX: 0, vx: 0, vy: 0,
    });
  }

  /**
   * 推进天空目标：飞 / 扇翅膀 / 引擎光脉动 / 中弹后翻滚下坠。
   *
   * ⚠ 中弹后的"翻滚 + 下坠"就是需求里的"**变得和鱼一样**"：
   *   它们原本水平匀速飞过（打不中就一直飞走），中弹之后转成**翻滚 + 慢慢往下掉** ——
   *   于是和鱼一样有"要不要赶紧补一枪"的取舍：补慢了它就掉出画面，白打。
   */
  _updateSky(dt) {
    this.skyT -= dt;
    if (this.skyT <= 0 && this.sky.filter((s) => s.alive).length < SKY_MAX_ALIVE) {
      this.skyT = SKY_GAP[0] + Math.random() * (SKY_GAP[1] - SKY_GAP[0]);
      this._spawnSky();
    }

    const cull = this.world.viewW;
    const floor = this.world.viewRange().bottom - 40;
    for (const s of this.sky) {
      if (!s.alive) continue;
      const p = s.mesh.position;
      s.phase += dt;

      if (s.tumbling) {
        // 中了弹：翻滚 + 减速 + 往下掉（和鱼的滞空手感同一族）
        s.vy -= TUNING.airGravity * dt * 0.34;
        p.y += s.vy * dt;
        p.x += s.vx * dt;
        s.mesh.rotation.z += s.spin * dt;
        s.mesh.rotation.x += s.spinX * dt;
      } else {
        p.x += s.dir * s.speed * dt;
        // 高度上轻微起伏（鸟最明显、飞机几乎不飘、UFO 慢慢浮）
        const bob = s.kind === 'bird' ? 5 : s.kind === 'plane' ? 1.4 : 8;
        p.y = s.y0 + Math.sin(s.phase * 0.7) * bob;
      }

      // 各造型自己的小动作（部件挂在 mesh.userData 上，见 fish.js 的 buildSkyModel）
      const ud = s.mesh.userData;
      if (s.kind === 'bird' && ud.wingL) {
        // ⚠ 两片翅膀**同号**旋转（它们没有做镜像，几何完全一样）——
        //   翼尖在屏幕内一起上下摆，才是"扇翅膀"；一正一负会变成来回拧。
        const a = Math.sin(s.phase * 9) * 0.55;
        ud.wingL.rotation.z = a;
        ud.wingR.rotation.z = a;
      } else if (s.kind === 'plane' && ud.glow) {
        ud.glow.material.opacity = 0.55 + 0.35 * Math.abs(Math.sin(s.phase * 6));
      } else if (s.kind === 'ufo') {
        if (ud.dome) ud.dome.material.opacity = 0.5 + 0.3 * Math.sin(s.phase * 2.4);
        if (ud.beam) ud.beam.material.opacity = 0.10 + 0.08 * Math.sin(s.phase * 1.7 + 1);
      }

      // 飞出画面两侧 / 掉到视野下方 → 收走（没打光就是白飞）
      if (Math.abs(p.x - this.world.camX) > cull || p.y < floor) {
        this.world.scene.remove(s.mesh);
        s.alive = false;
      }
    }
    this.sky = this.sky.filter((s) => s.alive);
  }

  /**
   * 天空目标中弹：扣血 → 打光就见钱；没打光就**开始翻滚 + 被顶一下**。
   * ⚠ 第一次中弹就把 `engaged` 打开 —— 镜头从这里开始咬住它（见 `_airCamera`）。
   */
  _applySkyDamage(s, dmg) {
    const p = s.mesh.position;
    s.hp -= dmg;
    s.engaged = true;

    if (!s.tumbling) {
      s.tumbling = true;
      s.spin = (7 + Math.random() * 7) * (Math.random() < 0.5 ? -1 : 1);
      s.spinX = 1.6 + Math.random() * 2.6;
      s.vy = TUNING.knockUpBase * 0.55;       // 先被顶一下，再往下掉
      s.vx = s.dir * s.speed * 0.35;
      this.world.burstSparks(p.x, p.y, 8, 0.8);
      this._hitStop(s.hp);
    }
    if (s.hp > 0) {
      const shots = Math.max(1, Math.ceil(s.hp / Math.max(0.05, dmg)));
      this.ui.floatText(p.x, p.y + 10 * MODEL_SCALE, `还差 ${shots} 枪`, 'sm');
      return;
    }
    this._killSky(s);
  }

  /** 打光血：和鱼走同一套结算（连击 / 倍率 / 船只加成 / 特效），只换了名字与特效量级 */
  _killSky(s) {
    const p = s.mesh.position;
    this.combo += 1;
    this.mult = this.multOfCombo;
    this.run.bestCombo = Math.max(this.run.bestCombo, this.combo);

    // ⚠ 和 `_hitFish` 同一个口径：船只加成**乘在结算金额上**，不改身价
    const gain = Math.max(1, Math.round(s.value * this.mult * (this.boatGoldMul || 1)));
    this.save.coins += gain;
    this.run.earned += gain;
    this.run.sky += 1;

    this.world.burstCoins(p.x, p.y, s.kind === 'bird' ? 8 : 16);
    this.world.burstSparks(p.x, p.y, s.kind === 'bird' ? 14 : 26, 1.4);
    this.world.addShake(s.kind === 'bird' ? 2.4 : 4.5);
    this.ui.floatText(p.x, p.y, `${s.name} +${gain}`, 'good');
    this.ui.setCoins(this.save.coins);
    this.ui.setCombo(this.combo, this.mult);
    SFX.bird();                                  // 三种共用「空中目标被击落」的音
    if (this.combo % 3 === 0) SFX.coin(this.combo / 3);

    this.world.scene.remove(s.mesh);
    s.alive = false;
  }

  _updateAir(dt, t) {
    this.airT += dt;
    // 枪械：冷却 / 换弹 / 预热 / 过热全在这里推进，连发枪的开火也在这里发生
    this._updateGun(dt);
    // 榴弹枪（批 4）：推进引信 —— 到点才炸。放在开火之后，同一帧新挂上的弹不会立刻炸。
    this._updateLobs(dt);

    // 天空目标（海鸟 / 飞机 / UFO）：刷新 + 飞行 + 中弹翻滚，见 _spawnSky / _updateSky
    this._updateSky(dt);

    // 空中鱼
    for (const f of this.airFish) {
      if (f.state !== FISH_STATE.AIR) continue;
      if (f.knockT > 0) f.knockT -= dt;      // 逐鱼的上顶冷却（见 _applyDamage）
      f.update(dt, t, this.world.viewRange());
      if (f.mesh.position.y > this.maxAltReached) this.maxAltReached = f.mesh.position.y;
      if (f.mesh.position.y <= WORLD.surfaceY) {
        // 落回水里 → 逃走
        this.run.escaped.push(f.def.name);
        // 入水水花分级（批 6 特效 #8）：身价越高水花越大（6 ~ 34）——
        // 接口本来就有  参数，所以只是"把身价映射过去"，不新增粒子系统。
        const splashN = Math.round(6 + Math.min(28, f.value / 190 * 28));
        this.world.burstSplash(f.mesh.position.x, WORLD.surfaceY, splashN);
        this.ui.floatText(f.mesh.position.x, WORLD.surfaceY + 18 * MODEL_SCALE, '逃走了', 'bad sm');
        SFX.escape();
        f.kill();
      }
    }
    this.airFish = this.airFish.filter((f) => f.state === FISH_STATE.AIR);
    // ⚠ airClearT 计的是「场上没有可打的鱼之后过了多久」，airT 计的是「空中阶段总共多久」。
    //   两者混用会让"打完最后一条鱼"和"进空中阶段 0.9s"撞车 —— 见下面的结算判定。

    // 结算判定。
    // ⚠ **只数鱼**：天空目标（海鸟 / 飞机 / UFO）是加分项，**不拦结算**。
    //   历史事故：早先这里把「还有飞鸟在场」也算进未完成条件 —— 鸟只要还在屏幕上就永远不结算，
    //   玩家只能干等 20 多秒。这条口径（只数鱼）从那次修复起就没变过，加飞机 / UFO 时也守着它。
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
      } else if (this.airT > this.airTimeout) {
        // ⚠ v0.8：从常量 `TUNING.airTimeout` 改成实例字段 —— 它现在随「耐压舱」等级变
        //   （第 8 项升级，见 applyUpgrades）。这里每帧读一次字段，不再读 config。
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
   * ⚠ **例外**：**中过弹**的天空目标优先级更高（它正在翻滚下坠，最该补枪）——
   *   见下面 `engaged` 那一段。没中弹的天空目标不抢镜头。
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

    // ── 天空目标：**中过弹的优先** ──
    // 需求原文："打中天上的物品则这些物品变成和鱼一样会旋转，镜头会跟随"。
    // 所以只要有一个天空目标中过弹（`engaged`），镜头就切过去咬住它 ——
    // 它正在翻滚下坠，是最该补枪的那个；打光了 / 掉出画面之后自然回到鱼身上。
    // ⚠ **没中过弹的天空目标不抢镜头**：它们只是路过，抢镜头只会让画面在结算前乱甩。
    let skyX = null, skyY = null, skyVx = 0, skyVy = 0;
    for (const s of this.sky) {
      if (!s.alive || !s.engaged) continue;
      const p = s.mesh.position;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (skyY === null || p.y < skyY) {
        skyX = p.x; skyY = p.y;
        skyVx = s.tumbling ? s.vx : s.dir * s.speed;
        skyVy = s.tumbling ? s.vy : 0;
      }
    }
    if (skyY !== null) {
      return {
        x: clamp(skyX + skyVx / (rate * 0.75), -640, 640),
        y: skyY + skyVy / rate + viewH * TUNING.airCamFollowBias,
        scale, rate,
      };
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
    this._syncSms();
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
    for (const s of this.sky) this.world.scene.remove(s.mesh);
    this.sky = [];

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
    const deepest = -(mapMaxDepth(this.map) - 12 * MODEL_SCALE);

    // ── Boss（批 7）：带 `bossWhen` 的鱼**不进普通鱼池** ──
    // 它只在满足条件时出现（见 `_checkBossTrigger`），所以先单独收起来。
    // ⚠ 不带 `bossWhen` 的 Boss（首图的黄金鱼王）**照常进池** —— 它是"这张图的大鱼"，
    //   不是"藏着的那条"。两张图两种定位，不要一刀切。
    this.bossDefs = SPECIES.filter(
      (s) => s.bossWhen && s.zones.some((z) => zones.some((mz) => mz.id === z)),
    );
    this.boss = null;
    this._bossPhase = 0;

    for (const zone of zones) {
      const pool = SPECIES.filter((s) => s.zones.includes(zone.id) && !s.bossWhen);
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
    // 命中定格（批 6 特效 #1）：命中那一瞬间把世界**放慢到 5%**，持续 0.04~0.12s。
    // ⚠ 只压 dt，不暂停渲染 —— 画面照画，只是世界走得慢（那才是"顿一下"的手感）。
    // ⚠ 用  而不是 ：连续命中时取**最长**的那次，不会被后一枪缩短。
    if (this.hitStopT > 0) { this.hitStopT -= dt; dt *= TUNING.hitStopScale; }
    const st = this.state;
    const vh = this.world.viewH;
    // 所有相机锚点都按可见高度取比例，保证不同屏幕比例下的画面构图一致
    const anchor = (r) => WORLD.surfaceY + vh * r;
    let cam = { x: 0, y: anchor(CAMERA.shopAnchor), rate: 2.5, scale: 1 };

    // ── 状态逻辑 ──
    // 深度氛围（批 6 特效 #11）：越深 vignette 越重。
    // ⚠ 只在变化超过 2% 时才写 DOM —— 每帧写 style 会让浏览器每帧重算样式。
    {
      const d01 = Math.min(1, Math.max(0, -this.hook.y / Math.max(1, mapMaxDepth(this.map))));
      if (Math.abs(d01 - (this._vig01 || 0)) > 0.02) { this._vig01 = d01; this.ui.setVignette(d01); }
    }

    // ── 海妖之歌（批 8b）──────────────────────────────────
    // 只有  的图有。**它一直走，不挑状态** —— 那是"节拍"的定义。
    if (this.map && this.map.hook === 'siren') {
      this.sirenT -= dt;
      if (this.sirenOnT > 0) this.sirenOnT -= dt;
      if (this.sirenT <= 0) {
        this.sirenT = SIREN.period;
        this.sirenOnT = SIREN.duration;
        this.world.burstRing(this.hook.x, this.hook.y, SIREN.ring, 0x8fb4e8);
        this.world.addShake(6);
        this.ui.setHint('海妖之歌 —— 鱼群正在靠近');
        // 20% 概率把 Boss 招来：这是"机会"的另一半，玩家得有取舍
        if (Math.random() < SIREN.bossChance) this._sirenBoss();
      }
    }

    if (st === STATE.DESCEND) {
      // Boss 出场检查（批 7）：只在"从更深处升上来"这件事说得通的下潜阶段调
      this._checkBossTrigger();
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
        // ⚠ 沉船格子（批 8）：**刹停这一段也要免疫** —— 它同样是"下潜撞鱼"。
        //   只挡主循环的话，从格子外撞进来、带着刹车滑进格子的那一下还是会被串走。
        const bumpPre = this.bumpRadius;
        for (const f of this.fish.active) {
          if (this._inWreckCell()) break;
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
        // 沉船格子（批 8）：钩子在格子里时**免疫下潜撞鱼** —— 这是这个机制的全部价值。
        if (this.dropGraceT <= 0 && !this._inWreckCell()) {
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
    // 行为模式（批 7）要读鱼钩在哪 —— 鱼不自己去找钩子（那样鱼就得认识 game），
    // 所以由这一层把坐标喂进去。一个对象复用，避免每帧为每条鱼新建。
    // ⚠  是"这一帧歌声在不在"—— 鱼按它决定要不要朝钩子游
    const ctx = { x: this.hook.x, y: this.hook.y, siren: this.sirenOnT > 0 };
    for (const f of this.fish.active) {
      if (f.immuneT > 0) f.immuneT -= dt;      // 被鱼护挤下来的鱼的免疫计时
      if (f.state === FISH_STATE.AIR) continue;
      f.update(dt, this.time, view, ctx);
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
// ── 原型挂载 ──────────────────────────────────────────────
/**
 * 把 mixin 类里的方法逐个挂到 `Game.prototype` 上。
 *
 * ⚠⚠ 必须用 `defineProperty`：**类方法是不可枚举的**，`Object.assign` 一个都拷不过来，
 *   而且会**静默**什么都不做 —— 正是这个项目最怕的那种失效。
 * ⚠ 跳过 `constructor`，否则 Game 的构造函数会被顶掉。
 * ⚠ 第二条静默失效：**同名方法会被这里悄悄覆盖**（`Object.defineProperty` 能改写已存在的属性）。
 *   所以"搬走的方法在 game.js 里还留着定义"必须当成错误 —— 搬迁脚本里有断言挡它。
 */
function mountMixin(cls) {
  for (const k of Object.getOwnPropertyNames(cls.prototype)) {
    if (k === 'constructor') continue;
    Object.defineProperty(Game.prototype, k, Object.getOwnPropertyDescriptor(cls.prototype, k));
  }
}

// 剧情驱动（来电 / 短信 / 电台 / 过场 / 注脚）→ src/narrative.js
mountMixin(Narrative);
// 航线（地图 / 海图 / 船厂 / 海床宝箱）→ src/voyage.js
mountMixin(Voyage);
// 枪械（枪店 + 开火管线）→ src/guns.js
mountMixin(Guns);

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
