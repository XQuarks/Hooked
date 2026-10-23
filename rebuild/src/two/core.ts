/**
 * 2D 渲染层地基：坐标映射、颜色工具、画布池。
 *
 * 世界仍是米制（1 单位 = 1 米，y 向下为正，水下 y 为负）。
 * 屏幕映射只做「等比缩放 + 跟随焦点」：
 *   sx = W/2 + (wx - 0) * scale
 *   sy = H/2 + (wy - camY) * scale
 * 这样 engine 里的碰撞、射程、下潜速度全部不用改。
 */

export const VIEW_W = 7.2; // 横向可见米数（略大于 XW=3.45 的物理边界）
export const CAM_LEAD = 1.5; // 屏幕中心比焦点低多少米（沿用原机位习惯）

export interface Vec2 {
  x: number;
  y: number;
}

/** 屏幕与世界之间的映射（含抖动），由 Stage2D 实现 */
export interface Cam {
  W: number;
  H: number;
  scale: number;
  /** 屏幕中心对应的世界 y */
  cy: number;
  /** 屏幕中心对应的世界 x（空中推近时用来横向跟随） */
  cx: number;
  shakeX: number;
  shakeY: number;
  toScreenX(wx: number): number;
  toScreenY(wy: number): number;
  toWorld(sx: number, sy: number): Vec2;
}

/** 与 THREE.Vector3 交互兼容的最小实现，让 engine 的位移代码原样保留 */
export class Vec3 {
  x: number;
  y: number;
  z: number;
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  set(x: number, y: number, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  copy(v: { x: number; y: number; z: number }) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }
  lerp(v: { x: number; y: number; z: number }, t: number) {
    this.x += (v.x - this.x) * t;
    this.y += (v.y - this.y) * t;
    this.z += (v.z - this.z) * t;
    return this;
  }
}

/** 与 THREE.Vector3 的 scale 属性兼容 */
export class Scale3 {
  x = 1;
  y = 1;
  z = 1;
  set(x: number, y: number, z = x) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  setScalar(s: number) {
    this.x = s;
    this.y = s;
    this.z = s;
    return this;
  }
}

// ---------------------------------------------------------------- 颜色

export function parseHex(hex: string): [number, number, number] {
  const s = hex.trim();
  // 允许把 shade()/mixHex() 产出的 rgb(r,g,b) 再喂回来做二次运算
  if (s.startsWith('rgb')) {
    const m = s.match(/(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/);
    if (m) {
      return [
        Math.max(0, Math.min(255, Math.round(+m[1]))),
        Math.max(0, Math.min(255, Math.round(+m[2]))),
        Math.max(0, Math.min(255, Math.round(+m[3]))),
      ];
    }
    return [0, 0, 0];
  }
  let h = s.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function clamp255(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

export function mixHex(a: string, b: string, t: number): string {
  const A = parseHex(a);
  const B = parseHex(b);
  const k = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(A[0] + (B[0] - A[0]) * k)},${Math.round(
    A[1] + (B[1] - A[1]) * k,
  )},${Math.round(A[2] + (B[2] - A[2]) * k)})`;
}

/** 往白里推（提亮）/ 往黑里压（压暗） */
export function shade(hex: string, t: number): string {
  const [r, g, b] = parseHex(hex);
  if (t >= 0) {
    return `rgb(${Math.round(r + (255 - r) * t)},${Math.round(g + (255 - g) * t)},${Math.round(
      b + (255 - b) * t,
    )})`;
  }
  const k = 1 + t;
  return `rgb(${Math.round(clamp255(r * k))},${Math.round(clamp255(g * k))},${Math.round(
    clamp255(b * k),
  )})`;
}

/** 往某个色相靠（用于把水色统一到青蓝系） */
export function tint(hex: string, to: string, t: number): string {
  return mixHex(hex, to, t);
}

// ---------------------------------------------------------------- 画布

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.floor(w));
  c.height = Math.max(1, Math.floor(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  return g;
}

/** 预生成噪点贴图，用于给大面积渐变加胶片颗粒，避免「塑料平滑」 */
export function noiseTile(size = 128): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 96 + Math.random() * 96;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 26;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** 球面/椭圆软光斑贴图（用于发光体，避免每帧建渐变） */
export function glowDot(size = 64, color = '#ffffff'): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  const r = size / 2;
  const gr = g.createRadialGradient(r, r, 0, r, r, r);
  gr.addColorStop(0, rgba(color, 1));
  gr.addColorStop(0.32, rgba(color, 0.5));
  gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return c;
}

export function easeOut(t: number): number {
  const k = 1 - t;
  return 1 - k * k * k;
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** 确定性哈希噪声（用于静态剪影轮廓，避免每帧抖动） */
export function hash1(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

/** 一维平滑值噪声，用于山脊/珊瑚轮廓 */
export function ridge(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash1(i + seed * 31.7);
  const b = hash1(i + 1 + seed * 31.7);
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

export function fbm1(x: number, seed: number, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += ridge(x * freq, seed + i * 7.3) * amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum;
}
