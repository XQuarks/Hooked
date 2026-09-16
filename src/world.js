/**
 * world.js — 场景 / 相机 / 光照 / 水体 / 背景 / 粒子 / 震屏
 */
import * as THREE from 'three';
import {
  WORLD, CAMERA, TUNING, WATER_STOPS, ALTITUDE_BANDS, DEEP, ICEBERG, mapMaxDepth, MODEL_SCALE,
} from './config.js';

// ─────────────────────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────────────────────
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * 卡通着色的三段阶梯贴图。
 * 普通 Lambert 在「环境光 + 单向光」下会糊成一片，看不出体积；
 * 换成 toon 之后明暗只有三档，低多边形的块面感立刻出来了。
 */
let _toonTex = null;
function toonGradient() {
  if (_toonTex) return _toonTex;
  const steps = new Uint8Array([86, 168, 240]);
  const tex = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  _toonTex = tex;
  return tex;
}

/** 统一的卡通材质工厂：鱼、船、渔夫都用它，保证整场光照语言一致 */
export function toonMat(params) {
  return new THREE.MeshToonMaterial({ gradientMap: toonGradient(), ...params });
}

/** 合并多份几何体为一份（只保留 position / normal），把零碎 mesh 压成 1 个 draw call */
export function mergeGeos(list) {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  let off = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, off * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, off * 3);
    off += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}

/**
 * 按世界高度在大气分层之间插值，得到「星空浓度 / 云浓度」两个 0~1 系数。
 * 相机越高，星星越亮、云越淡，最后只剩太空。
 */
function altitudeMix(y) {
  const B = ALTITUDE_BANDS;
  if (y <= B[0].y) return { stars: B[0].stars, clouds: B[0].clouds };
  for (let i = 0; i < B.length - 1; i++) {
    if (y < B[i + 1].y) {
      const t = (y - B[i].y) / (B[i + 1].y - B[i].y);
      return {
        stars: lerp(B[i].stars, B[i + 1].stars, t),
        clouds: lerp(B[i].clouds, B[i + 1].clouds, t),
      };
    }
  }
  const last = B[B.length - 1];
  return { stars: last.stars, clouds: last.clouds };
}

/**
 * 用 Canvas 画一张纵向渐变贴图（对应世界 Y 从 bottomY 到 skyTop）。
 * @param {Array<[number,string]>} stops `[世界Y, 颜色]`，**世界 Y 约定**（不是 0~1 比例）。
 *   两张地图的深度不一样（430 / 620），所以比例形式的色标必须先经 stopsForMap
 *   换算成世界 Y 再进来 —— 这样这里只需要处理一种约定。
 */
function makeGradientTexture(stops = WATER_STOPS) {
  const H = 1024, W = 8;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const total = WORLD.skyTop - WORLD.bottomY;
  const grad = g.createLinearGradient(0, 0, 0, H);
  for (const [y, color] of stops) {
    const t = (y - WORLD.bottomY) / total;      // 0=底 1=顶
    grad.addColorStop(clamp(1 - t, 0, 1), color); // canvas y=0 是顶部
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * 把一张地图的主题换算成「世界 Y 色标」。
 *
 * 没有 `theme.waterStops` 的地图直接用 WATER_STOPS（世界 Y 约定，手写死）。
 * 有的地图走两段拼装：
 *   ① 水下 = `theme.waterStops`（**比例约定**：0 = 本图最深，1 = 水面）
 *      按本图深度铺满 [bottomY, 0]，于是「冰蓝 → 墨蓝」这条曲线自动适配 620m 的极地，
 *      加第三张图只要照抄一条曲线，不用重算一整套世界 Y。
 *   ② 水面以上 = `theme.skyStops`（世界 Y 约定），没给就沿用 WATER_STOPS 里 0 以上的部分。
 *
 * ⚠ 比例段必须 clamp 到 bottomY：极地 620m 比世界底 −500 还深，
 *   不 clamp 的话最深的两个色标会落到贴图外面，渐变底端会缺一块。
 */
function stopsForMap(map) {
  const theme = (map && map.theme) || null;
  if (!theme || !Array.isArray(theme.waterStops)) return WATER_STOPS;
  const maxD = Math.max(1, mapMaxDepth(map));
  const under = theme.waterStops.map(([k, c]) => [Math.max(WORLD.bottomY, -k * maxD), c]);
  const sky = Array.isArray(theme.skyStops) ? theme.skyStops : WATER_STOPS.filter(([y]) => y > 0);
  return [...under, ...sky];
}

/** 柔光圆点贴图（用于光晕 / 神光 / 粒子） */
export function makeGlowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.45, inner.replace(/[\d.]+\)$/, '0.45)'));
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ─────────────────────────────────────────────────────────────
// 粒子池
// ─────────────────────────────────────────────────────────────
class ParticlePool {
  constructor(scene, geometry, material, max = 80) {
    this.scene = scene;
    this.max = max;
    this.items = [];
    for (let i = 0; i < max; i++) {
      // 每个粒子独立克隆材质，才能做逐粒子淡出
      const m = new THREE.Mesh(geometry, material.clone());
      m.visible = false;
      m.matrixAutoUpdate = true;
      scene.add(m);
      this.items.push({ mesh: m, active: false, vx: 0, vy: 0, g: 0, life: 0, maxLife: 1, spin: 0, scale: 1, fade: 1, drag: 0 });
    }
    this.cursor = 0;
    this.baseOpacity = material.opacity ?? 1;
  }

  spawn({ x, y, z = 0, vx = 0, vy = 0, g = 0, life = 1, scale = 1, spin = 0, drag = 0 }) {
    const p = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;
    p.active = true;
    p.mesh.visible = true;
    p.mesh.position.set(x, y, z);
    p.mesh.scale.setScalar(scale);
    p.mesh.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
    p.vx = vx; p.vy = vy; p.g = g;
    p.life = life; p.maxLife = life;
    p.spin = spin; p.scale = scale; p.drag = drag;
    return p;
  }

  update(dt) {
    for (const p of this.items) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; p.mesh.visible = false; continue; }
      if (p.drag) {
        const k = Math.exp(-p.drag * dt);
        p.vx *= k; p.vy *= k;
      }
      p.vy += p.g * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      if (p.spin) p.mesh.rotation.z += p.spin * dt;
      const t = p.life / p.maxLife;
      p.mesh.scale.setScalar(p.scale * (0.35 + 0.65 * t));
      p.mesh.material.opacity = this.baseOpacity * Math.min(1, t * 2.2);
    }
  }

  clear() {
    for (const p of this.items) { p.active = false; p.mesh.visible = false; }
  }
}

// ─────────────────────────────────────────────────────────────
// 爆炸池（点击处爆炸的视觉主体）
// 每个爆炸 = 一圈快速扩张的冲击波 + 一团火球
// ─────────────────────────────────────────────────────────────
class BlastPool {
  constructor(scene, glowTex, max = 8) {
    this.items = [];
    for (let i = 0; i < max; i++) {
      const g = new THREE.Group();

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.86, 1, 48),
        new THREE.MeshBasicMaterial({
          color: 0xe6f8ff, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        })
      );
      const core = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: glowTex, color: 0xffcf8a, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      g.add(ring, core);
      g.visible = false;
      g.renderOrder = 8;
      scene.add(g);
      this.items.push({ g, ring, core, life: 0, maxLife: 0.46, radius: 30 });
    }
    this.cursor = 0;
  }

  spawn(x, y, radius) {
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    it.g.position.set(x, y, 4);
    it.g.rotation.z = Math.random() * 6.28;
    it.g.visible = true;
    it.maxLife = 0.40 + Math.min(0.30, radius * 0.006);
    it.life = it.maxLife;
    it.radius = radius;
    return it;
  }

  update(dt) {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) { it.g.visible = false; continue; }
      const t = 1 - it.life / it.maxLife;          // 0 → 1
      const e = 1 - Math.pow(1 - t, 2.6);          // easeOut

      it.ring.scale.setScalar(it.radius * (0.22 + e * 1.05));
      it.ring.material.opacity = (1 - t) * (1 - t) * 0.95;
      it.ring.rotation.z += dt * 1.8;

      it.core.scale.setScalar(it.radius * (0.5 + e * 1.7));
      it.core.material.opacity = Math.pow(1 - t, 1.5) * 0.9;
    }
  }

  clear() { for (const it of this.items) { it.life = 0; it.g.visible = false; } }
}

// ─────────────────────────────────────────────────────────────
// World
// ─────────────────────────────────────────────────────────────
export class World {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object|null} [map] 初始地图（MAPS 里的一项）。不给就先按默认主题建，
   *   之后由 game 调 setMap 刷成存档里的那张 —— 但那样玩家会先看到一帧宁静海湾。
   */
  constructor(canvas, map = null) {
    this.canvas = canvas;
    this.map = map;
    this.snowBoost = 1;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: false, powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x061f38, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-100, 100, 120, -120, 0.1, 600);
    this.camera.position.set(0, 110, WORLD.cameraZ);
    this.camera.lookAt(0, 110, 0);

    this.camY = WORLD.surfaceY + WORLD.viewHeight * CAMERA.shopAnchor;
    this.camX = 0;
    this.viewScale = 1;      // 1 = 正常视野，>1 = 拉远（正交缩放）
    this.shake = 0;
    this.shakeT = 0;
    this.time = 0;
    this.alt = { stars: 0, clouds: 1 };
    this.darkness = 0;       // 0 = 明亮，1 = 全黑（由深度与灯具等级共同决定）
    this.lampLevel = 0;
    this.lampR = TUNING.lampRadius(0);
    this.lampP = TUNING.lampPower(0);

    this._buildLights();
    this._buildBackground();
    this._buildSky();
    this._buildSpace();
    this._buildAurora();
    this._buildDeepDecor();
    this._buildIceDecor();
    this._buildIcebergs();
    this._buildSurface();
    this._buildBoat();
    this._buildParticles();
    this._buildBlasts();
    this._buildVeil();

    this.resize();
    // 把主题刷成传入的那张地图（浮冰 / 极光 / 冰柱的显隐都在这里统一决定）
    this.applyMap(map);
  }

  // ── 光照 ──────────────────────────────────────────────────
  _buildLights() {
    // 半球光：天空偏冷蓝、地面偏深蓝，比纯环境光多一层"上下不同色"的立体感
    this.hemi = new THREE.HemisphereLight(0xcdeaff, 0x0a2238, 0.85);
    this.scene.add(this.hemi);

    this.ambient = new THREE.AmbientLight(0xbfe4ff, 0.55);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xfff4dd, 1.55);
    this.sun.position.set(-0.85, 0.95, 0.55);
    this.scene.add(this.sun);

    this.rim = new THREE.DirectionalLight(0x8ce2ff, 0.62);
    this.rim.position.set(0.8, -0.35, 0.5);
    this.scene.add(this.rim);

    // 灯具：挂在鱼钩上的点光。
    // 这是"深海看不见 → 升级灯具"这条成长线的唯一视觉载体，
    // 强度和照射距离都跟着 lamp 等级走。
    this.hookLight = new THREE.PointLight(0xdcf6ff, 0.5, 120, 1.5);
    this.hookLight.position.set(0, 0, 26);
    this.scene.add(this.hookLight);
  }

  /** 灯具等级（0~4）：直接决定深海能看清多大范围 */
  setLamp(lv) {
    const v = clamp(Math.round(Number.isFinite(lv) ? lv : 0), 0, 4);
    this.lampLevel = v;
    this.lampR = TUNING.lampRadius(v);
    this.lampP = TUNING.lampPower(v);
  }

  // ── 背景渐变 ──────────────────────────────────────────────
  _buildBackground() {
    const h = WORLD.skyTop - WORLD.bottomY;
    const geo = new THREE.PlaneGeometry(1400, h);
    const mat = new THREE.MeshBasicMaterial({ map: makeGradientTexture(), depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, (WORLD.skyTop + WORLD.bottomY) / 2, -90);
    mesh.renderOrder = -100;
    this.scene.add(mesh);
    this.bg = mesh;
  }

  // ── 天空：太阳 + 云 ───────────────────────────────────────
  _buildSky() {
    this.glowTex = makeGlowTexture('rgba(255,250,220,0.95)', 'rgba(255,250,220,0)');

    const sunMat = new THREE.MeshBasicMaterial({
      map: this.glowTex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0.62,
    });
    const sun = new THREE.Mesh(new THREE.PlaneGeometry(118, 118), sunMat);
    sun.position.set(-54, 214, -72);
    sun.renderOrder = -90;
    this.scene.add(sun);

    const sunCore = new THREE.Mesh(
      new THREE.CircleGeometry(13, 32),
      new THREE.MeshBasicMaterial({ color: 0xfffbe6, transparent: true, opacity: 0.9, depthWrite: false })
    );
    sunCore.position.set(-54, 214, -71);
    sunCore.renderOrder = -89;
    this.scene.add(sunCore);
    this.sunGlow = sun;
    this.sunCore = sunCore;

    // 云
    this.clouds = [];
    this.cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.78, depthWrite: false });
    const cloudMat = this.cloudMat;
    const puffGeo = new THREE.SphereGeometry(1, 12, 8);
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const n = 4 + Math.floor(Math.random() * 3);
      for (let j = 0; j < n; j++) {
        const p = new THREE.Mesh(puffGeo, cloudMat);
        p.position.set((j - n / 2) * 7.5 + Math.random() * 4, Math.random() * 3, Math.random() * 5 - 2.5);
        p.scale.set(7 + Math.random() * 6, 3.4 + Math.random() * 3, 5.5 + Math.random() * 3);
        g.add(p);
      }
      g.position.set(-170 + Math.random() * 340, 236 + Math.random() * 236, -58 + Math.random() * 12);
      g.renderOrder = -85;
      g.userData.speed = 1.6 + Math.random() * 3.2;
      this.scene.add(g);
      this.clouds.push(g);
    }

    // 水面神光（浅水区体积光）
    const rayMat = new THREE.MeshBasicMaterial({
      map: this.glowTex, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false, color: 0xcdf4ff,
    });
    this.rays = [];
    for (let i = 0; i < 7; i++) {
      const w = 12 + Math.random() * 26;
      const r = new THREE.Mesh(new THREE.PlaneGeometry(w, 210), rayMat.clone());
      r.position.set(-70 + Math.random() * 140, -100, -46 - Math.random() * 8);
      r.rotation.z = (Math.random() - 0.5) * 0.35;
      r.renderOrder = -80;
      this.scene.add(r);
      this.rays.push(r);
    }
  }

  // ── 太空：星空 / 月亮 / 星云（随高度淡入） ────────────────
  _buildSpace() {
    // 星空
    // ⚠ v0.2：天空高度 ×2（skyTop 1500 → 3000），星星的数量也要 ×2 ——
    //   否则同一批星星铺在 2 倍高的天上，密度会稀一半，而空中阶段相机
    //   最高能到 ~2480m，那里会变成一片没有星星的"假深空"。
    const N = 1240;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 1700;
      pos[i * 3 + 1] = 120 + Math.random() * 3320;
      pos[i * 3 + 2] = -89 - Math.random() * 3;
      const warm = Math.random() < 0.14;
      c.setHSL(warm ? 0.09 : 0.58, warm ? 0.5 : 0.32, 0.74 + Math.random() * 0.24);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.starMat = new THREE.PointsMaterial({
      size: 2.5, vertexColors: true, transparent: true, opacity: 0,
      sizeAttenuation: false, depthWrite: false,
    });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.renderOrder = -95;
    this.scene.add(this.stars);

    // 月亮：飞上去的过程中会从身边经过，制造"真的在升高"的错觉
    this.moonGroup = new THREE.Group();
    this.moonGroup.position.set(-172, 1960, -86);
    this.scene.add(this.moonGroup);

    this.moonMat = new THREE.MeshBasicMaterial({
      color: 0xeaf3ff, transparent: true, opacity: 0, depthWrite: false,
    });
    this.moonGroup.add(new THREE.Mesh(new THREE.CircleGeometry(42, 44), this.moonMat));

    this.moonGlowMat = new THREE.MeshBasicMaterial({
      map: this.glowTex, color: 0xa8d4ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const moonGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.moonGlowMat);
    moonGlow.scale.setScalar(300);
    moonGlow.position.z = -2;
    this.moonGroup.add(moonGlow);

    // 月面上的环形山，让它不像一张圆纸片
    this.moonCraterMat = new THREE.MeshBasicMaterial({
      color: 0xbccbdd, transparent: true, opacity: 0, depthWrite: false,
    });
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * 6.28, r = Math.random() * 24;
      const cr = new THREE.Mesh(new THREE.CircleGeometry(2.6 + Math.random() * 6, 16), this.moonCraterMat);
      cr.position.set(Math.cos(a) * r, Math.sin(a) * r, 0.5);
      this.moonGroup.add(cr);
    }

    // 星云：几团极淡的彩色辉光
    this.nebulas = [];
    const hues = [0x5a7dff, 0xb85cff, 0x2fb8c8, 0xff6b9d];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: this.glowTex, color: hues[i], transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      m.scale.set(560 + Math.random() * 420, 380 + Math.random() * 260, 1);
      m.position.set((Math.random() - 0.5) * 900, 1400 + Math.random() * 1600, -92);
      m.renderOrder = -96;
      this.scene.add(m);
      this.nebulas.push(m);
    }
  }

  // ─────────────────────────────────────────────────────────
  // 地图主题（第二张地图开始才有东西）
  //
  // 三块彼此独立、都靠 applyMap 统一开关：
  //   ① 极光   —— 天空里的光帘，抬头就能看见，"到北极了"最强的一眼
  //   ② 冰柱   —— 贴两侧岩壁往下挂的冰锥 + 头顶压下来的冰凌
  //   ③ 浮冰   —— 浅层的可碰撞障碍（判定在 game.js，这里只负责长出来和漂）
  // ─────────────────────────────────────────────────────────

  /** 极光：几条竖直的光帘，用一张"上实下虚"的渐变贴图 + 加色混合 */
  _buildAurora() {
    // 光帘贴图：竖向的亮度渐变，横向再撒一些细折痕（不然是一块规整的方布）。
    //
    // ⚠ 最亮的一档**不能**放在贴图顶端。
    //   待机可见的天空只有 y ∈ [0, 120]（viewH 160、camY 40），
    //   而帘子高 120~230 是从水面往上伸的 —— 玩家看到的只是帘子的**下半截**。
    //   亮部放 v=0.18（顶端）的话，最亮那一段整条在画面外，
    //   屏幕上只剩一点尾巴，看起来就是"几条暗色竖条"而不是极光。
    //   把最亮挪到 v≈0.62（帘子中下部），可见区里才有完整的亮带。
    const H = 256, W = 16;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0.00, 'rgba(255,255,255,0)');
    grad.addColorStop(0.20, 'rgba(255,255,255,0.35)');
    grad.addColorStop(0.42, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.62, 'rgba(255,255,255,1.00)');
    grad.addColorStop(0.85, 'rgba(255,255,255,0.40)');
    grad.addColorStop(1.00, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // 横向也做一点不均：让光帘本身有"折痕"，不然是一块规整的方布
    for (let i = 0; i < 26; i++) {
      g.globalAlpha = 0.10 + Math.random() * 0.16;
      g.fillStyle = '#ffffff';
      g.fillRect(Math.random() * W, 0, 1, H);
    }
    g.globalAlpha = 1;
    this.auroraTex = new THREE.CanvasTexture(cv);
    this.auroraTex.colorSpace = THREE.SRGBColorSpace;

    this.auroraRoot = new THREE.Group();
    this.auroraRoot.visible = false;
    this.scene.add(this.auroraRoot);
    this.aurora = [];
  }

  /** 按 theme.aurora 的参数（重）建光帘。换图时调。 */
  _applyAurora(cfg) {
    for (const r of this.aurora) this.auroraRoot.remove(r);
    this.aurora = [];
    if (!cfg) return;
    // y = [底边基准, 高度上限]。光帘是"从上往下垂"的，定位必须按**底边**算。
    // 按中心定位会让整条帘子整体上移一个完整高度（h 有 120~230），
    // 底边直接从水面飞到 200+，整条帘子跑出画面 —— 换图后什么都看不到。
    const [yLo, yHi] = cfg.y || [10, 230];
    const span = Math.max(60, yHi - yLo);
    const color = cfg.color ?? 0x4dffc3;
    const n = Math.max(2, Math.round(cfg.ribbons ?? 5));
    for (let i = 0; i < n; i++) {
      const h = span * (0.55 + Math.random() * 0.5);
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          // opacity 0.3 实测在天空上只加出 +8/255（约 3%），肉眼等于没画；
          // 0.62 又反过来把整片天空盖成青绿、极夜的深蓝全没了。
          // 0.46 是出图对比出来的：帘子亮到一眼能认出，天空还透得出来。
          map: this.auroraTex, color, transparent: true, opacity: 0.46,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        })
      );
      m.scale.set(30 + Math.random() * 46, h, 1);
      // ⚠ x 展布要按**待机可见宽度**定，不是按玩法宽度。
      //   待机时 viewScale ≈ 0.62 → viewW ≈ 95，可见 x 只有 ±47.5。
      //   原来撒到 ±122，5 条里 3 条整条在画面外（探针实测：只有 2 条落在画布内）。
      //   现在 ±45 —— 帘子本身还有 15~38 的半宽，边缘几条会被画面自然裁掉，
      //   这正是极光该有的样子（铺满天空、看不到尽头）。
      const bottom = yLo + Math.random() * 35;
      m.position.set(-45 + Math.random() * 90, bottom + h / 2, -88);
      m.renderOrder = -93;
      m.userData.phase = Math.random() * 6.28;
      m.userData.baseX = m.position.x;
      m.userData.wave = 0.6 + Math.random() * 1.4;
      this.auroraRoot.add(m);
      this.aurora.push(m);
    }
  }

  /**
   * 冰柱地形：两套东西共用一份材质。
   *   ① 侧壁冰锥：从浅层一路挂到 −300m，越深越细越长
   *   ② 头顶冰凌：从水面往下压的一排倒锥（`theme.iceCeiling`）
   * 用固定种子 —— 和岩壁一样，每次刷新长得一样，不然玩家会觉得地图在乱跳。
   */
  _buildIceDecor() {
    this.iceRoot = new THREE.Group();
    this.iceRoot.visible = false;
    this.scene.add(this.iceRoot);

    this._iceMat = toonMat({
      color: 0xbfe6f7, flatShading: true, transparent: true, opacity: 0.86,
    });
    this._iceMat2 = toonMat({
      color: 0x86c6e6, flatShading: true, transparent: true, opacity: 0.78,
    });

    let seed = 20260916;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    const cone = new THREE.ConeGeometry(1, 1, 6);
    const side = [];
    // 侧壁冰锥：0 ~ −300m，两列交错
    for (let i = 0; i < 22; i++) {
      const k = i % 2 === 0 ? -1 : 1;
      const y = (-8 - (i / 21) * 292 + rng() * 12) * MODEL_SCALE;
      const len = (16 + rng() * 30) * MODEL_SCALE;
      const r = (3.2 + rng() * 4.6) * MODEL_SCALE;
      const g = cone.clone();
      g.scale(r, len, r);
      // 稍微斜着往下扎，比一根根竖直的更像冰
      g.rotateZ(k * (0.12 + rng() * 0.3));
      g.translate(0, y, -16 + rng() * 20);
      const m = new THREE.Mesh(g, i % 3 === 0 ? this._iceMat2 : this._iceMat);
      m.userData.side = k;
      m.userData.off = rng() * 9;
      m.userData.y = y;
      this.iceRoot.add(m);
      side.push(m);
    }
    this.iceSide = side;

    // 头顶冰凌：从 0m 往下压的一排倒锥（锥尖朝下）
    const ceil = [];
    for (let i = 0; i < 26; i++) {
      const len = (9 + rng() * 22) * MODEL_SCALE;
      const r = (2.4 + rng() * 3.6) * MODEL_SCALE;
      const g = cone.clone();
      g.rotateZ(Math.PI);                 // 锥尖朝下
      g.scale(r, len, r);
      g.translate((i / 25 - 0.5) * 300 + (rng() - 0.5) * 8, -len * 0.5 - 1.5 * MODEL_SCALE, -6 + rng() * 14);
      ceil.push(new THREE.Mesh(g, i % 2 ? this._iceMat : this._iceMat2));
    }
    this.iceCeiling = new THREE.Group();
    for (const c of ceil) this.iceCeiling.add(c);
    this.iceRoot.add(this.iceCeiling);
  }

  /** 浮冰组（长出来一次，之后只切显隐 + 漂移；换图时按需重建） */
  _buildIcebergs() {
    this.icebergRoot = new THREE.Group();
    this.icebergRoot.visible = false;
    this.scene.add(this.icebergRoot);
    this.icebergs = [];
  }

  /** 重新生成一批浮冰（冰封极地专属）。on = false 时清空并整组隐藏。 */
  buildIcebergs(on) {
    for (const b of this.icebergs) this.icebergRoot.remove(b.mesh);
    this.icebergs = [];
    if (!on) { this.icebergRoot.visible = false; return; }

    this.icebergRoot.visible = true;
    let seed = 20260917;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    const n = Math.round(lerp(ICEBERG.count[0], ICEBERG.count[1], rng()));
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const spanX = WORLD.fishHalfWidth * 2;

    for (let i = 0; i < n; i++) {
      // 一块浮冰 = 3~5 个冰疙瘩合并，这样轮廓是"裂开的冰"而不是一颗球
      const parts = [];
      const blobs = 3 + Math.floor(rng() * 3);
      for (let j = 0; j < blobs; j++) {
        const g = ico.clone();
        const s = 0.5 + rng() * 0.62;
        g.scale(s, s * (0.72 + rng() * 0.4), s * 0.8);
        g.rotateZ(rng() * 6.28);
        g.translate((j - (blobs - 1) / 2) * 0.85 + (rng() - 0.5) * 0.5,
          (rng() - 0.5) * 0.7, (rng() - 0.5) * 0.5);
        parts.push(g);
      }
      const r = lerp(ICEBERG.radius[0], ICEBERG.radius[1], rng());
      const mesh = new THREE.Mesh(mergeGeos(parts), this._iceMat);
      // 几何体的实际半径 ≈ 1.6（几个单位球错位拼出来的），缩放到目标判定半径
      mesh.scale.setScalar(r / 1.55);
      const y = WORLD.surfaceY - 10 * MODEL_SCALE - rng() * (ICEBERG.depth - 16 * MODEL_SCALE);
      const x = (rng() - 0.5) * spanX;
      mesh.position.set(x, y, 4 + rng() * 4);
      mesh.rotation.z = (rng() - 0.5) * 0.5;
      this.icebergRoot.add(mesh);

      const dir = rng() < 0.5 ? -1 : 1;
      this.icebergs.push({
        mesh,
        r,
        vx: dir * lerp(ICEBERG.drift[0], ICEBERG.drift[1], rng()),
        bob: rng() * 6.28,
        hitT: 0,
      });
    }
  }

  /**
   * 换到某张地图：把「这片海长什么样」一次性刷成新主题。
   *
   * 只碰视觉，不碰玩法 —— 刷哪些鱼、尺子多长分别由 game.js / ui.js 各自处理，
   * 三边都只认同一个 `map` 对象，不互相调用。
   */
  applyMap(map) {
    this.map = map || null;
    const theme = (map && map.theme) || {};

    // ① 水体渐变：换图最直观的信号（冰蓝 → 墨蓝，一眼就知道不在海湾了）
    if (this.bg) {
      const old = this.bg.material.map;
      this.bg.material.map = makeGradientTexture(stopsForMap(map));
      this.bg.material.needsUpdate = true;
      if (old && old !== this.bg.material.map && old.dispose) old.dispose();
    }

    // ② 极光
    const auroraOn = !!theme.aurora;
    this.auroraRoot.visible = auroraOn;
    if (auroraOn) this._applyAurora(theme.aurora);
    else if (this.aurora.length) this._applyAurora(null);

    // ③ 冰柱 / 头顶冰凌
    if (this.iceRoot) {
      this.iceRoot.visible = !!theme.icePillars;
      if (this.iceCeiling) this.iceCeiling.visible = !!theme.iceCeiling;
    }
    // 有冰柱的地图收起海带：绿色的海带在冰层下很出戏，
    // 而且两套贴边装饰同时出现会让两侧的岩壁变成一堵糊掉的墙。
    const hideKelp = !!theme.icePillars;
    for (const d of this.decor) {
      if (d.userData.kind === 'kelp') d.visible = !hideKelp;
    }

    // ④ 海雪密度（极地水里悬浮的冰晶比温带海多）
    this.snowBoost = Number.isFinite(theme.snow) ? theme.snow : 1;
    // ⑤ 天空明暗：极夜没有刺眼的太阳，云也只是几片灰影
    this.skyDim = Number.isFinite(theme.skyDim) ? theme.skyDim : 1;

    // ⑤ 浮冰：只有带 hook = 'iceberg' 的地图才有
    this.buildIcebergs(!!map && map.hook === 'iceberg');
  }

  /** 浮冰的碰撞体（game.js 只读这个，不碰 mesh 细节） */
  get icebergColliders() { return this.icebergRoot && this.icebergRoot.visible ? this.icebergs : null; }

  // ── 爆炸池 ───────────────────────────────────────────────
  _buildBlasts() {
    this.blasts = new BlastPool(this.scene, this.glowTex, 8);
  }

  // ─────────────────────────────────────────────────────────
  // 深海地形：两侧的岩石 / 海带 / 神秘发光体
  //
  // 这一层存在的意义不只是好看 —— 深海完全没有参照物时，
  // 玩家感觉不到自己在往下走；有了两侧的岩壁和海带，
  // "我在下沉"这件事才有速度感。
  // ─────────────────────────────────────────────────────────
  _buildDeepDecor() {
    this.decorRoot = new THREE.Group();
    this.scene.add(this.decorRoot);
    this.decor = [];

    this._rockMats = [
      toonMat({ color: 0x2c4054, flatShading: true }),
      toonMat({ color: 0x223444, flatShading: true }),
      toonMat({ color: 0x38506a, flatShading: true }),
    ];
    this._kelpMat = toonMat({
      color: 0x2e7360, side: THREE.DoubleSide, transparent: true, opacity: 0.94, flatShading: true,
    });
    this._kelpMat2 = toonMat({
      color: 0x3d6f3a, side: THREE.DoubleSide, transparent: true, opacity: 0.9, flatShading: true,
    });
    this._stoneMat = toonMat({ color: 0x40505e, flatShading: true });
    this._runeMat = new THREE.MeshBasicMaterial({ color: 0x8ff4dc });
    this._tubeMat = toonMat({ color: 0x6a4a58, flatShading: true });
    this._tubeTipMat = new THREE.MeshBasicMaterial({ color: 0xff6a7a });

    // 固定种子：每次刷新地形长得一样，不然玩家会觉得地图在乱跳
    let seed = 20260914;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const span = DEEP.decorTop - DEEP.decorBottom;

    const add = (g, side, off, rng2) => {
      g.userData.side = side;
      g.userData.off = off;
      // ⚠ 地形（岩石 / 海带 / 发光遗物）的尺寸是设计稿尺寸，统一在这里乘一次模型倍率。
      //   放在 add() 而不是三个 _makeXxx 里，是为了保证"以后加第四种地形"不会漏掉。
      //   位置（g.position）不受影响 —— 它由调用方和 _layoutDecor 单独设。
      g.scale.setScalar(MODEL_SCALE);
      this.decorRoot.add(g);
      this.decor.push(g);
      return g;
    };

    // 岩石：贴着两侧岩壁堆，越深越暗（靠材质本身 + 光照）
    for (let i = 0; i < DEEP.rockCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const g = this._makeRock(rng);
      g.position.set(0, DEEP.decorTop - rng() * span, -20 + rng() * 26);
      add(g, side, rng() * 13, rng);
    }

    // 海带：只在浅中层，深海没有光合作用
    for (let i = 0; i < DEEP.kelpCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const g = this._makeKelp(rng);
      g.position.set(0, DEEP.decorTop - rng() * (span * 0.55), -14 + rng() * 22);
      // 打标记：冰封极地要把这一组收起来（绿色的海带在冰下很出戏，冰柱顶替它）
      g.userData.kind = 'kelp';
      add(g, side, rng() * 11, rng);
    }

    // 神秘发光体：晶簇 / 遗迹石柱 / 悬浮光球 / 管虫
    for (let i = 0; i < DEEP.relicCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const g = this._makeRelic(rng, i % 4);
      g.position.set(0, DEEP.decorBottom + 40 + rng() * (span - 60), -18 + rng() * 20);
      add(g, side, rng() * 10, rng);
    }

    this.wallX = WORLD.minViewWidth / 2 - DEEP.wallInset;
    this._layoutDecor();
  }

  /** 把地形按当前屏幕半宽贴到左右边缘（横屏时自动往外推，不挡玩法区） */
  _layoutDecor() {
    if (!this.decor) return;
    // 只保证「不压到鱼的活动范围」；再往外推就整块跑到画面外去了，
    // 玩家在深海里会觉得自己在对着空屏幕下沉。
    const halfW = Math.max(
      WORLD.fishHalfWidth + 8,
      (this.baseViewW || WORLD.minViewWidth) / 2 - DEEP.wallInset
    );
    this.wallX = halfW;
    for (const d of this.decor) {
      d.position.x = d.userData.side * (halfW + d.userData.off);
    }
    // 冰柱和岩壁走同一套贴边规则（它们是"第二种岩壁"，不是独立装饰）
    if (this.iceSide) {
      for (const d of this.iceSide) {
        d.position.x = d.userData.side * (halfW + d.userData.off);
      }
    }
  }

  /** 一块岩石：1~3 个低多边形块合并成一份几何体，只要 1 个 draw call */
  _makeRock(rng) {
    const parts = [];
    const n = 1 + Math.floor(rng() * 3);
    const ico = new THREE.IcosahedronGeometry(1, 0);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3((rng() - 0.5) * 20, (rng() - 0.5) * 16, (rng() - 0.5) * 16),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 6.28, rng() * 6.28, rng() * 6.28)),
        new THREE.Vector3(8 + rng() * 17, 6 + rng() * 15, 8 + rng() * 17)
      );
      parts.push(ico.clone().applyMatrix4(m));
    }
    const g = new THREE.Mesh(mergeGeos(parts), this._rockMats[Math.floor(rng() * 3)]);
    const wrap = new THREE.Group();
    wrap.add(g);
    return wrap;
  }

  /** 一株海带：几片会摆动的带子 + 底部固着器 */
  _makeKelp(rng) {
    const wrap = new THREE.Group();
    const mat = rng() < 0.5 ? this._kelpMat : this._kelpMat2;
    const n = 2 + Math.floor(rng() * 4);
    const blades = [];
    for (let i = 0; i < n; i++) {
      const h = 26 + rng() * 52;
      const w = 3.4 + rng() * 3.6;
      const geo = new THREE.PlaneGeometry(w, h, 1, 7);
      const pos = geo.attributes.position;
      for (let k = 0; k < pos.count; k++) {
        const t = (pos.getY(k) + h / 2) / h;      // 0 底 → 1 顶
        pos.setX(k, pos.getX(k) * (0.34 + t * 1.0));   // 顶端散开
      }
      geo.translate(0, h / 2, 0);                 // 基点挪到底部，方便绕根部摆
      const m = new THREE.Mesh(geo, mat);
      m.position.set((i - (n - 1) / 2) * 4.6, 0, (rng() - 0.5) * 10);
      m.rotation.y = (rng() - 0.5) * 1.0;
      m.userData.phase = rng() * 6.28;
      m.userData.amp = 0.09 + rng() * 0.15;
      wrap.add(m);
      blades.push(m);
    }
    const hold = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), this._stoneMat);
    hold.scale.set(5.5, 2.6, 5.5);
    wrap.add(hold);
    wrap.userData.blades = blades;
    return wrap;
  }

  /** 神秘发光体：0 晶簇 / 1 遗迹石柱 / 2 悬浮光球 / 3 管虫 */
  _makeRelic(rng, kind) {
    const wrap = new THREE.Group();

    if (kind === 0) {
      const crystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(1, 0),
        toonMat({ color: 0x3ad6c0, emissive: 0x0f6f66, emissiveIntensity: 0.9, flatShading: true })
      );
      const parts = [];
      const oct = new THREE.OctahedronGeometry(1, 0);
      const n = 3 + Math.floor(rng() * 4);
      for (let i = 0; i < n; i++) {
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3((rng() - 0.5) * 14, rng() * 4, (rng() - 0.5) * 10),
          new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 0.5, rng() * 6.28, (rng() - 0.5) * 0.5)),
          new THREE.Vector3(2.4 + rng() * 3, 9 + rng() * 16, 2.4 + rng() * 3)
        );
        parts.push(oct.clone().applyMatrix4(m));
      }
      crystal.geometry = mergeGeos(parts);
      wrap.add(crystal);
      this._addRelicGlow(wrap, 0x4fe8cf, 52, rng);

    } else if (kind === 1) {
      const h = 46 + rng() * 40;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(6, 8.5, h, 6), this._stoneMat);
      pillar.position.y = h / 2;
      wrap.add(pillar);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 9.5, 4, 6), this._stoneMat);
      cap.position.y = h + 2;
      wrap.add(cap);
      // 柱身刻纹
      for (let i = 0; i < 3; i++) {
        const rune = new THREE.Mesh(new THREE.TorusGeometry(6.6, 0.7, 4, 6), this._runeMat);
        rune.rotation.x = Math.PI / 2;
        rune.position.y = h * (0.25 + i * 0.24);
        wrap.add(rune);
      }
      this._addRelicGlow(wrap, 0x7ff0d8, 62, rng);

    } else if (kind === 2) {
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(4.6, 12, 10),
        toonMat({ color: 0xdff4ff, emissive: 0x7fd8ff, emissiveIntensity: 1.0 })
      );
      wrap.add(orb);
      const tendrils = [];
      for (let i = 0; i < 5; i++) {
        const len = 16 + rng() * 16;
        const geo = new THREE.PlaneGeometry(1.9, len, 1, 5);
        geo.translate(0, -len / 2, 0);      // 基点挪到顶端，绕顶端摆
        const t = new THREE.Mesh(geo, this._kelpMat);
        t.position.set((i - 2) * 2.0, -4.4, (rng() - 0.5) * 3);
        t.userData.phase = rng() * 6.28;
        t.userData.amp = 0.2 + rng() * 0.22;
        wrap.add(t);
        tendrils.push(t);
      }
      wrap.userData.blades = tendrils;
      this._addRelicGlow(wrap, 0x9fe4ff, 58, rng);

    } else {
      const n = 4 + Math.floor(rng() * 4);
      for (let i = 0; i < n; i++) {
        const h = 20 + rng() * 30;
        const stem = new THREE.Group();
        stem.position.set((i - (n - 1) / 2) * 5.2, 0, (rng() - 0.5) * 8);
        stem.rotation.z = (rng() - 0.5) * 0.24;
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.0, h, 6), this._tubeMat);
        tube.position.y = h / 2;
        stem.add(tube);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(1.9, 8, 6), this._tubeTipMat);
        tip.position.y = h;
        stem.add(tip);
        wrap.add(stem);
      }
      this._addRelicGlow(wrap, 0xff8a96, 44, rng);
    }

    return wrap;
  }

  /** 给神秘物体挂一团会呼吸的加色辉光 */
  _addRelicGlow(wrap, color, size, rng) {
    const mat = new THREE.MeshBasicMaterial({
      map: this.glowTex, color, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    m.scale.setScalar(size);
    m.position.y = 8 + rng() * 10;
    m.renderOrder = -3;
    wrap.add(m);
    wrap.userData.pulse = {
      mesh: m, base: 0.26 + rng() * 0.2, size,
      freq: 0.6 + rng() * 1.1, phase: rng() * 6.28,
    };
  }

  // ── 深海暗幕 + 灯具光池 ───────────────────────────────────
  _buildVeil() {
    const cv = document.createElement('canvas');
    cv.width = 4; cv.height = 256;
    const g = cv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, 'rgba(0,3,10,0)');
    grad.addColorStop(0.45, 'rgba(0,3,10,0.55)');
    grad.addColorStop(1, 'rgba(0,2,7,1)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;

    this.veilMat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0, depthWrite: false, depthTest: false,
    });
    this.veil = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.veilMat);
    this.veil.renderOrder = 60;
    this.veil.visible = false;
    this.scene.add(this.veil);

    // 灯具光池：加色辉光叠在暗幕之上，做出"手电筒照出去"的那一圈
    this.lampGlowMat = new THREE.MeshBasicMaterial({
      map: this.glowTex, color: 0xb6e8ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    });
    this.lampGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.lampGlowMat);
    this.lampGlow.renderOrder = 61;
    this.lampGlow.visible = false;
    this.scene.add(this.lampGlow);
  }

  /** 每帧：海带摆动 + 发光体呼吸 + 视野外剔除 */
  _updateDecor(dt) {
    const top = this.camY + this.viewH / 2 + 46 * MODEL_SCALE;
    const bottom = this.camY - this.viewH / 2 - 46 * MODEL_SCALE;
    for (let i = 0; i < this.decor.length; i++) {
      const d = this.decor[i];
      d.visible = d.position.y < top && d.position.y > bottom;
      if (!d.visible) continue;

      const blades = d.userData.blades;
      if (blades) {
        for (let k = 0; k < blades.length; k++) {
          const b = blades[k];
          b.rotation.z = Math.sin(this.time * 0.85 + b.userData.phase) * b.userData.amp
            + Math.sin(this.time * 2.4 + b.userData.phase * 1.7) * b.userData.amp * 0.32;
        }
      }

      const p = d.userData.pulse;
      if (p) {
        const k = 0.7 + Math.sin(this.time * p.freq + p.phase) * 0.3;
        p.mesh.material.opacity = p.base * k;
        p.mesh.scale.setScalar(p.size * (0.86 + k * 0.28));
      }
    }
  }

  // ── 水面 ─────────────────────────────────────────────────
  _buildSurface() {
    // 起伏的水面带
    const segX = 90;
    const geo = new THREE.PlaneGeometry(1400, 34, segX, 1);
    geo.translate(0, -17, 0); // 顶边贴 y=0
    const cv = document.createElement('canvas');
    cv.width = 8; cv.height = 64;
    const g = cv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, 'rgba(190,240,255,0.85)');
    grad.addColorStop(0.35, 'rgba(120,215,245,0.55)');
    grad.addColorStop(1, 'rgba(60,170,220,0.0)');
    g.fillStyle = grad; g.fillRect(0, 0, 8, 64);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;

    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.surfaceBand = new THREE.Mesh(geo, mat);
    this.surfaceBand.position.set(0, 0, -6);
    this.surfaceBand.renderOrder = -60;
    this.scene.add(this.surfaceBand);

    // 高光浪线
    const lineGeo = new THREE.PlaneGeometry(1400, 3.4);
    const lineMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.surfaceLine = new THREE.Mesh(lineGeo, lineMat);
    this.surfaceLine.position.set(0, 0, -5);
    this.surfaceLine.renderOrder = -59;
    this.scene.add(this.surfaceLine);

    this._bandTop = [];
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > -0.5) this._bandTop.push(i);
    this._bandPos = pos;
    this._bandX = this._bandTop.map((i) => pos.getX(i));
  }

  // ── 小船 + 钓竿 + 渔夫 ────────────────────────────────────
  _buildBoat() {
    const boat = new THREE.Group();
    boat.position.set(0, WORLD.boatY, 4);
    this.scene.add(boat);
    this.boat = boat;

    const hullMat = toonMat({ color: 0xe8533f, flatShading: true });
    const hullMat2 = toonMat({ color: 0x1d5c86, flatShading: true });
    const deckMat = toonMat({ color: 0xf2efe2, flatShading: true });
    const woodMat = toonMat({ color: 0x8a6b4a, flatShading: true });
    const darkMat = toonMat({ color: 0x2f6f9e, flatShading: true });
    const metalMat = toonMat({ color: 0xc7d3dd, flatShading: true });

    // 船体：上红下蓝的两层挤出（蓝色那层沉在水线以下）
    const slice = (w, top) => {
      const s = new THREE.Shape();
      s.moveTo(-w, 0); s.lineTo(w, 0); s.lineTo(w + 7, top); s.lineTo(-w - 7, top); s.closePath();
      return s;
    };
    const hull = new THREE.Mesh(
      new THREE.ExtrudeGeometry(slice(15, 9), { depth: 13, bevelEnabled: false }), hullMat);
    hull.position.set(0, 0, -6.5);
    boat.add(hull);

    const keel = new THREE.Mesh(
      new THREE.ExtrudeGeometry(slice(14, 4), { depth: 13.8, bevelEnabled: false }), hullMat2);
    keel.position.set(0, -3.2, -6.9);
    boat.add(keel);

    // 甲板
    const deck = new THREE.Mesh(new THREE.BoxGeometry(42, 2.4, 14), deckMat);
    deck.position.set(0, 9.2, 0);
    boat.add(deck);

    // 舷墙 + 栏杆
    const gunwaleGeo = new THREE.BoxGeometry(44, 2.6, 1.6);
    const postGeo = new THREE.BoxGeometry(0.7, 5.2, 0.7);
    for (const zs of [1, -1]) {
      const gw = new THREE.Mesh(gunwaleGeo, deckMat);
      gw.position.set(0, 11.0, zs * 6.6);
      boat.add(gw);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(42, 0.7, 0.7), metalMat);
      rail.position.set(0, 16.8, zs * 6.6);
      boat.add(rail);
      for (let i = -2; i <= 2; i++) {
        const p = new THREE.Mesh(postGeo, metalMat);
        p.position.set(i * 9.4, 14.4, zs * 6.6);
        boat.add(p);
      }
    }

    // 驾驶舱
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(12, 9.5, 9.5), deckMat);
    cabin.position.set(12, 15.2, 0);
    boat.add(cabin);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(14.5, 1.8, 11.5), darkMat);
    roof.position.set(12, 20.6, 0);
    boat.add(roof);
    const winMat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff });
    for (const zs of [1, -1]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(7.2, 4.0, 0.4), winMat);
      win.position.set(12, 15.8, zs * 4.85);
      boat.add(win);
    }

    // 桅杆 + 旗
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.0, 30, 6), woodMat);
    mast.position.set(-16, 25, 0);
    boat.add(mast);
    const flagShape = new THREE.Shape();
    flagShape.moveTo(0, 0); flagShape.lineTo(7.5, 2.2); flagShape.lineTo(0, 4.4); flagShape.closePath();
    const flag = new THREE.Mesh(
      new THREE.ShapeGeometry(flagShape),
      new THREE.MeshBasicMaterial({ color: 0xff6b5b, side: THREE.DoubleSide })
    );
    flag.position.set(-15.6, 35, 0);
    boat.add(flag);
    this.flag = flag;

    // 甲板杂物：木箱 / 水桶 / 灯笼
    const crate = new THREE.Mesh(new THREE.BoxGeometry(7, 6, 7), woodMat);
    crate.position.set(4, 13.4, -3.6);
    crate.rotation.y = 0.4;
    boat.add(crate);
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.0, 4.2, 10), metalMat);
    bucket.position.set(-4.5, 12.4, 3.4);
    boat.add(bucket);
    const lantern = new THREE.Mesh(
      new THREE.SphereGeometry(1.9, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd98a })
    );
    lantern.position.set(-19, 12.8, 3.6);
    boat.add(lantern);
    const lanternGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: this.glowTex, color: 0xffcf7a, transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    lanternGlow.scale.setScalar(11);
    lanternGlow.position.copy(lantern.position);
    lanternGlow.position.z -= 1;
    boat.add(lanternGlow);

    // ── 渔夫 ──
    const man = new THREE.Group();
    man.position.set(-5, 10.4, 0);
    boat.add(man);
    this.man = man;

    const coatMat = toonMat({ color: 0xffcf3d, flatShading: true });
    const skinMat = toonMat({ color: 0xf2c9a0, flatShading: true });
    const bootMat = toonMat({ color: 0x35404a, flatShading: true });
    const redMat = toonMat({ color: 0xe8533f, flatShading: true });

    // 腿 + 靴
    for (const zs of [1, -1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.4, 7.4, 6), bootMat);
      leg.position.set(0, 3.4, zs * 1.8);
      man.add(leg);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.7, 2.7), bootMat);
      boot.position.set(0.6, 0.8, zs * 1.8);
      man.add(boot);
    }
    // 大衣 + 腰带 + 领巾
    const coat = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 5.4, 13, 10), coatMat);
    coat.position.y = 12;
    man.add(coat);
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(5.05, 5.05, 1.5, 10), bootMat);
    belt.position.y = 8.6;
    man.add(belt);
    const scarf = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.7, 1.7, 10), redMat);
    scarf.position.y = 17.6;
    man.add(scarf);
    // 头 + 胡子 + 眼睛
    const head = new THREE.Mesh(new THREE.SphereGeometry(3.6, 14, 10), skinMat);
    head.position.y = 21.6;
    man.add(head);
    const beard = new THREE.Mesh(
      new THREE.SphereGeometry(3.1, 10, 8),
      toonMat({ color: 0xe8e4dc, flatShading: true })
    );
    beard.scale.set(0.85, 0.72, 0.9);
    beard.position.set(1.6, 19.6, 0);
    man.add(beard);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1f26 });
    for (const zs of [1, -1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.44, 8, 6), eyeMat);
      e.position.set(3.1, 22.6, zs * 1.35);
      man.add(e);
    }
    // 帽子
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(5.8, 5.8, 0.9, 14), darkMat);
    brim.position.y = 24.4;
    man.add(brim);
    const hatTop = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 4.1, 3.6, 14), darkMat);
    hatTop.position.y = 26.4;
    man.add(hatTop);

    // 手臂（握着鱼竿）
    const armGeo = new THREE.CylinderGeometry(1.4, 1.2, 11.5, 6);
    const handGeo = new THREE.SphereGeometry(1.35, 8, 6);
    for (const zs of [1, -1]) {
      const arm = new THREE.Mesh(armGeo, coatMat);
      arm.position.set(2.4, 15.6, zs * 2.2);
      arm.rotation.z = -1.05;
      arm.rotation.x = zs * 0.2;
      man.add(arm);
      const hand = new THREE.Mesh(handGeo, skinMat);
      hand.position.set(4.6, 18.4, zs * 2.6);
      man.add(hand);
    }

    // ── 鱼竿（鱼线起点）──
    const rodMat = toonMat({ color: 0x4a3524, flatShading: true });
    const ROD_LEN = 40, ROD_ANG = -0.45;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 1.7, ROD_LEN, 6), rodMat);
    rod.position.set(-4, 26, 0);
    rod.rotation.z = ROD_ANG;
    boat.add(rod);
    this.rod = rod;
    this.rodLen = ROD_LEN;

    // 竿梢：竿的局部 +Y 方向顶端。船会摇晃，所以不能在这里算死 ——
    // 每帧从鱼竿的世界矩阵重算（见 _syncRodTip），否则鱼线会脱开竿梢飘在半空。
    this.rodTip = new THREE.Vector3();
    this._rodTipLocal = new THREE.Vector3(0, ROD_LEN / 2, 0);

    // 待机时的呼吸/摇晃基准
    this.boatBaseY = boat.position.y;
    this.rodBaseRot = ROD_ANG;
    this._syncRodTip();
  }

  /** 把竿梢的世界坐标重算出来（船摇晃之后必须调） */
  _syncRodTip() {
    if (!this.rod || !this.rodTip) return;
    this.boat.updateMatrixWorld(true);
    this._rodTipLocal.set(0, this.rodLen / 2, 0);
    this.rod.localToWorld(this._rodTipLocal);
    this.rodTip.copy(this._rodTipLocal);
  }

  /**
   * 船的摇晃：随浪起伏 + 左右摇摆（roll）+ 轻微俯仰（pitch）。
   *
   * 频率刻意压得很慢（0.5~1.3 rad/s）—— 要的是"缓缓摇晃"，
   * 两个不同周期的正弦叠加，避免看出机械的规律感。
   */
  _idleAnim(dt) {
    const t = this.time;

    // 起伏：慢波 + 快波各一条，合成自然的浪感
    const bob = Math.sin(t * 0.62) * 1.45 + Math.sin(t * 1.13 + 0.7) * 0.5;
    this.boat.position.y = this.boatBaseY + bob;

    // 左右摇摆 —— 这是"摇晃"最直观的那一部分。
    // 幅度取到 ~4°，船头船尾在屏幕上下摆动约 6px，看得出来但不像遇上台风。
    this.boat.rotation.z = Math.sin(t * 0.54) * 0.055 + Math.sin(t * 1.31 + 1.2) * 0.02;
    // 前后俯仰：正交侧视图里幅度很小，只是让船不那么像贴纸
    this.boat.rotation.x = Math.sin(t * 0.71 + 0.4) * 0.017;

    this.flag.rotation.y = Math.sin(t * 2.6) * 0.5;
    this.man.position.y = 10.4 + Math.sin(t * 1.5) * 0.35;
    this.rod.rotation.z = this.rodBaseRot + Math.sin(t * 0.9 + 0.3) * 0.032;

    // 船动了，竿梢也得跟着动 —— 鱼线起点和抛竿起抛点都靠它
    this._syncRodTip();
  }

  // ── 粒子池 ───────────────────────────────────────────────
  _buildParticles() {
    const coinGeo = new THREE.CylinderGeometry(1.6, 1.6, 0.5, 8);
    coinGeo.rotateX(Math.PI / 2);
    const coinMat = new THREE.MeshLambertMaterial({ color: 0xffcc33, emissive: 0x664400, transparent: true });
    this.coins = new ParticlePool(this.scene, coinGeo, coinMat, 90);

    const bubbleGeo = new THREE.SphereGeometry(1, 8, 6);
    const bubbleMat = new THREE.MeshBasicMaterial({ color: 0xd8f4ff, transparent: true, opacity: 0.6 });
    this.bubbles = new ParticlePool(this.scene, bubbleGeo, bubbleMat, 110);

    const sparkMat = new THREE.MeshBasicMaterial({
      map: makeGlowTexture('rgba(255,255,255,1)'), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.sparks = new ParticlePool(this.scene, new THREE.PlaneGeometry(6, 6), sparkMat, 130);

    const chunkGeo = new THREE.TetrahedronGeometry(1.6, 0);
    const chunkMat = new THREE.MeshLambertMaterial({ color: 0xff7a3d, flatShading: true, transparent: true });
    this.chunks = new ParticlePool(this.scene, chunkGeo, chunkMat, 70);

    // 环境海雪
    const N = 420;
    const pos = new Float32Array(N * 3);
    this.snowV = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 320;
      pos[i * 3 + 1] = WORLD.bottomY + Math.random() * (WORLD.skyTop - WORLD.bottomY);
      pos[i * 3 + 2] = -30 + Math.random() * 40;
      this.snowV[i] = 2 + Math.random() * 7;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({
      color: 0xd6f2ff, size: 1.8, transparent: true, opacity: 0.34, sizeAttenuation: false, depthWrite: false,
    }));
    this.snow.renderOrder = -70;
    this.scene.add(this.snow);
  }

  // ── 尺寸 ─────────────────────────────────────────────────
  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);

    const aspect = w / h;
    let vh = WORLD.viewHeight;
    let vw = vh * aspect;
    if (vw < WORLD.minViewWidth) { vw = WORLD.minViewWidth; vh = vw / aspect; }
    this.baseViewW = vw;
    this.baseViewH = vh;
    this._applyView();
    this._layoutDecor();
  }

  /** 把 baseView × viewScale 应用到正交相机 */
  _applyView() {
    const s = this.viewScale || 1;
    this.viewW = this.baseViewW * s;
    this.viewH = this.baseViewH * s;
    this.camera.left = -this.viewW / 2;
    this.camera.right = this.viewW / 2;
    this.camera.top = this.viewH / 2;
    this.camera.bottom = -this.viewH / 2;
    this.camera.updateProjectionMatrix();
  }

  /**
   * 正交缩放：1 = 正常视野，>1 = 拉远（空中看全景），<1 = 推近（待机时把渔夫拍大）。
   * 下限放到 0.5 是为了让"渔夫在船上待机"这个默认画面有足够的存在感。
   */
  setViewScale(s) {
    const v = clamp(Number.isFinite(s) ? s : 1, 0.5, 4);
    if (Math.abs(v - this.viewScale) < 0.002) return;
    this.viewScale = v;
    this._applyView();
  }

  /** 屏幕坐标（0..1 归一化，左上为原点）→ 世界坐标 */
  screenToWorld(nx, ny) {
    return {
      x: this.camX + (nx - 0.5) * this.viewW,
      y: this.camY + (0.5 - ny) * this.viewH,
    };
  }

  /** 当前可见的世界 Y 范围 */
  viewRange() {
    return {
      top: this.camY + this.viewH / 2,
      bottom: this.camY - this.viewH / 2,
      left: this.camX - this.viewW / 2,
      right: this.camX + this.viewW / 2,
    };
  }

  // ── 特效入口 ─────────────────────────────────────────────
  addShake(amount) { this.shake = Math.min(this.shake + amount, 30); }

  burstCoins(x, y, n = 8) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 130;
      this.coins.spawn({
        x, y, z: 2 + Math.random() * 4,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 40,
        g: -280, life: 0.7 + Math.random() * 0.6,
        scale: 0.7 + Math.random() * 0.8, spin: (Math.random() - 0.5) * 22, drag: 0.9,
      });
    }
  }

  burstBubbles(x, y, n = 10, spread = 14) {
    for (let i = 0; i < n; i++) {
      this.bubbles.spawn({
        x: x + (Math.random() - 0.5) * spread, y: y + (Math.random() - 0.5) * spread, z: 1,
        vx: (Math.random() - 0.5) * 26, vy: 22 + Math.random() * 55,
        g: 12, life: 0.6 + Math.random() * 0.8, scale: 0.6 + Math.random() * 1.4, drag: 0.7,
      });
    }
  }

  burstSparks(x, y, n = 14, scale = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 220;
      this.sparks.spawn({
        x, y, z: 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        g: -120, life: 0.22 + Math.random() * 0.3,
        scale: (0.5 + Math.random() * 1.4) * scale, drag: 2.2,
      });
    }
  }

  burstChunks(x, y, n = 12) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 170;
      this.chunks.spawn({
        x, y, z: 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        g: -300, life: 0.6 + Math.random() * 0.5,
        scale: 0.6 + Math.random() * 1.1, spin: (Math.random() - 0.5) * 16, drag: 0.5,
      });
    }
  }

  burstSplash(x, y, n = 22) {
    for (let i = 0; i < n; i++) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      this.sparks.spawn({
        x: x + (Math.random() - 0.5) * 10, y, z: 5,
        vx: dir * (20 + Math.random() * 120), vy: 90 + Math.random() * 200,
        g: -420, life: 0.4 + Math.random() * 0.45,
        scale: 0.7 + Math.random() * 1.2, drag: 0.4,
      });
    }
    this.burstBubbles(x, y, 16, 26);
  }

  /**
   * 点击处爆炸：冲击波环 + 火球 + 火花 + 碎块
   * @param {number} radius 世界单位，和伤害判定半径一致，做到"看到多大就炸多大"
   */
  burstExplosion(x, y, radius) {
    this.blasts.spawn(x, y, radius);
    this.burstSparks(x, y, 22, Math.max(0.8, radius / 26));
    this.burstChunks(x, y, 12);
    this.burstBubbles(x, y, 6, radius * 0.7);
  }

  clearParticles() {
    this.coins.clear(); this.bubbles.clear(); this.sparks.clear(); this.chunks.clear();
    if (this.blasts) this.blasts.clear();
  }

  // ── 每帧更新 ─────────────────────────────────────────────
  /**
   * @param {number} dt
   * @param {{x?:number, y:number, rate?:number, scale?:number,
   *          hookY?:number, depthT?:number}} cam
   */
  update(dt, cam) {
    this.time += dt;

    const rate = Number.isFinite(cam.rate) ? cam.rate : 4;

    // 相机跟随（带数值防护：即使某处算出了 NaN，也不会让整条坐标换算链失效）
    if (!Number.isFinite(this.camY)) this.camY = CAMERA.minY;
    if (!Number.isFinite(this.camX)) this.camX = 0;

    const ty = Number.isFinite(cam.y) ? Math.max(cam.y, CAMERA.minY) : this.camY;
    this.camY += (ty - this.camY) * (1 - Math.exp(-rate * dt));

    const tx = Number.isFinite(cam.x) ? cam.x : this.camX;
    this.camX += (tx - this.camX) * (1 - Math.exp(-rate * 0.75 * dt));

    this.setViewScale(cam.scale);

    const depthT = clamp(cam.depthT ?? 0, 0, 1);
    const hookY = Number.isFinite(cam.hookY) ? cam.hookY : 0;

    // ── 深度黑暗 ──
    // 越深环境光越弱；灯具等级决定鱼钩那盏灯照多远、多亮。
    // 这是「深海看不见 → 回渔具店买灯具」这条成长线的全部依据。
    const depth = Math.max(0, -this.camY);
    const rawDark = clamp(depth / DEEP.darknessFull, 0, 1);
    const dark = rawDark * (1 - this.lampP * 0.9);
    this.darkness = dark;

    // 震屏
    this.shakeT += dt;
    this.shake = Math.max(0, this.shake - this.shake * TUNING.shakeDecay * dt - 2 * dt);
    const sx = this.shake ? Math.sin(this.shakeT * 63) * this.shake * 0.5 : 0;
    const sy = this.shake ? Math.cos(this.shakeT * 51) * this.shake * 0.5 : 0;

    this.camera.position.x = this.camX + sx;
    this.camera.position.y = this.camY + sy;
    this.camera.updateMatrixWorld();

    // 深度光照衰减（黑暗由灯具压制）
    this.hemi.intensity = lerp(0.85, 0.05, dark);
    this.ambient.intensity = lerp(0.55, 0.05, dark);
    this.sun.intensity = lerp(1.55, 0.05, dark);
    this.rim.intensity = lerp(0.62, 0.06, dark);

    // 鱼钩上的灯具
    this.hookLight.position.set(this.camX, hookY, 26);
    this.hookLight.intensity = (0.25 + this.lampP * 3.6) * clamp(0.35 + rawDark, 0, 1);
    this.hookLight.distance = this.lampR * 3.4;

    // 深海暗幕 + 灯具光池（屏幕空间叠加，只在水平面以下生效）
    const under = this.camY < WORLD.surfaceY + 30 * MODEL_SCALE;
    const veilOn = under && dark > 0.015;
    this.veil.visible = veilOn;
    if (veilOn) {
      this.veil.position.set(this.camX, this.camY, 8);
      this.veil.scale.set(this.viewW * 1.06, this.viewH * 1.06, 1);
      this.veilMat.opacity = Math.min(0.6, dark * 0.72);
    }
    const lampShow = under && hookY < WORLD.surfaceY + 10 * MODEL_SCALE && dark > 0.02;
    this.lampGlow.visible = lampShow;
    if (lampShow) {
      this.lampGlow.position.set(this.camX, hookY, 9);
      this.lampGlow.scale.setScalar(this.lampR * 2.4);
      this.lampGlowMat.opacity = (0.10 + this.lampP * 0.44) * clamp(dark * 1.6, 0, 1);
    }

    // ── 高度：云 → 天空 → 太空 ──
    const alt = altitudeMix(this.camY);
    this.alt = alt;
    this.starMat.opacity = alt.stars * 0.95;
    this.moonMat.opacity = alt.stars;
    this.moonGlowMat.opacity = alt.stars * 0.5;
    this.moonCraterMat.opacity = alt.stars * 0.45;
    this.cloudMat.opacity = 0.78 * alt.clouds * (this.skyDim ?? 1);

    const sunFade = clamp(1 - this.camY / (760 * MODEL_SCALE), 0, 1) * (this.skyDim ?? 1);
    this.sunGlow.material.opacity = 0.62 * sunFade;
    this.sunCore.material.opacity = 0.9 * sunFade;

    for (let i = 0; i < this.nebulas.length; i++) {
      this.nebulas[i].material.opacity =
        alt.stars * (0.10 + 0.05 * Math.sin(this.time * 0.35 + i * 1.9));
    }
    this.moonGroup.rotation.z = Math.sin(this.time * 0.05) * 0.06;

    // ── 极光：整条光帘缓慢起伏 + 明暗呼吸 ──
    // 起伏用 sin 而不是随机：极光是"飘"，随机抖动会变成"闪"，看起来很廉价。
    if (this.auroraRoot.visible) {
      for (let i = 0; i < this.aurora.length; i++) {
        const r = this.aurora[i];
        const ph = r.userData.phase;
        r.position.x = r.userData.baseX + Math.sin(this.time * 0.09 * r.userData.wave + ph) * 26;
        r.rotation.z = Math.sin(this.time * 0.07 * r.userData.wave + ph) * 0.07;
        r.material.opacity = 0.20 + 0.14 * Math.sin(this.time * 0.42 + ph * 1.7);
      }
    }

    // ── 浮冰：横向漂移 + 上下浮沉，出界就绕到另一边 ──
    if (this.icebergRoot.visible && this.icebergs.length) {
      const hw = WORLD.fishHalfWidth + 30;
      for (const b of this.icebergs) {
        const p = b.mesh.position;
        p.x += b.vx * dt;
        if (p.x > hw) p.x = -hw;
        else if (p.x < -hw) p.x = hw;
        // 浮沉幅度很小（3.2）—— 冰块几乎不随浪走，晃得大了就不像冰了
        p.y += Math.sin(this.time * 0.5 + b.bob) * 3.2 * dt;
        b.mesh.rotation.z += Math.sin(this.time * 0.35 + b.bob) * 0.12 * dt;
        if (b.hitT > 0) b.hitT -= dt;
      }
    }

    // 水面波动
    const pos = this._bandPos;
    for (let i = 0; i < this._bandTop.length; i++) {
      const idx = this._bandTop[i];
      const x = this._bandX[i];
      pos.setY(idx,
        Math.sin(x * 0.075 + this.time * 2.1) * 1.7 +
        Math.sin(x * 0.028 - this.time * 1.35) * 1.2 +
        Math.sin(x * 0.19 + this.time * 3.4) * 0.45);
    }
    pos.needsUpdate = true;

    // 船随浪摇晃（同时把竿梢位置同步出去 —— 鱼线/抛竿起抛点都依赖它）
    this._idleAnim(dt);

    // 云飘动
    if (alt.clouds > 0.02) {
      for (const c of this.clouds) {
        c.position.x += c.userData.speed * dt;
        if (c.position.x > 210) c.position.x = -210;
      }
    }

    // 神光呼吸（只在近水面有意义，升高后淡出）
    const rayFade = clamp(1 - this.camY / (180 * MODEL_SCALE), 0, 1);
    for (let i = 0; i < this.rays.length; i++) {
      const r = this.rays[i];
      r.material.opacity = (0.1 + Math.sin(this.time * 0.7 + i) * 0.05) * rayFade;
      r.visible = rayFade > 0.02;
      r.position.x += Math.sin(this.time * 0.35 + i * 1.7) * dt * 6;
    }

    // 海雪（只在水下）
    const waterT = clamp(1 - this.camY / (60 * MODEL_SCALE), 0, 1);
    if (waterT > 0.02) {
      const sp = this.snow.geometry.attributes.position;
      for (let i = 0; i < this.snowV.length; i++) {
        let y = sp.getY(i) - this.snowV[i] * dt;
        if (y < WORLD.bottomY) { y = WORLD.skyTop; sp.setX(i, (Math.random() - 0.5) * 320); }
        sp.setY(i, y);
      }
      sp.needsUpdate = true;
      this.snow.visible = true;
      // snowBoost 是地图主题给的密度倍率（极地 1.7，温带 1）—— 夹到 1 以内免得白茫茫一片
      this.snow.material.opacity = Math.min(0.72, lerp(0.06, 0.42, depthT) * waterT * this.snowBoost);
    } else {
      this.snow.visible = false;
    }

    this.coins.update(dt);
    this.bubbles.update(dt);
    this.sparks.update(dt);
    this.chunks.update(dt);
    this.blasts.update(dt);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

export { clamp, lerp };
