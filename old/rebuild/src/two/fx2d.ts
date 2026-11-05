/**
 * 粒子 / 冲击环 / 飘字。API 与 3D 版完全一致，引擎侧不用改。
 * 2D 的优势是加色混合便宜，所以光效可以给得比 3D 更大胆。
 */
import { Cam, rgba, hash1 } from './core';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  color: string;
  size: number;
  gravity: number;
  /** 阻尼：汁液比火星「粘」，飞不远 */
  drag?: number;
  /** 沿速度方向拉长的倍数（1 = 正圆）。汁液的拉丝感全靠这个 */
  stretch?: number;
  /** 汁液粒子用普通混合（加色会把颜色冲成白），其它粒子仍走 lighter */
  juice?: boolean;
  /** 汁液的深色描边：浅蓝天空上，灰蓝色的鱼汁不加边几乎看不见 */
  edge?: string;
  /** 液滴的亮部（鱼身上较亮的那个色），做高光 */
  glint?: string;
}

/** 命中点那团短暂的颜色残留：爆开的一瞬间整块肉/汁的轮廓 */
interface Splat {
  x: number;
  y: number;
  z: number;
  color: string;
  r: number;
  life: number;
  max: number;
}

/**
 * 颜色工具：统一进出 #rrggbb。
 * 不能用 core 的 `shade()` / `mixHex()`：它们返回 `rgb(...)` 字符串，
 * 而这里的 `rgba()` 只吃 hex —— 喂进去会得到 `rgba(NaN,NaN,NaN,a)`，
 * canvas 直接忽略这个颜色，粒子整个隐形（这个坑踩过一次）。
 */
function rgbOf(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
}

function hexOf(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

/** 变暗 */
function darken(hex: string, k: number): string {
  const [r, g, b] = rgbOf(hex);
  return hexOf(r * k, g * k, b * k);
}

/** 提亮（往白里混） */
function lighten(hex: string, t: number): string {
  const [r, g, b] = rgbOf(hex);
  const f = (v: number) => v + (255 - v) * t;
  return hexOf(f(r), f(g), f(b));
}

/** 两个颜色按 t 混合 */
function mix(a: string, b: string, t: number): string {
  const A = rgbOf(a);
  const B = rgbOf(b);
  return hexOf(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

interface Ring {
  x: number;
  y: number;
  z: number;
  color: string;
  from: number;
  to: number;
  life: number;
  max: number;
}

interface FloatText {
  x: number;
  y: number;
  z: number;
  txt: string;
  color: string;
  size: number;
  life: number;
  max: number;
}

export class FX {
  private ps: Particle[] = [];
  private rings: Ring[] = [];
  private texts: FloatText[] = [];
  private splats: Splat[] = [];

  /**
   * 命中溅射：像打爆一颗水果那样，从受击点喷出一束带颜色的汁。
   *
   * 和 `spawn()` 的区别不是「多几个粒子」，而是三点：
   *  1. 方向性——沿 dir 张成一个锥形，不是均匀圆环（子弹打进去是有方向的）
   *  2. 有重量——重力 -22，汁水飞出去会往下坠，弧线才像液体
   *  3. 拉丝——粒子沿速度方向拉长，越快越长，静止时缩回圆点
   */
  juice(
    x: number,
    y: number,
    z: number,
    opt: {
      color: string;
      color2?: string;
      n?: number;
      speed?: number;
      dir?: number;
      spread?: number;
      life?: number;
      size?: number;
      /** 载体速度：鱼被打飞时，身上的汁也跟着一起走，而不是留在原地 */
      carryX?: number;
      carryY?: number;
    },
  ) {
    const n = opt.n ?? 18;
    const sp = opt.speed ?? 9;
    const dir = opt.dir ?? Math.PI / 2; // 世界 y 向上为正 → +90° 是朝上喷
    const arc = opt.spread ?? Math.PI * 1.3;
    for (let i = 0; i < n; i++) {
      if (this.ps.length > 420) break;
      const a = dir + (Math.random() - 0.5) * arc;
      const k = 0.28 + Math.random() * 0.72;
      const life = (opt.life ?? 0.5) * (0.6 + Math.random() * 0.7);
      // 主体取「亮部 + 暗部」的中值：纯亮色在浅蓝天上飘，纯暗色像墨汁，
      // 一半一半才既压得住背景、又保留鱼自己的色相。每三个里有一个更亮，做出层次。
      const main = opt.color2 ? mix(opt.color, opt.color2, 0.5) : opt.color;
      const c = i % 3 === 0 ? lighten(main, 0.2) : main;
      this.ps.push({
        x: x + (Math.random() - 0.5) * 0.16,
        y: y + (Math.random() - 0.5) * 0.16,
        z,
        vx: Math.cos(a) * sp * k + (opt.carryX ?? 0),
        vy: Math.sin(a) * sp * k + (opt.carryY ?? 0),
        vz: (Math.random() - 0.5) * 1.6,
        life,
        max: life,
        color: lighten(c, 0.1),
        edge: darken(c, 0.52),
        glint: lighten(opt.color, 0.3),
        size: (opt.size ?? 0.3) * (0.45 + Math.random() * 0.75),
        gravity: -22,
        drag: 0.9,
        stretch: 1.55,
        juice: true,
      });
    }
  }

  /** 命中点的一团颜色：极短命、快速膨胀后消失，负责「爆开」的第一眼 */
  splat(x: number, y: number, z: number, color: string, r = 0.55, life = 0.2) {
    if (this.splats.length > 12) this.splats.shift();
    this.splats.push({ x, y, z, color, r, life, max: life });
  }

  spawn(
    x: number,
    y: number,
    z: number,
    opt: {
      color: string;
      n?: number;
      speed?: number;
      life?: number;
      size?: number;
      gravity?: number;
      spread?: number;
    },
  ) {
    const n = opt.n ?? 12;
    const sp = opt.speed ?? 4;
    for (let i = 0; i < n; i++) {
      if (this.ps.length > 340) break;
      const a = Math.random() * Math.PI * 2;
      const k = 0.35 + Math.random() * 0.65;
      this.ps.push({
        x,
        y,
        z,
        vx: Math.cos(a) * sp * k,
        vy: Math.sin(a) * sp * k,
        vz: (Math.random() - 0.5) * sp * 0.3,
        life: (opt.life ?? 0.7) * (0.7 + Math.random() * 0.5),
        max: 0,
        color: opt.color,
        size: (opt.size ?? 0.4) * (0.6 + Math.random() * 0.8),
        gravity: opt.gravity ?? 0,
      });
      this.ps[this.ps.length - 1].max = this.ps[this.ps.length - 1].life;
    }
    void opt.spread;
  }

  bubble(x: number, y: number, z: number, n = 3) {
    for (let i = 0; i < n; i++) {
      if (this.ps.length > 340) break;
      this.ps.push({
        x: x + (Math.random() - 0.5) * 0.3,
        y,
        z,
        vx: (Math.random() - 0.5) * 0.4,
        vy: -1.6 - Math.random() * 1.8,
        vz: 0,
        life: 1.1 + Math.random() * 1.1,
        max: 2.2,
        color: '#cfe9ff',
        size: 0.12 + Math.random() * 0.16,
        gravity: -1.2,
      });
    }
  }

  ring(x: number, y: number, z: number, color: string, from = 0.6, to = 1.8, life = 0.35) {
    if (this.rings.length > 16) this.rings.shift();
    this.rings.push({ x, y, z, color, from, to, life, max: life });
  }

  text(x: number, y: number, z: number, txt: string, color: string, size = 0.55) {
    if (this.texts.length > 18) this.texts.shift();
    this.texts.push({ x, y, z, txt, color, size, life: 1.1, max: 1.1 });
  }

  update(dt: number) {
    for (let i = this.ps.length - 1; i >= 0; i--) {
      const p = this.ps[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.ps.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.vx *= 1 - dt * (p.drag ?? 1.6);
      p.vy *= 1 - dt * (p.drag ?? 0) * 0.35;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
    }
    for (let i = this.splats.length - 1; i >= 0; i--) {
      this.splats[i].life -= dt;
      if (this.splats[i].life <= 0) this.splats.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      this.rings[i].life -= dt;
      if (this.rings[i].life <= 0) this.rings.splice(i, 1);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      t.y -= dt * 1.1;
      if (t.life <= 0) this.texts.splice(i, 1);
    }
  }

  clear() {
    this.ps.length = 0;
    this.rings.length = 0;
    this.texts.length = 0;
    this.splats.length = 0;
  }

  draw(g: CanvasRenderingContext2D, cam: Cam) {
    // ---- 汁液色斑：极短命的一团颜色，负责「爆开」的第一眼
    for (const s of this.splats) {
      const k = 1 - s.life / s.max;
      const px = cam.toScreenX(s.x);
      const py = cam.toScreenY(s.y);
      const rad = Math.max(2, s.r * cam.scale * (0.5 + k * 0.9));
      const a = (1 - k) * 0.55;
      const gr = g.createRadialGradient(px, py, 0, px, py, rad);
      gr.addColorStop(0, rgba(s.color, a));
      gr.addColorStop(0.6, rgba(s.color, a * 0.5));
      gr.addColorStop(1, rgba(s.color, 0));
      g.fillStyle = gr;
      g.beginPath();
      g.arc(px, py, rad, 0, Math.PI * 2);
      g.fill();
    }

    // ---- 汁液粒子：沿速度拉长的椭圆 + 普通混合。
    // 加色(lighter)会把颜色冲成白，看着像火星而不是果汁，所以这组走 source-over。
    for (const p of this.ps) {
      if (!p.juice) continue;
      const a = Math.min(1, p.life / p.max) * 0.95;
      const px = cam.toScreenX(p.x);
      const py = cam.toScreenY(p.y);
      const rad = Math.max(0.8, p.size * cam.scale * 0.5 * (0.55 + a * 0.45));
      const spd = Math.hypot(p.vx, p.vy);
      // 越快拉得越长，但不超过 stretch 给的上限
      const extra = Math.min(Math.max(0, (p.stretch ?? 1) - 1), spd * 0.12);
      const half = rad * (1 + extra);
      g.save();
      g.translate(px, py);
      // 世界 y 向上、屏幕 y 向下 → 屏幕里的方向是 (vx, -vy)
      const ang = spd > 0.4 ? Math.atan2(-p.vy, p.vx) : 0;
      g.rotate(ang);

      // 拖尾：从身后一小段拉到当前位置，高速时才有「甩出去的水线」
      if (spd > 2.2) {
        const tail = Math.min(26, spd * cam.scale * 0.026);
        g.strokeStyle = rgba(p.edge ?? p.color, a * 0.5);
        g.lineCap = 'round';
        g.lineWidth = rad * 1.5;
        g.beginPath();
        g.moveTo(-tail - half * 0.4, 0);
        g.lineTo(0, 0);
        g.stroke();
      }

      // 细描边 + 鱼色主体 + 一点高光：像有体积的水滴，而不是一块色斑
      g.fillStyle = rgba(p.edge ?? p.color, a * 0.9);
      g.beginPath();
      g.ellipse(0, 0, half, rad, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = rgba(p.color, a);
      g.beginPath();
      g.ellipse(0, 0, half * 0.9, rad * 0.85, 0, 0, Math.PI * 2);
      g.fill();
      if (rad > 3.2) {
        g.fillStyle = rgba(p.glint ?? '#ffffff', a * 0.6);
        g.beginPath();
        g.ellipse(-half * 0.26, -rad * 0.3, half * 0.28, rad * 0.3, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }

    // ---- 冲击环
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const r of this.rings) {
      const k = 1 - r.life / r.max;
      const rad = (r.from + (r.to - r.from) * k) * cam.scale;
      const a = (1 - k) * 0.6;
      const px = cam.toScreenX(r.x);
      const py = cam.toScreenY(r.y);
      g.strokeStyle = rgba(r.color, a);
      g.lineWidth = Math.max(1, cam.scale * 0.05 * (1 - k * 0.5));
      g.beginPath();
      g.ellipse(px, py, rad, rad * 0.86, 0, 0, Math.PI * 2);
      g.stroke();
    }

    // ---- 粒子（软圆 + 加色）
    for (const p of this.ps) {
      if (p.juice) continue;
      const a = Math.min(1, p.life / p.max) * 0.9;
      const px = cam.toScreenX(p.x);
      const py = cam.toScreenY(p.y);
      const rad = Math.max(0.7, p.size * cam.scale * 0.5 * (0.5 + a * 0.5));
      g.fillStyle = rgba(p.color, a);
      g.beginPath();
      g.arc(px, py, rad, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();

    // ---- 飘字
    for (const t of this.texts) {
      const k = t.life / t.max;
      const a = k > 0.72 ? (1 - k) / 0.28 : Math.min(1, k / 0.3);
      const px = cam.toScreenX(t.x);
      const py = cam.toScreenY(t.y);
      const fs = Math.max(10, t.size * cam.scale);
      g.save();
      g.globalAlpha = Math.max(0, Math.min(1, a));
      g.font = `800 ${fs.toFixed(1)}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = Math.max(2, fs * 0.18);
      g.strokeStyle = 'rgba(4,12,20,0.72)';
      g.lineJoin = 'round';
      g.strokeText(t.txt, px, py);
      g.fillStyle = t.color;
      g.fillText(t.txt, px, py);
      g.restore();
    }
  }

  /** 供画面做「光晕层」收集：返回所有粒子的世界坐标与颜色 */
  brightSpots(): { x: number; y: number; color: string; size: number; a: number }[] {
    return this.ps
      // 汁液不发光：混进光晕层会让命中处糊成一团白
      .filter((p) => !p.juice)
      .map((p) => ({
        x: p.x,
        y: p.y,
        color: p.color,
        size: p.size,
        a: Math.min(1, p.life / p.max),
      }));
  }
}

void hash1;
