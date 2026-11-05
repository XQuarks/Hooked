/**
 * 2D 鱼：矢量绘制，按体形参数区分品种。
 *
 * 造型逻辑（和 3D 版最大的不同）：
 * - 3D 靠几何细分做「真实」，结果是青灰水里一团糊。
 * - 2D 靠三样东西做「好看」：轮廓（体形一眼可辨）、明暗（背暗腹亮）、一条逆光边。
 *   这三样在手机小屏上的辨识度远高于多边形数量。
 *
 * 所有形状用三次贝塞尔，控制点由体形系数推导，因此加新鱼只要给一组系数。
 */
import { Species } from '../game/data';
import { Cam, Vec3, Scale3, rgba, shade, mixHex, hash1 } from './core';

interface Form {
  h: number; // 体高 / 体长
  snout: number; // 吻端厚度（相对体高）
  headUp: number; // 头背高度
  backUp: number; // 最高背
  backPos: number; // 最高背位置（-0.5..0.5，正为靠头）
  pedH: number; // 尾柄高度
  belly: number; // 腹最低
  dorsal: number; // 背鳍高度
  eye: number; // 眼径系数
  caudal: 'fork' | 'fan' | 'round' | 'crescent' | 'none';
  tail: number; // 尾鳍长度系数
  mouth: number; // 嘴张开程度
}

const FORMS: Record<string, Form> = {
  fish: { h: 0.27, snout: 0.18, headUp: 0.9, backUp: 1, backPos: -0.02, pedH: 0.13, belly: 0.84, dorsal: 0.5, eye: 0.1, caudal: 'fork', tail: 0.3, mouth: 0.14 },
  long: { h: 0.17, snout: 0.12, headUp: 0.86, backUp: 1, backPos: -0.06, pedH: 0.1, belly: 0.8, dorsal: 0.34, eye: 0.09, caudal: 'fork', tail: 0.34, mouth: 0.1 },
  round: { h: 0.46, snout: 0.34, headUp: 0.92, backUp: 1, backPos: 0.02, pedH: 0.16, belly: 0.92, dorsal: 0.3, eye: 0.09, caudal: 'fan', tail: 0.22, mouth: 0.22 },
  flat: { h: 0.38, snout: 0.22, headUp: 0.84, backUp: 0.92, backPos: -0.04, pedH: 0.12, belly: 0.9, dorsal: 0.28, eye: 0.08, caudal: 'fan', tail: 0.24, mouth: 0.16 },
  shark: { h: 0.29, snout: 0.26, headUp: 0.78, backUp: 0.98, backPos: 0.0, pedH: 0.1, belly: 0.8, dorsal: 1.35, eye: 0.068, caudal: 'crescent', tail: 0.36, mouth: 0.2 },
  king: { h: 0.31, snout: 0.28, headUp: 0.94, backUp: 1.04, backPos: -0.04, pedH: 0.14, belly: 0.86, dorsal: 1.1, eye: 0.09, caudal: 'fork', tail: 0.32, mouth: 0.2 },
  angler: { h: 0.42, snout: 0.42, headUp: 1.06, backUp: 1.0, backPos: 0.14, pedH: 0.12, belly: 0.9, dorsal: 0.34, eye: 0.075, caudal: 'round', tail: 0.22, mouth: 0.3 },
  narwhal: { h: 0.2, snout: 0.24, headUp: 0.9, backUp: 0.96, backPos: 0.06, pedH: 0.11, belly: 0.86, dorsal: 0.2, eye: 0.07, caudal: 'crescent', tail: 0.28, mouth: 0.1 },
  jelly: { h: 0.5, snout: 0.5, headUp: 1, backUp: 1, backPos: 0, pedH: 0.3, belly: 1, dorsal: 0, eye: 0, caudal: 'none', tail: 0, mouth: 0 },
  squid: { h: 0.26, snout: 0.2, headUp: 0.72, backUp: 1, backPos: -0.24, pedH: 0.3, belly: 0.72, dorsal: 0.26, eye: 0.1, caudal: 'fan', tail: 0.34, mouth: 0 },
};

function formOf(shape: string): Form {
  return FORMS[shape] ?? FORMS.fish;
}

export class FishSprite {
  sp: Species;
  form: Form;
  root = { position: new Vec3(), scale: new Scale3() };
  flash = 0;
  z = 0;

  private dir = 1;
  private spin = 0;
  private wag = Math.random() * 6.28;
  private t = Math.random() * 10;
  private glowPhase = Math.random() * 6.28;
  /** 命中后的挤压回弹（squash & stretch），1 = 无 */
  private squash = 1;
  /**
   * 身体纵向渐变缓存：配色只由鱼种决定，坐标只由像素高度 H 决定。
   * H 不变时复用同一个渐变对象 —— 绘制结果完全相同，只是不再每帧重建。
   */
  private bodyGrad: CanvasGradient | null = null;
  private bodyGradH = -1;
  private bodyGradCtx: CanvasRenderingContext2D | null = null;

  constructor(sp: Species) {
    this.sp = sp;
    this.form = formOf(sp.shape);
  }

  setDir(d: number) {
    this.dir = d >= 0 ? 1 : -1;
  }

  setSpin(rot: number) {
    this.spin = rot;
  }

  update(dt: number) {
    this.t += dt;
    this.wag += dt * (5.2 + this.sp.speed * 0.6);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 4.2);
    if (this.squash < 1) this.squash = Math.min(1, this.squash + dt * 3.4);
  }

  /** 被击中时的挤压：横向拉长、纵向压扁 */
  impulse() {
    this.squash = 0.72;
  }

  dispose() {
    /* 2D 无资源 */
  }

  /** 主绘制。z 只用于前后排序，透视由调用方按 z 做轻微缩放 */
  draw(g: CanvasRenderingContext2D, cam: Cam) {
    // 视觉放大：0.3 米的沙丁鱼按实际比例只有 20px，手机上根本看不清鱼形。
    // 大鱼少放一点，避免挡满屏幕。
    const grow = Math.max(1.3, 2.0 - this.sp.len * 0.14);
    const L = this.sp.len * Math.abs(this.root.scale.x) * cam.scale * grow;
    if (L < 2) return;
    const H = L * this.form.h;

    const px = cam.toScreenX(this.root.position.x);
    const py = cam.toScreenY(this.root.position.y);
    if (px < -L || px > cam.W + L || py < -L || py > cam.H + L) return;

    g.save();
    g.translate(px, py);
    if (this.spin) g.rotate(this.spin);
    // 挤压：沿游动方向拉长
    const sx = this.dir * (1 + (1 - this.squash) * 1.1);
    const sy = this.squash;
    g.scale(sx, sy);

    if (this.sp.shape === 'jelly') this.drawJelly(g, L, H);
    else if (this.sp.shape === 'squid') this.drawSquid(g, L, H);
    else this.drawFish(g, L, H);

    g.restore();
  }

  // ------------------------------------------------------------ 常规鱼

  private drawFish(g: CanvasRenderingContext2D, L: number, H: number) {
    const f = this.form;
    const half = L / 2;
    const px = (v: number) => v * half;
    const py = (v: number) => v * H;

    const wag = Math.sin(this.wag) * 0.16;
    const wag2 = Math.sin(this.wag - 0.7) * 0.1;

    const base = this.sp.color;
    const back = shade(base, -0.46);
    const mid = base;
    const belly = shade(base, 0.42);

    // ---- 尾鳍（先画，压在身体下面）
    const pedX = -half * 0.94;
    const pedY = py(f.pedH);
    this.caudal(g, pedX, 0, H, f, wag);

    // ---- 背鳍
    if (f.dorsal > 0.01) {
      const x0 = px(f.backPos - 0.02);
      const x1 = px(-0.34);
      const top = -H * (1 + f.dorsal * 0.72);
      g.beginPath();
      g.moveTo(x0, -H * 0.62);
      g.quadraticCurveTo((x0 + x1) * 0.5, top, x1, py(f.pedH) * 1.2);
      g.quadraticCurveTo((x0 + x1) * 0.62, -H * 0.44, x0, -H * 0.6);
      g.closePath();
      g.fillStyle = rgba(shade(base, -0.16), 0.82);
      g.fill();
    }

    // ---- 臀鳍
    g.beginPath();
    g.moveTo(px(-0.16), H * 0.62);
    g.quadraticCurveTo(px(-0.28), H * 1.08, px(-0.4), H * 0.4);
    g.closePath();
    g.fillStyle = rgba(belly, 0.62);
    g.fill();

    // ---- 身体
    g.beginPath();
    g.moveTo(half, -H * f.snout);
    g.bezierCurveTo(px(0.72), -H * f.headUp * 0.98, px(0.2), -H * f.backUp * 1.06, px(f.backPos), -H * f.backUp);
    g.bezierCurveTo(px(-0.26), -H * 0.96, px(-0.66), -H * 0.44, pedX, -pedY);
    g.lineTo(pedX, pedY);
    g.bezierCurveTo(px(-0.6), H * 0.42, px(-0.24), H * f.belly * 0.96, px(0.04), H * f.belly);
    g.bezierCurveTo(px(0.34), H * f.belly * 0.94, px(0.72), H * 0.6, half, H * f.snout * 0.62);
    g.closePath();

    // 同一条鱼、同一个屏幕尺寸 → 渐变完全一样，命中缓存后直接复用
    let grad = this.bodyGrad;
    if (!grad || this.bodyGradCtx !== g || this.bodyGradH !== H) {
      grad = g.createLinearGradient(0, -H * 1.1, 0, H * 1.05);
      grad.addColorStop(0, back);
      grad.addColorStop(0.34, mid);
      grad.addColorStop(0.66, mixHex(mid, belly, 0.55));
      grad.addColorStop(1, belly);
      this.bodyGrad = grad;
      this.bodyGradH = H;
      this.bodyGradCtx = g;
    }
    g.fillStyle = grad;
    g.fill();
    // 暗描边：不管背景多亮多暗，鱼的轮廓都在
    g.strokeStyle = rgba(shade(base, -0.86), 0.4);
    g.lineWidth = Math.max(1, L * 0.02);
    g.stroke();

    // ---- 侧线：一条更亮的细弧，是「鳞片反光」最省事的暗示
    g.save();
    g.clip();
    g.beginPath();
    g.moveTo(px(0.3), -H * 0.1);
    g.quadraticCurveTo(px(-0.1), H * 0.02, px(-0.56), -H * 0.04);
    g.strokeStyle = rgba(shade(base, 0.62), 0.5);
    g.lineWidth = Math.max(1, L * 0.022);
    g.stroke();

    // ---- 腹部亮面：模拟水下的环境反光
    const bl = g.createLinearGradient(0, H * 0.1, 0, H * 1.0);
    bl.addColorStop(0, rgba('#ffffff', 0));
    bl.addColorStop(1, rgba('#ffffff', 0.22));
    g.fillStyle = bl;
    g.fillRect(-half, H * 0.1, L, H);
    g.restore();

    // ---- 背部逆光边：整条鱼「立」起来的关键
    g.beginPath();
    g.moveTo(px(0.86), -H * f.snout * 0.9);
    g.bezierCurveTo(px(0.72), -H * f.headUp * 0.98, px(0.2), -H * f.backUp * 1.06, px(f.backPos), -H * f.backUp);
    g.bezierCurveTo(px(-0.26), -H * 0.96, px(-0.66), -H * 0.44, pedX, -pedY);
    g.strokeStyle = rgba(shade(base, 0.72), 0.62);
    g.lineWidth = Math.max(1, L * 0.018);
    g.stroke();

    // ---- 胸鳍
    const finSwing = Math.sin(this.wag * 0.8) * 0.3;
    g.save();
    g.translate(px(0.34), H * 0.12);
    g.rotate(0.4 + finSwing);
    g.beginPath();
    g.ellipse(0, 0, L * 0.11, H * 0.2, 0, 0, Math.PI * 2);
    g.fillStyle = rgba(shade(base, 0.3), 0.5);
    g.fill();
    g.restore();

    // ---- 嘴
    if (f.mouth > 0.02) {
      g.beginPath();
      g.moveTo(half, -H * f.snout * 0.32);
      g.quadraticCurveTo(half - L * 0.06, H * f.mouth * 0.3, half - L * 0.1, H * f.snout * 0.3);
      g.strokeStyle = rgba(shade(base, -0.7), 0.7);
      g.lineWidth = Math.max(1, L * 0.016);
      g.stroke();
    }

    // ---- 眼睛
    const eyeR = Math.max(1.1, L * f.eye * 0.5);
    const ex = half * 0.66;
    const ey = -H * 0.24;
    g.fillStyle = '#fdfdff';
    g.beginPath();
    g.arc(ex, ey, eyeR, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#12161c';
    g.beginPath();
    g.arc(ex + eyeR * 0.16, ey, eyeR * 0.56, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = rgba('#ffffff', 0.9);
    g.beginPath();
    g.arc(ex + eyeR * 0.42, ey - eyeR * 0.36, eyeR * 0.24, 0, Math.PI * 2);
    g.fill();

    // ---- 招牌特征
    this.specialMarks(g, L, H, base);

    // ---- 命中闪白
    if (this.flash > 0) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = rgba('#ffffff', this.flash * 0.62);
      g.beginPath();
      g.moveTo(half, -H * f.snout);
      g.bezierCurveTo(px(0.72), -H * f.headUp * 0.98, px(0.2), -H * f.backUp * 1.06, px(f.backPos), -H * f.backUp);
      g.bezierCurveTo(px(-0.26), -H * 0.96, px(-0.66), -H * 0.44, pedX, -pedY);
      g.lineTo(pedX, pedY);
      g.bezierCurveTo(px(-0.6), H * 0.42, px(-0.24), H * f.belly * 0.96, px(0.04), H * f.belly);
      g.bezierCurveTo(px(0.34), H * f.belly * 0.94, px(0.72), H * 0.6, half, H * f.snout * 0.62);
      g.closePath();
      g.fill();
      g.restore();
    }

    void wag2;
  }

  private caudal(
    g: CanvasRenderingContext2D,
    pedX: number,
    _cy: number,
    H: number,
    f: Form,
    wag: number,
  ) {
    const len = H * f.tail * 1.55;
    const spread = H * (0.5 + f.tail * 0.9);
    const tipY = wag * len * 0.7;
    const base = this.sp.color;
    const c = rgba(shade(base, -0.2), 0.9);

    g.fillStyle = c;
    g.beginPath();
    if (f.caudal === 'fork') {
      g.moveTo(pedX, -H * f.pedH);
      g.quadraticCurveTo(pedX - len * 0.6, -spread * 0.5 + tipY, pedX - len, -spread + tipY);
      g.quadraticCurveTo(pedX - len * 0.72, tipY * 0.8, pedX - len * 0.5, tipY * 0.6);
      g.quadraticCurveTo(pedX - len * 0.72, tipY * 0.8, pedX - len, spread + tipY);
      g.quadraticCurveTo(pedX - len * 0.6, spread * 0.5 + tipY, pedX, H * f.pedH);
    } else if (f.caudal === 'crescent') {
      g.moveTo(pedX, -H * f.pedH);
      g.quadraticCurveTo(pedX - len * 0.8, -spread * 0.9 + tipY, pedX - len * 1.05, -spread * 1.25 + tipY);
      g.quadraticCurveTo(pedX - len * 0.54, tipY, pedX - len * 1.05, spread * 1.25 + tipY);
      g.quadraticCurveTo(pedX - len * 0.8, spread * 0.9 + tipY, pedX, H * f.pedH);
    } else if (f.caudal === 'round') {
      g.ellipse(pedX - len * 0.5, tipY, len * 0.55, spread * 0.72, tipY * 0.4, 0, Math.PI * 2);
    } else {
      g.moveTo(pedX, -H * f.pedH);
      g.quadraticCurveTo(pedX - len * 0.7, -spread + tipY, pedX - len, -spread * 0.62 + tipY);
      g.lineTo(pedX - len * 0.82, tipY);
      g.lineTo(pedX - len, spread * 0.62 + tipY);
      g.quadraticCurveTo(pedX - len * 0.7, spread + tipY, pedX, H * f.pedH);
    }
    g.closePath();
    g.fill();

    // 尾鳍缘光
    g.strokeStyle = rgba(shade(base, 0.55), 0.4);
    g.lineWidth = Math.max(0.8, H * 0.03);
    g.stroke();
  }

  /** 各品种的招牌特征：鲨鱼牙、鮟鱇诱饵、独角鲸长牙、鱼王冠 */
  private specialMarks(g: CanvasRenderingContext2D, L: number, H: number, base: string) {
    const f = this.form;
    const half = L / 2;
    const shape = this.sp.shape;

    if (shape === 'shark') {
      // 露出的牙
      g.fillStyle = 'rgba(255,255,255,0.92)';
      for (let i = 0; i < 5; i++) {
        const x = half * (0.94 - i * 0.1);
        g.beginPath();
        g.moveTo(x, H * 0.06);
        g.lineTo(x - L * 0.028, H * 0.06);
        g.lineTo(x - L * 0.014, H * 0.19);
        g.closePath();
        g.fill();
      }
      // 鳃裂
      g.strokeStyle = rgba(shade(base, -0.6), 0.5);
      g.lineWidth = Math.max(0.8, L * 0.012);
      for (let i = 0; i < 3; i++) {
        const x = half * (0.42 - i * 0.075);
        g.beginPath();
        g.moveTo(x, -H * 0.24);
        g.lineTo(x, H * 0.2);
        g.stroke();
      }
    }

    if (shape === 'angler') {
      // 发光诱饵：一根前伸的须 + 亮点
      const tipX = half * 1.28;
      const tipY = -H * 1.5;
      g.strokeStyle = rgba(shade(base, -0.3), 0.85);
      g.lineWidth = Math.max(1, L * 0.016);
      g.beginPath();
      g.moveTo(half * 0.72, -H * 0.86);
      g.quadraticCurveTo(half * 1.12, -H * 1.5, tipX, tipY);
      g.stroke();
      const pulse = 0.7 + Math.sin(this.t * 3 + this.glowPhase) * 0.3;
      const gl = g.createRadialGradient(tipX, tipY, 0, tipX, tipY, L * 0.16);
      gl.addColorStop(0, rgba('#d8fff0', 0.95 * pulse));
      gl.addColorStop(0.3, rgba('#7cf7c0', 0.5 * pulse));
      gl.addColorStop(1, rgba('#7cf7c0', 0));
      g.fillStyle = gl;
      g.beginPath();
      g.arc(tipX, tipY, L * 0.16, 0, Math.PI * 2);
      g.fill();
    }

    if (shape === 'narwhal') {
      // 长牙
      g.strokeStyle = '#f2f6fa';
      g.lineWidth = Math.max(1.2, L * 0.03);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(half * 0.94, -H * 0.24);
      g.lineTo(half * 1.9, -H * 1.1);
      g.stroke();
    }

    if (shape === 'king' && this.sp.glow) {
      // 鱼王：头顶一圈微光
      const gl = g.createRadialGradient(0, -H * 1.1, 0, 0, -H * 1.1, L * 0.55);
      gl.addColorStop(0, rgba(this.sp.color2, 0.4));
      gl.addColorStop(1, rgba(this.sp.color2, 0));
      g.fillStyle = gl;
      g.beginPath();
      g.arc(0, -H * 1.1, L * 0.55, 0, Math.PI * 2);
      g.fill();
    }

    if (shape === 'round') {
      // 河豚的刺
      g.fillStyle = rgba(shade(base, -0.5), 0.7);
      for (let i = 0; i < 9; i++) {
        const a = -Math.PI * 0.95 + (i / 8) * Math.PI * 1.05;
        const x = Math.cos(a) * half * 0.82;
        const y = Math.sin(a) * H * 0.86;
        g.beginPath();
        g.moveTo(x - L * 0.018, y);
        g.lineTo(x + Math.cos(a) * L * 0.055, y + Math.sin(a) * L * 0.055);
        g.lineTo(x + L * 0.018, y);
        g.closePath();
        g.fill();
      }
    }

    // 通用：稀有鱼加一层柔光，让玩家一眼看出「这条不一样」
    if (this.sp.glow && shape !== 'king') {
      g.save();
      g.globalCompositeOperation = 'lighter';
      const pulse = 0.22 + Math.sin(this.t * 2.2 + this.glowPhase) * 0.1;
      const gl = g.createRadialGradient(0, 0, 0, 0, 0, L * 0.62);
      gl.addColorStop(0, rgba(this.sp.color2, pulse));
      gl.addColorStop(1, rgba(this.sp.color2, 0));
      g.fillStyle = gl;
      g.beginPath();
      g.ellipse(0, 0, L * 0.62, H * 1.2, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    void f;
  }

  // ------------------------------------------------------------ 水母

  private drawJelly(g: CanvasRenderingContext2D, L: number, H: number) {
    const r = L * 0.46;
    const squash = 1 + Math.sin(this.wag * 0.7) * 0.07;
    const base = this.sp.color;

    g.save();
    g.globalCompositeOperation = 'lighter';
    const gl = g.createRadialGradient(0, 0, 0, 0, 0, r * 2.1);
    gl.addColorStop(0, rgba(base, 0.42));
    gl.addColorStop(0.45, rgba(base, 0.14));
    gl.addColorStop(1, rgba(base, 0));
    g.fillStyle = gl;
    g.beginPath();
    g.arc(0, 0, r * 2.1, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // 触须
    g.strokeStyle = rgba(shade(base, 0.3), 0.4);
    g.lineWidth = Math.max(1, L * 0.02);
    for (let i = 0; i < 6; i++) {
      const ox = (i / 5 - 0.5) * r * 1.3;
      const ph = this.wag * 0.5 + i;
      g.beginPath();
      g.moveTo(ox, r * 0.3);
      g.bezierCurveTo(ox + Math.sin(ph) * r * 0.2, r * 0.9, ox - Math.sin(ph) * r * 0.24, r * 1.4, ox + Math.sin(ph + 1) * r * 0.16, r * 1.9);
      g.stroke();
    }

    // 伞盖
    const gr = g.createLinearGradient(0, -r * 0.7, 0, r * 0.5);
    gr.addColorStop(0, rgba(shade(base, 0.4), 0.85));
    gr.addColorStop(0.6, rgba(base, 0.7));
    gr.addColorStop(1, rgba(shade(base, -0.2), 0.5));
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(0, 0, r, r * 0.78 * squash, 0, Math.PI, Math.PI * 2);
    g.quadraticCurveTo(r * 0.6, r * 0.24, 0, r * 0.3);
    g.quadraticCurveTo(-r * 0.6, r * 0.24, -r, 0);
    g.closePath();
    g.fill();

    // 伞盖边缘光
    g.strokeStyle = rgba('#ffffff', 0.55);
    g.lineWidth = Math.max(1, L * 0.024);
    g.beginPath();
    g.ellipse(0, 0, r, r * 0.78 * squash, 0, Math.PI * 1.05, Math.PI * 1.95);
    g.stroke();

    // 内腔
    g.fillStyle = rgba(shade(base, 0.6), 0.3);
    g.beginPath();
    g.ellipse(0, -r * 0.16, r * 0.36, r * 0.3, 0, 0, Math.PI * 2);
    g.fill();

    if (this.flash > 0) {
      g.fillStyle = rgba('#ffffff', this.flash * 0.55);
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.fill();
    }
    void H;
  }

  // ------------------------------------------------------------ 乌贼

  private drawSquid(g: CanvasRenderingContext2D, L: number, H: number) {
    const base = this.sp.color;
    const bodyL = L * 0.62;
    const bodyH = H * 0.8;

    // 触手
    g.strokeStyle = rgba(shade(base, -0.1), 0.75);
    for (let i = 0; i < 6; i++) {
      const ox = (i / 5 - 0.5) * bodyH * 0.7;
      const ph = this.wag * 0.7 + i * 0.8;
      g.lineWidth = Math.max(1, L * 0.018);
      g.beginPath();
      g.moveTo(bodyL * 0.42, 0);
      g.quadraticCurveTo(bodyL * 0.9, ox + Math.sin(ph) * 4, bodyL * 1.3, ox * 1.6 + Math.sin(ph) * 8);
      g.stroke();
    }

    // 外套膜（圆锥形）
    const gr = g.createLinearGradient(0, -bodyH, 0, bodyH);
    gr.addColorStop(0, shade(base, -0.34));
    gr.addColorStop(0.5, base);
    gr.addColorStop(1, shade(base, 0.3));
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(-bodyL, 0);
    g.bezierCurveTo(-bodyL * 0.6, -bodyH, bodyL * 0.1, -bodyH * 0.92, bodyL * 0.44, -bodyH * 0.3);
    g.lineTo(bodyL * 0.44, bodyH * 0.3);
    g.bezierCurveTo(bodyL * 0.1, bodyH * 0.92, -bodyL * 0.6, bodyH, -bodyL, 0);
    g.closePath();
    g.fill();

    // 鳍
    g.fillStyle = rgba(shade(base, 0.2), 0.6);
    g.beginPath();
    g.moveTo(-bodyL * 0.9, 0);
    g.quadraticCurveTo(-bodyL * 0.4, -bodyH * 1.5, bodyL * 0.2, -bodyH * 0.9);
    g.quadraticCurveTo(-bodyL * 0.4, -bodyH * 0.7, -bodyL * 0.9, 0);
    g.fill();

    // 眼
    const eyeR = Math.max(1.4, L * 0.055);
    g.fillStyle = '#fdfdff';
    g.beginPath();
    g.arc(bodyL * 0.3, -bodyH * 0.18, eyeR, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0f1319';
    g.beginPath();
    g.arc(bodyL * 0.32, -bodyH * 0.18, eyeR * 0.55, 0, Math.PI * 2);
    g.fill();
  }
}

// ---------------------------------------------------------------- 池

export class FishFactory {
  private pools = new Map<string, FishSprite[]>();
  private live = new Set<FishSprite>();
  private parent: { addFish(f: FishSprite): void; removeFish(f: FishSprite): void };

  constructor(parent: { addFish(f: FishSprite): void; removeFish(f: FishSprite): void }) {
    this.parent = parent;
  }

  acquire(sp: Species): FishSprite {
    const pool = this.pools.get(sp.id);
    let f = pool?.pop();
    if (!f) f = new FishSprite(sp);
    f.sp = sp;
    f.form = formOf(sp.shape);
    f.flash = 0;
    f.z = 0;
    f.root.scale.setScalar(1);
    f.root.position.set(0, 0, 0);
    f.setSpin(0);
    this.live.add(f);
    this.parent.addFish(f);
    return f;
  }

  release(f: FishSprite) {
    if (!this.live.has(f)) return;
    this.live.delete(f);
    this.parent.removeFish(f);
    let pool = this.pools.get(f.sp.id);
    if (!pool) {
      pool = [];
      this.pools.set(f.sp.id, pool);
    }
    if (pool.length < 24) pool.push(f);
  }

  releaseAll() {
    for (const f of [...this.live]) this.release(f);
  }

  dispose() {
    this.releaseAll();
    this.pools.clear();
  }
}

export function noiseAngle(seed: number) {
  return hash1(seed) * Math.PI * 2;
}
