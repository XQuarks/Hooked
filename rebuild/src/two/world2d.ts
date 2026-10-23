/**
 * 船、渔夫、鱼竿、鱼钩、漂流瓶——全部改成矢量剪影绘制。
 *
 * 为什么不画细节：
 * 竖屏手机上一艘 4 米长的船只有约 250px 宽，画铆钉和木纹只会变成噪点。
 * 改成「暗部剪影 + 一条逆光边缘」，轮廓清楚、体积感靠光，反而更像插画。
 */
import { Band, MapInfo } from '../game/data';
import { Cam, Vec3, rgba, shade, tint, hash1 } from './core';

/** 与 3D 版保持一致，供 engine 的抛竿轨迹使用 */
export const ROD_PIVOT = { x: 0.78, y: 1.24 };
export const ROD_LEN = 2.9;
const DECK_Y = 0.6;
const HULL_LEN = 2.0; // 半长（米）

export class BottleSprite {
  x: number;
  y: number;
  z: number;
  t = Math.random() * 6.28;
  dispose() {
    /* 2D 无需释放 GPU 资源 */
  }
  constructor(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}

class BottleGroupRef {
  items: BottleSprite[] = [];
  private owner: World2D;
  constructor(owner: World2D) {
    this.owner = owner;
  }
  add(b: BottleSprite) {
    if (!this.items.includes(b)) this.items.push(b);
    return b;
  }
  remove(b: BottleSprite) {
    const i = this.items.indexOf(b);
    if (i >= 0) this.items.splice(i, 1);
    this.owner.forget(b);
  }
  clear() {
    this.items.length = 0;
  }
}

export class World2D {
  map: MapInfo;
  /** 与 THREE.Object3D 用法兼容：position / visible / rotation.z */
  lure = { position: new Vec3(), visible: true, rotation: { z: 0 } };
  /** 浪高倍率（天气）：影响船身起伏与浪花 */
  sea = 1;
  bottleGroup: BottleGroupRef;
  lureLight = { intensity: 0, distance: 10 };
  lureGlow = { scale: { value: 1, setScalar(v: number) { this.value = v; } } };

  rodAngle = -1.02;
  private saw = false;
  private hat = 'straw';
  private bob = 0;
  /** bottleGroup.remove 后需要通知 stage 停止绘制 */
  private removed: BottleSprite[] = [];

  constructor(public stage: { dropBottle(b: BottleSprite): void }, map: MapInfo) {
    this.map = map;
    this.bottleGroup = new BottleGroupRef(this);
  }

  forget(b: BottleSprite) {
    this.removed.push(b);
  }

  setSaw(on: boolean) {
    this.saw = on;
  }

  setHat(hat: string) {
    this.hat = hat;
  }

  setRod(p: number) {
    this.rodAngle = -1.02 + p;
  }

  setSea(v: number) {
    this.sea = Math.max(0.2, v);
  }

  /** 杆尖世界坐标：抛竿轨迹与钓线起点都用它 */
  rodTip() {
    const a = this.rodAngle;
    return { x: ROD_PIVOT.x - Math.sin(a) * ROD_LEN, y: ROD_PIVOT.y + Math.cos(a) * ROD_LEN };
  }

  update(_t: number, dt: number, _band: Band, _depth: number, _cam: unknown, _revealed: boolean) {
    this.bob += dt;
  }

  dispose() {
    this.bottleGroup.clear();
  }

  // ---------------------------------------------------------- 绘制

  /** 船与渔夫：贴在水线以上的剪影 */
  drawBoat(g: CanvasRenderingContext2D, cam: Cam, t: number) {
    const horizon = cam.toScreenY(0);
    if (horizon > cam.H + 40 || horizon < -cam.H) return;

    const s = cam.scale;
    const bob = (Math.sin(t * 0.9) * 0.035 + Math.sin(t * 1.7) * 0.014) * this.sea;
    const rot = Math.sin(t * 1.1) * 0.012 * this.sea;
    const cx = cam.toScreenX(0);
    const cy = cam.toScreenY(bob);

    g.save();
    // 只画水线以上，避免船底压在水面上
    g.beginPath();
    g.rect(0, 0, cam.W, Math.max(0, horizon));
    g.clip();
    g.translate(cx, cy);
    g.rotate(rot);

    const hull = shade(this.map.id === 'ice' ? '#1b2b3c' : '#2a2520', -0.1);
    const dark = shade(hull, -0.42);
    const rim = this.map.id === 'ice' ? '#9fd8ff' : '#ffd9a0';

    // --- 船体：首翘、尾直、底弧（不是梯形方盒）
    const L = HULL_LEN * s;
    const gunY = -DECK_Y * s; // 舷缘（屏幕 y 向上为负）
    const keelY = 0.16 * s;
    const bowLift = 0.34 * s;

    const gunwale = () => {
      g.beginPath();
      g.moveTo(-L, gunY + 0.1 * s);
      g.bezierCurveTo(-L * 0.6, gunY + 0.05 * s, -L * 0.06, gunY + 0.015 * s, L * 0.5, gunY);
      g.bezierCurveTo(L * 0.74, gunY - 0.05 * s, L * 0.9, gunY - 0.2 * s, L, gunY - bowLift);
    };

    g.beginPath();
    g.moveTo(-L, gunY + 0.1 * s);
    g.bezierCurveTo(-L * 0.6, gunY + 0.05 * s, -L * 0.06, gunY + 0.015 * s, L * 0.5, gunY);
    g.bezierCurveTo(L * 0.74, gunY - 0.05 * s, L * 0.9, gunY - 0.2 * s, L, gunY - bowLift);
    g.lineTo(L * 0.83, gunY + 0.36 * s); // 船首柱
    g.bezierCurveTo(L * 0.46, keelY - 0.02 * s, -L * 0.16, keelY + 0.05 * s, -L * 0.84, keelY + 0.06 * s);
    g.closePath();
    g.fillStyle = hull;
    g.fill();

    // 逆光边缘：沿舷缘一条细亮线
    gunwale();
    g.strokeStyle = rgba(rim, 0.6);
    g.lineWidth = Math.max(1.2, 0.03 * s);
    g.stroke();

    // 水线白条（吃水线）
    g.beginPath();
    g.moveTo(-L * 0.84, 0.07 * s);
    g.bezierCurveTo(-L * 0.38, 0.11 * s, L * 0.34, 0.09 * s, L * 0.78, -0.01 * s);
    g.strokeStyle = rgba('#eaf6ff', 0.12);
    g.lineWidth = Math.max(1, 0.05 * s);
    g.stroke();

    // --- 驾驶室：斜顶 + 三扇窗（窗透出暖光，是船上唯一的亮点）
    const cabX = -L * 0.68;
    const cabW = L * 0.44;
    const cabH = 0.74 * s;
    g.fillStyle = dark;
    g.beginPath();
    g.moveTo(cabX, gunY + 0.08 * s);
    g.lineTo(cabX, gunY - cabH);
    g.lineTo(cabX + cabW * 0.78, gunY - cabH);
    g.lineTo(cabX + cabW, gunY - cabH - 0.15 * s);
    g.lineTo(cabX + cabW, gunY + 0.08 * s);
    g.closePath();
    g.fill();

    const winY = gunY - cabH * 0.74;
    const winH = cabH * 0.32;
    g.fillStyle = rgba('#ffce7a', 0.86);
    g.fillRect(cabX + cabW * 0.11, winY, cabW * 0.22, winH);
    g.fillRect(cabX + cabW * 0.44, winY, cabW * 0.22, winH);
    g.fillRect(cabX + cabW * 0.71, winY + 0.02 * s, cabW * 0.16, winH * 0.82);
    // 舱内暖光外溢
    const sp = g.createRadialGradient(cabX + cabW * 0.5, gunY - cabH * 0.6, 0, cabX + cabW * 0.5, gunY - cabH * 0.6, cabW * 1.3);
    sp.addColorStop(0, rgba('#ffb85c', 0.18));
    sp.addColorStop(1, rgba('#ffb85c', 0));
    g.fillStyle = sp;
    g.fillRect(cabX - cabW, gunY - cabH * 2, cabW * 3, cabH * 2.4);

    // --- 桅杆 + 航行灯
    g.strokeStyle = dark;
    g.lineWidth = Math.max(1, 0.03 * s);
    g.beginPath();
    g.moveTo(-L * 0.16, gunY - cabH * 1.1);
    g.lineTo(-L * 0.16, gunY - cabH * 2.05);
    g.stroke();
    const lampX = -L * 0.16;
    const lampY = gunY - cabH * 2.12;
    const lg = g.createRadialGradient(lampX, lampY, 0, lampX, lampY, 0.16 * s);
    lg.addColorStop(0, rgba('#ffe9a8', 0.95));
    lg.addColorStop(1, rgba('#ffe9a8', 0));
    g.fillStyle = lg;
    g.beginPath();
    g.arc(lampX, lampY, 0.16 * s, 0, Math.PI * 2);
    g.fill();

    // --- 渔夫
    this.drawFisher(g, s, t, gunY, dark, rim);

    // --- 鱼竿（绕手部 pivot 旋转）
    this.drawRod(g, s, t, rim);

    g.restore();

    // 水线处的浪花
    this.foam(g, cam, horizon, t);
  }

  private drawFisher(
    g: CanvasRenderingContext2D,
    s: number,
    t: number,
    gunY: number,
    dark: string,
    rim: string,
  ) {
    const px = 0.18 * s; // 坐在这个位置
    const feet = gunY + 0.015 * s;
    const breathe = Math.sin(t * 0.85) * 0.008 * s;
    const coat = shade(dark, 0.1);
    const pants = shade(dark, -0.1);

    // 坐姿的关键尺寸（局部坐标：原点在甲板，向上为负）
    const hipY = -0.34 * s;
    const shoulderY = -0.9 * s;
    const headY = -1.06 * s;

    g.save();
    g.translate(px, feet);

    // --- 木箱凳：渔夫坐在上面，而不是直挺挺站在甲板上
    const crateTop = -0.35 * s;
    g.fillStyle = shade('#6b4a2c', -0.2);
    g.fillRect(-0.2 * s, crateTop, 0.44 * s, 0.35 * s);
    g.fillStyle = shade('#8a6238', 0.02);
    g.fillRect(-0.23 * s, crateTop - 0.035 * s, 0.5 * s, 0.07 * s);
    g.strokeStyle = rgba('#2a1a0c', 0.32);
    g.lineWidth = Math.max(1, 0.012 * s);
    for (const yy of [0.06, 0.17]) {
      g.beginPath();
      g.moveTo(-0.18 * s, crateTop + yy * s);
      g.lineTo(0.22 * s, crateTop + yy * s);
      g.stroke();
    }
    g.fillStyle = rgba('#2a1a0c', 0.22);
    g.fillRect(-0.2 * s, crateTop + 0.34 * s, 0.44 * s, 0.02 * s);

    // --- 远侧那条腿（略暗，制造前后层次）：大腿前伸、小腿垂下
    g.strokeStyle = shade(pants, -0.22);
    g.lineWidth = 0.105 * s;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-0.05 * s, hipY + 0.01 * s);
    g.quadraticCurveTo(0.12 * s, hipY - 0.02 * s, 0.2 * s, hipY + 0.04 * s);
    g.stroke();
    g.beginPath();
    g.moveTo(0.2 * s, hipY + 0.04 * s);
    g.lineTo(0.205 * s, -0.08 * s);
    g.stroke();
    g.fillStyle = shade(pants, -0.5);
    g.beginPath();
    g.ellipse(0.215 * s, -0.045 * s, 0.075 * s, 0.042 * s, 0, 0, Math.PI * 2);
    g.fill();

    // --- 近侧腿：膝盖抬起一点，脚踩在甲板上
    g.strokeStyle = shade(pants, 0.04);
    g.lineWidth = 0.118 * s;
    g.beginPath();
    g.moveTo(0.01 * s, hipY);
    g.quadraticCurveTo(0.17 * s, hipY - 0.075 * s, 0.29 * s, hipY - 0.055 * s);
    g.stroke();
    g.beginPath();
    g.moveTo(0.29 * s, hipY - 0.055 * s);
    g.quadraticCurveTo(0.315 * s, -0.17 * s, 0.31 * s, -0.075 * s);
    g.stroke();
    // 大腿上沿的逆光，坐姿轮廓才立得住
    g.strokeStyle = rgba(rim, 0.16);
    g.lineWidth = Math.max(1, 0.018 * s);
    g.beginPath();
    g.moveTo(0.04 * s, hipY - 0.06 * s);
    g.quadraticCurveTo(0.17 * s, hipY - 0.11 * s, 0.27 * s, hipY - 0.095 * s);
    g.stroke();
    // 雨靴
    g.fillStyle = shade(pants, -0.46);
    g.beginPath();
    g.ellipse(0.33 * s, -0.045 * s, 0.09 * s, 0.05 * s, 0, 0, Math.PI * 2);
    g.fill();
    g.fillRect(0.274 * s, -0.155 * s, 0.1 * s, 0.115 * s);

    // --- 躯干：坐着时略微前倾，肩宽腰窄
    const lean = 0.05 * s;
    g.fillStyle = coat;
    g.beginPath();
    g.moveTo(-0.17 * s + breathe, shoulderY);
    g.quadraticCurveTo(-0.155 * s, -0.62 * s, -0.135 * s, hipY);
    g.quadraticCurveTo(0.01 * s, hipY + 0.05 * s, 0.13 * s, hipY);
    g.quadraticCurveTo(0.15 * s, -0.62 * s, 0.16 * s + breathe, shoulderY);
    g.quadraticCurveTo(0 + lean, shoulderY - 0.055 * s, -0.17 * s + breathe, shoulderY);
    g.closePath();
    g.fill();

    // 救生衣
    g.fillStyle = rgba('#e8873f', 0.92);
    g.beginPath();
    g.moveTo(-0.155 * s, shoulderY + 0.035 * s);
    g.quadraticCurveTo(-0.145 * s, -0.7 * s, -0.125 * s, -0.66 * s);
    g.lineTo(0.12 * s, -0.66 * s);
    g.quadraticCurveTo(0.14 * s, -0.7 * s, 0.145 * s, shoulderY + 0.035 * s);
    g.closePath();
    g.fill();
    g.fillStyle = rgba('#b85f22', 0.6);
    g.fillRect(-0.125 * s, -0.8 * s, 0.25 * s, 0.032 * s);

    // --- 左臂：手搭在膝盖上（坐姿里最自然的一只手）
    g.strokeStyle = coat;
    g.lineWidth = 0.085 * s;
    g.beginPath();
    g.moveTo(-0.15 * s, shoulderY + 0.05 * s);
    g.quadraticCurveTo(-0.22 * s, -0.66 * s, -0.13 * s, -0.56 * s);
    g.quadraticCurveTo(-0.02 * s, -0.48 * s, 0.16 * s, hipY - 0.03 * s);
    g.stroke();
    g.fillStyle = shade(dark, 0.05);
    g.beginPath();
    g.ellipse(0.18 * s, hipY - 0.02 * s, 0.05 * s, 0.042 * s, 0, 0, Math.PI * 2);
    g.fill();

    // --- 右臂：向前伸，握住杆柄（支点在 ROD_PIVOT，见 drawRod）
    g.lineWidth = 0.074 * s;
    g.beginPath();
    g.moveTo(0.145 * s, shoulderY + 0.04 * s);
    g.quadraticCurveTo(0.34 * s, -0.8 * s, ROD_PIVOT.x * s - px, -ROD_PIVOT.y * s - gunY - 0.015 * s);
    g.stroke();
    g.fillStyle = shade(dark, 0.05);
    g.beginPath();
    g.ellipse(ROD_PIVOT.x * s - px, -ROD_PIVOT.y * s - gunY - 0.015 * s, 0.052 * s, 0.043 * s, 0, 0, Math.PI * 2);
    g.fill();

    // --- 脖子 / 头
    g.fillStyle = shade(dark, -0.06);
    g.fillRect(-0.05 * s, headY + 0.085 * s, 0.1 * s, 0.1 * s);

    g.fillStyle = shade(dark, 0.16);
    g.beginPath();
    g.ellipse(0.012 * s, headY, 0.104 * s, 0.116 * s, 0, 0, Math.PI * 2);
    g.fill();

    // 帽子
    if (this.hat === 'chef') {
      g.fillStyle = '#f4f0e6';
      g.beginPath();
      g.ellipse(0.012 * s, headY - 0.13 * s, 0.113 * s, 0.098 * s, 0, 0, Math.PI * 2);
      g.fill();
      g.fillRect(-0.086 * s, headY - 0.13 * s, 0.196 * s, 0.06 * s);
    } else {
      const hatCol = this.hat === 'cap' ? '#2f6f8f' : this.hat === 'bucket' ? '#4a5a66' : this.hat === 'party' ? '#e2563f' : '#c79a4e';
      g.fillStyle = hatCol;
      g.beginPath();
      g.ellipse(0.012 * s, headY - 0.1 * s, 0.228 * s, 0.052 * s, -0.04, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(0.012 * s, headY - 0.135 * s, 0.098 * s, 0.062 * s, -0.04, Math.PI, Math.PI * 2);
      g.fill();
    }
    // 帽子逆光边
    g.strokeStyle = rgba(rim, 0.4);
    g.lineWidth = Math.max(0.8, 0.018 * s);
    g.beginPath();
    g.ellipse(0.012 * s, headY - 0.102 * s, 0.228 * s, 0.052 * s, -0.04, Math.PI * 0.05, Math.PI * 0.95);
    g.stroke();

    // 头肩轮廓光
    g.beginPath();
    g.ellipse(0.012 * s, headY, 0.106 * s, 0.118 * s, 0, Math.PI * 0.88, Math.PI * 1.86);
    g.strokeStyle = rgba(rim, 0.45);
    g.lineWidth = Math.max(0.8, 0.02 * s);
    g.stroke();

    g.restore();
  }

  private drawRod(g: CanvasRenderingContext2D, s: number, t: number, rim: string) {
    const a = this.rodAngle;
    const px = ROD_PIVOT.x * s;
    const py = -ROD_PIVOT.y * s;
    const tipX = px - Math.sin(a) * ROD_LEN * s;
    // 屏幕 y 向下为正，世界 y 向上为正：杆尖要「减」cos，之前写成加号，
    // 结果画出来的杆尖与 rodTip()（钩子/钓线的起点）差了整整 2*cos*L，钩子像是凭空出现的。
    const tipY = py - Math.cos(a) * ROD_LEN * s;

    // 杆身：根粗梢细，带一点弯
    const bend = Math.sin(t * 1.6) * 0.02 * s;
    const mx = (px + tipX) / 2 + bend;
    const my = (py + tipY) / 2 - bend * 0.6;
    g.strokeStyle = '#7d5228';
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(px, py);
    g.quadraticCurveTo((px + mx) / 2, (py + my) / 2, mx, my);
    g.lineWidth = Math.max(1.8, 0.075 * s);
    g.stroke();
    g.beginPath();
    g.moveTo(mx, my);
    g.quadraticCurveTo((mx + tipX) / 2, (my + tipY) / 2, tipX, tipY);
    g.lineWidth = Math.max(1, 0.028 * s);
    g.stroke();
    // 杆梢提亮
    g.beginPath();
    g.moveTo((px + tipX) / 2 + bend, (py + tipY) / 2);
    g.lineTo(tipX, tipY);
    g.strokeStyle = rgba(rim, 0.75);
    g.lineWidth = Math.max(0.8, 0.016 * s);
    g.stroke();

    // 绕线轮
    g.fillStyle = '#3a2a1a';
    g.beginPath();
    g.arc(px + 0.1 * s, py + 0.06 * s, 0.06 * s, 0, Math.PI * 2);
    g.fill();

    // 锯片（升级件）
    if (this.saw) {
      const r = 0.15 * s;
      g.save();
      g.translate(px + 0.34 * s, py + 0.34 * s);
      g.rotate(t * 9);
      g.fillStyle = '#c9d4dc';
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        g.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
        const a2 = ang + Math.PI / 8;
        g.lineTo(Math.cos(a2) * r * 1.32, Math.sin(a2) * r * 1.32);
      }
      g.closePath();
      g.fill();
      g.restore();
    }
  }

  private foam(g: CanvasRenderingContext2D, cam: Cam, horizon: number, t: number) {
    const s = cam.scale;
    const cx = cam.toScreenX(0);
    const L = HULL_LEN * s;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 16; i++) {
      const k = i / 16;
      const x = cx - L * 1.05 + k * L * 2.1;
      const ph = hash1(i * 4.3) * 6.28;
      const wob = Math.sin(t * 2.2 + ph) * 2.2 * this.sea;
      const r = (2 + hash1(i * 9.1) * 4) * (s / 60);
      g.fillStyle = rgba('#eafaff', 0.05 + hash1(i * 2.7) * 0.09);
      g.beginPath();
      g.ellipse(x, horizon + wob + 1, r * 1.6, r * 0.7, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  /** 漂浮的鱼钩：水下一个亮点，钩身是细金属弧 */
  drawLure(g: CanvasRenderingContext2D, cam: Cam, _t: number) {
    if (!this.lure.visible) return;
    const { x, y } = this.lure.position;
    const px = cam.toScreenX(x);
    const py = cam.toScreenY(y);
    const s = cam.scale;
    const r = 0.17 * s;
    const dark = this.lureLight.intensity > 0;

    // 头灯光圈（黑暗深度带才有）
    if (dark) {
      const R = (this.lureLight.distance / 1.15) * cam.scale * 0.9;
      const lg = g.createRadialGradient(px, py, 0, px, py, Math.max(r * 2, R));
      lg.addColorStop(0, rgba('#ffe9b0', 0.3));
      lg.addColorStop(0.3, rgba('#ffd98a', 0.12));
      lg.addColorStop(1, rgba('#ffd98a', 0));
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = lg;
      g.beginPath();
      g.arc(px, py, Math.max(r * 2, R), 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    g.save();
    g.translate(px, py);
    g.rotate(this.lure.rotation.z);

    // 钩身
    g.strokeStyle = '#cfe3f2';
    g.lineWidth = Math.max(1.4, 0.045 * s);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(0, -r * 1.5);
    g.lineTo(0, r * 0.7);
    g.arc(-r * 0.62, r * 0.7, r * 0.62, 0, Math.PI, false);
    g.stroke();

    // 高光点
    const gl = g.createRadialGradient(0, -r * 0.2, 0, 0, -r * 0.2, r * 2.6);
    gl.addColorStop(0, rgba('#ffffff', 0.85));
    gl.addColorStop(0.28, rgba('#bfe9ff', 0.32));
    gl.addColorStop(1, rgba('#bfe9ff', 0));
    g.fillStyle = gl;
    g.beginPath();
    g.arc(0, -r * 0.2, r * 2.6, 0, Math.PI * 2);
    g.fill();

    g.restore();
  }

  drawBottles(g: CanvasRenderingContext2D, cam: Cam, t: number) {
    for (const b of this.bottleGroup.items) {
      const px = cam.toScreenX(b.x);
      const py = cam.toScreenY(b.y);
      if (px < -60 || px > cam.W + 60 || py < -60 || py > cam.H + 60) continue;
      const s = cam.scale;
      const sway = Math.sin(t * 1.2 + b.t) * 0.06;
      g.save();
      g.translate(px, py);
      g.rotate(sway + 0.25);

      // 绿光
      g.save();
      g.globalCompositeOperation = 'lighter';
      const gl = g.createRadialGradient(0, 0, 0, 0, 0, 0.55 * s);
      gl.addColorStop(0, rgba('#7cf7b0', 0.5));
      gl.addColorStop(0.4, rgba('#7cf7b0', 0.14));
      gl.addColorStop(1, rgba('#7cf7b0', 0));
      g.fillStyle = gl;
      g.beginPath();
      g.arc(0, 0, 0.55 * s, 0, Math.PI * 2);
      g.fill();
      g.restore();

      g.fillStyle = 'rgba(143,224,176,0.9)';
      g.beginPath();
      g.moveTo(-0.09 * s, -0.16 * s);
      g.lineTo(0.09 * s, -0.16 * s);
      g.lineTo(0.09 * s, 0.16 * s);
      g.quadraticCurveTo(0, 0.22 * s, -0.09 * s, 0.16 * s);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(165,232,196,0.95)';
      g.fillRect(-0.035 * s, -0.27 * s, 0.07 * s, 0.12 * s);
      g.fillStyle = '#b98a52';
      g.fillRect(-0.038 * s, -0.33 * s, 0.076 * s, 0.07 * s);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fillRect(-0.06 * s, -0.12 * s, 0.022 * s, 0.2 * s);
      g.restore();
    }
    // 已移除的瓶子清理
    if (this.removed.length) this.removed.length = 0;
  }

  /** 出口：把背景色调传给外部（保留签名以兼容旧调用） */
  tintOf(band: Band): string {
    return tint(band.fog, '#ffffff', 0.1);
  }
}
