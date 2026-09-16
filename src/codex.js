/**
 * codex.js — 鱼类图鉴
 *
 * 两件事：
 *   1. 图鉴排序：**两级结构 —— 先按地图，再按海域深度**（宁静海湾：表层 → 中层 → 深层 →
 *      深渊 → 海沟），同一层内按身价升序 —— 这样列表本身就是一张"往下走会越来越贵"的地图。
 *      地图这一级是为"以后会扩展新地图"预留的：新地图只要进 MAPS，图鉴会自动多出一组。
 *   2. 鱼图标：canvas 2D 程序化画一条侧视鱼。
 *      为什么不用 3D 缩略图？因为需求里有一条「未钓上的鱼显示为黑色且不透露详细信息」，
 *      2D 里把调色板整体换成黑色就是最干净的剪影，不用碰材质。
 *
 * 图标画法刻意和 3D 模型保持同一套特征参数（body / tail / fin / stripe / spots /
 * spikes / bill / crest / crown / legs / wings / hammer / lure / bignose / fangs /
 * fanTail / fanFin / belly），所以图鉴里认得出的鱼，海里也认得出。
 */
import { SPECIES, ZONES, MAPS, mapOfSpecies } from './config.js';

const TAU = Math.PI * 2;
const hex = (n) => '#' + ((n >>> 0) & 0xffffff).toString(16).padStart(6, '0');

const mapIndex = (id) => {
  const i = MAPS.findIndex((m) => m.id === id);
  return i < 0 ? 99 : i;
};

/** 图鉴顺序：先按地图顺序，再按海域深度，最后按身价 */
export function codexOrder() {
  const zi = new Map(ZONES.map((z, i) => [z.id, i]));
  return SPECIES.slice().sort((a, b) => {
    const ma = mapIndex(mapOfSpecies(a).id);
    const mb = mapIndex(mapOfSpecies(b).id);
    if (ma !== mb) return ma - mb;
    const za = zi.get(a.zones[0]) ?? 99;
    const zb = zi.get(b.zones[0]) ?? 99;
    if (za !== zb) return za - zb;
    if (a.value !== b.value) return a.value - b.value;
    return a.id < b.id ? -1 : 1;
  });
}

/** 鱼的主海域（zones 里的第一个 = 最浅的那层） */
export function primaryZone(def) {
  return ZONES.find((z) => z.id === def.zones[0]) || ZONES[0];
}

/** 鱼属于哪张地图 */
export function mapLabel(def) {
  const m = mapOfSpecies(def);
  return m.name;
}

/**
 * 图鉴里显示的「所在海域」文案，跨区鱼会带上第二层。
 * 用 `nick`（阳光浅滩 / 宁静海湾…）而不是功能名（表层海域 / 深层海域），
 * 跟主界面大标题保持同一套称呼，玩家不用记两套名字。
 */
export function zoneLabel(def) {
  const names = def.zones.map((id) => {
    const z = ZONES.find((x) => x.id === id);
    return z ? (z.nick || z.name + '海域') : null;
  }).filter(Boolean);
  return names.join(' / ');
}

/**
 * 把鱼按「地图 → 海域」两级分组。
 * 返回**所有**地图（含还没拿到许可证的那些），这样界面能把未开放的地图渲染成
 * "敬请期待"，玩家一眼知道"这片海之外还有别的地方" —— 这是多地图结构唯一的广告位。
 *
 * @param {Array} list codexOrder() 的结果
 * @param {(map:object)=>boolean} [ownedOf] 这张图玩家是否已经能进。
 *   不给就全部算已拥有（纯数据测试用）。真实调用点必须传 ——
 *   否则冰封极地会提前把全部 22 条鱼的剪影摊开，"没解锁"这件事就白做了。
 */
export function groupByMap(list, ownedOf = null) {
  return MAPS.map((map) => {
    const mine = list.filter((def) => mapOfSpecies(def).id === map.id);
    const zones = [];
    for (const def of mine) {
      const z = primaryZone(def);
      let g = zones.find((x) => x.zone.id === z.id);
      if (!g) { g = { zone: z, list: [] }; zones.push(g); }
      g.list.push(def);
    }
    const owned = ownedOf ? ownedOf(map) : true;
    return { map, zones, count: mine.length, locked: map.unlocked === false || !owned };
  }).filter((g) => g.count > 0 || g.locked);
}


// ─────────────────────────────────────────────────────────────
// 图标绘制
// ─────────────────────────────────────────────────────────────

/** 扇形（狮子鱼的毒鳍、蝴蝶鱼的扇尾都用它） */
function pie(ctx, x, y, r, a0, a1, fill) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, r, a0, a1);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * 在 ctx 上画一条鱼，铺满 w×h 的方框。
 * @param {boolean} known 未钓上时传 false —— 整条鱼画成黑色剪影
 */
export function drawFishIcon(ctx, def, w, h, known) {
  const [L, H] = def.body;
  const s = Math.min(w / (L * 3.05), h / (H * 3.75));
  const cx = w * 0.53, cy = h * 0.5;
  const bl = L * s, bh = H * s;
  const P = (v) => (known ? hex(v) : '#070b11');   // 调色板：未知即全黑

  ctx.clearRect(0, 0, w, h);

  // ── 背后光晕（深海发光鱼 + 扣钱鱼） ──
  // 半径刻意压到贴着身体：铺满画布的话，扣钱鱼的红色会把鱼本身的颜色全吃掉。
  // 扣钱鱼比发光鱼更收敛 —— 它的"显眼"靠列表里的红框 + ⚠ 徽章，不靠糊一层红。
  const haloCol = def.hazard ? '#ff2a2a' : (def.glow ? hex(def.glow[1]) : null);
  if (known && haloCol) {
    const hr = Math.max(bl, bh) * (def.hazard ? 1.45 : 1.85);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, hr);
    g.addColorStop(0, haloCol + (def.hazard ? '4e' : '78'));
    g.addColorStop(0.55, haloCol + (def.hazard ? '1e' : '2c'));
    g.addColorStop(1, haloCol + '00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  const bodyPath = () => {
    ctx.beginPath();
    ctx.ellipse(cx, cy, bl, bh, 0, 0, TAU);
  };

  // ── 尾鳍 ──
  const tx = cx - bl * 0.96;
  const tl = def.tail[0] * s, th = def.tail[1] * s;
  ctx.beginPath();
  if (def.fanTail) {
    ctx.moveTo(tx, cy);
    ctx.quadraticCurveTo(tx - tl * 0.55, cy - th * 1.15, tx - tl * 1.3, cy - th * 0.85);
    ctx.quadraticCurveTo(tx - tl * 1.6, cy, tx - tl * 1.3, cy + th * 0.85);
    ctx.quadraticCurveTo(tx - tl * 0.55, cy + th * 1.15, tx, cy);
  } else {
    ctx.moveTo(tx, cy);
    ctx.lineTo(tx - tl, cy - th);
    ctx.lineTo(tx - tl * 0.55, cy);
    ctx.lineTo(tx - tl, cy + th);
  }
  ctx.closePath();
  ctx.fillStyle = P(def.color);
  ctx.fill();

  // ── 背鳍 / 胸鳍（狮子鱼换成扇面） ──
  if (def.fanFin) {
    const k = def.fanFin;
    pie(ctx, cx + bl * 0.05, cy - bh * 0.42, H * 0.62 * s * k, -Math.PI * 0.96, -Math.PI * 0.16, P(def.color));
    pie(ctx, cx - bl * 0.12, cy + bh * 0.3, H * 0.5 * s * k, Math.PI * 0.14, Math.PI * 0.86, P(def.color));
  } else if (def.fin) {
    const fh = def.fin[1] * s;
    ctx.beginPath();
    ctx.moveTo(cx + bl * 0.42, cy - bh * 0.72);
    ctx.lineTo(cx - bl * 0.1, cy - bh - fh);
    ctx.lineTo(cx - bl * 0.92, cy - bh * 0.66);
    ctx.closePath();
    ctx.fillStyle = P(def.color);
    ctx.fill();
    // 胸鳍
    ctx.beginPath();
    ctx.moveTo(cx + bl * 0.22, cy + bh * 0.18);
    ctx.lineTo(cx - bl * 0.35, cy + bh * 0.2 + fh * 0.9);
    ctx.lineTo(cx - bl * 0.3, cy + bh * 0.1);
    ctx.closePath();
    ctx.fill();
  }

  // ── 蝠鲼双翼 ──
  if (def.wings) {
    const wl = def.wings * s;
    for (const dir of [-1, 1]) {
      ctx.save();
      ctx.translate(cx + bl * 0.1, cy);
      ctx.rotate(dir * 0.42);
      ctx.beginPath();
      ctx.ellipse(-bl * 0.55, 0, wl * 0.72, bh * 0.5, 0, 0, TAU);
      ctx.fillStyle = P(def.color);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── 皇带鱼背冠 ──
  if (def.crest) {
    const cc = def.crestColor ?? def.color;
    ctx.beginPath();
    ctx.moveTo(cx + bl * 0.8, cy - bh * 0.7);
    ctx.quadraticCurveTo(cx + bl * 0.45, cy - bh * 2.4, cx - bl * 0.15, cy - bh * 1.15);
    ctx.closePath();
    ctx.fillStyle = P(cc);
    ctx.fill();
  }

  // ── 黄金鱼王王冠 ──
  if (def.crown) {
    ctx.fillStyle = P(0xffe066);
    for (const i of [-1, 0, 1]) {
      const bx = cx + bl * 0.3 + i * bh * 0.36;
      ctx.beginPath();
      ctx.moveTo(bx - bh * 0.16, cy - bh * 0.9);
      ctx.lineTo(bx, cy - bh * 1.7);
      ctx.lineTo(bx + bh * 0.16, cy - bh * 0.9);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ── 鮟鱇鱼发光诱饵 ──
  if (def.lure) {
    ctx.strokeStyle = P(0x2a1a22);
    ctx.lineWidth = Math.max(1, bh * 0.11);
    ctx.beginPath();
    ctx.moveTo(cx + bl * 0.3, cy - bh * 0.85);
    ctx.quadraticCurveTo(cx + bl * 0.55, cy - bh * 2.1, cx + bl * 1.0, cy - bh * 1.95);
    ctx.stroke();
    const bx = cx + bl * 1.0, by = cy - bh * 1.95, br = bh * 0.3;
    if (known) {
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, br * 5);
      g.addColorStop(0, '#fff3b0cc'); g.addColorStop(1, '#ffd76600');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, br * 5, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = known ? '#ffe89a' : P(0xffe89a);
    ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill();
  }

  // ── 乌贼触手 ──
  if (def.legs) {
    ctx.strokeStyle = P(def.color);
    ctx.lineWidth = Math.max(1.2, bh * 0.2);
    ctx.lineCap = 'round';
    for (let i = 0; i < def.legs; i++) {
      const a = (i - (def.legs - 1) / 2) * 0.42;
      const x0 = cx - bl * 0.75;
      ctx.beginPath();
      ctx.moveTo(x0, cy + a * bh * 0.5);
      ctx.quadraticCurveTo(x0 - L * 0.5 * s, cy + a * bh * 0.9, x0 - L * 0.85 * s, cy + a * bh * 1.5);
      ctx.stroke();
    }
  }

  // ── 身体 ──
  bodyPath();
  ctx.fillStyle = P(def.color);
  ctx.fill();

  // ── 腹部 ──
  if (def.belly) {
    ctx.save();
    bodyPath();
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(cx, cy + bh * 0.68, bl * 0.96, bh * 0.62, 0, 0, TAU);
    ctx.fillStyle = P(def.belly);
    ctx.fill();
    ctx.restore();
  }

  // ── 条纹 ──
  if (def.stripe) {
    const n = Math.max(1, def.stripeN ?? 2);
    ctx.save();
    bodyPath();
    ctx.clip();
    ctx.fillStyle = P(def.stripe);
    for (let i = 0; i < n; i++) {
      const fx = n === 1 ? 0.26 : 0.6 - (i / (n - 1)) * 1.14;
      const bw = bl * (n > 3 ? 0.19 : 0.34);
      ctx.fillRect(cx + bl * fx - bw / 2, cy - bh * 1.2, bw, bh * 2.4);
    }
    ctx.restore();
  }

  // ── 斑点 ──
  if (def.spots) {
    ctx.save();
    bodyPath();
    ctx.clip();
    ctx.fillStyle = P(def.spots);
    const pts = [[0.35, -0.35], [-0.05, -0.5], [-0.45, -0.28], [0.15, 0.3], [-0.3, 0.42], [0.5, 0.05], [-0.62, 0.05]];
    for (const [px, py] of pts) {
      ctx.beginPath();
      ctx.arc(cx + bl * px, cy + bh * py, bh * 0.14, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── 尖刺 ──
  if (def.spikes) {
    const n = def.spikes;
    // 和 3D 保持同一套配色：有自发光用自发光，否则用默认的土黄尖刺色
    ctx.fillStyle = P(def.emissive ?? 0x8a7b52);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const ox = cx + Math.cos(a) * bl, oy = cy + Math.sin(a) * bh;
      const nx = Math.cos(a) * bh * 0.3, ny = Math.sin(a) * bh * 0.3;
      const px = -Math.sin(a) * bh * 0.13, py = Math.cos(a) * bh * 0.13;
      ctx.beginPath();
      ctx.moveTo(ox + px, oy + py);
      ctx.lineTo(ox + nx, oy + ny);
      ctx.lineTo(ox - px, oy - py);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ── 剑鱼长吻 ──
  if (def.bill) {
    const blen = def.bill * s * 0.75;
    ctx.beginPath();
    ctx.moveTo(cx + bl * 0.9, cy - bh * 0.2);
    ctx.lineTo(cx + bl + blen, cy);
    ctx.lineTo(cx + bl * 0.9, cy + bh * 0.2);
    ctx.closePath();
    ctx.fillStyle = P(def.color);
    ctx.fill();
  }

  // ── 大鼻子 ──
  if (def.bignose) {
    ctx.beginPath();
    ctx.ellipse(cx + bl * 0.9, cy - bh * 0.06, bh * 0.42 * def.bignose, bh * 0.4 * def.bignose, 0, 0, TAU);
    ctx.fillStyle = P(def.color);
    ctx.fill();
  }

  // ── 双髻鲨锤头 ──
  if (def.hammer) {
    ctx.save();
    bodyPath();
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(cx + bl * 0.88, cy, bh * 0.34, bh * 1.15, 0, 0, TAU);
    ctx.fillStyle = P(def.color);
    ctx.fill();
    ctx.restore();
  }

  // ── 獠牙 ──
  if (def.fangs) {
    ctx.fillStyle = P(0xfffdf2);
    for (let i = 0; i < def.fangs; i++) {
      const upper = i % 2 === 0;
      const k = Math.floor(i / 2);
      const fx = cx + bl * (0.86 - k * 0.14);
      const fy = cy + (upper ? -1 : 1) * bh * 0.24;
      ctx.beginPath();
      ctx.moveTo(fx - bh * 0.09, fy);
      ctx.lineTo(fx + bh * 0.09, fy);
      ctx.lineTo(fx, fy + (upper ? 1 : -1) * bh * 0.5);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ── 胡须 ──
  if (def.whisker) {
    ctx.strokeStyle = P(def.belly ?? def.color);
    ctx.lineWidth = Math.max(1, bh * 0.1);
    for (let i = 0; i < def.whisker; i++) {
      const a = (i - (def.whisker - 1) / 2) * 0.45;
      ctx.beginPath();
      ctx.moveTo(cx + bl * 0.88, cy + bh * 0.05);
      ctx.quadraticCurveTo(
        cx + bl * 1.35, cy + bh * (0.1 + a),
        cx + bl * 1.7, cy + bh * (0.35 + a * 1.6)
      );
      ctx.stroke();
    }
  }

  // ── 眼睛 ──
  const er = (def.eye ?? 0.5) * bh * 0.42;
  const ex = cx + bl * 0.6, ey = cy - bh * 0.28;
  ctx.beginPath();
  ctx.arc(ex, ey, er, 0, TAU);
  ctx.fillStyle = known ? '#ffffff' : '#0b1017';
  ctx.fill();
  if (known) {
    ctx.beginPath();
    ctx.arc(ex + er * 0.22, ey, er * 0.52, 0, TAU);
    ctx.fillStyle = '#141920';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex + er * 0.02, ey - er * 0.34, er * 0.19, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fill();
  }

  // ── 剪影描边：未钓上时给一层冷蓝细边，免得纯黑糊成一团看不出形状 ──
  if (!known) {
    bodyPath();
    ctx.strokeStyle = 'rgba(120, 180, 230, 0.28)';
    ctx.lineWidth = Math.max(1, bh * 0.06);
    ctx.stroke();
  }
}
