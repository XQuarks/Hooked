/**
 * fish.js — 鱼类 3D 造型工厂 + 游动行为 + 对象池
 *
 * 性能要点：所有零碎部件（鳍 / 刺 / 腿 / 王冠 / 条纹）都在构建期合并成单个
 * BufferGeometry，眼睛用贴图平面代替「眼白+瞳孔」两个 mesh。
 * 单条鱼最终只有 5~8 个 draw call，而不是 15~25 个。
 */
import * as THREE from 'three';
import { WORLD, TUNING, RARITY, rollRarity, MODEL_SCALE } from './config.js';
import { makeGlowTexture, toonMat } from './world.js';

// ── 缓存 ────────────────────────────────────────────────────
const geoCache = new Map();
const matCache = new Map();
const sh = (k, make) => { if (!geoCache.has(k)) geoCache.set(k, make()); return geoCache.get(k); };
const mt = (k, make) => { if (!matCache.has(k)) matCache.set(k, make()); return matCache.get(k); };

const SPHERE = () => sh('sphere', () => new THREE.SphereGeometry(1, 12, 8));
const CONE = () => sh('cone', () => new THREE.ConeGeometry(1, 1, 5));
const PLANE = () => sh('plane', () => new THREE.PlaneGeometry(1, 1));

/**
 * 鱼身：旋转体剖面 [半径, 轴向位置]。
 * 之前用的是「一个压扁的球」—— 在正交相机下完全看不出鱼形，
 * 就是一团椭圆。换成旋转体之后有头粗尾细的流线，加上卡通着色的三档明暗，
 * 立体感是这一步提升最明显的地方。
 */
const FISH_PROFILE = [
  [0.03, -1.00], [0.30, -0.90], [0.62, -0.62], [0.88, -0.24],
  [1.00, 0.12], [0.92, 0.46], [0.70, 0.74], [0.38, 0.93], [0.04, 1.00],
];
const BODY = () => sh('fishbody', () => {
  const pts = FISH_PROFILE.map(([r, h]) => new THREE.Vector2(r, h));
  const g = new THREE.LatheGeometry(pts, 14);
  g.rotateZ(-Math.PI / 2);   // 旋转轴 Y → X，鱼头朝 +X
  return g;
});

// ── 几何工具 ────────────────────────────────────────────────
/** 把一份几何体摆到指定位置/旋转/缩放后返回副本 */
function place(geo, pos, rot, scale) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(pos[0], pos[1], pos[2]),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])),
    new THREE.Vector3(scale[0], scale[1], scale[2])
  );
  return geo.clone().applyMatrix4(m);
}

/** 合并多份几何体为一份（只保留 position / normal，够用且省内存） */
function mergeGeos(list) {
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

/** 鱼鳍：XY 平面内的多边形（正对相机） */
function finGeo(key, pts) {
  return sh('fin:' + key, () => {
    const s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    s.closePath();
    return new THREE.ShapeGeometry(s);
  });
}

const TAIL_PTS = [[0, 0], [-1, 1], [-0.58, 0], [-1, -1]];
const DORSAL_PTS = [[0, 0], [-0.25, 1], [-1, 0.25], [-1, 0]];
const PEC_PTS = [[0, 0], [-0.7, -0.9], [-1, 0.1]];
const CREST_PTS = [[0, 0], [-0.15, 1], [-0.75, 0.55], [-0.95, 0]];
const WING_PTS = [[0, 0], [-0.35, -1], [-1, -0.25], [-0.75, 0.1]];
// 扇尾 / 扇鳍：蝴蝶鱼、狮子鱼用，张开成一把扇子而不是简单的三角
const FAN_TAIL_PTS = [[0, 0], [-0.62, 0.92], [-1.02, 0.78], [-1.28, 0], [-1.02, -0.78], [-0.62, -0.92]];
const FAN_FIN_PTS = [[0, 0], [0.18, 1.0], [-0.46, 1.24], [-1.08, 0.86], [-1.2, 0.06], [-0.6, -0.12]];

/** 球形分布的尖刺，合并成一份几何体 */
function spikeGeo(key, n, r, sc) {
  return sh('spikes:' + key, () => {
    const cone = CONE();
    const parts = [];
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const phi = Math.acos(1 - 2 * (i + 0.5) / n);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      v.set(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)).normalize();
      const pos = [v.x * r[0] * 0.9, v.y * r[1] * 0.9, v.z * r[2] * 0.9];
      const q = new THREE.Quaternion().setFromUnitVectors(up, v);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(pos[0], pos[1], pos[2]), q,
        new THREE.Vector3(sc[0], sc[1], sc[2])
      );
      parts.push(cone.clone().applyMatrix4(m));
    }
    return mergeGeos(parts);
  });
}

/**
 * 扣钱鱼头顶的 ⚠ 徽章贴图。
 * 「所有扣钱的鱼做明显一点」这一条不能只靠配色 —— 玩家在深海暗幕里根本分不清
 * 黄色是黄金鱼王还是河豚。所以给扣钱鱼统一挂一个亮黄三角警示牌，一眼可辨。
 */
function warnTexture() {
  return sh('warntex', () => {
    const S = 64;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, S, S);
    g.fillStyle = '#ffd400';
    g.beginPath();
    g.moveTo(S / 2, 3); g.lineTo(S - 3, S - 6); g.lineTo(3, S - 6); g.closePath();
    g.fill();
    g.lineWidth = 6; g.strokeStyle = '#7a0d0d'; g.lineJoin = 'round'; g.stroke();
    g.fillStyle = '#7a0d0d';
    g.fillRect(S / 2 - 3.4, S * 0.30, 6.8, S * 0.33);
    g.beginPath(); g.arc(S / 2, S * 0.79, 4.4, 0, 6.2832); g.fill();
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/**
 * 斑点：用斐波那契球分布撒一层扁球，只保留身体侧面（|z| 大）的那些，
 * 免得斑点长到头顶和肚皮上。合并成一份几何体，仍然只有 1 个 draw call。
 */
function spotGeo(key, n, r) {
  return sh('spots:' + key, () => {
    const sph = SPHERE();
    const parts = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const phi = Math.acos(1 - 2 * (i + 0.5) / n);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      v.set(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)).normalize();
      if (Math.abs(v.z) < 0.42) continue;             // 只贴两侧
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(v.x * r[0] * 0.9, v.y * r[1] * 0.88, v.z * r[2] * 0.99),
        new THREE.Quaternion(),
        new THREE.Vector3(r[0] * 0.17, r[1] * 0.17, r[2] * 0.07)
      );
      parts.push(sph.clone().applyMatrix4(m));
    }
    return parts.length ? mergeGeos(parts) : null;
  });
}

/** 卡通眼睛贴图：一次 draw call 搞定眼白 + 瞳孔 + 高光 */
function eyeTexture() {
  return sh('eyetex', () => {
    const S = 64;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, S, S);
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(S / 2, S / 2, S * 0.46, 0, 6.2832); g.fill();
    g.fillStyle = '#141920';
    g.beginPath(); g.arc(S * 0.56, S / 2, S * 0.245, 0, 6.2832); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.beginPath(); g.arc(S * 0.47, S * 0.36, S * 0.085, 0, 6.2832); g.fill();
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/**
 * 根据鱼种定义生成 3D 模型（Group）。鱼头朝 +X。
 * mesh.userData.core / detail 用于挂上鱼线时切换简化模型。
 */
export function buildFishModel(def) {
  const g = new THREE.Group();
  const [L, H, W] = def.body;

  const bodyMat = mt('body:' + def.id, () => toonMat({
    color: def.color,
    emissive: def.emissive ?? 0x000000,
    emissiveIntensity: def.emissiveIntensity ?? 0,
    flatShading: true,
    transparent: def.opacity != null,
    opacity: def.opacity ?? 1,
  }));

  // ── 描边：反面外壳。低多边形 + 描边是让正交视角"立起来"最有效的一招。
  // 半透明的幽灵鱼不加，否则实心黑边会把它变得很脏。
  // 扣钱鱼换成暗红描边 —— 深海暗幕里黑边是看不见的，暗红才刺眼。
  if (def.opacity == null) {
    const outline = new THREE.Mesh(BODY(), mt(def.hazard ? 'outlineHazard' : 'outline', () => new THREE.MeshBasicMaterial({
      color: def.hazard ? 0x8c0f14 : 0x0a1524, side: THREE.BackSide,
    })));
    outline.scale.set(L * 1.06, H * 1.12, W * 1.12);
    outline.userData.core = true;
    outline.renderOrder = -1;
    g.add(outline);
  }

  // ── 身体 ──
  const body = new THREE.Mesh(BODY(), bodyMat);
  body.scale.set(L, H, W);
  body.userData.core = true;
  g.add(body);

  // ── 腹部色块：同一份旋转体压扁下移，z 方向稍微撑出去 8%，
  // 于是从侧面看就是一条干净的双色分界，成本只有 1 个 draw call。
  if (def.belly) {
    const bm = mt('belly:' + def.id, () => toonMat({ color: def.belly, flatShading: true }));
    const b = new THREE.Mesh(BODY(), bm);
    b.scale.set(L * 0.95, H * 0.58, W * 1.08);
    b.position.y = -H * 0.42;
    g.add(b);
  }

  // ── 斑点（鲭鱼 / 金枪鱼 / 蝠鲼 / 毒蛇鱼 / 鱼王） ──
  if (def.spots) {
    const sg = spotGeo(def.id, def.spotsN ?? 14, [L, H, W]);
    if (sg) {
      const sm = mt('spot:' + def.id, () => toonMat({ color: def.spots, flatShading: true }));
      g.add(new THREE.Mesh(sg, sm));
    }
  }

  // ── 尾鳍（独立，需要摆动） ──
  const finMat = mt('fin:' + def.id, () => toonMat({
    color: def.color, side: THREE.DoubleSide, transparent: true, opacity: 0.94, flatShading: true,
  }));
  const tailPivot = new THREE.Group();
  tailPivot.position.x = -L * 0.92;
  g.add(tailPivot);
  const tail = new THREE.Mesh(finGeo(def.fanTail ? 'fantail' : 'tail', def.fanTail ? FAN_TAIL_PTS : TAIL_PTS), finMat);
  tail.scale.set(def.tail[0] * (def.fanTail ?? 1), def.tail[1] * (def.fanTail ?? 1), 1);
  tail.userData.core = true;
  tailPivot.add(tail);
  g.userData.tailPivot = tailPivot;

  // ── 背鳍 + 双侧胸鳍：合并成 1 个 mesh ──
  const finParts = [];
  if (def.fanFin) {
    // 狮子鱼：背鳍 + 双胸鳍全换成大扇面，张开像一把烧着的扇子
    const k = def.fanFin;
    finParts.push(place(finGeo('fanfin', FAN_FIN_PTS), [L * 0.2, H * 0.78, 0], [0, 0, 0], [L * 0.58 * k, H * 0.95 * k, 1]));
    finParts.push(place(finGeo('fanfin', FAN_FIN_PTS), [L * 0.32, -H * 0.1, W * 0.7], [0, -0.75, -0.35], [L * 0.5 * k, H * 0.85 * k, 1]));
    finParts.push(place(finGeo('fanfin', FAN_FIN_PTS), [L * 0.32, -H * 0.1, -W * 0.7], [0, 0.75, -0.35], [L * 0.5 * k, H * 0.85 * k, 1]));
  } else {
    if (def.fin) {
      finParts.push(place(finGeo('dorsal', DORSAL_PTS), [L * 0.15, H * 0.82, 0], [0, 0, 0], [def.fin[0], def.fin[1], 1]));
    }
    finParts.push(place(finGeo('pec', PEC_PTS), [L * 0.25, -H * 0.25, W * 0.85], [0, -0.5, 0], [L * 0.6, H * 0.7, 1]));
    finParts.push(place(finGeo('pec', PEC_PTS), [L * 0.25, -H * 0.25, -W * 0.85], [0, 0.5, 0], [L * 0.6, H * 0.7, 1]));
  }
  g.add(new THREE.Mesh(mergeGeos(finParts), finMat));

  // ── 眼睛：贴图平面 × 2 ──
  const er = def.eye ?? 0.5;
  const eyeMat = mt('eye', () => new THREE.MeshBasicMaterial({
    map: eyeTexture(), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide,
  }));
  for (const zs of [1, -1]) {
    const e = new THREE.Mesh(PLANE(), eyeMat);
    e.scale.setScalar(er * 3.0);
    e.position.set(L * 0.6, H * 0.3, zs * W * 0.76);
    e.rotation.y = zs > 0 ? 0 : Math.PI;
    g.add(e);
  }

  // ── 条纹：沿身体轮廓贴 stripeN 圈，合并 ──
  if (def.stripe) {
    const n = Math.max(1, def.stripeN ?? 2);
    const sm = mt('stripe:' + def.id, () => toonMat({ color: def.stripe, flatShading: true }));
    const thin = n > 3;
    const parts = [];
    for (let i = 0; i < n; i++) {
      const fx = n === 1 ? 0.24 : 0.58 - (i / (n - 1)) * 1.08;
      const s = new THREE.Mesh(BODY(), sm);
      s.scale.set(L * (thin ? 0.085 : 0.15), H * 1.05, W * 1.06);
      s.position.x = L * fx;
      s.updateMatrix();
      parts.push(BODY().clone().applyMatrix4(s.matrix));
    }
    g.add(new THREE.Mesh(mergeGeos(parts), sm));
  }

  // ── 獠牙：从嘴里交错伸出的白锥，牙尖朝内（合不上嘴的那种） ──
  if (def.fangs) {
    const fm = mt('fang', () => toonMat({ color: 0xfffdf2, flatShading: true }));
    const parts = [];
    for (let i = 0; i < def.fangs; i++) {
      const upper = i % 2 === 0;
      const k = Math.floor(i / 2);
      parts.push(place(
        CONE(),
        [L * (0.9 - k * 0.13), (upper ? 1 : -1) * H * 0.2, (i % 4 < 2 ? 1 : -1) * W * 0.22],
        [0, 0, upper ? Math.PI : 0],
        [H * 0.075, H * 0.46, H * 0.075]
      ));
    }
    g.add(new THREE.Mesh(mergeGeos(parts), fm));
  }

  // ── 胡须：从嘴边长出去的两三根细须 ──
  if (def.whisker) {
    const wm = mt('whisker:' + def.id, () => new THREE.MeshBasicMaterial({ color: def.belly ?? def.color }));
    const cyl = sh('whiskercyl', () => new THREE.CylinderGeometry(0.5, 0.16, 1, 4));
    const parts = [];
    for (let i = 0; i < def.whisker; i++) {
      const a = (i - (def.whisker - 1) / 2) * 0.3;
      parts.push(place(
        cyl,
        [L * 0.9 + Math.cos(a) * L * 0.4, -H * 0.16 + Math.sin(a) * H * 0.5, (i % 2 ? 1 : -1) * W * 0.45],
        [0, 0, Math.PI / 2 - a],
        [H * 0.06, L * 0.8, H * 0.06]
      ));
    }
    g.add(new THREE.Mesh(mergeGeos(parts), wm));
  }

  // ── 大鼻子（水滴鱼 / 鮟鱇鱼） ──
  if (def.bignose) {
    const n = new THREE.Mesh(SPHERE(), bodyMat);
    n.scale.set(H * 0.42 * def.bignose, H * 0.4 * def.bignose, W * 0.72 * def.bignose);
    n.position.set(L * 0.92, -H * 0.08, 0);
    g.add(n);
  }

  // ── 尖刺（河豚 / 毒蛇鱼）：合并 ──
  if (def.spikes) {
    const spikeMat = mt('spike:' + def.id, () => toonMat({
      color: def.emissive ?? 0x8a7b52, flatShading: true,
    }));
    g.add(new THREE.Mesh(spikeGeo(def.id, def.spikes, [L, H, W], [0.5, 2.0, 0.5]), spikeMat));
  }

  // ── 剑鱼长吻 ──
  if (def.bill) {
    const bill = new THREE.Mesh(CONE(), bodyMat);
    bill.scale.set(H * 0.28, def.bill, H * 0.28);
    bill.rotation.z = -Math.PI / 2;
    bill.position.x = L + def.bill * 0.5;
    g.add(bill);
  }

  // ── 鮟鱇鱼发光诱饵 ──
  if (def.lure) {
    const stalk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, H * 2.0, 5),
      mt('stalk', () => new THREE.MeshLambertMaterial({ color: 0x2a1a22 }))
    );
    stalk.position.set(L * 0.35, H * 1.5, 0);
    stalk.rotation.z = -0.5;
    g.add(stalk);

    const bulb = new THREE.Mesh(SPHERE(), mt('lurebulb', () => new THREE.MeshBasicMaterial({ color: 0xffe89a })));
    bulb.scale.setScalar(1.5);
    bulb.position.set(L * 0.95, H * 2.5, 0);
    g.add(bulb);

    const halo = new THREE.Mesh(PLANE(), mt('lurehalo', () => new THREE.MeshBasicMaterial({
      map: makeGlowTexture('rgba(255,255,255,1)'), color: 0xffd766, transparent: true,
      opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false,
    })));
    halo.scale.setScalar(13);
    halo.position.copy(bulb.position);
    halo.position.z = -1;
    g.add(halo);
  }

  // ── 皇带鱼背鳍冠 ──
  if (def.crest) {
    const crestMat = def.crestColor
      ? mt('crestc:' + def.id, () => toonMat({ color: def.crestColor, side: THREE.DoubleSide, flatShading: true }))
      : finMat;
    const crest = new THREE.Mesh(finGeo('crest', CREST_PTS), crestMat);
    crest.scale.set(L * 0.85, H * 1.5, 1);
    crest.position.set(L * 0.55, H * 0.85, 0);
    g.add(crest);
  }

  // ── 蝠鲼双翼：合并 ──
  if (def.wings) {
    const wm = mt('wing:' + def.id, () => new THREE.MeshBasicMaterial({
      color: def.color, side: THREE.DoubleSide, transparent: true, opacity: 0.9,
    }));
    const parts = [1, -1].map((zs) => place(
      finGeo('wing', WING_PTS),
      [L * 0.35, -H * 0.2, 0],
      [zs * 0.5, 0, 0],
      [L * 0.95, def.wings, zs]
    ));
    g.add(new THREE.Mesh(mergeGeos(parts), wm));
  }

  // ── 双髻鲨锤头 ──
  if (def.hammer) {
    const ham = new THREE.Mesh(SPHERE(), bodyMat);
    ham.scale.set(L * 0.11, H * 0.22, W * 2.6);
    ham.position.x = L * 0.88;
    g.add(ham);
  }

  // ── 黄金鱼王王冠：合并 ──
  if (def.crown) {
    const cm = mt('crown', () => toonMat({ color: 0xffe066, emissive: 0x6b4b00, flatShading: true }));
    const parts = [-1, 0, 1].map((i) => place(
      CONE(), [L * 0.35 + i * H * 0.35, H * 1.25, 0], [0, 0, 0], [H * 0.2, H * 0.75, H * 0.2]
    ));
    g.add(new THREE.Mesh(mergeGeos(parts), cm));
  }

  // ── 乌贼触手：合并 ──
  if (def.legs) {
    const lm = mt('leg:' + def.id, () => toonMat({
      color: def.color, emissive: def.emissive ?? 0,
      emissiveIntensity: (def.emissiveIntensity ?? 0) * 0.6, flatShading: true,
    }));
    const parts = [];
    for (let i = 0; i < def.legs; i++) {
      parts.push(place(
        CONE(),
        [-L * 1.35, (i - (def.legs - 1) / 2) * W * 0.42, 0],
        [0, 0, Math.PI / 2],
        [W * 0.28, L * 0.75, W * 0.28]
      ));
    }
    g.add(new THREE.Mesh(mergeGeos(parts), lm));
  }

  // ── 深海发光光晕 ──
  if (def.glow) {
    const [r, c] = def.glow;
    const halo = new THREE.Mesh(PLANE(), mt('halo:' + def.id, () => new THREE.MeshBasicMaterial({
      map: makeGlowTexture('rgba(255,255,255,1)'), color: c, transparent: true,
      opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false,
    })));
    halo.scale.setScalar(r * 3.2);
    halo.position.z = -2;
    halo.renderOrder = -1;
    g.add(halo);
    g.userData.halo = halo;
  }

  // ── 扣钱鱼统一警戒视觉：红色脉冲光晕 + 头顶 ⚠ 徽章 ──
  // 深海里"颜色鲜艳"是不够的（暗幕会把饱和度吃掉），必须有形状信号。
  if (def.hazard) {
    const halo = new THREE.Mesh(PLANE(), mt('warnhalo', () => new THREE.MeshBasicMaterial({
      map: makeGlowTexture('rgba(255,255,255,1)'), color: 0xff2a2a, transparent: true,
      opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false,
    })));
    // 光晕跟着体型拉成椭圆：细长的电鳗要一条长红晕，河豚要一个圆红晕
    const hx = L * 2.6, hy = Math.max(H * 4.2, L * 0.9);
    halo.scale.set(hx, hy, 1);
    halo.position.z = -2.5;
    halo.renderOrder = -1;
    g.add(halo);
    g.userData.warnHalo = halo;
    g.userData.warnBase = { x: hx, y: hy };

    // 徽章挂在一个"反向自转"的枢轴上，每帧把父级偏航抵消掉，
    // 这样无论鱼头朝左还是朝右，⚠ 都正对镜头、且不会被身体挡住。
    const badgePivot = new THREE.Group();
    g.add(badgePivot);
    const bs = Math.max(H * 1.15, 2.2);
    const badge = new THREE.Mesh(PLANE(), mt('warnbadge', () => new THREE.MeshBasicMaterial({
      map: warnTexture(), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, depthWrite: false,
    })));
    badge.scale.setScalar(bs);
    badge.position.set(L * 0.08, H * 1.25 + bs * 0.6, W * 1.2 + 1.6);
    badge.renderOrder = 5;
    badgePivot.add(badge);
    g.userData.badgePivot = badgePivot;
  }

  // 分类：core（身体+尾巴，简化模型保留） / detail（挂上鱼线后隐藏）
  const core = [], detail = [];
  g.traverse((o) => {
    if (!o.isMesh) return;
    (o.userData.core ? core : detail).push(o);
  });
  g.userData.core = core;
  g.userData.detail = detail;

  return g;
}

// ─────────────────────────────────────────────────────────────
// Fish
// ─────────────────────────────────────────────────────────────
export const FISH_STATE = { SWIM: 'swim', CAUGHT: 'caught', AIR: 'air', DEAD: 'dead' };

/**
 * 血量由体型推算：小鱼一炮就碎，大鱼要补一炮。
 * ⚠ 除数跟着 MODEL_SCALE 走：radius 在 v0.2 里已经 ×2 了，除数不跟着涨的话
 *   "体型推算血量"会整体翻倍，和显式写了 hp 的鱼对不上。
 *   （所有鱼种都显式写了 hp，这条只是兜底路径，但不能留成错的。）
 */
const calcHp = (radius) => Math.max(1, Math.round(radius / (3.6 * MODEL_SCALE)));

export class Fish {
  constructor(def) {
    this.def = def;
    // 判定半径 = 设计稿半径 × 模型倍率 —— 必须和视觉一起放大，
    // 否则鱼看起来大了一倍、碰撞还是原来那个小圈，串鱼 / 撞鱼手感会全错。
    this.radius = def.radius * MODEL_SCALE;
    this.mesh = buildFishModel(def);
    this.mesh.visible = false;
    this.state = FISH_STATE.DEAD;
    this.inUse = false;
    this.capped = false;
    this.vx = 0; this.vy = 0;
    this.spin = 0;      // 绕 Z 轴（画面内的"打滚"，侧视正交相机下最显眼）
    this.spinX = 0;     // 绕 X 轴（前后翻）
    this.spinY = 0;     // 绕 Y 轴（左右转）
    this.hp = 1; this.maxHp = 1;
    // 被「鱼护」挤下鱼线后的短暂免疫（秒）。> 0 时上升阶段的扫掠不会把它重新串上，
    // 否则它会卡在鱼钩旁边被反复勾住/挣脱。
    this.immuneT = 0;
    // 被枪打中后「上顶」的冷却（秒）。连发枪（加特林 13 发/秒）如果不做这个限制，
    // knockUp 的 `vy = max(vy,0) + boost` 会在一秒里叠加到两千多 —— 鱼直接飞出大气层。
    // 见 game.js 的 _applyDamage。
    this.knockT = 0;
    // 稀有度（普通 / 银色 / 金色 / 王冠），在 reset() 里逐条抽签
    this.rarity = RARITY[0];

    // ── 稀有度光晕 ──
    // ⚠ 这份材质**必须逐条新建，不能进 matCache**：
    //   鱼种的身体材质是按 def.id 缓存的（同种鱼共用一份），
    //   但稀有度是**逐条**的 —— 共用材质会让一条金色鱼把整群同种鱼都染成金的。
    //   普通档把 visible 关掉，所以绝大多数鱼不额外占 draw call。
    this.rarityHalo = new THREE.Mesh(PLANE(), new THREE.MeshBasicMaterial({
      map: makeGlowTexture('rgba(255,255,255,1)'), color: 0xffffff, transparent: true,
      opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.rarityHalo.position.z = -3;
    this.rarityHalo.renderOrder = -1;
    this.rarityHalo.visible = false;
    this.mesh.add(this.rarityHalo);
  }

  reset(x, y) {
    const d = this.def;
    this.x = x;
    this.y = y;
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.speed = d.speed * (0.78 + Math.random() * 0.5);
    this.phase = Math.random() * Math.PI * 2;
    this.bobAmp = Math.random() * 2.6 * MODEL_SCALE;
    this.bobFreq = 0.55 + Math.random() * 0.9;
    // 稀有度：Boss（`elite === false`）不参与抽签 —— 它本身就已经是"稀有"了，
    // 再叠一层金色描边会让"金色"这个信号贬值。
    this.rarity = d.elite === false ? RARITY[0] : rollRarity();
    this.value = Math.round(d.value * this.rarity.mul * (0.85 + Math.random() * 0.4));
    const rh = this.rarityHalo;
    if (this.rarity.rim) {
      rh.visible = true;
      rh.material.color.setHex(this.rarity.rim);
      // 越稀有光晕越实、越大 —— 空中只有几秒钟做判断，必须一眼看出哪条值钱
      rh.material.opacity = 0.30 + 0.40 * this.rarity.glow;
      // ⚠ 系数 2.6 → 1.3：this.radius 已经是 ×2 后的值，而 rarityHalo 是 mesh 的
      //   子对象、还会被 mesh.scale（也 ×2）再放大一次。不折半的话光晕会变成 4 倍。
      rh.scale.setScalar(this.radius * (1.3 + this.rarity.glow * 0.7));
    } else {
      rh.visible = false;
    }
    this.state = FISH_STATE.SWIM;
    this.setSimple(false);
    this.capped = false;
    this.hitFlash = 0;
    this.immuneT = 0;
    this.knockT = 0;
    // 血量取自鱼种定义（图鉴要如实显示），没有定义才退回体型推算
    this.hp = Number.isFinite(d.hp) ? d.hp : calcHp(this.radius);
    this.maxHp = this.hp;
    // ⚠ 逐条随机大小要乘 MODEL_SCALE：下面 5 处 `mesh.scale.setScalar(this.scale)`
    //   （reset / launch / 游动 / 空中中弹 / 空中常规）全都读这一个字段，
    //   在这里乘一次，等于整条鱼（身体 + 鳍 + 光晕 + 徽章，全是 child）一起放大。
    //   如果改成在那 5 处分别乘，漏一处就是"某条鱼突然变小"的隐形 bug。
    this.scale = (0.9 + Math.random() * 0.22) * MODEL_SCALE;
    this.mesh.scale.setScalar(this.scale);
    this.mesh.visible = true;
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.position.set(x, y, 0);
    return this;
  }

  /** 简化模型：只保留身体 + 尾巴 */
  setSimple(v) {
    const d = this.mesh.userData.detail;
    if (!d) return;
    for (let i = 0; i < d.length; i++) d[i].visible = !v;
  }

  hook() { this.state = FISH_STATE.CAUGHT; this.setSimple(true); }

  release(x, y) {
    this.state = FISH_STATE.SWIM;
    this.setSimple(false);
    this.capped = false;
    this.x = x; this.y = y;
    this.hitFlash = 0.35;
  }

  /**
   * 起飞。初速和水平速度都由 game.js 按价值算好后传进来：
   * 越贵的鱼 → 初速越大 → 飞得越高、滞空越久。
   *
   * 自旋（需求⑤）：三轴一起给初速 —— 侧视正交相机下最显眼的是绕 Z 轴的"打滚"，
   * 所以 Z 是主轴、给得最猛；X / Y 是辅轴，让鱼看起来是**翻滚**而不是平面转圈。
   * 基准转速从原来的 ±4.5 rad/s 提到 ±7~16 rad/s（约 1.1~2.5 圈/秒），
   * 鱼一离水就明显在转，而不是像被吊着。
   */
  launch(vx, vy, originX, originY) {
    this.state = FISH_STATE.AIR;
    this.setSimple(false);
    this.capped = false;
    this.vx = Number.isFinite(vx) ? vx : 0;
    this.vy = Number.isFinite(vy) ? vy : 100;
    this.spin = (Math.random() < 0.5 ? -1 : 1) * (7 + Math.random() * 9);
    this.spinX = (Math.random() - 0.5) * 7;
    this.spinY = (Math.random() - 0.5) * 9;
    this.hitFlash = 0;
    this.hp = this.maxHp;
    this.knockT = 0;      // 抛向天空时清掉上顶冷却，第一枪立刻就能把它顶起来
    this.airX = Number.isFinite(originX) ? originX : this.mesh.position.x;
    this.airY = Number.isFinite(originY) ? originY : WORLD.surfaceY + 4 * MODEL_SCALE;
    this.mesh.position.set(this.airX, this.airY, 2);
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.scale.setScalar(this.scale);
  }

  /** 受到爆炸伤害，返回剩余血量 */
  damage(d) {
    this.hp -= Number.isFinite(d) ? d : 0;
    this.hitFlash = 0.3;
    return this.hp;
  }

  /**
   * 中弹但没死：把鱼再往天上顶一段（需求④）。
   * 血厚的鱼会一枪一枪被越打越高，直到血条见底或者飞出画面。
   *
   * 同时**追加旋转冲击**（需求⑤）：被枪打中的鱼要明显转得更凶。
   * 转速沿当前方向叠加而不是重新随机 —— 否则每一枪都像被按了"反向键"，
   * 观感是抽搐而不是被炸飞。
   */
  knockUp(vyBoost, vxBoost) {
    this.vy = Math.max(this.vy, 0) + (Number.isFinite(vyBoost) ? vyBoost : 0);
    this.vx += Number.isFinite(vxBoost) ? vxBoost : 0;
    const sgn = this.spin >= 0 ? 1 : -1;
    this.spin += sgn * (5 + Math.random() * 9);
    this.spinX += (Math.random() - 0.5) * 6;
    this.spinY += (Math.random() - 0.5) * 8;
    this.hitFlash = 0.32;
  }

  /** 扣钱鱼的脉冲光晕 + ⚠ 徽章朝向，每帧同步一次 */
  _syncExtras(t) {
    const ud = this.mesh.userData;
    if (ud.badgePivot) ud.badgePivot.rotation.y = -this.mesh.rotation.y;
    if (ud.warnHalo) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 5.2);
      ud.warnHalo.material.opacity = 0.26 + 0.24 * pulse;
      const k = 0.93 + 0.14 * pulse;
      ud.warnHalo.scale.set(ud.warnBase.x * k, ud.warnBase.y * k, 1);
    }
  }

  kill() { this.state = FISH_STATE.DEAD; this.mesh.visible = false; }

  /** 挂在鱼线上的展示位 */
  placeOnLine(x, y) {
    this.mesh.position.set(x, y, 0.6);
    // v0.3.5：每条的朝向 / 倾角都不一样 —— 挤成一团时才像「一捆鱼」而不是一队标兵。
    // ⚠ 角度是 _catch() 时抽一次存下来的（lineSpin / lineFlip），不是这里现抽：
    //   placeOnLine 每帧都被调（下潜 / 刹停 / 上升 / 空中都在调），
    //   现抽的话每条鱼每帧都在转，看起来像抽搐。
    const sp = Number.isFinite(this.lineSpin) ? this.lineSpin : 0;
    const fl = Number.isFinite(this.lineFlip) ? this.lineFlip : 0;
    this.mesh.rotation.set(0, Math.PI + fl, 0.35 + sp);
  }

  update(dt, t, viewRange) {
    if (this.state === FISH_STATE.DEAD) return;

    if (this.state === FISH_STATE.CAUGHT) {
      const b = this.mesh.position;
      this.mesh.rotation.z = 0.35 + Math.sin(t * 3 + b.y * 0.2) * 0.18;
      this.mesh.visible = !this.capped && b.y < viewRange.top + 25 * MODEL_SCALE && b.y > viewRange.bottom - 25 * MODEL_SCALE;
      return;
    }

    if (this.state === FISH_STATE.SWIM) {
      this.x += this.dir * this.speed * dt;
      const hw = WORLD.fishHalfWidth + this.radius;
      if (this.x > hw) { this.x = -hw; }
      else if (this.x < -hw) { this.x = hw; }

      const yy = this.y + Math.sin(t * this.bobFreq + this.phase) * this.bobAmp;
      this.mesh.position.set(this.x, yy, Math.sin(t * 0.6 + this.phase) * 3.0 * MODEL_SCALE);

      // 偏航摆动：正交视角下也能看出立体体积
      const base = this.dir > 0 ? 0 : Math.PI;
      const sgn = this.dir > 0 ? 1 : -1;
      // ⚠ 0.11 / 0.28 是「速度 → 摆尾频率」的换算系数，v0.2 里要**除以 MODEL_SCALE**：
      //   鱼速已经在 SPECIES 里 ×2 了，不折半的话摆尾会快一倍（鱼看起来像在发抖）。
      //   物理直觉：体型和速度同时 ×2 → "每秒游过几个身位"不变 → 摆尾频率也不该变。
      this.mesh.rotation.y = base + sgn * Math.sin(t * this.speed * 0.11 / MODEL_SCALE + this.phase) * 0.52;
      this.mesh.rotation.z = Math.sin(t * this.bobFreq * 1.25 + this.phase) * 0.12;

      const tp = this.mesh.userData.tailPivot;
      if (tp) tp.rotation.y = Math.sin(t * (4 + this.speed * 0.28 / MODEL_SCALE) + this.phase) * 0.5;

      this.mesh.scale.setScalar(this.scale * (this.hitFlash > 0 ? 1 + this.hitFlash * 0.9 : 1));
      if (this.hitFlash > 0) this.hitFlash -= dt;
      this._syncExtras(t);

    } else if (this.state === FISH_STATE.AIR) {
      this.vy += TUNING.airGravity * dt;
      this.airX += this.vx * dt;
      this.airY += this.vy * dt;
      this.mesh.position.set(this.airX, this.airY, 2);
      // 三轴翻滚：Z 是主轴（画面内的打滚），X / Y 让"转起来"有立体感
      this.mesh.rotation.z += this.spin * dt;
      this.mesh.rotation.x += this.spinX * dt;
      this.mesh.rotation.y += this.spinY * dt;

      // 被打中但没死：鼓一下，给玩家"再补一炮"的信号
      if (this.hitFlash > 0) {
        this.hitFlash -= dt;
        this.mesh.scale.setScalar(this.scale * (1 + Math.max(0, this.hitFlash) * 1.6));
      } else {
        this.mesh.scale.setScalar(this.scale);
      }
      this._syncExtras(t);
    }

    const p = this.mesh.position;
    const pad = (this.state === FISH_STATE.AIR ? 90 : 25) * MODEL_SCALE;
    this.mesh.visible = p.y < viewRange.top + pad && p.y > viewRange.bottom - pad;
  }
}

// ─────────────────────────────────────────────────────────────
// 鱼类对象池
// ─────────────────────────────────────────────────────────────
export class FishManager {
  constructor(scene) {
    this.scene = scene;
    this.pool = new Map();
    this.active = [];
  }

  acquire(def) {
    let list = this.pool.get(def.id);
    if (!list) { list = []; this.pool.set(def.id, list); }
    let f = list.find((x) => !x.inUse);
    if (!f) { f = new Fish(def); list.push(f); }
    f.inUse = true;
    this.scene.add(f.mesh);
    this.active.push(f);
    return f;
  }

  releaseAll() {
    for (const f of this.active) {
      f.inUse = false;
      f.state = FISH_STATE.DEAD;
      f.mesh.visible = false;
      this.scene.remove(f.mesh);
    }
    this.active.length = 0;
  }
}
