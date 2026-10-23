import { BOTTLES, MAPS, MapId, SPECIES, Species, WeatherId, Weapon, bandAt, rollWeather, speciesById, weatherById, weatherWeight } from './data';
import { Quality } from './state';
import { Stage2D as Stage } from '../two/stage2d';
import { World2D as World, BottleSprite } from '../two/world2d';
import { FishFactory, FishSprite as FishMesh } from '../two/fish2d';
import { FX } from '../two/fx2d';
import { CAM_LEAD, Vec3 } from '../two/core';
import { sfx } from './audio';

export const XW = 3.45;

/** 空中重力（m/s²）。比真实弱一截：鱼飞得高、滞空久，最高能被顶到太空看地球 */
const AIR_G = 9.2;
/** 空中阶段的硬顶（秒）：打不完也不让玩家干等 */
const AIR_TIMEOUT = 18;
/** 抛竿：空中重力（水平初速与滞空时间在出手时一次算好，见 updateCast） */
const CAST_G = 16;

export type Phase = 'idle' | 'cast' | 'descent' | 'turn' | 'ascent' | 'shoot';

export interface SceneConfig {
  map: MapId;
  hat: string;
  legend: boolean;
  weather: WeatherId;
}

export interface TripConfig extends SceneConfig {
  maxDepth: number;
  hookCap: number;
  saw: number;
  lamp: number;
  fin: number;
  weapon: Weapon;
  aim: number;
  slow: number;
  moneyMult: number;
  jellyMult: number;
  speedMult: number;
  hotFish: string;
  bottlesHave: string[];
  hints: Record<string, boolean>;
}

export interface TripResult {
  kills: Record<string, number>;
  gross: number;
  penalty: number;
  bonus: number;
  earned: number;
  depth: number;
  bottles: string[];
  hooked: number;
  lost: number;
  jellyHits: number;
  legend: boolean;
  maxCombo: number;
  /** 天空目标（鸟/飞机/UFO）打下来的收入，已计入 gross */
  skyGain: number;
  map: MapId;
}

export interface HudState {
  phase: Phase;
  depth: number;
  maxDepth: number;
  hooked: number;
  cap: number;
  saw: number;
  combo: number;
  mult: number;
  heat: number;
  overheated: boolean;
  estimate: number;
  band: string;
  airLeft: number;
  airValue: number;
  /** 已经打死的收益，HUD 上把它和钩上的、空中的加在一起显示，数字才不会往回掉 */
  gross: number;
  lamp: number;
  dark: boolean;
  abort: number;
}

export interface EngineOpts {
  quality: Quality;
  onHud: (h: HudState) => void;
  onEnd: (r: TripResult) => void;
  onBanner: (b: { text: string; sub?: string; color?: string }) => void;
  onHint: (k: string) => void;
  /** 钩子砸进水面的瞬间（用于全屏水花遮罩，掩盖水下/水上切换） */
  onSplash?: () => void;
  /** 局内变天：天气在下一潜途中换了，通知上层写回存档 */
  onWeather?: (w: WeatherId) => void;
}

interface PlanFish {
  sp: Species;
  depth: number;
  x: number;
  z: number;
  dir: number;
  speed: number;
  group: number;
}

interface Fish extends PlanFish {
  mesh: FishMesh | null;
  caught: boolean;
  dead: boolean;
  dartT: number;
  darting: number;
  x: number;
}

interface AirFish {
  sp: Species;
  mesh: FishMesh;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  hp: number;
  delay: number;
  /** 被击飞时的挤压回弹（1 → 0 衰减） */
  squash: number;
  /** 原始缩放倍率（fish2d 的 draw 会再乘体长，这里只存倍率，别存米数） */
  baseScale: number;
  /** 挨了几枪（第二枪要弹得更高） */
  hits: number;
  /** 顶飞冷却：连发枪每秒十几发，不节流会把速度叠到失控 */
  knockT: number;
  /** 刚刚被击中的余温：>0 时镜头优先跟它，玩家连击能把鱼一路送上天 */
  focusT: number;
  state: 'fly' | 'lost';
  life: number;
}

/** 天空目标：不属于渔获，打下来是加分项，也不拦结算 */
export type SkyKind = 'bird' | 'plane' | 'ufo';

export interface SkyActor {
  kind: SkyKind;
  x: number;
  y: number;
  vx: number;
  hp: number;
  maxHp: number;
  value: number;
  size: number;
  t: number;
  hitT: number;
}

const SKY_META: Record<SkyKind, { hp: number; value: number; speed: number; size: number; lift: number; weight: number }> = {
  bird: { hp: 2, value: 60, speed: 3.4, size: 0.42, lift: 1.2, weight: 6 },
  plane: { hp: 6, value: 260, speed: 4.6, size: 0.8, lift: 3.2, weight: 3 },
  ufo: { hp: 12, value: 800, speed: 2.6, size: 0.62, lift: 5.2, weight: 2 },
};

interface BottleActor {
  id: string;
  x: number;
  y: number;
  z: number;
  taken: boolean;
  group: BottleSprite;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Engine {
  stage: Stage;
  world: World;
  fx: FX;
  factory: FishFactory;
  opts: EngineOpts;

  scene: SceneConfig = { map: 'bay', hat: 'straw', legend: false, weather: 'clear' };
  cfg: TripConfig | null = null;
  phase: Phase = 'idle';
  paused = false;

  t = 0;
  raf = 0;
  last = 0;

  lure = { x: 0.9, y: 0, vy: 0, vx: 0 };
  targetX = 0.9;
  focusY = 0.6;
  camShake = { x: 0, y: 0, mag: 0 };
  /** 命中定格：这段时间里世界 dt 被压到 5%，只压时间不暂停渲染 */
  hitStopT = 0;
  /** 出水慢动作的剩余时间：鱼破水那一瞬把时间拉慢，纯表演 */
  slowT = 0;

  fishes: Fish[] = [];
  plan: PlanFish[] = [];
  hooked: Fish[] = [];
  air: AirFish[] = [];
  bottles: BottleActor[] = [];

  pointer = { x: 0, y: 0, down: false, type: 'mouse' };
  dragStart = { x: 0, target: 0.9, active: false };
  aim = new Vec3();
  pending = false;
  cooldown = 0;
  heat = 0;
  overheatT = 0;
  shots = 0;
  comboStack = 0;
  comboT = 0;
  saw = 0;
  turnT = 0;
  /** 刹停段：时长 / 起点 / 滑行距离。带着下潜速度滑出去再停，不是急刹 */
  turnDur = 0.5;
  turnFromY = 0;
  turnDrop = 0;
  /** 起拉段：用 3u³-2u²，起手速度 0、中间先沉 13%、末端接满速 */
  ascRampT = 0;
  ascRampDur = 0.6;
  ascFromY = 0;
  ascRampD = 0;
  endT = 0;
  /** 空中阶段已经过了多久（硬顶用） */
  airT = 0;
  /** 空中镜头的横向目标 */
  camX = 0;
  /** 上一次检查变天的深度 */
  weatherAt = 0;
  /** 天空目标（鸟/飞机/UFO）：只加分，不拦结算 */
  sky: SkyActor[] = [];
  skyT = 0;
  /** 抛竿阶段用时（秒），用于甩杆/飞行/入水的时间轴 */
  castT = 0;
  /** 入水后的相机过渡进度 0→1 */
  castBlend = 0;
  /** 抛竿入水的水花只触发一次 */
  castSplash = false;
  /** 钩子是否已经离开杆尖（出手） */
  castLaunched = false;
  /** 入水那一刻的 castT，用来算「入水后多久切下潜」 */
  castSplashT = 0;
  /** 本局是否已经提示过「快撞鱼了」 */
  warnedNear = false;
  /** 抛竿起点（杆尖在世界中的位置快照） */
  castFromX = 2.6;
  castFromY = 2.5;
  maxDepthReached = 0;
  abortHold = 0;
  abortDown = false;


  res: TripResult;
  hudTimer = 0;

  private ro: ResizeObserver;
  /** resize 合并定时器：手机上地址栏收缩会连发好几次回调 */
  private roT = 0;
  private disposed = false;
  private lastAbove = false;

  constructor(container: HTMLElement, opts: EngineOpts) {
    this.opts = opts;
    this.stage = new Stage({ container, quality: opts.quality });
    this.world = new World(this.stage, MAPS.bay);
    this.stage.attachWorld(this.world);
    this.fx = new FX();
    this.stage.setFx(this.fx);
    this.factory = new FishFactory(this.stage);
    this.world.setHat('straw');
    this.world.lure.visible = true;

    this.res = this.emptyResult('bay');

    const el = this.stage.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);

    // 合并连续回调：重建 canvas 位图在手机上要 5~30ms，连发会卡一下
    this.ro = new ResizeObserver(() => {
      window.clearTimeout(this.roT);
      this.roT = window.setTimeout(() => this.stage.resize(), 80);
    });
    this.ro.observe(container);

    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  emptyResult(map: MapId): TripResult {
    return { kills: {}, gross: 0, penalty: 0, bonus: 0, earned: 0, depth: 0, bottles: [], hooked: 0, lost: 0, jellyHits: 0, legend: false, maxCombo: 0, skyGain: 0, map };
  }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.roT);
    this.ro.disconnect();
    const el = this.stage.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    this.factory.dispose();
    this.world.dispose();
    this.stage.dispose();
  }

  resize() {
    this.stage.resize();
  }

  setQuality(q: Quality) {
    this.stage.setQuality(q);
  }

  setScene(s: SceneConfig) {
    this.scene = s;
    // 岸边也要立刻显示当前天气：以前只在 startTrip 里 setWeather，
    // 结果 HUD 写着「雷雨」、画面还是大晴天。
    this.stage.setWeather(s.weather);
    if (this.world.map.id !== s.map) {
      const hat = s.hat;
      this.world.dispose();
      this.world = new World(this.stage, MAPS[s.map]);
      this.stage.attachWorld(this.world);
      this.world.setHat(hat);
      this.world.lure.visible = true;
    }
    // 换图 / 换天气都要同步浪高（同图换天气时世界不会重建）
    this.world.setSea((weatherById[s.weather] ?? weatherById.clear).wave);
    this.world.setHat(s.hat);
  }

  /** 只换天气，不动世界（岸边切天气时用） */
  setWeather(id: WeatherId) {
    this.scene = { ...this.scene, weather: id };
    this.stage.setWeather(id);
    const w = weatherById[id] ?? weatherById.clear;
    this.world.setSea(w.wave);
  }

  setPaused(p: boolean) {
    this.paused = p;
    this.pointer.down = false;
    this.abortDown = false;
  }

  /** 直接回到岸边（放弃本局，不结算） */
  stop() {
    this.phase = 'idle';
    this.cfg = null;
    this.hooked = [];
    this.air = [];
    this.comboStack = 0;
    this.comboT = 0;
    this.heat = 0;
    this.overheatT = 0;
    this.abortHold = 0;
    this.abortDown = false;
    this.factory.releaseAll();
    this.clearBottles();
    this.fx.clear();
    this.lure = { x: 0.9, y: 0.2, vy: 0, vx: 0 };
    this.targetX = 0.9;
    this.focusY = 0.55;
    this.paused = false;
  }

  // ======================= 输入 =======================
  /** 调试快照（仅在 URL 带 #debug 时由 App 暴露到 window） */
  debugState() {
    return {
      phase: this.phase,
      weather: this.scene.weather,
      fish: this.plan.length,
      sea: Number(this.world.sea.toFixed(2)),
      aim: [Number(this.aim.x.toFixed(2)), Number(this.aim.y.toFixed(2))],
      focusY: Number(this.focusY.toFixed(2)),
      camY: Number(this.stage.camera.position.y.toFixed(2)),
      air: this.air.map((a) => ({
        sp: a.sp.id,
        x: Number(a.x.toFixed(2)),
        y: Number(a.y.toFixed(2)),
        hp: a.hp,
        delay: Number(a.delay.toFixed(2)),
        state: a.state,
      })),
      kills: this.res.kills,
      gross: this.res.gross,
      shots: this.shots,
    };
  }

  private localPoint(e: PointerEvent) {
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  onMove = (e: PointerEvent) => {
    const p = this.localPoint(e);
    this.pointer.x = p.x;
    this.pointer.y = p.y;
    this.pointer.type = e.pointerType || 'mouse';
    if (this.pointer.type !== 'mouse' && this.dragStart.active) {
      const dx = (p.x - this.dragStart.x) / this.stage.renderer.domElement.getBoundingClientRect().width;
      this.targetX = clamp(this.dragStart.target + dx * 12, -XW, XW);
    } else {
      const w = this.stage.screenToWorld(p.x, p.y);
      this.targetX = clamp(w.x, -XW, XW);
    }
    const wp = this.stage.screenToWorld(p.x, p.y);
    this.aim.set(wp.x, wp.y);
  };

  onDown = (e: PointerEvent) => {
    const p = this.localPoint(e);
    const wp = this.stage.screenToWorld(p.x, p.y);
    this.aim.set(wp.x, wp.y);
    this.pointer.down = true;
    this.pointer.type = e.pointerType || 'mouse';
    if (this.phase === 'shoot') {
      this.pending = true;
    } else if (this.phase === 'idle') {
      // 岸边点哪儿，钩子就往哪儿甩：落点由这一次点击的位置决定
      this.targetX = clamp(wp.x, -XW, XW);
    } else if (this.phase === 'cast') {
      this.targetX = clamp(wp.x, -XW, XW);
    } else if (this.phase === 'descent' || this.phase === 'ascent') {
      if (this.pointer.type === 'mouse') this.targetX = clamp(wp.x, -XW, XW);
      else {
        this.dragStart = { x: p.x, target: this.targetX, active: true };
      }
    }
  };

  onUp = () => {
    this.pointer.down = false;
    this.dragStart.active = false;
    this.abortDown = false;
  };

  onKey = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') this.targetX = clamp(this.targetX - 0.6, -XW, XW);
    if (k === 'arrowright' || k === 'd') this.targetX = clamp(this.targetX + 0.6, -XW, XW);
    if (k === ' ' && this.phase === 'shoot') this.pending = true;
  };

  onKeyUp = () => {};

  // ======================= 出海 =======================

  startTrip(cfg: TripConfig) {
    this.cfg = cfg;
    // 换图后第一次出海：确保世界/深度带也切过去（买票后不会重载页面）
    if (this.scene.map !== cfg.map) {
      this.setScene({ map: cfg.map, hat: cfg.hat, legend: cfg.legend, weather: cfg.weather });
    }
    this.stage.setWeather(cfg.weather);
    this.world.setSea((weatherById[cfg.weather] ?? weatherById.clear).wave);
    // 先进入「抛竿」过渡：甩杆 → 钩子飞出入水 → 相机跟着扎进水里，再接 descent
    this.phase = 'cast';
    this.castT = 0;
    this.castBlend = 0;
    this.warnedNear = false;
    this.castSplash = false;
    this.castLaunched = false;
    this.castSplashT = 0;
    this.res = this.emptyResult(cfg.map);
    this.saw = cfg.saw;
    this.hooked = [];
    this.air = [];
    this.comboStack = 0;
    this.comboT = 0;
    this.heat = 0;
    this.overheatT = 0;
    this.maxDepthReached = 0;
    this.abortHold = 0;
    this.turnT = 0;
    this.turnDrop = 0;
    this.airT = 0;
    this.camX = 0;
    this.weatherAt = 0;
    this.sky.length = 0;
    this.skyT = 1.2;
    this.ascRampT = 0;
    this.hitStopT = 0;
    // 起点就是杆尖：不要写死一个坐标，否则第一帧会「啪」地跳到杆尖上
    this.world.setRod(0);
    this.lure = { ...this.world.rodTip(), vy: 0, vx: 0 };
    // 保留 onDown 刚记下的落点，别在这里重置成中间
    this.focusY = 0.6;
    this.camShake.mag = 0;
    this.fx.clear();
    this.factory.releaseAll();
    this.clearBottles();
    this.spawn(cfg);
    this.world.setSaw(cfg.saw > 0);
    this.world.setHat(cfg.hat);
    sfx.click();
  }

  /** 抛竿过渡：0~0.20s 后仰蓄力，0.20~0.46s 前甩，0.40~0.86s 钩子抛物线入水，随后相机入水 */
  private updateCast(dt: number) {
    this.castT += dt;
    const t = this.castT;
    const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

    // 1) 甩杆姿态
    if (t < 0.2) {
      this.world.setRod(ease(t / 0.2) * 0.5); // 后仰蓄力
    } else if (t < 0.44) {
      this.world.setRod(0.5 - ease((t - 0.2) / 0.24) * 1.15); // 前甩，杆尖指向水面
    } else {
      this.world.setRod(-0.65 + ease(Math.min(1, (t - 0.44) / 0.55)) * 0.65); // 回弹到默认姿态
    }

    // 2) 钩子：跟着杆尖一起后仰蓄力，在杆尖「最高、刚开始前送」的一瞬出手。
    // 等到 0.32s 再放的话，杆尖已经往下扎，钩子会先向下再向上——就是玩家说的「弹」。
    if (t < 0.26) {
      const tip = this.world.rodTip();
      this.lure.x = tip.x;
      this.lure.y = tip.y;
      this.castFromX = tip.x;
      this.castFromY = tip.y;
    } else if (!this.castLaunched) {
      // 出手：一次算好整条抛物线，之后**不再中途修正**。
      // 之前每帧按「到落点的距离 ÷ 剩余滞空」重算水平速度，目标近时会在空中来回找，
      // 看起来像鱼钩在空中抽搐（用户说的「不合逻辑的弹动」）。
      this.castLaunched = true;
      const tx = clamp(this.targetX, -XW + 0.3, XW - 0.3);
      const dist = tx - this.lure.x;
      const h = Math.max(0.4, this.lure.y);
      // 滞空时间随距离增加，但收在 0.62~1.05s，手感统一
      const T = clamp(0.62 + Math.abs(dist) * 0.09, 0.62, 1.05);
      // 落点条件：h - (vy*T + 0.5*g*T²) = 0（vy 为正代表向下，见下面的积分）
      this.lure.vy = (h - 0.5 * CAST_G * T * T) / T;
      this.lure.vx = dist / T;
    } else if (!this.castSplash) {
      // 纯抛体：水平匀速、竖直匀加速，一条干净的弧
      this.lure.x = clamp(this.lure.x + this.lure.vx * dt, -XW + 0.3, XW - 0.3);
      this.lure.vy += CAST_G * dt;
      this.lure.y -= this.lure.vy * dt;

      if (this.lure.y <= 0.04 && this.lure.vy > 0) {
        this.lure.y = 0;
        this.castSplash = true;
        this.castSplashT = t;
        sfx.splash();
        this.opts.onSplash?.();
        this.fx.spawn(this.lure.x, 0.1, 0, { color: '#d6f4ff', n: 18, speed: 4.5, size: 0.55, life: 0.75, gravity: -9 });
        this.fx.ring(this.lure.x, 0.05, 0, '#cdefff', 0.25, 1.9, 0.45);
        this.camShake.mag = 2.5;
      }
    } else {
      // 入水后继续下沉
      this.lure.vy = Math.min(6, this.lure.vy + 16 * dt);
      this.lure.y -= this.lure.vy * dt;
      this.castBlend = Math.min(1, this.castBlend + dt * 3.4);
      if (Math.random() < dt * 8) this.fx.bubble(this.lure.x, this.lure.y, 0.2, 1);
    }

    // 3) 相机：先停在水面看船，滞空时跟着钩子上抬，入水后跟着沉下去
    if (t < 0.26) {
      this.focusY += (0.62 - this.focusY) * Math.min(1, dt * 6);
    } else if (!this.castSplash) {
      const target = Math.max(-0.6, this.lure.y - 2.4);
      this.focusY += (target - this.focusY) * Math.min(1, dt * 4.5);
    } else {
      // 镜头跟钩子一起下水。偏移量随深度慢慢拉开，
      // 不能在钩子还在空中时就把镜头按到水下三米——那一下看着像穿模。
      const target = this.lure.y - this.camOffset(Math.max(0, -this.lure.y));
      this.focusY += (target - this.focusY) * Math.min(1, dt * 5.5);
    }

    // 入水后 0.3 秒交给 descent；再加一道 2.8 秒的保险丝，防止极端情况下卡在 cast
    if ((this.castSplash && t > this.castSplashT + 0.3) || t > 2.8) {
      // 无缝交给 descent：此时相机已在钩子下方，且 above 已过渡为水下
      this.phase = 'descent';
      this.lure.vy = Math.max(this.lure.vy, 3);
      // 抛竿入水后不再弹任何文字（横幅 / 下潜提示都去掉），画面保持干净
    }
  }

  spawn(cfg: TripConfig) {
    this.plan = [];
    this.fishes = [];
    const map = cfg.map;
    // 天气影响刷新权重：群游/巡游/伏击/冲刺 + 稀有度
    const w = weatherById[cfg.weather] ?? weatherById.clear;
    const pool = SPECIES.filter((s) => s.map === map && (s.weight ?? 0) > 0);
    let d = 10;
    let group = 0;
    while (d < cfg.maxDepth + 2) {
      const cands = pool.filter((s) => d >= s.minD && d <= s.maxD);
      if (!cands.length) {
        d += 6;
        continue;
      }
      let total = 0;
      for (const c of cands) total += (c.weight ?? 1) * weatherWeight(c, w);
      let r = Math.random() * total;
      let pick = cands[0];
      for (const c of cands) {
        r -= (c.weight ?? 1) * weatherWeight(c, w);
        if (r <= 0) {
          pick = c;
          break;
        }
      }
      group++;
      if (pick.behavior === 'school' && Math.random() < 0.7) {
        const n = 4 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) {
          this.plan.push({
            sp: pick,
            depth: d + rand(-2.4, 2.4),
            x: rand(-XW, XW),
            z: rand(-1.5, 1.5),
            dir: Math.random() < 0.5 ? -1 : 1,
            speed: pick.speed * rand(0.85, 1.15),
            group,
          });
        }
        d += rand(5, 9) / (w.spawn ?? 1);
      } else {
        this.plan.push({
          sp: pick,
          depth: d,
          x: rand(-XW, XW),
          z: rand(-1.6, 1.6),
          dir: Math.random() < 0.5 ? -1 : 1,
          speed: pick.speed * rand(0.8, 1.25),
          group,
        });
        if (Math.random() < 0.22 * (w.spawn ?? 1)) {
          this.plan.push({
            sp: pick,
            depth: d + rand(1, 3),
            x: rand(-XW, XW),
            z: rand(-1.6, 1.6),
            dir: Math.random() < 0.5 ? -1 : 1,
            speed: pick.speed * rand(0.8, 1.25),
            group,
          });
        }
        d += rand(3.2, 6.4) / (w.spawn ?? 1);
      }
    }

    // 雾天/极光里，镇长那条金鱼更容易出现
    if (map === 'bay' && cfg.maxDepth >= 345 && Math.random() < Math.min(0.95, 0.65 * (w.bias.rare ?? 1))) {
      const sp = speciesById.goldfish;
      this.plan.push({ sp, depth: rand(348, Math.min(396, cfg.maxDepth)), x: rand(-2, 2), z: 0.4, dir: 1, speed: sp.speed, group: ++group });
    }
    if (map === 'ice' && cfg.maxDepth >= 505) {
      const sp = speciesById.fishking;
      this.plan.push({ sp, depth: rand(510, Math.min(590, cfg.maxDepth)), x: 0.6, z: 0, dir: -1, speed: sp.speed, group: ++group });
    }

    for (const p of this.plan) this.fishes.push({ ...p, x: p.x, mesh: null, caught: false, dead: false, dartT: rand(0.5, 2.6), darting: 0 });

    // 漂流瓶
    const bottles = BOTTLES.filter((b) => b.map === map && b.depth <= cfg.maxDepth && !cfg.bottlesHave.includes(b.id));
    for (const b of bottles) {
      const x = rand(-2.4, 2.4);
      const y = -b.depth;
      const z = rand(-0.8, 0.8);
      const g = new BottleSprite(x, y, z);
      this.world.bottleGroup.add(g);
      this.bottles.push({ id: b.id, x, y, z, taken: false, group: g });
    }
  }

  clearBottles() {
    for (const b of this.bottles) this.world.bottleGroup.remove(b.group);
    this.bottles = [];
  }

  banner(text: string, sub?: string, color?: string) {
    this.opts.onBanner({ text, sub, color });
  }

  // ======================= 主循环 =======================

  loop = (now: number) => {
    if (this.disposed) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.paused) {
      this.t += dt;
      try {
        this.update(dt);
      } catch (err) {
        console.error(err);
      }
    }
    this.stage.tick(this.t);
    this.stage.render(dt);
    this.raf = requestAnimationFrame(this.loop);
  };

  update(dt: number) {
    // 命中定格：命中那一瞬间把世界放慢到 5%，持续 0.04~0.11s。
    // 只压 dt，不暂停渲染 —— 画面还在画，只是世界走得慢，那才是「顿一下」。
    // 取 max 而不是覆盖：连发枪一秒十几发，覆盖会让后一枪缩短前一枪的定格，
    // 结果是「射速越高越没打击感」，和直觉相反。
    if (this.hitStopT > 0) {
      this.hitStopT -= dt;
      dt *= 0.05;
    }
    // 出水慢动作：破水那 0.22 秒把世界拉到 0.32 倍速，鱼是「缓缓升起」的
    if (this.slowT > 0) {
      this.slowT -= dt;
      dt *= 0.32;
    }
    const cfg = this.cfg;
    const band = bandAt(this.scene.map, Math.max(0, -this.lure.y));
    // 1 = 完全在水上，0 = 完全在水下，抛竿入水时连续过渡
    const above = this.aboveAmount();
    const revealed = above < 0.5;

    this.updateCamera(dt, above);
    this.stage.applyBand(band, MAPS[this.scene.map], Math.max(0, -this.lure.y), above);

    this.world.update(this.t, dt, band, Math.max(0, -this.lure.y), this.stage.camera.position, revealed);
    this.world.lure.position.set(this.lure.x, this.lure.y, 0);
    this.world.lure.visible = this.phase !== 'idle';
    this.world.lure.rotation.z = this.phase === 'ascent' ? 0.3 : 0;
    this.world.setSaw(this.phase === 'descent' && this.saw > 0);

    // 头灯
    const depth = Math.max(0, -this.lure.y);
    const dark = (this.scene.map === 'ice' && depth > 5) || depth > 150;
    const lampR = cfg ? cfg.lamp : 26;
    this.world.lureLight.intensity = dark && cfg ? 13 : 0;
    this.world.lureLight.distance = lampR * 1.15;
    this.world.lureGlow.scale.setScalar(dark ? clamp(lampR * 0.045, 0.9, 2.2) : 1.1);

    if (this.camShake.mag > 0) this.camShake.mag = Math.max(0, this.camShake.mag - dt * 26);
    this.camShake.x = (Math.random() - 0.5) * this.camShake.mag;
    this.camShake.y = (Math.random() - 0.5) * this.camShake.mag;

    if (this.phase === 'idle' || !cfg) {
      this.focusY += (0.55 + Math.sin(this.t * 0.9) * 0.12 - this.focusY) * Math.min(1, dt * 2.5);
      this.lure.y = 0.2;
      this.fx.update(dt);
      this.drawLine();
      this.pushHud();
      return;
    }

    if (this.phase === 'descent' || this.phase === 'ascent') this.steer(dt, cfg);
    this.updateFish(dt);

    if (this.phase === 'cast') this.updateCast(dt);
    else if (this.phase === 'descent') this.updateDescent(dt, cfg);
    else if (this.phase === 'turn') {
      this.turnT -= dt;
      // 刹停曲线 y = y0 − D(2u − u²)：起手速度 2D/T 正好是刹车前的下潜速度，
      // 末端速度为 0。看起来是「冲出去一段、被线拽住」，而不是撞墙。
      const u = clamp(1 - Math.max(0, this.turnT) / this.turnDur, 0, 1);
      this.lure.y = this.turnFromY - this.turnDrop * u * (2 - u);
      this.focusY += (this.lure.y + 0.8 - this.focusY) * Math.min(1, dt * 5);
      if (this.turnT <= 0) this.beginAscent('turn');
    } else if (this.phase === 'ascent') this.updateAscent(dt, cfg);
    else if (this.phase === 'shoot') this.updateShoot(dt, cfg);

    this.placeHooked(dt);
    this.checkBottles();
    this.fx.update(dt);
    this.drawLine();
    this.stage.setSky(this.sky);
    this.pushHud();

    const isAbove = above > 0.5;
    if (isAbove !== this.lastAbove) {
      if (!isAbove && !this.castSplash) {
        this.fx.spawn(this.lure.x, 0.1, 0, { color: '#cdefff', n: 22, speed: 5, size: 0.7, life: 0.8, gravity: -8 });
        sfx.splash();
      }
      this.lastAbove = isAbove;
    }
  }

/**
   * 「在水上」的程度：1 完全水上，0 完全水下。
   * 由镜头高度连续换算，而不是按阶段给 0/1——穿越水面时它是一条平滑曲线，
   * 天空、水面、水色就都能跟着一起渐变。
   */
  private aboveAmount() {
    return clamp(0.5 + (this.focusY + CAM_LEAD) / 4, 0, 1);
  }

  /**
   * 镜头中心比钩子高多少米。
   * 刚入水时几乎平视（钩子落在屏幕中下部），沉到 6 米以后才把钩子推到画面上方，
   * 把下方的深水让出来——这样一层层往下潜，视野是一点点打开的。
   */
  private camOffset(depth: number) {
    return 1.2 + Math.min(1, depth / 6) * 3.4;
  }

  private updateCamera(dt: number, above: number) {
    // 抛竿过渡由 updateCast 自己控制 focusY，这里只把结果交给相机
    if (this.phase === 'cast') {
      this.stage.setZoom(1);
      this.stage.setPan(0);
      this.stage.setCamera(this.focusY, this.camShake, above);
      return;
    }
    let target = this.focusY;
    // 平滑率：下潜要稳、收线要跟得紧。旧项目用的是 7 / 12，这里对齐同一量级。
    let k = 6;
    if (this.phase === 'descent') target = this.lure.y - this.camOffset(Math.max(0, -this.lure.y));
    else if (this.phase === 'ascent') {
      target = this.lure.y + 3.1;
      k = 12;
    } else if (this.phase === 'turn') {
      target = this.lure.y + 3.1;
      k = 5;
    } else if (this.phase === 'shoot') {
      // 跟「最低的那条」而不是最高的：它最快落回水里、最该先打。
      // 打掉 / 落水之后它就不再是 fly，下一帧自然换成剩下的最低那条 ——
      // 不需要额外的切换逻辑，天然形成「逐个点杀」的节奏。
      //
      // 扣钱的鱼（水母）不跟：把它钩上来甩上天本来就是失误，
      // 镜头凑过去等于把失误摆在画面正中，还挡住了真正该打的鱼。
      let low = Infinity;
      let lowVy = 0;
      let lowX = 0;
      let focus: AirFish | null = null;
      for (const a of this.air) {
        if (a.state !== 'fly') continue;
        if (a.sp.value < 0) continue;
        // 刚被打中的那条优先：玩家正在连击它，镜头得跟住，
        // 否则打飞的鱼一高就被「最低那条」抢走镜头，看着像追不上。
        if (a.focusT > 0 && (!focus || a.focusT > focus.focusT)) focus = a;
        if (a.y < low) {
          low = a.y;
          lowVy = a.vy;
          lowX = a.x;
        }
      }
      if (focus) {
        low = focus.y;
        lowVy = focus.vy;
        lowX = focus.x;
      }
      if (!Number.isFinite(low)) {
        // 天上全是扣钱鱼：镜头回到水面附近，让它们自己在画面上方飞
        low = 1;
        lowVy = 0;
        lowX = 0;
      }
      // 推近后可见高度只有 10 米出头，目标放在正中；lead 抵消镜头滞后。
      // 高度上限放到 620m：鱼被连击顶到几十米甚至上百米时，镜头必须跟得上去，
      // 原来的 40m 硬顶就是「鱼飞出画面、镜头追不上」的原因。
      k = 7;
      target = clamp(low - 1.5 + lowVy / k, -1, 620);
      this.camX = clamp(lowX, -XW + 1, XW - 1);
    } else target = 0.55;

    // 空中推近（视野缩到 72%）；飞得越高视野越拉开，免得鱼在屏幕外
    const air = this.phase === 'shoot';
    const zoom = air ? 0.72 + clamp((this.focusY - 25) / 90, 0, 1) * 0.85 : 1;
    this.stage.setZoom(zoom);
    this.stage.setPan(air ? this.camX : 0);

    // 指数平滑的稳态误差 = 目标速度 ÷ k —— 镜头永远落在目标后面 v/k。
    // 把瞄准点提前 v/k，误差正好抵消。上升时 vy 是负的，所以这里取负号。
    if (this.phase === 'descent' || this.phase === 'ascent') {
      target += -this.lure.vy / k;
    }

    // 单帧最多走 40%：低帧率时（dt 被钳到 0.05）不会让镜头一帧跳好几米
    this.focusY += (target - this.focusY) * Math.min(0.4, dt * k);
    this.stage.setCamera(this.focusY, this.camShake, above);
  }

  private steer(dt: number, cfg: TripConfig) {
    const dx = this.targetX - this.lure.x;
    const vmax = 11;
    this.lure.vx = clamp(dx * 9, -vmax, vmax);
    this.lure.x += this.lure.vx * dt;
    if (this.lure.y < -1 && this.scene.map === 'ice') {
      // 洋流：按深度正弦摆动，防流鳍降低影响
      const strength = (1 - clamp(cfg.fin / 100, 0, 0.92)) * 1.7;
      const push = Math.sin(this.t * 0.9 + this.lure.y * 0.06) * strength;
      this.lure.x += push * dt;
      this.targetX = clamp(this.targetX + push * dt * 0.7, -XW, XW);
    }
    this.lure.x = clamp(this.lure.x, -XW, XW);
  }

  private updateFish(dt: number) {
    const depth = -this.lure.y;
    const showFrom = depth - 34;
    const showTo = depth + 48;
    const pooled: FishMesh[] = [];

    for (const f of this.fishes) {
      if (f.caught || f.dead) continue;
      const inWindow = f.depth > showFrom && f.depth < showTo;
      if (inWindow && !f.mesh) {
        f.mesh = this.factory.acquire(f.sp);
        f.mesh.root.position.set(f.x, -f.depth, f.z);
        f.mesh.setDir(f.dir);
      } else if (!inWindow && f.mesh) {
        pooled.push(f.mesh);
        f.mesh = null;
      }
      if (!f.mesh) continue;

      // 行为
      if (f.sp.behavior === 'dart') {
        f.dartT -= dt;
        if (f.dartT <= 0) {
          f.darting = 0.65;
          f.dartT = rand(1.6, 3.2);
        }
        if (f.darting > 0) f.darting -= dt;
      }
      if (f.sp.behavior === 'hunt' && (this.phase === 'descent' || this.phase === 'ascent')) {
        if (Math.abs(-f.depth - this.lure.y) < 7 && Math.abs(f.x - this.lure.x) > 0.15) {
          f.x += Math.sign(this.lure.x - f.x) * 0.9 * dt;
        }
      }
      const boost = f.darting > 0 ? 2.6 : 1;
      f.x += f.dir * f.speed * boost * dt;
      if (f.x < -XW - 0.6) {
        f.x = -XW - 0.6;
        f.dir = 1;
      } else if (f.x > XW + 0.6) {
        f.x = XW + 0.6;
        f.dir = -1;
      }
      f.mesh.root.position.set(f.x, -f.depth, f.z);
      f.mesh.setDir(f.dir);
      f.mesh.update(dt);
    }
    if (pooled.length) pooled.forEach((m) => this.factory.release(m));
  }

  private updateDescent(dt: number, cfg: TripConfig) {
    const depth = Math.max(0, -this.lure.y);
    // 局内变天：每下沉 40 米掷一次骰子（22%）。天气同时改画面和刷鱼权重，
    // 所以「潜到一半变天」是实打实改变这一潜，不只是换张皮。
    if (depth > this.weatherAt + 40) {
      this.weatherAt = depth;
      if (Math.random() < 0.22) {
        const next = rollWeather(this.scene.map, this.scene.weather, true);
        if (next !== this.scene.weather) {
          this.setWeather(next);
          const w = weatherById[next];
          this.banner(w.icon + ' 变天了', w.name + ' · ' + w.tip, '#9fe8ff');
          this.opts.onWeather?.(next);
        }
      }
    }
    const maxS = (9 + depth * 0.022) * cfg.speedMult;
    this.lure.vy = Math.min(maxS, this.lure.vy + 13 * dt);
    this.lure.y -= this.lure.vy * dt;
    this.maxDepthReached = Math.max(this.maxDepthReached, -this.lure.y);
    if (Math.random() < dt * 7) this.fx.bubble(this.lure.x, this.lure.y, 0.2, 1);

    // 紧急收线
    if (this.abortDown) {
      this.abortHold += dt;
      if (this.abortHold >= 0.45) {
        this.abortDown = false;
        this.abortHold = 0;
        this.beginAscent('manual');
        return;
      }
    } else this.abortHold = Math.max(0, this.abortHold - dt * 3);

    // 碰撞
    for (const f of this.fishes) {
      if (f.caught || f.dead || !f.mesh) continue;
      const vlim = 1.6 + f.sp.len * 0.5;
      if (Math.abs(-f.depth - this.lure.y) > vlim) continue;
      const rr = f.sp.len * 0.42 + 0.42;
      const dx = f.x - this.lure.x;
      if (dx * dx + (-f.depth - this.lure.y) ** 2 < rr * rr) {
        if (this.saw > 0) {
          this.saw--;
          this.killInWater(f, cfg);
          sfx.saw();
          this.banner('锯开了！', `剩余电锯 ${this.saw} 次`, '#fde047');
          this.camShake.mag = 3;
        } else {
          this.hook(f, cfg);
          this.beginTurn('bite');
          return;
        }
      }
    }

    // 教学：第一次离鱼很近时提醒「撞到会结束下潜」（撞到之前才有意义）
    if (!cfg.hints.nearFish && !this.warnedNear) {
      let near = Infinity;
      for (const f of this.fishes) {
        if (f.caught || f.dead || !f.mesh) continue;
        const dy = -f.depth - this.lure.y;
        if (dy < -2 || dy > 7) continue;
        const d = Math.hypot(f.x - this.lure.x, dy) - (f.sp.len * 0.42 + 0.42);
        if (d < near) near = d;
      }
      if (near < 1.3) {
        this.warnedNear = true;
        this.opts.onHint('nearFish');
      }
    }

    if (-this.lure.y >= cfg.maxDepth) {
      this.lure.y = -cfg.maxDepth;
      this.beginTurn('bottom');
      return;
    }
    this.focusY += (this.lure.y - 3.4 - this.focusY) * Math.min(1, dt * 6);
  }

  private beginTurn(reason: 'bite' | 'bottom' | 'manual') {
    // 先记住刹车前的下潜速度，再清零 —— 距离由它推出来
    const v0 = Math.max(0, this.lure.vy);
    this.phase = 'turn';
    this.turnDur = 0.5;
    this.turnT = this.turnDur;
    this.turnFromY = this.lure.y;
    // 滑行距离：D = v0·T/2 时起手速度正好接得上。
    // 另外钳住剩余深度，别因为惯性冲出鱼线极限。
    const room = this.cfg ? Math.max(0, this.cfg.maxDepth + this.lure.y) : 99;
    this.turnDrop = Math.min((v0 * this.turnDur) / 2, room);
    this.lure.vy = 0;
    sfx.bump();
    this.camShake.mag = reason === 'bite' ? 5 : 3;
    if (reason === 'bite') this.banner('咬钩了！', '往上收线，尽量多钩几条', '#ffe066');
    else this.banner('收线！', '主动撞鱼，装满鱼钩', '#9fe8ff');
  }

  private beginAscent(_reason: string) {
    this.phase = 'ascent';
    // 起拉不再从静止猛拉：先给一段 3u³-2u² 的缓动，
    // 起手速度 0、中间先微微一沉（anticipation），末端速度正好等于收线速度。
    const cfg = this.cfg;
    const full = cfg ? this.hooked.length >= cfg.hookCap : false;
    const spd = full ? 26 : 13 + Math.max(0, -this.lure.y) * 0.028;
    this.ascRampDur = 0.6;
    this.ascRampT = this.ascRampDur;
    this.ascFromY = this.lure.y;
    this.ascRampD = (spd * this.ascRampDur) / 5;
    this.lure.vy = 0;
    this.banner('收线！', '往上撞鱼，装满你的钩', '#9fe8ff');
    if (this.cfg && !this.cfg.hints.ascent) this.opts.onHint('ascent');
  }

  private updateAscent(dt: number, cfg: TripConfig) {
    const full = this.hooked.length >= cfg.hookCap;
    const maxS = full ? 26 : 13 + Math.max(0, -this.lure.y) * 0.028;
    if (this.ascRampT > 0) {
      this.ascRampT -= dt;
      const u = clamp(1 - Math.max(0, this.ascRampT) / this.ascRampDur, 0, 1);
      // y = y0 + D(3u³ − 2u²)：u≈0.44 处先往下沉 13%·D，然后才冲上去
      this.lure.y = this.ascFromY + this.ascRampD * u * u * (3 * u - 2);
      // vy 跟着曲线的真实斜率走，出 ramp 时才不会「突然有速度」
      this.lure.vy = -(this.ascRampD * (9 * u * u - 4 * u)) / this.ascRampDur;
    } else {
      this.lure.vy = Math.max(-maxS, this.lure.vy - 16 * dt);
      // 坐标约定：y 向下为负，depth = -y。收线时 vy 为负值，故需用减法让 y 增大（上升）
      this.lure.y -= this.lure.vy * dt;
    }
    this.lure.y = Math.min(this.lure.y, 0.2);
    if (Math.random() < dt * 6) this.fx.bubble(this.lure.x, this.lure.y, 0.2, 1);

    if (!full) {
      for (const f of this.fishes) {
        if (f.caught || f.dead || !f.mesh) continue;
        const vlim = 1.6 + f.sp.len * 0.5;
        if (Math.abs(-f.depth - this.lure.y) > vlim) continue;
        const rr = f.sp.len * 0.45 + 0.5;
        if ((f.x - this.lure.x) ** 2 + (-f.depth - this.lure.y) ** 2 < rr * rr) {
          this.hook(f, cfg);
          if (f.sp.special === 'eel') this.zap();
          if (this.hooked.length >= cfg.hookCap) {
            this.banner('鱼钩满了！', '全速收线', '#86efac');
            sfx.pop();
            break;
          }
        }
      }
    }
    if (-this.lure.y <= 0.05) this.launch(cfg);
  }

  private hook(f: Fish, cfg: TripConfig) {
    f.caught = true;
    this.hooked.push(f);
    this.res.hooked++;
    sfx.catchFish();
    const n = this.hooked.length;
    const mesh = f.mesh;
    if (mesh) {
      mesh.root.position.set(this.lure.x, this.lure.y, 0.4);
      this.fx.ring(this.lure.x, this.lure.y, 0.3, '#ffe066', 0.4, 1.5, 0.35);
    }
    this.fx.text(this.lure.x, this.lure.y + 1, 0.6, f.sp.name, '#dff3ff', 0.42);
    if (n === cfg.hookCap) this.banner('钩满了！', '再撞就装不下了', '#86efac');
  }

  private killInWater(f: Fish, cfg: TripConfig) {
    f.dead = true;
    this.res.kills[f.sp.id] = (this.res.kills[f.sp.id] || 0) + 1;
    const v = Math.round(f.sp.value * cfg.moneyMult * (f.sp.id === cfg.hotFish ? 2 : 1));
    if (v > 0) this.res.gross += v;
    this.fx.spawn(f.x, -f.depth, f.z, { color: f.sp.color, n: 16, speed: 4, size: 0.55, life: 0.8 });
    this.fx.ring(f.x, -f.depth, f.z, '#ffffff', 0.4, 1.6, 0.3);
    this.fx.text(f.x, -f.depth + 0.8, f.z, `+$${v}`, '#ffe066', 0.45);
    if (f.mesh) {
      this.factory.release(f.mesh);
      f.mesh = null;
    }
  }

  private zap() {
    sfx.zap();
    this.camShake.mag = 8;
    const victims = this.hooked.filter((h) => h.sp.special !== 'eel').slice(-2);
    for (const v of victims) {
      const i = this.hooked.indexOf(v);
      if (i >= 0) this.hooked.splice(i, 1);
      v.caught = false;
      v.dead = true;
      this.res.lost++;
      this.fx.spawn(this.lure.x, this.lure.y, 0, { color: v.sp.color, n: 10, speed: 3, size: 0.5, life: 0.6 });
      if (v.mesh) {
        this.factory.release(v.mesh);
        v.mesh = null;
      }
    }
    this.banner('⚡ 被电了！', victims.length ? `甩掉了 ${victims.length} 条鱼` : '还好钩上没鱼', '#ffe066');
  }

  private placeHooked(dt: number) {
    for (let i = 0; i < this.hooked.length; i++) {
      const f = this.hooked[i];
      if (!f.mesh) continue;
      const ring = Math.floor(i / 6);
      const a = (i % 6) / 6;
      const ox = Math.cos(a * Math.PI * 2) * (0.28 + ring * 0.16);
      const oy = Math.sin(a * Math.PI * 2) * (0.28 + ring * 0.16) - 0.35 - ring * 0.12;
      const target = new Vec3(this.lure.x + ox, this.lure.y + oy, 0.5 + (i % 3) * 0.14);
      f.mesh.root.position.lerp(target, Math.min(1, dt * 14));
      f.mesh.setSpin(Math.sin(this.t * 3 + i) * 0.35);
      f.mesh.setDir(1);
      f.mesh.update(dt);
    }
  }

  private checkBottles() {
    for (const b of this.bottles) {
      if (b.taken) continue;
      if ((b.x - this.lure.x) ** 2 + (b.y - this.lure.y) ** 2 < 1.6 * 1.6) {
        b.taken = true;
        this.res.bottles.push(b.id);
        sfx.pop();
        this.banner('🍾 捡到漂流瓶！', '上岸后打开手机查看', '#7cf7b0');
        this.fx.spawn(b.x, b.y, b.z, { color: '#9dffc7', n: 18, speed: 3.4, size: 0.5, life: 0.9 });
        this.world.bottleGroup.remove(b.group);
      }
    }
  }

  private launch(cfg: TripConfig) {
    this.phase = 'shoot';
    this.slowT = 0.22;
    this.stage.burstSplash();
    this.res.depth = Math.round(this.maxDepthReached);
    sfx.splash();
    this.camShake.mag = 6;
    this.fx.spawn(this.lure.x, 0.1, 0, { color: '#d6f4ff', n: 28, speed: 7, size: 0.7, life: 0.9, gravity: -10 });
    const list = this.hooked;
    const fromY = Math.max(0.12, this.lure.y + 0.3);
    const n = list.length;
    this.hooked = [];
    this.airT = 0;
    this.air = list.map((f, i) => {
      const mesh = f.mesh!;
      // 出水后统一用 1 倍缩放：体长由 fish2d.draw 负责，这里再乘一次就会变形
      mesh.root.scale.setScalar(1);
      // 扇形展开：按捕获顺序铺开，条数越多扇面越宽
      const spread = n > 1 ? i / (n - 1) - 0.5 : 0;
      const val = Math.max(0, f.sp.value);
      // 初速决定最高点：apex = v0²/(2g)。贵鱼飞得更高、滞空更久，也更难打
      const v0 = 23 + Math.sqrt(val) * 0.55;
      const flight = (2 * v0) / AIR_G;
      // 先定「这条鱼总共该飘多远」，再反推水平速度 ——
      // 否则滞空久的贵鱼会因为速度一样而飘出画面
      const drift = 2.2 + Math.sqrt(val) * 0.04;
      const vx = (spread * 2 * drift) / flight + rand(-0.45, 0.45);
      const x = clamp(this.lure.x + rand(-0.35, 0.35), -XW + 0.3, XW - 0.3);
      mesh.root.position.set(x, fromY, 0.3 + (i % 3) * 0.2);
      mesh.setSpin(rand(0, 6));
      return {
        sp: f.sp,
        mesh,
        x,
        y: fromY,
        z: 0.3 + (i % 3) * 0.2,
        vx,
        vy: v0 * rand(0.96, 1.04),
        rot: rand(0, 6),
        // 三轴翻滚（2D 里只表现为更快更大的自转），基准比原来快一倍
        vr: (Math.random() < 0.5 ? -1 : 1) * rand(6, 13),
        hp: f.sp.hp,
        delay: 0.12 + i * 0.05,
        squash: 0,
        baseScale: 1,
        hits: 0,
        knockT: 0,
        focusT: 0,
        state: 'fly',
        life: 0,
      };
    });
    this.endT = this.air.length ? 1.6 : 0.7;
    this.cooldown = 0.15;
    this.pending = false;
    if (this.air.length) this.banner('开火！', '点鱼开枪 · 没打死会被打得更高', '#ffb4a8');
    else this.banner('空军……', '一条都没钓到', '#cbd5e1');
    if (this.air.length && !cfg.hints.shoot) this.opts.onHint('shoot');
  }

  private hitReach(cfg: TripConfig) {
    return cfg.aim + (cfg.weapon.id === 'pistol' ? 0.45 : 0.22);
  }

  private updateShoot(dt: number, cfg: TripConfig) {
    const dts = dt * cfg.slow;
    const g = AIR_G;
    this.airT += dt;
    this.updateSky(dt);
    let active = 0;
    for (const a of this.air) {
      if (a.state !== 'fly') continue;
      active++;
      if (a.delay > 0) {
        a.delay -= dt;
        if (a.delay <= 0) sfx.pop();
        continue;
      }
      a.vy -= g * dts;
      if (a.knockT > 0) a.knockT -= dt;
      if (a.focusT > 0) a.focusT -= dt;
      a.x += a.vx * dts;
      a.y += a.vy * dts;
      a.rot += a.vr * dts;
      if (a.x < -XW) {
        a.x = -XW;
        a.vx = Math.abs(a.vx);
      } else if (a.x > XW) {
        a.x = XW;
        a.vx = -Math.abs(a.vx);
      }
      a.mesh.root.position.set(a.x, a.y, a.z);
      a.mesh.setSpin(a.rot);
      // 被击飞时的挤压回弹，让「弹飞」更明显
      if (a.squash > 0) {
        a.squash = Math.max(0, a.squash - dt * 3.2);
        const k = a.squash;
        const L = a.baseScale;
        a.mesh.root.scale.set(L * (1 + k * 0.24), L * (1 - k * 0.2), L * (1 + k * 0.1));
      }
      a.mesh.update(dt);
      if (a.y < 0.2 && a.vy < 0) {
        a.state = 'lost';
        this.res.lost++;
        sfx.splash();
        this.fx.spawn(a.x, 0.2, a.z, { color: '#cdefff', n: 12, speed: 4, size: 0.5, life: 0.7 });
        this.factory.release(a.mesh);
      }
    }

    this.cooldown -= dt;
    this.heat = Math.max(0, this.heat - dt * 0.34);
    if (this.overheatT > 0) {
      this.overheatT -= dt;
      if (this.overheatT <= 0) this.heat = 0.15;
    }
    const w = cfg.weapon;
    const wantFire = this.pending || (w.auto && this.pointer.down);
    if (wantFire && this.cooldown <= 0 && this.overheatT <= 0) {
      this.fire(cfg);
      this.cooldown = 1 / w.rate;
      this.pending = false;
      if (w.heat > 0) {
        this.heat += w.heat / w.rate;
        if (this.heat >= 1) {
          this.heat = 1;
          this.overheatT = 1.15;
          sfx.overheat();
          this.banner('枪管过热！', '等它凉下来', '#fca5a5');
        }
      }
    }
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.comboStack = 0;
    }

    if (active === 0) {
      this.endT -= dt;
      if (this.endT <= 0) this.finish();
    } else if (this.airT > AIR_TIMEOUT) {
      this.finish();
    }
  }

  comboMult() {
    return Math.min(2.5, 1 + 0.15 * Math.max(0, this.comboStack - 1));
  }


  /** 天空目标：按权重刷，横向飞过屏幕。最多同时 3 个，否则画面太乱 */
  private spawnSky() {
    const kinds = Object.keys(SKY_META) as SkyKind[];
    const total = kinds.reduce((a, k) => a + SKY_META[k].weight, 0);
    let r = Math.random() * total;
    let kind: SkyKind = 'bird';
    for (const k of kinds) {
      r -= SKY_META[k].weight;
      if (r <= 0) {
        kind = k;
        break;
      }
    }
    const m = SKY_META[kind];
    const dir = Math.random() < 0.5 ? 1 : -1;
    const y = clamp(this.focusY + m.lift + rand(-1.6, 1.6), 2.5, 52);
    this.sky.push({
      kind,
      x: dir > 0 ? -XW - 1.8 : XW + 1.8,
      y,
      vx: dir * m.speed,
      hp: m.hp,
      maxHp: m.hp,
      value: m.value,
      size: m.size,
      t: 0,
      hitT: 0,
    });
  }

  private updateSky(dt: number) {
    if (this.sky.length < 3) {
      this.skyT -= dt;
      if (this.skyT <= 0) {
        this.spawnSky();
        this.skyT = rand(1.8, 4.2);
      }
    }
    for (let i = this.sky.length - 1; i >= 0; i--) {
      const s = this.sky[i];
      s.t += dt;
      s.x += s.vx * dt;
      if (s.hitT > 0) s.hitT -= dt;
      if (s.x < -XW - 2.6 || s.x > XW + 2.6) this.sky.splice(i, 1);
    }
  }

  /** 打中天空目标：死了加分，没死只闪一下 */
  private hitSky(index: number, dmg: number, cfg: TripConfig) {
    const s = this.sky[index];
    s.hp -= dmg;
    s.hitT = 1;
    this.hitStopT = Math.max(this.hitStopT, 0.045);
    this.fx.spawn(s.x, s.y, 0, { color: '#ffffff', n: 6, speed: 4, size: 0.3, life: 0.26, gravity: 0 });
    if (s.hp > 0) {
      this.fx.text(s.x, s.y + 0.6, 0, `还差 ${Math.max(1, Math.ceil(s.hp / Math.max(0.5, dmg)))} 枪`, '#cfe8ff', 0.3);
      return;
    }
    const v = Math.round(s.value * cfg.moneyMult);
    this.res.gross += v;
    this.res.skyGain += v;
    this.res.kills['sky_' + s.kind] = (this.res.kills['sky_' + s.kind] || 0) + 1;
    this.sky.splice(index, 1);
    this.fx.text(s.x, s.y, 0, `+${v}`, '#ffe066', 0.55);
    this.fx.ring(s.x, s.y, 0, '#ffffff', 0.4, 2.2, 0.32);
    this.fx.spawn(s.x, s.y, 0, { color: '#dff3ff', n: 16, speed: 5, size: 0.42, life: 0.7 });
    this.camShake.mag = Math.min(12, this.camShake.mag + 4);
    sfx.kill();
  }

  private fire(cfg: TripConfig) {
    this.shots++;
    const w = cfg.weapon;
    if (w.splash > 6) sfx.boom();
    else sfx.shot();
    this.camShake.mag = Math.max(this.camShake.mag, w.splash > 6 ? 9 : 2.5);
    const reach = this.hitReach(cfg);
    const px = this.aim.x;
    const py = this.aim.y;

    for (let i = 0; i < w.pellets; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rr = Math.random() * w.spread;
      const x = px + Math.cos(ang) * rr;
      const y = py + Math.sin(ang) * rr * 0.85;
      this.fx.ring(x, y, 0, '#ffe9a8', 0.1, reach * 0.75, 0.16);
      this.fx.spawn(x, y, 0, { color: '#fff2c0', n: 2, speed: 2.4, size: 0.22, life: 0.22, gravity: 0 });
      // 天空目标优先：它比鱼稀有，一颗弹丸只打一个东西
      let hitSky = false;
      for (let k = this.sky.length - 1; k >= 0; k--) {
        const s = this.sky[k];
        if (Math.hypot(s.x - x, s.y - y) > reach + s.size) continue;
        this.hitSky(k, w.dmg, cfg);
        hitSky = true;
        break;
      }
      if (hitSky) continue;
      let best: AirFish | null = null;
      let bd = Infinity;
      for (const a of this.air) {
        if (a.state !== 'fly' || a.delay > 0) continue;
        const d = Math.hypot(a.x - x, a.y - y);
        if (d < reach + a.sp.len * 0.4 && d < bd) {
          bd = d;
          best = a;
        }
      }
      if (w.splash > 0) {
        const R = w.splash;
        this.fx.ring(x, y, 0, '#ffd0a0', 0.3, R, 0.3);
        this.fx.spawn(x, y, 0, { color: '#ffb066', n: 16, speed: 7, size: 0.6, life: 0.5, gravity: 0 });
        for (let k = this.sky.length - 1; k >= 0; k--) {
          const s = this.sky[k];
          if (Math.hypot(s.x - x, s.y - y) < R + s.size) this.hitSky(k, w.dmg, cfg);
        }
        for (const a of this.air) {
          if (a.state !== 'fly' || a.delay > 0) continue;
          if (a === best || Math.hypot(a.x - x, a.y - y) < R + a.sp.len * 0.35) this.damage(a, w.dmg, cfg);
        }
      } else if (best) this.damage(best, w.dmg, cfg);
    }
  }

  private damage(a: AirFish, dmg: number, cfg: TripConfig) {
    if (a.state !== 'fly') return;
    const sp = a.sp;
    a.hp -= dmg;
    a.mesh.flash = 1;
    // 命中定格：血越厚停得越久，取 max 不覆盖（连发枪不会被后一枪缩短）
    this.hitStopT = Math.max(this.hitStopT, 0.035 + 0.075 * Math.min(1, a.hp / 8));
    if (a.hp > 0) {
      // 顶飞要节流：不然加特林一秒二十发会把同一条鱼顶出大气层
      if (a.knockT > 0) {
        // 节流期间的补枪也得有汁，只是不再顶飞
        this.fx.juice(a.x, a.y, a.z, { color: sp.color, color2: sp.color2, n: 7, speed: 9, size: 0.2, life: 0.32 });
        return;
      }
      a.knockT = 0.22;
      a.focusT = 1.5;
      // 没打死 → 被冲击力顶到更高空（y 向上为正，所以 vy 要往上加）
      a.hits += 1;
      const n = a.hits;
      // 第一枪是「打得动」，第二枪开始明显「打得飞」
      const boost = cfg.weapon.auto ? 7 + n * 2.6 : 12 + n * 6 + Math.max(0, n - 2) * 3;
      a.vy = Math.max(0, a.vy) + boost;
      a.y += 0.2 + n * 0.08;
      a.vx += rand(-1.8, 1.8) * (1 + n * 0.12);
      // 转速沿当前方向叠加，不重新随机 ——
      // 随机会让每一枪都像被按了「反向键」，观感是抽搐而不是被炸飞
      a.vr += (a.vr >= 0 ? 1 : -1) * rand(5, 12) * (1 + n * 0.1);
      a.squash = 1;
      a.mesh.flash = 1;

      // 溅汁：位置和速度都取「顶飞之后」的状态，
      // 否则汁液会留在原地，看起来像鱼掉了一地豆子而不是被打爆。
      this.fx.splat(a.x, a.y, a.z, sp.color, 0.32 + Math.min(0.26, sp.len * 0.3), 0.15);
      this.fx.juice(a.x, a.y, a.z, {
        color: sp.color,
        color2: sp.color2,
        n: 32,
        speed: 12,
        size: 0.13,
        life: 0.38,
        carryX: a.vx * 0.9,
        carryY: a.vy * 0.8,
      });

      // 表现：上冲火星 + 屏幕震动 + 飘字（第二枪全部加大）
      // 命中不再画冲击环：那圈白色跟着鱼飞会像肥皂泡，和「爆汁」抢戏。
      // 现在的分工是「汁液当主角，火星只做点缀」。
      this.fx.spawn(a.x, a.y, a.z, { color: '#ffe9a8', n: 3 + n, speed: 7 + n, size: 0.15, life: 0.3, gravity: -9 });
      this.fx.text(a.x, a.y + 1.6, a.z, n >= 2 ? `击飞 ×${n}!` : '击飞!', n >= 2 ? '#ffe08a' : '#ffd7d0', n >= 2 ? 0.4 : 0.34);
      this.fx.text(a.x, a.y + 2.7, a.z, `还差 ${Math.max(1, Math.ceil(a.hp / Math.max(0.5, dmg)))} 枪`, '#ffb4a8', 0.28);
      this.camShake.mag = Math.min(12, this.camShake.mag + 3.2 + n * 1.1);
      sfx.hit();
      return;
    }
    // 击杀：鱼当场消失，只留爆开的碎光和飘字。
    // 之前有个 0.8 秒的缩小淡出，看起来像「鱼变小了还在飞」，
    // 玩家分不清是打死了还是打偏了——直接抹掉反馈最干脆。
    a.state = 'lost';
    this.factory.release(a.mesh);
    // 打爆的爆汁比命中大一号：连色斑一起给，才读得出「整条鱼炸开了」
    this.fx.splat(a.x, a.y, a.z, sp.color, 0.6 + Math.min(0.5, sp.len * 0.5), 0.26);
    this.fx.juice(a.x, a.y, a.z, {
      color: sp.color,
      color2: sp.color2,
      n: 46,
      speed: 13,
      size: 0.18,
      life: 0.62,
      carryY: Math.max(0, a.vy) * 0.24,
    });
    this.comboStack = this.comboT > 0 ? this.comboStack + 1 : 1;
    this.comboT = 1.6;
    const mult = this.comboMult();
    this.res.maxCombo = Math.max(this.res.maxCombo, this.comboStack);
    if (sp.special === 'jelly') {
      // 罚款按当前毛收入比例，且设一个很低的下限：开局误伤不会直接清零收益
      const pen = Math.round(Math.max(6, this.res.gross * 0.1) * cfg.jellyMult);
      this.res.penalty += pen;
      this.res.jellyHits++;
      this.res.kills[sp.id] = (this.res.kills[sp.id] || 0) + 1;
      this.comboStack = 0;
      this.comboT = 0;
      this.fx.text(a.x, a.y, a.z, `-$${pen}`, '#ff8a8a', 0.6);
      this.fx.text(a.x, a.y - 1.1, a.z, '罚款！', '#ffc9c9', 0.34);
      sfx.bad();
      this.camShake.mag = 6;
    } else {
      const hot = sp.id === cfg.hotFish ? 2 : 1;
      const v = Math.round(sp.value * cfg.moneyMult * hot * mult);
      this.res.gross += v;
      this.res.kills[sp.id] = (this.res.kills[sp.id] || 0) + 1;
      this.fx.text(a.x, a.y, a.z, `+$${v}${hot > 1 ? ' 🔥' : ''}`, mult > 1 ? '#ffcf6b' : '#ffe066', 0.52);
      if (this.comboStack > 1) this.fx.text(a.x, a.y - 1.2, a.z, `${this.comboStack} 连 ×${mult.toFixed(2)}`, '#a8f0ff', 0.34);
      sfx.kill();
      if (this.comboStack > 1) sfx.combo(this.comboStack);
      this.fx.spawn(a.x, a.y, a.z, { color: '#ffffff', n: 6, speed: 3.4, size: 0.22, life: 0.4 });
      this.fx.ring(a.x, a.y, a.z, sp.color, 0.32, 0.95, 0.24);
      if (sp.special === 'legend') {
        this.res.legend = true;
        this.camShake.mag = 18;
        this.banner('👑 鱼王被击落！', '一副假牙从天而降……', '#ffe066');
        this.fx.spawn(a.x, a.y, a.z, { color: '#ffe066', n: 40, speed: 8, size: 0.9, life: 1.6, gravity: -3 });
      }
      if (sp.special === 'rare') {
        this.banner('✨ 镇长的金鱼！', '它看起来一点也不惊讶', '#ffd166');
      }
    }
  }

  private finish() {
    // 原地清空：stage 持有的是这个数组的引用，换成新数组屏幕上会残留
    this.sky.length = 0;
    const r = this.res;
    r.bonus = Math.round(Math.max(0, r.depth - 80) * 1.2);
    r.earned = r.gross - r.penalty + r.bonus;
    this.phase = 'idle';
    const out = { ...r };
    this.cfg = null;
    this.factory.releaseAll();
    this.air = [];
    this.clearBottles();
    this.opts.onEnd(out);
  }

  private drawLine() {
    const tip = this.world.rodTip();
    const on = this.phase === 'cast' || this.phase === 'descent' || this.phase === 'turn' || this.phase === 'ascent';
    this.stage.setLine(tip.x, tip.y, this.lure.x, this.lure.y, on);
  }

  private pushHud() {
    this.hudTimer += 1;
    if (this.hudTimer % 6 !== 0) return;
    const cfg = this.cfg;
    const depth = Math.max(0, -this.lure.y);
    const band = bandAt(this.scene.map, depth);
    let estimate = 0;
    for (const f of this.hooked) estimate += f.sp.value * (cfg?.moneyMult ?? 1) * (f.sp.id === cfg?.hotFish ? 2 : 1);
    const airValue = this.air.reduce((a, f) => a + (f.state === 'fly' ? f.sp.value : 0), 0);
    this.opts.onHud({
      phase: this.phase,
      depth: Math.round(depth),
      maxDepth: cfg?.maxDepth ?? 0,
      hooked: this.hooked.length,
      cap: cfg?.hookCap ?? 0,
      saw: this.saw,
      combo: this.comboStack,
      mult: this.comboMult(),
      heat: this.heat,
      overheated: this.overheatT > 0,
      estimate: Math.round(estimate),
      band: band.name,
      airLeft: this.air.filter((a) => a.state === 'fly').length,
      airValue: Math.round(airValue),
      gross: Math.round(this.res.gross),
      lamp: cfg?.lamp ?? 0,
      dark: (this.scene.map === 'ice' && depth > 5) || depth > 150,
      abort: Math.min(1, this.abortHold / 0.45),
    });
  }

  /** UI 长按紧急收线 */
  setAbortDown(v: boolean) {
    this.abortDown = v;
    if (!v) this.abortHold = 0;
  }
}
