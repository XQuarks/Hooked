/**
 * hook.js — 鱼钩 / 鱼线 / 渔获串展示
 */
import * as THREE from 'three';
import { WORLD, MODEL_SCALE } from './config.js';
import { makeGlowTexture } from './world.js';

const MAX_LINE_POINTS = 11;
const MAX_CATCH_DISPLAY = 30;   // 鱼线上最多同时渲染多少条鱼

function quadPoint(a, b, c, t, out) {
  const it = 1 - t;
  out.x = it * it * a.x + 2 * it * t * b.x + t * t * c.x;
  out.y = it * it * a.y + 2 * it * t * b.y + t * t * c.y;
  return out;
}

export class Hook {
  constructor(scene, rodTip) {
    this.scene = scene;
    this.rodTip = rodTip;
    this.x = 0;
    this.y = WORLD.surfaceY - 6 * MODEL_SCALE;
    this.radius = 4 * MODEL_SCALE;

    // ── 鱼线 ──
    const positions = new Float32Array(MAX_LINE_POINTS * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xe8f8ff, transparent: true, opacity: 0.62,
    }));
    this.line.frustumCulled = false;
    scene.add(this.line);
    this._linePos = positions;

    // ── 鱼钩本体 ──
    this.group = new THREE.Group();
    scene.add(this.group);

    const metalMat = new THREE.MeshLambertMaterial({ color: 0xd9e6ef, emissive: 0x223344, flatShading: true });
    this.sinker = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 9), metalMat);
    this.sinker.scale.set(2.1 * MODEL_SCALE, 2.7 * MODEL_SCALE, 2.1 * MODEL_SCALE);
    this.sinker.position.y = 2.6 * MODEL_SCALE;
    this.group.add(this.sinker);

    const hookCurve = new THREE.TorusGeometry(2.5, 0.55, 6, 14, Math.PI * 1.35);
    const hookMesh = new THREE.Mesh(hookCurve, metalMat);
    hookMesh.scale.setScalar(MODEL_SCALE);
    hookMesh.position.y = -1.4 * MODEL_SCALE;
    hookMesh.rotation.z = Math.PI * 0.82;
    this.group.add(hookMesh);

    // 发光珠：深处也能看清钩子
    this.bead = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xd8f8ff })
    );
    this.bead.scale.setScalar(1.6 * MODEL_SCALE);
    this.bead.position.y = 3.6 * MODEL_SCALE;
    this.group.add(this.bead);

    // 光晕：让鱼钩在任何深度都醒目
    this.halo = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: makeGlowTexture('rgba(200,245,255,1)'), color: 0xa8ecff,
        transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    this.halo.scale.setScalar(26 * MODEL_SCALE);
    this.halo.position.z = -3;
    this.halo.renderOrder = -2;
    this.group.add(this.halo);

    // 捕获范围指示环
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.94, 1, 36),
      new THREE.MeshBasicMaterial({
        color: 0xbdf2ff, transparent: true, opacity: 0.42,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      })
    );
    this.group.add(this.ring);

    this.setRadius(4 * MODEL_SCALE);
    this.setPosition(0, WORLD.surfaceY - 6 * MODEL_SCALE);
  }

  setRadius(r) {
    this.radius = r;
    this.ring.scale.setScalar(r);
  }

  setPosition(x, y) {
    this.x = x;
    this.y = y;
    this.group.position.set(x, y, 1);
    this._updateLine();
  }

  /** 是否可见（在水下） */
  setVisible(v) {
    this.group.visible = v;
    this.line.visible = v;
  }

  _updateLine() {
    const tip = this.rodTip;
    const hook = { x: this.x, y: this.y };
    // 控制点：让鱼线有一点自然下垂的弧度
    const ctrl = {
      x: (tip.x + hook.x) * 0.5 + (hook.x - tip.x) * 0.12,
      y: (tip.y + hook.y) * 0.5,
    };
    const p = { x: 0, y: 0 };
    for (let i = 0; i < MAX_LINE_POINTS; i++) {
      const t = i / (MAX_LINE_POINTS - 1);
      quadPoint(tip, ctrl, hook, t, p);
      this._linePos[i * 3] = p.x;
      this._linePos[i * 3 + 1] = p.y;
      this._linePos[i * 3 + 2] = 1.2;
    }
    this.line.geometry.attributes.position.needsUpdate = true;
    this.line.geometry.computeBoundingSphere();
  }

  /** 每帧动画：珠子呼吸 + 钩子微摆 */
  update(dt, t, deep) {
    const pulse = 0.75 + Math.sin(t * 4) * 0.25;
    this.bead.scale.setScalar((1.15 + pulse * 0.55) * MODEL_SCALE);
    this.halo.scale.setScalar((19 + pulse * 7) * MODEL_SCALE);
    this.halo.material.opacity = 0.34 + pulse * 0.24;
    this.group.rotation.z = Math.sin(t * 1.6) * 0.09;
    this.ring.material.opacity = 0.28 + pulse * 0.3;
    this.ring.rotation.z = t * 0.7;
    this.line.material.opacity = 0.35 + (1 - deep) * 0.32;
  }

  /**
   * 把渔获按捕获顺序串在鱼线下方
   * 超过 MAX_DISPLAY 条只保留计数不再建模型，避免几十条鱼把 draw call 打爆
   * @param {Fish[]} list
   */
  layoutCatch(list) {
    // ── 全部卡在钩子位置、挤成一团（v0.3.4）──
    // 需求原话："全部卡在钩子的位置上挤成一团"。
    // v0.3.3 那版是**整齐的两列交错**，看着像码货 —— 这次改成真正的"堆"：
    //   以钩子为中心的一个小圆盘里散布，半径按鱼自己的视觉尺寸算。
    //
    // ⚠ 位置必须**确定性**（用索引做散列，不能用 Math.random）：
    //   layoutCatch 每帧都会被调用（下潜 / 刹停 / 上升 / 空中都在调），
    //   用真随机的话每条鱼每帧都会瞬移，看起来像在抽搐。
    //   散列用黄金角 + 一个索引 hash，同一条鱼永远落在同一个位置。
    const GOLD = 2.399963;                      // 黄金角：连续索引散得最均匀
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const L = f.def.body[0] * MODEL_SCALE;
      const H = f.def.body[1] * MODEL_SCALE;
      const extY = 2 * (L * 0.34 + H * 0.94);   // 斜挂时的纵向占位
      const extX = 2 * (L * 0.94 + H * 0.34);   // 斜挂时的横向占位

      // 索引散列：两个独立的 [0,1) 伪随机数（同一个 i 永远得到同一对值）
      const h = (k) => {
        const v = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453;
        return v - Math.floor(v);
      };
      const ang = i * GOLD + h(1) * 1.1;        // 角度：黄金角 + 抖动
      const rad = 0.3 + 0.7 * h(2);             // 半径：0.3~1.0，全都挤在同一个圈里
      const x = this.x + Math.cos(ang) * extX * 0.40 * rad;
      // 纵向只往下偏，让整团挂在钩子下方（不会把鱼甩到钩子上面去）
      const y = this.y - extY * 0.26 - Math.abs(Math.sin(ang)) * extY * 0.60 * rad;

      if (i >= MAX_CATCH_DISPLAY) {
        f.capped = true;
        f.mesh.visible = false;
        continue;
      }
      f.capped = false;
      f.placeOnLine(x, y);
    }
  }

}

/** 点到线段的距离（用于高速下的连续碰撞检测） */
export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}
