/**
 * 2D 舞台：与 3D 版 Stage 同签名，engine 只换一个 import。
 *
 * 合成顺序（决定画面成败的关键）：
 *   背景(天空/水体/光柱/远中景) → 船 → 漂流瓶 → 鱼(按 z 排序)
 *   → 鱼钩 → 钓线 → 粒子 → 近景剪影 → 过渡/暗角
 * 近景剪影压在鱼上面，玩家才会有「在水草后面看」的纵深，而不是看一张贴纸。
 */
import { Band, MapInfo, Weather, WeatherId, weatherById } from '../game/data';
import { Quality } from '../game/state';
import { CAM_LEAD, VIEW_W, Cam, makeCanvas, ctx2d, rgba } from './core';
import { Backdrop } from './background';
import type { FX } from './fx2d';
import { weatherParticles, weatherSky, weatherVeil, weatherize } from './weather';
import { World2D, BottleSprite } from './world2d';
import { FishSprite } from './fish2d';

/** 天空目标的最小绘制契约（engine 的 SkyActor 结构上兼容它，避免循环依赖） */
export interface SkySprite {
  kind: 'bird' | 'plane' | 'ufo';
  x: number;
  y: number;
  vx: number;
  size: number;
  t: number;
  hitT: number;
  hp: number;
  maxHp: number;
}

interface FakeCamera {
  position: { x: number; y: number; z: number };
}

export class Stage2D {
  readonly kind = '2d' as const;
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  /** engine 通过它拿事件目标；2D 下就是 canvas 本身 */
  renderer: { domElement: HTMLCanvasElement; info: { render: { calls: number; triangles: number } } };
  camera: FakeCamera;

  quality: Quality;
  W = 0;
  H = 0;
  dpr = 1;

  world: World2D | null = null;
  private backdrop = new Backdrop();
  private fishes: FishSprite[] = [];
  private skyActors: SkySprite[] = [];
  private band: Band | null = null;
  private rawBand: Band | null = null;
  private weather: Weather = weatherById.clear;
  private map: MapInfo | null = null;
  private above = 1;
  private depth = 0;
  private shake = { x: 0, y: 0 };
  private line = { tipX: 0, tipY: 0, lureX: 0, lureY: 0, visible: false };
  private splashed = 0;
  private clock = 0;
  /** 常规视野下的像素/米；实际 scale = baseScale / zoomNow */
  private baseScale = 60;
  /** 目标推近倍率：1 = 常规，0.7 = 视野缩到 70%（放大） */
  private zoomTarget = 1;
  private zoomNow = 1;
  private panTarget = 0;
  private panNow = 0;
  /** 出水水幕：1 → 0 快速衰减 */
  private burst = 0;
  /** 粒子 / 冲击环 / 飘字。由 engine 注入，逻辑与渲染分离 */
  private fx: FX | null = null;

  readonly cam: Cam;

  constructor(opts: { container: HTMLElement; quality: Quality }) {
    this.quality = opts.quality;
    this.backdrop.quality = opts.quality;
    this.canvas = makeCanvas(4, 4);
    this.canvas.className = 'gl';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.canvas.style.touchAction = 'none';
    opts.container.appendChild(this.canvas);
    this.g = ctx2d(this.canvas);

    this.renderer = {
      domElement: this.canvas,
      info: { render: { calls: 0, triangles: 0 } },
    };
    this.camera = { position: { x: 0, y: 0, z: 13.6 } };

    const self = this;
    this.cam = {
      W: 0,
      H: 0,
      scale: 60,
      cy: 2.9,
      cx: 0,
      shakeX: 0,
      shakeY: 0,
      toScreenX(wx: number) {
        return self.W / 2 + (wx - this.cx) * this.scale + this.shakeX * 0.16 * this.scale;
      },
      // 世界 y 向上为正（水面向下为负），屏幕 y 向下为正 → 用减号
      toScreenY(wy: number) {
        return self.H / 2 - (wy - this.cy) * this.scale + this.shakeY * 0.16 * this.scale;
      },
      toWorld(sx: number, sy: number) {
        return {
          x: (sx - self.W / 2 - this.shakeX * 0.16 * this.scale) / this.scale + this.cx,
          y: this.cy - (sy - self.H / 2 - this.shakeY * 0.16 * this.scale) / this.scale,
        };
      },
    };

    this.resize();
  }

  attachWorld(w: World2D) {
    this.world = w;
  }

  dropBottle(_b: BottleSprite) {
    /* 由 World2D 自己维护列表 */
  }

  /** 天空目标每帧由 engine 同步过来（只读，不复制） */
  setSky(list: SkySprite[]) {
    this.skyActors = list;
  }

  /** 注入特效层（engine 持有的那份，含粒子、冲击环、飘字） */
  setFx(fx: FX) {
    this.fx = fx;
  }

  addFish(f: FishSprite) {
    if (!this.fishes.includes(f)) this.fishes.push(f);
  }

  removeFish(f: FishSprite) {
    const i = this.fishes.indexOf(f);
    if (i >= 0) this.fishes.splice(i, 1);
  }

  setLine(tipX: number, tipY: number, lureX: number, lureY: number, visible: boolean) {
    this.line.tipX = tipX;
    this.line.tipY = tipY;
    this.line.lureX = lureX;
    this.line.lureY = lureY;
    this.line.visible = visible;
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const W = Math.round(rect.width);
    const H = Math.round(rect.height);
    if (W < 2 || H < 2) return;
    const dpr = this.quality === 'low' ? 1 : this.quality === 'mid' ? Math.min(1.5, window.devicePixelRatio || 1) : Math.min(2, window.devicePixelRatio || 1);

    if (W === this.W && H === this.H && dpr === this.dpr) return;
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.canvas.style.width = W + 'px';
    this.canvas.style.height = H + 'px';

    this.baseScale = W / VIEW_W;
    this.cam.W = W;
    this.cam.H = H;
    this.applyZoom();
  }

  /**
   * 推近镜头。`z = 1` 是常规视野，`0.7` 表示可见范围缩到 70%（画面放大 1.43 倍）。
   * 平滑在 render 里做，所以调用方每帧给目标值就行。
   */
  setZoom(z: number) {
    this.zoomTarget = Math.max(0.5, Math.min(1.4, z));
  }

  /** 横向平移：空中推近后视野变窄，要跟着目标横向走，否则鱼会跑出画面 */
  setPan(x: number) {
    this.panTarget = x;
  }

  private applyZoom() {
    this.cam.scale = this.baseScale / this.zoomNow;
    this.cam.cx = this.panNow;
  }

  /** 切换天气：影响雾/光/色调与雨雪粒子 */
  setWeather(id: WeatherId) {
    const w = weatherById[id] ?? weatherById.clear;
    if (w.id === this.weather.id) return;
    this.weather = w;
    this.backdrop.wave = w.wave ?? 1;
    this.rawBand = null; // 强制下一帧重算调色
  }

  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    this.backdrop.quality = q;
    this.W = 0; // 强制重算 dpr
    this.resize();
  }

  applyBand(band: Band, map: MapInfo, depth: number, above: number) {
    // 按天气调色；band 是 MAPS 里的稳定引用，只有换带/换天气才重算
    if (this.rawBand !== band) {
      this.rawBand = band;
      this.band = weatherize(band, this.weather);
    }
    this.map = map;
    this.depth = depth;
    this.above = above;
  }

  setCamera(focusY: number, shake: { x: number; y: number }, above: number) {
    // 不再给 above 额外加高度：above 现在由镜头高度反推，
    // 两边互相影响会形成反馈（镜头上下抖）。
    this.cam.cy = focusY + CAM_LEAD;
    this.shake.x = shake.x;
    this.shake.y = shake.y;
    this.cam.shakeX = shake.x;
    this.cam.shakeY = shake.y;
    this.above = above;
    this.camera.position.y = this.cam.cy;
  }

  tick(t: number) {
    this.clock = t;
  }

  /** 入水闪光由 engine 触发（抛竿落水瞬间） */
  splash() {
    this.splashed = 1;
  }

  /** 破水那一瞬：整屏一层白水幕，从下往上快速散掉 */
  burstSplash() {
    this.burst = 1;
  }

  screenToWorld(px: number, py: number) {
    return this.cam.toWorld(px, py);
  }

  worldToScreen(wx: number, wy: number, _z = 0) {
    return { x: this.cam.toScreenX(wx), y: this.cam.toScreenY(wy) };
  }

  render(dt = 1 / 60) {
    if (this.W < 2 || !this.band || !this.map) return;
    // 推近/回落的平滑放在这里做：所有绘制都读 cam.scale，改一处就能全跟上
    if (Math.abs(this.zoomNow - this.zoomTarget) > 0.001 || Math.abs(this.panNow - this.panTarget) > 0.01) {
      this.zoomNow += (this.zoomTarget - this.zoomNow) * Math.min(1, dt * 7);
      this.panNow += (this.panTarget - this.panNow) * Math.min(1, dt * 7);
      this.applyZoom();
    }
    const g = this.g;
    const cam = this.cam;
    const t = this.clock;

    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);

    this.backdrop.paintBack(g, cam, t, this.band, this.map, this.depth, this.above);
    weatherSky(g, cam, this.weather, t, this.above);
    weatherVeil(g, cam, this.weather, this.above);

    if (this.world) {
      if (this.above > 0.02) this.world.drawBoat(g, cam, t);
      this.world.drawBottles(g, cam, t);
    }

    this.drawSky(g, cam);

    // 鱼：按 z 从远到近
    if (this.fishes.length) {
      const list = this.fishes.slice().sort((a, b) => a.root.position.z - b.root.position.z);
      for (const f of list) f.draw(g, cam);
    }

    if (this.world) {
      this.world.drawLure(g, cam, t);
      if (this.line.visible) this.drawLine(g, cam);
    }

    this.backdrop.paintFront(g, cam, t, this.band, this.map, this.depth, this.above);
    weatherParticles(g, cam, t, this.weather, this.above);

    // 粒子 / 冲击环 / 飘字压在前景之上：水草挡不住命中溅出来的汁。
    // 之前这里漏了这一步，整层特效只算不画，等于白做。
    this.fx?.draw(g, cam);

    if (this.burst > 0.01) {
      this.burst = Math.max(0, this.burst - dt * 2.2);
      const b = this.burst;
      const SW = cam.W;
      const SH = cam.H;
      const gr = g.createLinearGradient(0, SH * 0.28, 0, SH);
      gr.addColorStop(0, rgba('#e8f8ff', 0));
      gr.addColorStop(0.55, rgba('#ffffff', 0.42 * b));
      gr.addColorStop(1, rgba('#ffffff', 0.7 * b));
      g.fillStyle = gr;
      g.fillRect(0, SH * 0.28, SW, SH * 0.72);
      // 一条贴着水面的亮带，像整片海被掀起
      const line = g.createLinearGradient(0, SH * 0.5, 0, SH);
      line.addColorStop(0, rgba('#ffffff', 0));
      line.addColorStop(0.35, rgba('#ffffff', 0.26 * b));
      line.addColorStop(1, rgba('#ffffff', 0));
      g.fillStyle = line;
      g.fillRect(0, SH * 0.5, SW, SH * 0.5);
    }

    this.overlay(g, dt);
    this.renderer.info.render.calls = 1 + this.fishes.length;
    this.renderer.info.render.triangles = 0;
  }


  /** 天空目标：鸟 / 飞机 / UFO，都是剪影风，被打中时整只闪白 */
  private drawSky(g: CanvasRenderingContext2D, cam: Cam) {
    if (!this.skyActors.length) return;
    const { W, H } = cam;
    for (const s of this.skyActors) {
      const px = cam.toScreenX(s.x);
      const py = cam.toScreenY(s.y);
      const L = s.size * cam.scale * 0.6;
      if (px < -L * 5 || px > W + L * 5 || py < -L * 5 || py > H + L * 5) continue;
      g.save();
      g.translate(px, py);
      if (s.vx < 0) g.scale(-1, 1);
      const hit = s.hitT > 0;
      const body = hit ? '#ffffff' : 'rgba(34,56,76,0.92)';
      const soft = hit ? '#ffffff' : 'rgba(66,100,126,0.8)';

      if (s.kind === 'bird') {
        const flap = Math.sin(s.t * 10) * L * 0.5;
        g.strokeStyle = body;
        g.lineWidth = Math.max(1.6, L * 0.16);
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(-L, flap * 0.5);
        g.quadraticCurveTo(-L * 0.45, -L * 0.62 + flap, 0, 0);
        g.quadraticCurveTo(L * 0.45, -L * 0.62 + flap, L, flap * 0.5);
        g.stroke();
        // 身体：不然两条弧线看着像眉毛
        g.fillStyle = body;
        g.beginPath();
        g.ellipse(0, L * 0.08, L * 0.3, L * 0.15, 0, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.moveTo(L * 0.26, L * 0.04);
        g.lineTo(L * 0.44, L * 0.12);
        g.lineTo(L * 0.26, L * 0.16);
        g.closePath();
        g.fill();
      } else if (s.kind === 'plane') {
        g.fillStyle = body;
        g.beginPath();
        g.ellipse(0, 0, L * 1.15, L * 0.24, 0, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.moveTo(-L * 0.15, 0);
        g.lineTo(L * 0.5, L * 0.75);
        g.lineTo(L * 0.2, 0);
        g.closePath();
        g.fill();
        g.beginPath();
        g.moveTo(L * 0.9, 0);
        g.lineTo(L * 0.78, -L * 0.55);
        g.lineTo(L * 1.12, 0);
        g.closePath();
        g.fill();
      } else {
        g.fillStyle = soft;
        g.beginPath();
        g.ellipse(0, 0, L * 1.05, L * 0.3, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = hit ? '#ffffff' : 'rgba(150,235,255,0.55)';
        g.beginPath();
        g.ellipse(0, -L * 0.22, L * 0.44, L * 0.36, 0, Math.PI, Math.PI * 2);
        g.fill();
        for (let i = -1; i <= 1; i++) {
          const a = 0.45 + 0.45 * Math.sin(s.t * 7 + i * 1.7);
          g.fillStyle = `rgba(255,232,140,${a})`;
          g.beginPath();
          g.arc(i * L * 0.52, L * 0.14, L * 0.1, 0, Math.PI * 2);
          g.fill();
        }
      }

      // 血厚的（飞机/UFO）给一条细血条，玩家知道还要补几枪
      if (s.maxHp > 4 && s.hp < s.maxHp) {
        const bw = L * 1.8;
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(-bw / 2, -L * 1.05, bw, 3);
        g.fillStyle = '#ffd166';
        g.fillRect(-bw / 2, -L * 1.05, bw * Math.max(0, s.hp / s.maxHp), 3);
      }
      g.restore();
    }
  }

  private drawLine(g: CanvasRenderingContext2D, cam: Cam) {
    const { tipX, tipY, lureX, lureY } = this.line;
    const ax = cam.toScreenX(tipX);
    const ay = cam.toScreenY(tipY);
    const bx = cam.toScreenX(lureX);
    const by = cam.toScreenY(lureY);
    if (Math.abs(by - ay) < 2) return;

    g.save();
    // 主线：略下垂的二次曲线
    const sag = Math.min(40, Math.abs(by - ay) * 0.1);
    g.beginPath();
    g.moveTo(ax, ay);
    g.quadraticCurveTo(ax + (bx - ax) * 0.35, ay + (by - ay) * 0.5 + sag, bx, by);
    g.strokeStyle = rgba('#e8f6ff', 0.5);
    g.lineWidth = Math.max(1, cam.scale * 0.014);
    g.stroke();
    // 高光芯
    g.strokeStyle = rgba('#ffffff', 0.28);
    g.lineWidth = Math.max(0.6, cam.scale * 0.006);
    g.stroke();
    g.restore();
  }

  private overlay(g: CanvasRenderingContext2D, dt: number) {
    const W = this.W;
    const H = this.H;

    // 穿越水面的水色过渡：above 在中间时铺一层水，避免「啪」地换场景
    if (this.above > 0.02 && this.above < 0.98) {
      const k = 1 - Math.abs(this.above - 0.5) * 2;
      g.fillStyle = rgba('#bfe9ff', k * 0.5);
      g.fillRect(0, 0, W, H);
    }

    // 落水闪光
    if (this.splashed > 0) {
      this.splashed = Math.max(0, this.splashed - dt * 2.6);
      g.save();
      g.globalCompositeOperation = 'lighter';
      const r = Math.max(W, H) * 0.6;
      const gr = g.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, r);
      gr.addColorStop(0, rgba('#eafaff', this.splashed * 0.75));
      gr.addColorStop(0.45, rgba('#8fd8f0', this.splashed * 0.3));
      gr.addColorStop(1, rgba('#8fd8f0', 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
      g.restore();
    }

    // 暗角：把注意力收到中间
    const vg = g.createRadialGradient(W / 2, H * 0.46, Math.min(W, H) * 0.26, W / 2, H * 0.5, Math.max(W, H) * 0.8);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(0.62, 'rgba(0,0,0,0.1)');
    vg.addColorStop(1, 'rgba(0,0,0,0.44)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
  }

  dispose() {
    this.fishes.length = 0;
    this.world = null;
    this.canvas.remove();
  }
}
