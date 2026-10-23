/**
 * 背景：天空、海面、水体、光柱、焦散、视差剪影。
 *
 * 视觉思路（为什么这样画）：
 * 1. 3D 之所以「灰蒙蒙」，是因为雾把远处压平了，而这游戏几乎没有远处。
 *    2D 改成「分层剪影」：远/中/近三层，每层用不同暗度 + 不同视差速度，
 *    层次一拉开，深度感立刻出来，不需要任何景深。
 * 2. 光线只在两处出现：水面附近的光柱、贴着背景爬的焦散。
 *    少了这两个，水下就是一块死板的渐变。
 * 3. 所有轮廓都用噪声生成，不用贴图，保证单文件离线。
 */
import { Band, MapInfo } from '../game/data';
import { Cam, shade, tint, rgba, fbm1, hash1, noiseTile } from './core';

const SPACING = 6.4; // 剪影层云团的世界间距（米）

/** 同一条深度带里，越深水色越暗、越冷 */
function deepK(depth: number): number {
  return Math.max(0.16, 1 - depth / 360);
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class Backdrop {
  /** 画质只影响「装饰层」的开关，不影响玩法与主构图 */
  quality: 'low' | 'mid' | 'high' = 'high';
  /** 浪高倍率：天气驱动（0.55 平静 ~ 2.1 雷雨） */
  wave = 1;
  private noise = noiseTile();

  // ---- 下面全是缓存：只复用同一批绘制参数，不改任何像素 ----
  /** 由 Stage2D 在 resize 时同步，噪点烘焙要按物理像素还原 */
  dpr = 1;
  /** 统一光照层：4 个色标都是常量，只随画布高度变 */
  private lightGrad: CanvasGradient | null = null;
  private lightGradH = -1;
  private lightCtx: CanvasRenderingContext2D | null = null;
  /** 焦散：按序号缓存 alpha=1 的渐变，绘制时用 globalAlpha 还原透明度 */
  private causticGrads: (CanvasGradient | null)[] = [];
  private causticR: number[] = [];
  private causticColor = '';
  private causticCtx: CanvasRenderingContext2D | null = null;
  /** 噪点：预烘焙成物理像素尺寸的位图，每帧只做一次 1:1 blit */
  private grainBaked: HTMLCanvasElement | null = null;
  private grainW = -1;
  private grainH = -1;
  private grainDpr = -1;

  /** 背景：必须在鱼之前画 */
  paintBack(
    g: CanvasRenderingContext2D,
    cam: Cam,
    t: number,
    band: Band,
    map: MapInfo,
    depth: number,
    above: number,
  ) {
    const { W, H } = cam;
    // 水线在屏幕上的位置。镜头沉下去时它一路往上滑出画面——
    // 用它（而不是一个布尔开关）来分区，穿越水面才不会有硬切。
    const hy = cam.toScreenY(0);
    const air = clamp01(above);
    // 水体那套只在「确实有水」时画：完全在水上时画了也会被天空盖住，
    // 半透明时反而会透出一堆水下剪影（看着像幽灵）
    const wet = air < 0.6;

    if (wet) {
      this.waterColumn(g, cam, t, band, map, depth);
      this.rays(g, cam, t, band, map, depth);
      this.silhouette(g, cam, t, band, map, depth, 0.34, 0.0);
      this.silhouette(g, cam, t, band, map, depth, 0.62, 1.0);
      if (this.quality !== 'low') this.farFish(g, cam, t, band, depth);
      if (this.quality === 'high') this.caustics(g, cam, t, band, depth);

      // 统一光照方向：顶亮底暗。这一层把零散元素的明暗拉回同一套光里
      // 四个色标全是常量，只有画布高度会影响它 → 缓存，不必每帧重建
      if (!this.lightGrad || this.lightCtx !== g || this.lightGradH !== H) {
        const lg = g.createLinearGradient(0, 0, 0, H);
        lg.addColorStop(0, rgba('#e6feff', 0.14));
        lg.addColorStop(0.26, rgba('#ffffff', 0));
        lg.addColorStop(0.62, rgba('#001018', 0));
        lg.addColorStop(1, rgba('#001018', 0.4));
        this.lightGrad = lg;
        this.lightCtx = g;
        this.lightGradH = H;
      }
      g.fillStyle = this.lightGrad;
      g.fillRect(0, 0, W, H);
    }

    if (air <= 0.004) return;

    // 天空只出现在水线以上那一条，透明度随「离水面远近」连续衰减：
    // 贴水面时天空还算实，潜下去两米就只剩水色——这就是真实下潜的观感。
    const skyH = Math.max(0, Math.min(H, hy));
    g.save();
    g.globalAlpha = air;
    if (skyH > 0.5) {
      g.beginPath();
      g.rect(0, 0, W, skyH);
      g.clip();
      this.sky(g, cam, t, map);
      g.restore();
      g.save();
      g.globalAlpha = air;
    }
    // 水面层：波纹、反光、亮带都画在 hy 附近，水下仰视时它也正好是「头顶那层水」
    this.seaSurface(g, cam, t, band, map, depth);
    g.restore();
  }

  /** 前景：画在鱼之上，做遮挡纵深 + 收尾的颗粒 */
  paintFront(
    g: CanvasRenderingContext2D,
    cam: Cam,
    t: number,
    band: Band,
    map: MapInfo,
    depth: number,
    above: number,
  ) {
    if (above < 0.995) {
      // 近景水草只画在水线以下，否则镜头贴着水面时它会飘到天上
      const hy = cam.toScreenY(0);
      const top = Math.max(0, Math.min(cam.H, hy));
      g.save();
      g.beginPath();
      g.rect(0, top, cam.W, cam.H - top);
      g.clip();
      this.silhouette(g, cam, t, band, map, depth, 1.15, 2.0);
      g.restore();
    }
    if (this.quality !== 'low') this.grain(g, cam);
  }

  // ------------------------------------------------------------ 水上

  private sky(
    g: CanvasRenderingContext2D,
    cam: Cam,
    t: number,
    map: MapInfo,
  ) {
    const { W, H } = cam;
    const horizon = cam.toScreenY(0);
    const top = Math.min(0, horizon);

    const gr = g.createLinearGradient(0, top, 0, horizon + 4);
    const [s0, s1, s2] = map.sky;
    gr.addColorStop(0, s0);
    gr.addColorStop(0.52, s1);
    gr.addColorStop(1, tint(s2, s1, 0.55));
    g.fillStyle = gr;
    g.fillRect(0, 0, W, Math.max(1, horizon));

    // 太阳：低角度、贴近地平线，才有「清晨出海」的味道
    const sunX = W * 0.68;
    const sunY = horizon - H * 0.2;
    const halo = g.createRadialGradient(sunX, sunY, 0, sunX, sunY, H * 0.38);
    halo.addColorStop(0, rgba(map.sun, 0.5));
    halo.addColorStop(0.22, rgba(map.sun, 0.17));
    halo.addColorStop(1, rgba(map.sun, 0));
    g.fillStyle = halo;
    g.fillRect(0, 0, W, Math.max(1, horizon));

    const core = g.createRadialGradient(sunX, sunY, 0, sunX, sunY, H * 0.055);
    core.addColorStop(0, '#ffffff');
    core.addColorStop(0.42, rgba(map.sun, 0.9));
    core.addColorStop(1, rgba(map.sun, 0));
    g.fillStyle = core;
    g.fillRect(sunX - H * 0.1, sunY - H * 0.1, H * 0.2, H * 0.2);

    // 云：极扁的椭圆条带，只在水天线附近，避免抢主体
    if (map.id === 'bay') {
      for (let i = 0; i < 5; i++) {
        const cy = horizon - H * (0.1 + i * 0.055);
        const cx = ((t * (5 + i * 2) + i * 190) % (W + 260)) - 130;
        g.fillStyle = rgba('#ffffff', 0.13 - i * 0.016);
        g.beginPath();
        g.ellipse(cx, cy, W * (0.24 + hash1(i) * 0.12), H * 0.012, 0, 0, Math.PI * 2);
        g.fill();
      }
    } else {
      // 冰海：极光带
      for (let k = 0; k < 3; k++) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        const ag = g.createLinearGradient(0, 0, 0, horizon * 0.9);
        ag.addColorStop(0, rgba('#4de2c0', 0));
        ag.addColorStop(0.45, rgba(k === 1 ? '#7cf0d8' : '#3fb6d8', 0.09));
        ag.addColorStop(1, rgba('#2a7fd0', 0));
        g.fillStyle = ag;
        g.beginPath();
        g.moveTo(0, horizon * (0.34 + k * 0.1));
        for (let x = 0; x <= W; x += 24) {
          const w = Math.sin(x * 0.006 + t * 0.24 + k * 1.9) * H * 0.05;
          g.lineTo(x, horizon * (0.34 + k * 0.1) + w);
        }
        g.lineTo(W, 0);
        g.lineTo(0, 0);
        g.closePath();
        g.fill();
        g.restore();
      }
    }

    this.farHills(g, cam, t, map);
    this.highClouds(g, cam, t, map);

    // 太空层：镜头被鱼带到很高时，天空逐渐变成深空 + 星点 + 地球弧线
    this.spaceSky(g, cam, t);
  }

  /**
   * 高空 / 太空背景。
   * 高度从水线在屏幕上的位置反推：alt = (toScreenY(0) - H/2) / scale。
   * 70m 开始压暗，110m 出星星，120m 开始露出地球弧线——鱼被连击顶得越高，画面越像冲出大气层。
   */
  private spaceSky(g: CanvasRenderingContext2D, cam: Cam, t: number) {
    const { W, H } = cam;
    const alt = Math.max(0, (cam.toScreenY(0) - H / 2) / cam.scale);
    const space = clamp01((alt - 70) / 110);
    if (space <= 0.01) return;

    // 深空底色：把原本的蓝天压成近黑
    const sg = g.createLinearGradient(0, 0, 0, H);
    sg.addColorStop(0, rgba('#02040c', 0.96 * space));
    sg.addColorStop(0.6, rgba('#040a1a', 0.9 * space));
    sg.addColorStop(1, rgba('#071428', 0.72 * space));
    g.fillStyle = sg;
    g.fillRect(0, 0, W, H);

    // 星星：固定在天球上，不跟镜头位移（远到没有视差）
    const n = 140;
    for (let i = 0; i < n; i++) {
      const seed = i * 3.77;
      const x = hash1(seed) * W;
      const y = hash1(seed + 1.9) * H * 0.94;
      const tw = 0.55 + 0.45 * Math.sin(t * (1.1 + hash1(seed + 3.3) * 2.6) + seed);
      const r = 0.55 + hash1(seed + 5.1) * 1.5;
      g.fillStyle = rgba('#eaf4ff', (0.22 + 0.6 * hash1(seed + 6.7)) * tw * space);
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }

    // 月亮：比地球更远，只在很高的地方露出来
    const moon = clamp01((alt - 190) / 80);
    if (moon > 0.01) {
      const mx = W * 0.18;
      const my = H * 0.14;
      const mr = W * 0.075;
      const mg = g.createRadialGradient(mx - mr * 0.35, my - mr * 0.35, 0, mx, my, mr);
      mg.addColorStop(0, rgba('#f4f7ff', 0.95 * moon));
      mg.addColorStop(0.7, rgba('#c9d3e6', 0.9 * moon));
      mg.addColorStop(1, rgba('#8a93a8', 0.85 * moon));
      g.fillStyle = mg;
      g.beginPath();
      g.arc(mx, my, mr, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = rgba('#9aa4b8', 0.5 * moon);
      for (const [dx, dy, r] of [
        [-0.32, -0.18, 0.16],
        [0.18, 0.22, 0.2],
        [0.42, -0.3, 0.1],
      ]) {
        g.beginPath();
        g.arc(mx + dx * mr, my + dy * mr, r * mr, 0, Math.PI * 2);
        g.fill();
      }
    }

    // 流星：每 7.5 秒划一颗，只在有星空时出现
    const period = 7.5;
    const ph = t % period;
    if (space > 0.35 && ph < 0.65) {
      const k = Math.floor(t / period);
      const sx = W * (0.15 + hash1(k * 2.7) * 0.7);
      const sy = H * (0.05 + hash1(k * 4.1) * 0.25);
      const p = ph / 0.65;
      const len = W * 0.16;
      const ex = sx + len * p;
      const ey = sy + len * 0.42 * p;
      const tg = g.createLinearGradient(sx, sy, ex, ey);
      tg.addColorStop(0, rgba('#ffffff', 0.9 * space * (1 - p)));
      tg.addColorStop(1, rgba('#ffffff', 0));
      g.strokeStyle = tg;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(ex, ey);
      g.stroke();
    }

    // 地球：从下方露出一条蓝色弧线，越往上露得越多
    const earth = clamp01((alt - 120) / 100);
    if (earth <= 0.01) return;
    const cx = W / 2;
    const limbY = H * (0.9 + 0.06 * (1 - earth));
    const R = W * 2.4;
    g.save();
    g.beginPath();
    g.arc(cx, limbY + R, R, 0, Math.PI * 2);
    g.clip();
    const og = g.createLinearGradient(0, limbY - H * 0.05, 0, H);
    og.addColorStop(0, rgba('#6fd6ff', 0.95));
    og.addColorStop(0.18, rgba('#2f93d8', 0.97));
    og.addColorStop(0.6, rgba('#155a9e', 1));
    og.addColorStop(1, rgba('#082a55', 1));
    g.fillStyle = og;
    g.fillRect(0, limbY - H * 0.06, W, H - limbY + H * 0.06);
    // 云带
    for (let i = 0; i < 7; i++) {
      const seed = i * 5.31;
      const yy = limbY + H * (0.05 + hash1(seed) * 0.5);
      const xx = ((hash1(seed + 1.4) * W * 1.4 + t * 2.2) % (W * 1.4)) - W * 0.2;
      g.fillStyle = rgba('#eaf8ff', 0.1 + hash1(seed + 2.6) * 0.12);
      g.beginPath();
      g.ellipse(xx, yy, W * (0.16 + hash1(seed + 3.8) * 0.2), H * 0.012, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();

    // 大气边缘
    g.save();
    g.strokeStyle = rgba('#a9ecff', 0.85 * earth);
    g.lineWidth = 2.4;
    g.shadowColor = '#5fd0ff';
    g.shadowBlur = 18;
    g.beginPath();
    g.arc(cx, limbY + R, R, Math.PI * 1.12, Math.PI * 1.88);
    g.stroke();
    g.restore();
  }

  /**
   * 高空云层。
   *
   * 为什么必须有：鱼被甩到二三十米高时，画面里只剩一片蓝色渐变，玩家完全感觉不到
   * 「我在升高」。云按世界高度铺几层、跟着相机滚过去，高度才看得见。
   * 层高越往上间隔越大（真实云也是越高越稀），颜色越浅。
   */
  private highClouds(g: CanvasRenderingContext2D, cam: Cam, t: number, map: MapInfo) {
    if (this.quality === 'low') return;
    const { W, H } = cam;
    const ice = map.id === 'ice';
    // y = 世界高度（米），w = 云团宽度（米），a = 透明度
    const bands = [
      { y: 11, w: 3.2, a: ice ? 0.14 : 0.18 },
      { y: 19, w: 4.4, a: ice ? 0.16 : 0.24 },
      { y: 31, w: 6.2, a: ice ? 0.18 : 0.3 },
      { y: 47, w: 8.4, a: ice ? 0.2 : 0.36 },
      { y: 70, w: 11, a: ice ? 0.22 : 0.42 },
      { y: 98, w: 14, a: ice ? 0.16 : 0.3 },
      { y: 132, w: 18, a: ice ? 0.12 : 0.22 },
      { y: 175, w: 23, a: ice ? 0.09 : 0.16 },
    ];
    const col = ice ? '#cfe4ff' : '#ffffff';
    for (const b of bands) {
      const sy = cam.toScreenY(b.y);
      if (sy < -H * 0.35 || sy > H * 1.35) continue;
      const radius = b.w * cam.scale * 0.5;
      for (let i = 0; i < 2; i++) {
        const seed = hash1(b.y * 0.37 + i * 11.3);
        // 横向缓慢漂移 + 按世界宽度平铺，镜头抬升时云会相对往下走
        const drift = t * (4 + b.y * 0.12);
        const x = ((seed * W * 1.6 + drift) % (W + radius * 2)) - radius;
        const gr = g.createRadialGradient(x, sy, 0, x, sy, radius);
        gr.addColorStop(0, rgba(col, b.a));
        gr.addColorStop(0.5, rgba(col, b.a * 0.52));
        gr.addColorStop(1, rgba(col, 0));
        g.fillStyle = gr;
        g.beginPath();
        g.ellipse(x, sy, radius, radius * 0.26, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  /** 远景陆地剪影：只在水上出现，用两层做出空气透视 */
  private farHills(g: CanvasRenderingContext2D, cam: Cam, t: number, map: MapInfo) {
    const { W, H } = cam;
    const horizon = cam.toScreenY(0);
    if (horizon < -H * 0.2) return;

    for (let layer = 0; layer < 2; layer++) {
      const h = H * (layer === 0 ? 0.075 : 0.042);
      const baseY = horizon - (layer === 0 ? h * 0.42 : 0);
      const col = layer === 0 ? tint(map.sky[2], map.sky[1], 0.45) : tint(map.sky[2], map.sky[1], 0.2);
      g.fillStyle = rgba(col, layer === 0 ? 0.5 : 0.72);
      g.beginPath();
      g.moveTo(0, baseY + h * 0.6);
      const drift = t * (layer === 0 ? 1.6 : 3.1);
      for (let x = -20; x <= W + 20; x += 12) {
        const n = fbm1((x + drift) * 0.006 + layer * 12, 3 + layer);
        g.lineTo(x, baseY - n * h);
      }
      g.lineTo(W + 20, baseY + h);
      g.closePath();
      g.fill();
    }
  }

  /** 水上看到的海面：镜面反射 + 透视波纹 */
  private seaSurface(
    g: CanvasRenderingContext2D,
    cam: Cam,
    t: number,
    band: Band,
    map: MapInfo,
    depth: number,
  ) {
    const { W, H } = cam;
    const horizon = cam.toScreenY(0);
    if (horizon > H) return;
    const y0 = Math.max(0, horizon);

    const dk = deepK(depth);
    const gr = g.createLinearGradient(0, y0, 0, H);
    gr.addColorStop(0, tint(map.sky[1], band.fog, 0.55));
    gr.addColorStop(0.14, shade(band.fog, 0.02));
    gr.addColorStop(1, shade(band.fog, -0.4 * (1.15 - dk * 0.15)));
    g.fillStyle = gr;
    g.fillRect(0, y0, W, H - y0);

    // 天空倒影带：紧贴地平线最亮
    const rg = g.createLinearGradient(0, y0, 0, y0 + H * 0.22);
    rg.addColorStop(0, rgba(map.sun, 0.34));
    rg.addColorStop(0.35, rgba(map.sky[1], 0.2));
    rg.addColorStop(1, rgba(map.sky[1], 0));
    g.fillStyle = rg;
    g.fillRect(0, y0, W, H * 0.22);

    // 水天线：一条发亮的细带，把天空和海分开但不生硬
    const edge = g.createLinearGradient(0, horizon - 10, 0, horizon + 30);
    edge.addColorStop(0, rgba('#ffffff', 0));
    edge.addColorStop(0.3, rgba('#f2ffff', 0.42));
    edge.addColorStop(0.52, rgba('#ffffff', 0.5));
    edge.addColorStop(1, rgba('#dff8ff', 0));
    g.fillStyle = edge;
    g.fillRect(0, horizon - 10, W, 40);

    // 波纹：两层——远细密、近粗疏，透视感靠线宽和间距拉开
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 64; i++) {
      const k = i / 64;
      const py = y0 + Math.pow(k, 1.9) * (H - y0) * 1.08;
      if (py > H + 6) break;
      const amp = 1.2 + k * 10;
      const len = W * (0.04 + k * 0.26);
      const ph = hash1(i * 3.1) * 6.28;
      const sp = 0.45 + hash1(i * 7.7) * 1.5;
      const cx = ((Math.sin(t * sp + ph) * 0.5 + 0.5) * (W + len * 2)) - len;
      g.strokeStyle = rgba(map.sun, 0.04 + k * 0.13);
      g.lineWidth = 0.8 + k * 2.6;
      g.beginPath();
      g.moveTo(cx - len / 2, py);
      g.quadraticCurveTo(cx, py - amp, cx + len / 2, py);
      g.stroke();
    }

    // 高光碎片：白色短横线，玻璃海的「闪」全靠它
    for (let i = 0; i < 42; i++) {
      const k = Math.pow(hash1(i * 3.7), 0.72);
      const py = y0 + 6 + k * (H - y0) * 0.96;
      if (py > H + 4) continue;
      const len = 5 + k * 30;
      const px = hash1(i * 5.1) * W;
      const a = (0.12 + hash1(i * 7.3) * 0.34) * (0.3 + k * 0.7);
      const flick = 0.6 + 0.4 * Math.sin(t * 2.2 + i * 1.7);
      g.strokeStyle = rgba('#ffffff', a * flick);
      g.lineWidth = 1 + k * 2.2;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px + len, py);
      g.stroke();
    }
    g.restore();

    // 太阳在水面的碎光柱
    const sunX = W * 0.68;
    const sg = g.createLinearGradient(sunX, y0, sunX, H);
    sg.addColorStop(0, rgba(map.sun, 0.11));
    sg.addColorStop(0.5, rgba(map.sun, 0.035));
    sg.addColorStop(1, rgba(map.sun, 0));
    g.fillStyle = sg;
    g.beginPath();
    g.moveTo(sunX - H * 0.02, y0);
    g.lineTo(sunX + H * 0.02, y0);
    g.lineTo(sunX + W * 0.34, H);
    g.lineTo(sunX - W * 0.34, H);
    g.closePath();
    g.fill();
  }

  // ------------------------------------------------------------ 水下

  private waterColumn(
    g: CanvasRenderingContext2D,
    cam: Cam,
    t: number,
    band: Band,
    map: MapInfo,
    depth: number,
  ) {
    const { W, H } = cam;
    const dk = deepK(depth);
    const surface = cam.toScreenY(0);

    // 屏幕内固定「上亮下暗」：水面方向总有光，深渊方向必然暗。
    // 再乘一个随深度衰减的系数，越深整屏越沉。
    const dim = (c: string) => {
      const v = shade(c, -(1 - dk) * 0.62);
      // 冰海是永夜：压暗并往深蓝偏，靠极光和头灯打亮
      return map.id === 'ice' ? tint(shade(v, -0.32), '#0a3a5c', 0.34) : v;
    };
    const topCol = dim(tint(band.fog, '#ffffff', map.id === 'ice' ? 0.24 : 0.56));
    const midCol = dim(shade(band.fog, -0.02));
    const botCol = dim(shade(band.fog, -0.78));

    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, topCol);
    gr.addColorStop(0.2, midCol);
    gr.addColorStop(0.58, dim(shade(band.fog, -0.32)));
    gr.addColorStop(1, botCol);
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);

    // 顶部环境光：像是有光从水面上方渗下来
    const tg = g.createLinearGradient(0, 0, 0, H * 0.42);
    tg.addColorStop(0, rgba(tint(band.fog, '#ffffff', 0.72), (map.id === 'ice' ? 0.22 : 0.5) * dk));
    tg.addColorStop(0.3, rgba(tint(band.fog, '#ffffff', 0.5), 0.14 * dk));
    tg.addColorStop(1, rgba(band.fog, 0));
    g.fillStyle = tg;
    g.fillRect(0, 0, W, H * 0.42);

    // 水面在头顶：斯涅尔窗（一条会呼吸的亮带）
    if (surface > -H * 0.2 && surface < H * 0.55) {
      const wg = g.createLinearGradient(0, surface - H * 0.08, 0, surface + H * 0.34);
      wg.addColorStop(0, rgba('#eafcff', 0.34 * dk + 0.16));
      wg.addColorStop(0.18, rgba('#bff0ff', 0.26 * dk + 0.08));
      wg.addColorStop(1, rgba('#bff0ff', 0));
      g.fillStyle = wg;
      g.fillRect(0, Math.max(0, surface - H * 0.08), W, H * 0.42);

      // 水面波纹的投影
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 6; i++) {
        const yy = surface + i * 11 + 4;
        const amp = 2 + this.wave * 2.2;
        g.strokeStyle = rgba('#f0ffff', (0.13 - i * 0.018) * (0.35 + dk * 0.65));
        g.lineWidth = 2.2;
        g.beginPath();
        for (let x = 0; x <= W; x += 16) {
          const w = Math.sin(x * 0.019 + t * 1.1 + i * 1.7) * amp + Math.sin(x * 0.043 - t * 0.7) * amp * 0.5;
          if (x === 0) g.moveTo(x, yy + w);
          else g.lineTo(x, yy + w);
        }
        g.stroke();
      }
      g.restore();
    }

    // 极光：冰海的灵魂，没有它就只是一片灰水
    if (map.id === 'ice') {
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 3; k++) {
        const ag = g.createLinearGradient(0, 0, 0, H * 0.34);
        ag.addColorStop(0, rgba(k === 1 ? '#5affc8' : '#3aa8e0', 0.24 - k * 0.03));
        ag.addColorStop(0.55, rgba(k === 1 ? '#3fe0b4' : '#2f86c8', 0.1));
        ag.addColorStop(1, rgba('#2f86c8', 0));
        g.fillStyle = ag;
        g.beginPath();
        g.moveTo(0, 0);
        for (let x = 0; x <= W; x += 18) {
          const y = H * (0.05 + k * 0.06) + Math.sin(x * 0.0072 + t * 0.32 + k * 1.7) * H * 0.038;
          g.lineTo(x, y);
        }
        g.lineTo(W, 0);
        g.closePath();
        g.fill();
      }
      g.restore();
    }

    // 悬浮微尘
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 46; i++) {
      const seed = i * 5.13;
      const px = hash1(seed) * W;
      const speed = 5 + hash1(seed + 1.7) * 13;
      const py = ((hash1(seed + 3.3) * H + t * speed + cam.cy * 22 * (0.3 + hash1(seed + 9) * 0.7)) % (H + 40)) - 20;
      const r = 0.6 + hash1(seed + 5.5) * 1.6;
      const a = (0.08 + hash1(seed + 7.1) * 0.26) * (0.3 + dk * 0.7);
      g.fillStyle = rgba('#f2ffff', a);
      g.beginPath();
      g.arc(px, py, r, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();

    void map;
  }

  /** 光柱：从水面斜射下来，随时间和深度摆动 */
  private rays(
    g: CanvasRenderingContext2D,
    cam: Cam,
    t: number,
    band: Band,
    map: MapInfo,
    depth: number,
  ) {
    const { W, H } = cam;
    const dk = deepK(depth);
    if (dk < 0.06) return;

    g.save();
    g.globalCompositeOperation = 'lighter';
    // 少而强：4 根里只有 2 根明显，其余做陪衬，避免满屏竖纹
    const n = 4;
    for (let i = 0; i < n; i++) {
      const seed = i * 13.7;
      const sway = Math.sin(t * 0.32 + seed) * 0.5 + Math.sin(t * 0.11 + seed * 2.1) * 0.5;
      const baseX = ((i + 0.5) / n) * W * 1.1 - W * 0.05 + sway * W * 0.06;
      const width = W * (0.035 + hash1(seed + 1) * 0.09);
      const tilt = (hash1(seed + 2) - 0.5) * W * 0.62 + sway * W * 0.1;
      // 始终从屏幕顶端画起并向下渐隐：水面在屏幕外时也不会出现水平切边
      const y0 = -H * 0.04;
      const len = H * 1.2;
      const pulse = 0.55 + 0.45 * Math.sin(t * 0.6 + seed * 1.7);
      const strength = 0.34 + hash1(seed + 9) * 0.66;
      const a = 0.2 * pulse * dk * strength * (map.id === 'ice' ? 0.34 : 1);

      // 外层：宽而淡，做柔边
      const gr = g.createLinearGradient(0, y0, 0, y0 + len);
      gr.addColorStop(0, rgba(band.ray, a));
      gr.addColorStop(0.26, rgba(band.ray, a * 0.62));
      gr.addColorStop(0.74, rgba(band.ray, a * 0.16));
      gr.addColorStop(1, rgba(band.ray, 0));
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(baseX - width * 0.5, y0);
      g.lineTo(baseX + width * 0.5, y0);
      g.lineTo(baseX + tilt + width * 1.35, y0 + len);
      g.lineTo(baseX + tilt - width * 1.35, y0 + len);
      g.closePath();
      g.fill();

      // 内层：窄而亮，做光芯
      const gr2 = g.createLinearGradient(0, y0, 0, y0 + len);
      gr2.addColorStop(0, rgba('#ffffff', a * 0.9));
      gr2.addColorStop(0.2, rgba(band.ray, a * 0.55));
      gr2.addColorStop(0.66, rgba(band.ray, 0));
      g.fillStyle = gr2;
      g.beginPath();
      g.moveTo(baseX - width * 0.16, y0);
      g.lineTo(baseX + width * 0.16, y0);
      g.lineTo(baseX + tilt + width * 0.8, y0 + len);
      g.lineTo(baseX + tilt - width * 0.8, y0 + len);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  /** 远景鱼影：极淡的小剪影，纯粹用来让海里「有东西」，不参与玩法 */
  private farFish(
    g: CanvasRenderingContext2D,
    cam: Cam,
    t: number,
    band: Band,
    depth: number,
  ) {
    const { W, H } = cam;
    const dk = deepK(depth);
    g.save();
    for (let i = 0; i < 9; i++) {
      const seed = i * 11.3;
      const dir = hash1(seed + 2) > 0.5 ? 1 : -1;
      const speed = 4 + hash1(seed + 4) * 7;
      const x = ((dir > 0 ? hash1(seed + 1) * W + t * speed : hash1(seed + 1) * W - t * speed) % (W + 120) + W + 120) % (W + 120) - 60;
      const y = ((hash1(seed) * H + t * 2.2 + cam.cy * 9 * (0.3 + hash1(seed + 5) * 0.7)) % (H + 120)) - 60;
      const len = (5 + hash1(seed + 3) * 8) * (cam.scale / 60);
      const wave = Math.sin(t * 2.4 + seed) * 0.1;

      g.fillStyle = rgba(shade(band.fog, -0.24), 0.16 * dk + 0.05);
      g.beginPath();
      g.ellipse(x, y, len, len * 0.34, wave * 0.3, 0, Math.PI * 2);
      g.fill();
      // 尾巴
      g.beginPath();
      g.moveTo(x - dir * len * 0.9, y);
      g.lineTo(x - dir * len * 1.5, y - len * 0.3 + wave * 4);
      g.lineTo(x - dir * len * 1.5, y + len * 0.3 + wave * 4);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  /** 波光：贴在背景上的蠕动的光带，模拟水面把阳光聚焦成网 */
  private caustics(
    g: CanvasRenderingContext2D,
    cam: Cam,
    t: number,
    band: Band,
    depth: number,
  ) {
    const dk = deepK(depth);
    if (dk < 0.2) return;
    const { W, H, scale } = cam;
    g.save();
    g.globalCompositeOperation = 'lighter';

    // 水色变了就整批作废（颜色写在渐变里，不能只换一部分）
    if (this.causticCtx !== g || this.causticColor !== band.ray) {
      this.causticGrads.length = 0;
      this.causticR.length = 0;
      this.causticColor = band.ray;
      this.causticCtx = g;
    }

    for (let i = 0; i < 16; i++) {
      const seed = i * 7.31;
      const bx = hash1(seed) * W + Math.sin(t * 0.22 + seed) * 12;
      const by = ((hash1(seed + 1) * H + t * (4 + hash1(seed + 5) * 8) + cam.cy * 14 * (0.4 + hash1(seed + 6) * 0.6)) % (H + 140)) - 70;
      const rx = (13 + hash1(seed + 2) * 34) * (scale / 60);
      const ry = rx * (0.3 + hash1(seed + 3) * 0.28);
      const a = (0.035 + hash1(seed + 4) * 0.055) * dk * (0.5 + 0.5 * Math.sin(t * 0.7 + seed));
      if (a <= 0.004) continue;
      // 缓存的渐变固定 alpha=1，绘制时用 globalAlpha 乘回去。
      // 原写法三个色标是 (a, 0.45a, 0)，每个都同乘 a → 与 (1, 0.45, 0) × globalAlpha=a 逐像素一致。
      let gr = this.causticGrads[i];
      if (!gr || Math.abs(this.causticR[i] - rx) > 0.5) {
        gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
        gr.addColorStop(0, rgba(band.ray, 1));
        gr.addColorStop(0.55, rgba(band.ray, 0.45));
        gr.addColorStop(1, rgba(band.ray, 0));
        this.causticGrads[i] = gr;
        this.causticR[i] = rx;
      }
      g.save();
      g.translate(bx, by);
      g.scale(1, ry / rx);
      g.globalAlpha = a;
      g.fillStyle = gr;
      g.beginPath();
      g.arc(0, 0, rx, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    g.restore();
  }

  /**
   * 视差剪影层。speed < 1 表示移动得比相机慢（看起来更远）。
   * near=true 时色更深，用来做前景遮挡，制造「从水草后面看过去」的纵深。
   */
  private silhouette(
    g: CanvasRenderingContext2D,
    cam: Cam,
    t: number,
    band: Band,
    map: MapInfo,
    depth: number,
    speed: number,
    seedBias: number,
  ) {
    const { W, H, scale } = cam;
    const dk = deepK(depth);
    const near = speed > 1;
    // 空气透视：越远越接近水色（融进雾里），越近越黑（剪影）。
    // 三层分别对应「雾里轮廓 / 中景 / 前景遮挡」。
    const dark = near ? -0.9 : speed > 0.5 ? -0.52 : -0.2;
    const col = shade(band.fog, dark * (1.14 - dk * 0.22));
    const alpha = near ? 0.96 : speed > 0.5 ? 0.72 : 0.5;
    const layerCam = cam.cy * speed;

    const viewH = H / scale;
    const top = layerCam - viewH / 2 - SPACING;
    const bot = layerCam + viewH / 2 + SPACING;
    const i0 = Math.floor(top / SPACING);
    const i1 = Math.ceil(bot / SPACING);
    // 越近的层越密，否则竖屏中间会空得像一张纸
    const perCell = near ? 3 : speed > 0.5 ? 2 : 1;

    g.save();
    g.fillStyle = rgba(col, alpha);
    for (let i = i0; i <= i1; i++) {
      for (let k = 0; k < perCell; k++) {
        const seed = i * 2.71 + seedBias * 17.3 + k * 7.77;
        const r = hash1(seed);
        if (r < (near ? 0.06 : 0.2)) continue; // 留白，避免每格都有东西
        const wy = i * SPACING + (hash1(seed + 1) - 0.5) * 3.2 + (k - (perCell - 1) / 2) * (SPACING / perCell);
        const sy = cam.toScreenY(wy - (cam.cy - layerCam));
        const side = hash1(seed + 2) > 0.5 ? 1 : -1;
        const s = (0.65 + hash1(seed + 3) * 0.85) / (speed > 1 ? 1.35 : 1);

        if (r < 0.42) this.coralClump(g, cam, side, sy, s, seed + 4, t);
        else if (r < 0.72) this.rockClump(g, cam, side, sy, s, seed + 8);
        else this.kelpClump(g, cam, side, sy, s, seed + 12, t);
      }
    }
    g.restore();

    // 冰海额外：冰柱从上方垂下来
    if (map.id === 'ice' && !near && speed < 0.5) {
      g.save();
      g.fillStyle = rgba(tint(col, '#bfe9ff', 0.3), 0.5);
      for (let i = i0; i <= i1; i++) {
        const seed = i * 9.13;
        if (hash1(seed) < 0.55) continue;
        const sy = cam.toScreenY(i * SPACING + hash1(seed + 1) * 3);
        const w = 6 + hash1(seed + 2) * 22;
        const h = (24 + hash1(seed + 3) * 58) * (cam.scale / 60);
        g.beginPath();
        g.moveTo(W * 0.5 + (hash1(seed + 4) - 0.5) * W - w / 2, sy - h);
        g.lineTo(W * 0.5 + (hash1(seed + 4) - 0.5) * W + w / 2, sy - h);
        g.lineTo(W * 0.5 + (hash1(seed + 4) - 0.5) * W, sy);
        g.closePath();
        g.fill();
      }
      g.restore();
    }
  }

  /** 珊瑚：从一点长出几根渐细的分叉枝，末端带小球（不是三角形） */
  private coralClump(
    g: CanvasRenderingContext2D,
    cam: Cam,
    side: number,
    sy: number,
    s: number,
    seed: number,
    t: number,
  ) {
    const { W, scale } = cam;
    const k = scale / 60;
    const bx = side > 0 ? W * (0.86 + hash1(seed) * 0.12) : W * (0.14 - hash1(seed) * 0.12);
    const branches = 3 + Math.floor(hash1(seed + 1) * 3);
    g.strokeStyle = g.fillStyle;
    g.lineCap = 'round';

    for (let b = 0; b < branches; b++) {
      const lean = (hash1(seed + b * 7) - 0.5) * 1.05;
      const h = (44 + hash1(seed + b * 5) * 62) * s * k;
      const sway = Math.sin(t * 0.5 + b * 1.3 + seed) * 0.07;
      const w0 = (6 + hash1(seed + b * 9) * 5) * s * k;
      const tipX = bx + (lean + sway) * h * 0.72;
      const tipY = sy - h;

      // 主枝
      g.lineWidth = w0;
      g.beginPath();
      g.moveTo(bx, sy);
      g.quadraticCurveTo(bx + lean * h * 0.22, sy - h * 0.56, tipX, tipY);
      g.stroke();

      // 侧枝
      if (hash1(seed + b * 11) > 0.45) {
        const sx = bx + (tipX - bx) * 0.52;
        const syy = sy - h * 0.5;
        g.lineWidth = w0 * 0.62;
        g.beginPath();
        g.moveTo(sx, syy);
        g.quadraticCurveTo(sx + w0 * 2.2, syy - h * 0.24, sx + w0 * 3.4, syy - h * 0.46);
        g.stroke();
      }

      // 末端小球：珊瑚虫的触手感
      g.beginPath();
      g.arc(tipX, tipY, w0 * 0.58, 0, Math.PI * 2);
      g.fill();
    }
  }

  /** 岩石：不对称的多段弧 + 附着小石，避免变成「面包」 */
  private rockClump(
    g: CanvasRenderingContext2D,
    cam: Cam,
    side: number,
    sy: number,
    s: number,
    seed: number,
  ) {
    const { W, scale } = cam;
    const k = scale / 60;
    const bx = side > 0 ? W * (0.92 + hash1(seed) * 0.1) : W * (0.08 - hash1(seed) * 0.1);
    const w = (44 + hash1(seed + 1) * 58) * s * k;
    const h = (24 + hash1(seed + 2) * 42) * s * k;
    const wob = (hash1(seed + 3) - 0.5) * 0.5;

    g.beginPath();
    g.moveTo(bx - w, sy);
    g.bezierCurveTo(bx - w * 0.92, sy - h * (0.72 + wob), bx - w * 0.5, sy - h * 1.06, bx - w * 0.12, sy - h * (0.98 - wob * 0.4));
    g.bezierCurveTo(bx + w * 0.2, sy - h * 0.9, bx + w * 0.5, sy - h * (0.62 + wob), bx + w * 0.7, sy - h * 0.34);
    g.bezierCurveTo(bx + w * 0.88, sy - h * 0.16, bx + w * 0.96, sy - h * 0.06, bx + w, sy);
    g.closePath();
    g.fill();

    if (hash1(seed + 4) > 0.4) {
      g.beginPath();
      g.ellipse(bx + w * 0.62, sy - h * 0.12, w * 0.26, h * 0.3, -0.2, Math.PI, Math.PI * 2);
      g.fill();
    }
  }

  /** 海带：细长弯曲的叶片，根部宽、顶端尖，随水流摆 */
  private kelpClump(
    g: CanvasRenderingContext2D,
    cam: Cam,
    side: number,
    sy: number,
    s: number,
    seed: number,
    t: number,
  ) {
    const { W, scale } = cam;
    const k = scale / 60;
    const bx = side > 0 ? W * (0.93 + hash1(seed) * 0.08) : W * (0.07 - hash1(seed) * 0.08);
    const blades = 2 + Math.floor(hash1(seed + 1) * 3);
    for (let b = 0; b < blades; b++) {
      const ox = (hash1(seed + b * 3) - 0.5) * 38 * s;
      const h = (78 + hash1(seed + b * 5) * 96) * s * k;
      const sway = Math.sin(t * 0.72 + b * 1.5 + seed) * 0.15;
      const w = (5.5 + hash1(seed + b * 7) * 6) * s * k;
      const x0 = bx + ox;
      const tipX = x0 + sway * h;
      const tipY = sy - h;

      g.beginPath();
      g.moveTo(x0 - w, sy);
      g.bezierCurveTo(x0 - w * 1.05, sy - h * 0.34, tipX - w * 0.42, sy - h * 0.74, tipX, tipY);
      g.bezierCurveTo(tipX + w * 0.46, sy - h * 0.72, x0 + w * 1.05, sy - h * 0.32, x0 + w, sy);
      g.closePath();
      g.fill();
    }
  }

  /** 颗粒：压掉大面积渐变的「塑料感」 */
  private grain(g: CanvasRenderingContext2D, cam: Cam) {
    const W = cam.W;
    const H = cam.H;
    const dpr = this.dpr;
    // 尺寸或像素比变了才重新烘焙（resize 时一次）
    if (!this.grainBaked || this.grainW !== W || this.grainH !== H || this.grainDpr !== dpr) {
      if (!this.noise) return;
      const off = document.createElement('canvas');
      off.width = Math.max(1, Math.round(W * dpr));
      off.height = Math.max(1, Math.round(H * dpr));
      const og = off.getContext('2d');
      if (!og) return;
      // 与原来逐帧做的事完全一致：同样的变换、同样的 pattern、同样的 alpha
      og.setTransform(dpr, 0, 0, dpr, 0, 0);
      og.globalAlpha = 0.5;
      const pat = og.createPattern(this.noise, 'repeat');
      if (!pat) return;
      og.fillStyle = pat;
      og.fillRect(0, 0, W, H);
      this.grainBaked = off;
      this.grainW = W;
      this.grainH = H;
      this.grainDpr = dpr;
    }
    const baked = this.grainBaked;
    if (!baked) return;
    // 烘焙结果已经是最终像素，1:1 贴上去即可
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.drawImage(baked, 0, 0);
    g.restore();
  }
}
