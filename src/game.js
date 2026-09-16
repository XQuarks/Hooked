/**
 * game.js — 主循环 + 状态机
 *
 *   TITLE ─▶ IDLE ─▶ DESCEND ─▶ ASCEND ─▶ AIR ─▶ RESULT ─┐
 *             ▲   │                                        │
 *             │   └─▶ PHONE（手机：商店 / 图鉴 / 设置三个 App）│
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
  UPGRADES, UPGRADE_ORDER, MAX_LEVEL, levelCapForMap, upgradeCost, SAVE_KEY, altitudeAt,
  DEFAULT_MAP, MAPS, mapById, mapMaxDepth, zoneAtDepth, zonesOfMap,
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
 * 声呐刻度上"值得为它再往下放一段"的身价门槛（金色刻度）。
 * 和 _catch() 里飘字用金色高亮的门槛是同一个数 —— 两处不一致的话，
 * 玩家会看到声呐标金、勾上来却不是金色，那种不一致比没有高亮更糟。
 */
const SONAR_HOT_VALUE = 120;

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
        s.levels[k] = clamp(Math.round(Number(raw.levels?.[k]) || 0), 0, MAX_LEVEL);
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
    this.ui.setMap(this.map);
    this.input = new Input(this.canvas);

    this.state = STATE.TITLE;
    this.phoneOpen = false;                // 手机是否展开（不占用 state，世界照常在 IDLE 跑）
    this.time = 0;
    this.timeScale = 1;
    this.slowmoT = 0;
    this.fireCd = 0;
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
    this.descendSpeed = TUNING.descendSpeed(this.save.levels.sinker);
    // 下面 4 项由 applyUpgrades() 统一赋值，这里先给个初值免得 applyUpgrades 之前被读到
    this.ascendSpeed = TUNING.ascendSpeed(this.save.levels.winch);
    this.creelLimit = TUNING.creelLimit(this.save.levels.creel);
    this.bumpRadius = TUNING.bumpRadiusAt(this.save.levels.rig);
    this.pufferPenalty = TUNING.pufferPenaltyAt(this.save.levels.insurance);
    this.sonarPct = TUNING.sonar(this.save.levels.sonar);
    this.baitBonus = TUNING.bait(this.save.levels.bait);
    this._sonarT = 0;                      // 声呐刻度的刷新节流（不用每帧重建 DOM）
    // 浮冰减速剩余时间（冰封极地）。> 0 时下潜速度乘 ICEBERG.slowScale ——
    // 撞浮冰的代价是"这一段变慢"，不是"这一竿结束"（和撞鱼区分开）。
    this.iceSlowT = 0;
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
   * 11 项升级在这里一次性落到 game 实例上，**不要在下潜/上升的循环里现查 LEVELS** ——
   * 那样每帧要读 11 次表，而且"哪一项在哪生效"会散得满代码都是。
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
    this.descendSpeed = TUNING.descendSpeed(L.sinker);
    this.ascendSpeed = TUNING.ascendSpeed(L.winch);          // 绞盘
    this.creelLimit = TUNING.creelLimit(L.creel);            // 鱼护
    this.bumpRadius = TUNING.bumpRadiusAt(L.rig);            // 加固
    this.pufferPenalty = TUNING.pufferPenaltyAt(L.insurance); // 保险
    this.baitBonus = TUNING.bait(L.bait);                    // 鱼饵（spawnFish 抽签时用）
    this.sonarPct = TUNING.sonar(L.sonar);                   // 声呐（0~1，深度尺上画探测带）
    this.hook.setRadius(TUNING.hookRadius(L.hook));
    this.world.setLamp(L.lamp);
    this.ui.setLineLimit(this.maxDepth);
    this.ui.setSonar(this.sonarPct);                         // 声呐
  }

  // ── 一局数据 ─────────────────────────────────────────────
  _resetRun() {
    this.caught = [];
    this.run = {
      caught: 0, lost: 0, shot: 0, earned: 0,
      bestCombo: 0, depth: 0, alt: 0, escaped: [], birds: 0,
    };
    this.combo = 0;
    this.mult = 1;
    this.maxDepthReached = 0;
    this.maxAltReached = 0;
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
        this._fireAt(nx, ny);
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
    // 手机入口：商店 / 图鉴 / 设置 三个 App 都在这台手机里
    el.phoneBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.state === STATE.IDLE && !this.phoneOpen) { SFX.tap(); this.openPhone(); }
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
  /** 打开手机：世界继续按 IDLE 跑，只是把抛竿输入和底部入口收起来 */
  openPhone() {
    if (this.state !== STATE.IDLE || this.phoneOpen) return;
    this.phoneOpen = true;
    this.ui.showPhoneBtn(false);
    this.ui.setHint('');
    this.ui.openPhone(this.save, this._phoneHandlers());
  }

  closePhone() {
    if (!this.phoneOpen) return;
    this.phoneOpen = false;
    this.ui.closePhone();
    if (this.state === STATE.IDLE) {
      this.ui.showPhoneBtn(true);
      this.ui.setHint('点击屏幕 · 抛竿下潜');
    }
  }

  /** 手机里各 App 的回调，全部回到 game 这一层执行 */
  _phoneHandlers() {
    return {
      tap: () => SFX.tap(),
      cast: () => { SFX.tap(); this.closePhone(); this.enterDescend(); },
      buy: (k) => this._buy(k),
      mapList: () => MAPS.map((m) => this.mapProgress(m)),
      goMap: (id) => this._goMap(id),
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

  /**
   * 某张地图的换图进度 —— 三个条件一次算清，界面和逻辑共用同一个来源。
   *
   *   ① 图鉴 ≥ 75%：逼玩家真的把这张图玩透（去不同深度、钓不同的鱼）
   *   ② 潜到过本图上限：免费（鱼线升到本图闸门就自然满足），但让"潜到底"成为明确目标
   *   ③ 付许可证金币：辅助条件，作用是"让换图有一点成本感"，不是主要门槛
   *
   * 为什么不用"金币够了就能走"：纯金币门槛是线性的，而玩家收入被深度封顶卡住，
   * 最后一张图前面要刷 1000+ 竿 —— 那会把游戏变成纯肝（见 EXPANSION 3.3）。
   */
  mapProgress(map) {
    const mine = SPECIES.filter((s) => s.zones.some((z) => map.zones.includes(z)));
    const got = mine.filter((s) => (this.save.codex[s.id]?.n || 0) > 0).length;
    const ratio = mine.length ? got / mine.length : 1;
    const maxD = mapMaxDepth(map);
    const reached = Math.min(this.mapBestOf(map.id), maxD);
    const owned = map.license <= 0 || this._licenses().includes(map.id);
    return {
      map, owned, maxD, reached,
      depthOk: reached >= maxD,
      codex: got, codexTotal: mine.length, codexRatio: ratio, codexOk: ratio >= 0.75,
      price: map.license, affordable: this.save.coins >= map.license,
      canBuy: !owned && ratio >= 0.75 && reached >= maxD && this.save.coins >= map.license,
    };
  }

  /** 买下某张地图的许可证并进去。条件不够 / 买不起返回 false，调用方负责提示。 */
  buyMap(id) {
    const map = mapById(id);
    const p = this.mapProgress(map);
    if (p.owned) return this.enterMap(id);
    if (!p.canBuy) return false;
    this.save.coins -= map.license;
    this._licenses().push(map.id);
    return this.enterMap(id);
  }

  /**
   * 换到某张已拥有的地图：清场、换世界主题、刷新尺子总量与界面。
   *
   * 顺序有讲究：`world.applyMap` / `ui.setMap` 必须在 `spawnFish` 之前 ——
   * 刷鱼读的是 `this.map`（存档已经改了，没问题），但尺子的总量和分区
   * 要等 ui.setMap 之后才对齐，`refreshApp` 又必须在 ui.setMap 之后。
   */
  enterMap(id) {
    const map = mapById(id);
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
    return true;
  }

  /**
   * 「航线」App 里的按钮回调：当前图 → 忽略；已拥有 → 直接过去；
   * 条件满了 → 扣钱买证并过去；否则 → 拒绝音效。
   * 界面那边已经按同样的条件把按钮置灰了，这里再判一次是防"数据在两次渲染之间变了"。
   */
  _goMap(id) {
    const map = mapById(id);
    if (map.id === this.map.id) return;
    const p = this.mapProgress(map);
    if (p.owned) { SFX.tap(); this.enterMap(map.id); return; }
    if (!p.canBuy) { SFX.deny(); this.world.addShake(2); return; }
    SFX.buy();
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
    if (lv >= MAX_LEVEL) return;
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

  // ── ① 下潜（鱼是障碍） ────────────────────────────────────
  enterDescend() {
    this.state = STATE.DESCEND;
    this._resetRun();
    this.spawnFish();
    this.ui.hideOverlay();
    this.ui.showHud(true);
    this.ui.showPhoneBtn(false);
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
  _updateAscend(dt) {
    const prevY = this.hook.y;
    const prevX = this.hook.x;
    // ── 回拉起步缓动（v0.3.1 需求③）──
    // 位置曲线 y(u) = y0 + D·(3u³ − 2u²)：
    //   起手速度 0（接住前面刹停的"静止"）、末端速度 5D/T（接上满速上拉），
    //   中间在 u ≈ 0.44 处**先往下沉 13%·D** —— 这就是 anticipation，
    //   也是"easeInBack 的感觉"的来源。令末端速度 = ascendSpeed 得 D = ascendSpeed·T/5。
    // ⚠ 直接置 state='ascend' 的夹具（verify5 C8）不走 _beginAscend，
    //   ascendRampT ≤ 0，会直接落到下面的满速分支 —— 那些断言因此不受影响。
    if (this.ascendRampT > 0) {
      this.ascendRampT -= dt;
      const T = TUNING.ascendRamp;
      const u = clamp(1 - Math.max(0, this.ascendRampT) / T, 0, 1);
      const D = (this.ascendSpeed * T) / 5;
      this.hook.y = this.ascendFrom + D * u * u * (3 * u - 2);
    } else {
      this.hook.y += this.ascendSpeed * dt;    // 绞盘升级直接作用在这里
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

    // 出水
    if (this.hook.y >= WORLD.surfaceY - 2 * MODEL_SCALE) this.enterAir();
  }

  /**
   * 串上一条鱼。
   *
   * 鱼护（creel）在这里生效：**超过上限时，最早串上的那条会挣脱**（而不是"新鱼串不上"）。
   * 为什么选"挤掉最老的"：它把鱼护从一个"硬上限"变成了一个**取舍** ——
   * 上升途中你会看着一串 66 的灯笼鱼，犹豫要不要为下面那条 260 的皇带鱼腾位置。
   * 硬上限只会让人挫败（"我看到了却抓不了"），挤掉最老的才会产生决策。
   */
  _catch(f) {
    // 鱼护满 → 最早的那条挣脱（放回水里，横向推开一点 + 1.2s 免疫，免得同一帧又被扫回来）
    if (this.caught.length >= this.creelLimit) {
      const old = this.caught.shift();
      const p0 = old.mesh.position;
      const away = p0.x < this.hook.x ? -1 : 1;
      old.release(p0.x + away * 30, p0.y);
      old.immuneT = 1.2;
      this.run.lost += 1;
      this.ui.dropFirstCatch(this.caught.length);
      this.world.burstBubbles(p0.x, p0.y, 8, 12);
      this.ui.floatText(p0.x, p0.y + 14 * MODEL_SCALE, `${old.def.name} 挣脱了`, 'bad sm');
      SFX.escape();
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

  /** 记入图鉴：首次钓到才算「解锁」，之后只累加次数与最高身价 */
  _recordCodex(f) {
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
    this.ui.setHint('点击屏幕任意位置引爆');
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
    this.fireCd = 0;
    this.combo = 0;
    this.mult = 1;
    this.maxAltReached = 0;
    this.ui.setCombo(0, 1);

    // 慢动作：制造"哇"的一瞬
    this.timeScale = TUNING.slowmoScale;
    this.slowmoT = TUNING.slowmoTime;
  }

  /**
   * 点击处爆炸。
   * 判定跟任何枪口位置无关 —— 爆炸就发生在玩家点的那个世界坐标上，
   * 所以手机上不会出现「手指挡住枪口」的问题。
   * 屏幕下方也不再画武器外观：命中反馈就是那圈冲击波本身。
   */
  _fireAt(nx, ny) {
    if (this.state !== STATE.AIR || this.fireCd > 0) return;

    const w = this.world.screenToWorld(nx, clamp(ny - 0.045, 0, 1));
    if (!Number.isFinite(w.x) || !Number.isFinite(w.y)) return;

    const lv = this.save.levels.power;
    this.fireCd = TUNING.fireCooldown;

    SFX.shot();
    this.world.addShake(4.5);

    const radius = TUNING.blastRadius(lv);
    const dmg = TUNING.damage(lv);
    this.world.burstExplosion(w.x, w.y, radius);

    let hitAny = false;
    for (const f of this.airFish) {
      if (f.state !== FISH_STATE.AIR) continue;
      const p = f.mesh.position;
      const d = Math.hypot(p.x - w.x, p.y - w.y);
      // 爆炸圈就是判定圈：只要圈碰到鱼身，就是满额伤害。
      // （不做距离衰减 —— 否则 1 级打不死 1 血小鱼，手感会非常别扭）
      if (d > radius + f.radius) continue;
      hitAny = true;
      if (f.damage(dmg) <= 0) {
        this._hitFish(f);
      } else {
        // 中弹没死 → 再往天上顶一段（需求④）。
        // 血越厚顶得越高，顺便告诉玩家"还差几枪"，免得以为打中了没反应。
        f.knockUp(TUNING.knockUpBase + f.hp * TUNING.knockUpPerHp, 0);
        this.world.burstSparks(p.x, p.y, 6, 0.7);
        const shots = Math.max(1, Math.ceil(f.hp / dmg));
        this.ui.floatText(p.x, p.y + 10 * MODEL_SCALE, `还差 ${shots} 枪`, 'sm');
      }
    }
    if (hitAny) this.world.addShake(2.2);
  }

  _hitFish(f) {
    const p = f.mesh.position;

    if (f.def.hazard) {
      // 扣钱鱼：爆炸扣钱。
      // 金币不会扣成负数；本竿收入按「实际扣掉的数额」记，
      // 否则身上没钱时两个账对不上（结算显示的收入会莫名其妙少一截）。
      // 罚款由「保险」减免（Lv20 减 80%，30 → 6）。
      this.combo = 0; this.mult = 1;
      const fine = this.pufferPenalty;
      const before = this.save.coins;
      this.save.coins = Math.max(0, before - fine);
      this.run.earned -= before - this.save.coins;
      this.world.burstChunks(p.x, p.y, 22);
      this.world.burstSparks(p.x, p.y, 26, 1.6);
      this.world.addShake(16);
      const saved = TUNING.pufferPenalty - fine;
      this.ui.floatText(p.x, p.y,
        saved > 0 ? `${f.def.name} −${fine}（保险省 ${saved}）` : `${f.def.name} −${fine}`, 'bad');
      this.ui.setCombo(0, 1);
      this.ui.setCoins(this.save.coins);
      SFX.puffer();
      f.kill();
      return;
    }

    this.combo += 1;
    this.mult = this.multOfCombo;
    this.run.bestCombo = Math.max(this.run.bestCombo, this.combo);

    const gain = Math.max(1, Math.round(f.value * this.mult));
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
    if (this.fireCd > 0) this.fireCd -= dt;
    this.airT += dt;

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
    this.ui.setCombo(0, 1);
    this.ui.setHint('');
    this.ui.setCatchVisible(false);
    this.ui.setRulerVisible(false);
    this.ui.setZone(null);
    for (const b of this.birds) this.world.scene.remove(b.mesh);
    this.birds = [];
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

  /**
   * 声呐的输入：场上所有**还在游**的鱼的深度（米，正数）。
   * 只报游动中的 —— 已经串上鱼线的、正被拖出水面的、飞在空中的都不该出现在尺子上，
   * 否则尺子会变成"我已经钓到了什么"的回执，而不是"下面还有什么"的雷达。
   */
  _sonarDepths() {
    const out = [];
    for (const f of this.fish.active) {
      if (f.state !== FISH_STATE.SWIM) continue;
      out.push({ d: -f.mesh.position.y, hot: f.value >= SONAR_HOT_VALUE });
    }
    return out;
  }

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
        // 判定半径的基准是固定值（TUNING.bumpRadius），不跟着鱼钩等级涨 ——
        // 否则升级鱼钩会让下潜变得寸步难行，等于花钱买罪受。
        // 想让下潜更从容 → 单独买「加固」（this.bumpRadius = 基准 × (1 - rig)）。
        const bump = this.bumpRadius;
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
            this._reel('bump', dspd);
            break;
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
      // 第三个参数是鱼钩**当前**深度 —— 声呐探测带跟着它走，而不是跟着"已潜最深"。
      this.ui.setDepth(this.maxDepthReached, this.maxDepth, -this.hook.y);
      // 声呐刻度：0.15s 刷一次就够（每帧重建 DOM 是纯浪费），0 级时整个调用是空转
      if (this.sonarPct > 0) {
        this._sonarT -= dt;
        if (this._sonarT <= 0) {
          this._sonarT = 0.15;
          this.ui.setSonarBlips(this._sonarDepths());
        }
      }
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
