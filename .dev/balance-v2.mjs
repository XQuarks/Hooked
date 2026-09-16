/**
 * balance-v2.mjs — 扩充方案（EXPANSION.md）的经济模型验算
 *
 * 目的：不是"跑游戏"，而是**把设计稿里的数值表代进模型，看养成节奏对不对**。
 *       模型里没有任何 Three.js / DOM，只有金币和等级，所以可以秒级扫参数。
 *
 * 判断标准（按重要性排序）：
 *   1. 【最重要】每升 10 级需要几竿？—— 总体必须**单调缓升**，不能递减。
 *      现有版本是递减的：11.1 → 5.5 → 3.6 → 3.1，越玩越快，27 分钟吃完所有内容。
 *   2. 主线总时长落在 6~10 小时（约 300~500 竿）。
 *   3. 金币出口结构合理：许可证（大额门槛）+ 升级（持续投入）都要占得住。
 *
 * 用法：node .dev/balance-v2.mjs [GROWTH] [BASE_MUL]
 *   例：node .dev/balance-v2.mjs 1.34 3.0     ← 最终选定方案
 */

// ═══════════════════════════════════════════════════════════
// 可调参数（命令行覆盖，方便扫参数）
// ═══════════════════════════════════════════════════════════
const GROWTH = Number(process.argv[2] || 1.47);   // 每级成本倍率（现值 1.85，但只有 5 级）
const BASE_MUL = Number(process.argv[3] || 1.0);  // 全部 base 的整体缩放（分层交给 base 本身）
const LIC_MUL = Number(process.argv[4] || 10);    // 许可证 = LIC_MUL × 当前地图满深度收入

// ── 结构参数（最终方案固定） ──
const SEG = [5, 4, 4, 4, 3];   // 每张地图开放的等级段（累计 5/9/13/17/20）
const SAVE_AT = 0.6;           // 攒到许可证的 60% 就停止消费，转为储蓄
const MAX_LV = SEG.reduce((a, b) => a + b, 0);   // 20

// ── 行为参数 ──
const DENS = 0.18;              // FISH_DENSITY，沿用现值
const CAPTURE_RATE = 0.45;      // 上升阶段扫过的鱼里，被串上的比例
const COMBO_MULT = 1.6;         // 全程平均连击倍率（实测区间 1.3~1.9）
const CAST_SECONDS = 70;        // 一竿（含商店操作）平均耗时

/**
 * 5 张地图。鱼身价梯度 ≈ ×2.8，深度上限 ≈ ×1.45。
 * 两个梯度刻意不同：深度涨得慢、身价涨得快 —— "潜得更深"始终有强正反馈。
 * license 留空，由「上一张图的满深度收入 × LIC_MUL」自动算出。
 */
const MAPS = [
  {
    id: 'calm-bay', name: '宁静海湾', maxDepth: 430,
    zones: [
      { n: 14, lo: 0, hi: 55, fish: [[6, 30], [11, 20], [15, 17], [9, 11]] },
      { n: 20, lo: 55, hi: 120, fish: [[32, 9], [24, 19], [28, 14], [42, 9], [55, 10]] },
      { n: 20, lo: 120, hi: 195, fish: [[66, 18], [82, 12], [100, 8], [130, 8]] },
      { n: 18, lo: 195, hi: 275, fish: [[160, 11], [190, 6], [200, 8], [260, 5], [340, 4]] },
      { n: 20, lo: 275, hi: 430, fish: [[420, 5], [680, 1.6]] },
    ],
  },
  {
    id: 'polar', name: '冰封极地', maxDepth: 620,
    zones: [
      { n: 16, lo: 0, hi: 70, fish: [[17, 26], [26, 20], [38, 16], [22, 14]] },
      { n: 20, lo: 70, hi: 170, fish: [[62, 12], [78, 16], [95, 14], [140, 8]] },
      { n: 20, lo: 170, hi: 300, fish: [[190, 14], [240, 12], [310, 10], [420, 6]] },
      { n: 18, lo: 300, hi: 460, fish: [[560, 12], [700, 8], [880, 6], [1150, 4]] },
      { n: 20, lo: 460, hi: 620, fish: [[1450, 6], [1900, 2.2]] },
    ],
  },
  {
    id: 'lava', name: '熔岩海沟', maxDepth: 780,
    zones: [
      { n: 16, lo: 0, hi: 80, fish: [[47, 26], [72, 20], [105, 16], [61, 14]] },
      { n: 20, lo: 80, hi: 200, fish: [[172, 12], [218, 16], [266, 14], [390, 8]] },
      { n: 20, lo: 200, hi: 360, fish: [[530, 14], [670, 12], [870, 10], [1180, 6]] },
      { n: 18, lo: 360, hi: 560, fish: [[1570, 12], [1960, 8], [2460, 6], [3220, 4]] },
      { n: 22, lo: 560, hi: 780, fish: [[4060, 6], [5320, 2.2]] },
    ],
  },
  {
    id: 'wreck', name: '废弃沉船', maxDepth: 900,
    zones: [
      { n: 16, lo: 0, hi: 90, fish: [[132, 26], [202, 20], [294, 16], [171, 14]] },
      { n: 20, lo: 90, hi: 230, fish: [[482, 12], [610, 16], [745, 14], [1092, 8]] },
      { n: 20, lo: 230, hi: 420, fish: [[1484, 14], [1876, 12], [2436, 10], [3304, 6]] },
      { n: 18, lo: 420, hi: 650, fish: [[4396, 12], [5488, 8], [6888, 6], [9016, 4]] },
      { n: 22, lo: 650, hi: 900, fish: [[11368, 6], [14896, 2.2]] },
    ],
  },
  {
    id: 'song', name: '深海之声', maxDepth: 1100,
    zones: [
      { n: 16, lo: 0, hi: 100, fish: [[370, 26], [566, 20], [823, 16], [479, 14]] },
      { n: 20, lo: 100, hi: 260, fish: [[1350, 12], [1708, 16], [2086, 14], [3058, 8]] },
      { n: 20, lo: 260, hi: 470, fish: [[4155, 14], [5253, 12], [6821, 10], [9252, 6]] },
      { n: 18, lo: 470, hi: 730, fish: [[12309, 12], [15368, 8], [19290, 6], [25248, 4]] },
      { n: 22, lo: 730, hi: 1100, fish: [[31831, 6], [41716, 2.2]] },
    ],
  },
];

// ═══════════════════════════════════════════════════════════
// 升级表：11 项 × 20 级，单一连续成本曲线（不按地图硬分段）
// ═══════════════════════════════════════════════════════════
const UPGRADES = [
  { key: 'line', base: 150, tier: '基础' },       // 最大下潜深度
  { key: 'hook', base: 120, tier: '基础' },       // 捕获判定半径
  { key: 'sinker', base: 100, tier: '基础' },     // 下潜速度
  { key: 'power', base: 100, tier: '基础' },      // 爆炸伤害 / 半径
  { key: 'lamp', base: 180, tier: '基础' },       // 深海照亮半径
  { key: 'winch', base: 400, tier: '新轴' },      // 绞盘：上升速度
  { key: 'creel', base: 340, tier: '新轴' },      // 鱼护：串鱼上限
  { key: 'insurance', base: 520, tier: '新轴' },  // 保险：扣钱减免
  { key: 'sonar', base: 600, tier: '进阶' },      // 声呐：显示鱼的位置
  { key: 'bait', base: 450, tier: '进阶' },       // 鱼饵：提高稀有鱼出现率
  { key: 'rig', base: 700, tier: '进阶' },        // 加固：降低下潜撞鱼判定
];

const cost = (u, lv) => Math.round(u.base * BASE_MUL * Math.pow(GROWTH, lv));

// ═══════════════════════════════════════════════════════════
// 收入模型
// ═══════════════════════════════════════════════════════════

/**
 * 鱼线等级 → 最大下潜深度。
 * 锚点 = 每张地图的深度上限，等级按 SEG 累计；锚点之间线性插值。
 *   Lv0=80 → Lv5=430 → Lv9=620 → Lv13=780 → Lv17=900 → Lv20=1100
 */
const DEPTH_ANCHOR = (() => {
  const a = [[0, 80]];
  let lv = 0;
  MAPS.forEach((m, i) => { lv += SEG[i]; a.push([lv, m.maxDepth]); });
  return a;
})();

function maxDepthAtLevel(lv) {
  const A = DEPTH_ANCHOR;
  if (lv <= A[0][0]) return A[0][1];
  for (let i = 0; i < A.length - 1; i++) {
    if (lv <= A[i + 1][0]) {
      const [l0, d0] = A[i], [l1, d1] = A[i + 1];
      return Math.round(d0 + (d1 - d0) * (lv - l0) / (l1 - l0));
    }
  }
  return A[A.length - 1][1];
}

/** 一竿收入：按能潜到的深度，对每层海域做「到达比例」加权 */
function incomePerCast(map, maxDepth) {
  let sum = 0;
  for (const z of map.zones) {
    const span = z.hi - z.lo;
    const reach = Math.max(0, Math.min(maxDepth, z.hi) - z.lo);
    if (reach <= 0) continue;
    const n = Math.max(1, Math.round(z.n * DENS)) * (reach / span);
    const w = z.fish.reduce((s, f) => s + f[1], 0);
    const avg = z.fish.reduce((s, f) => s + f[0] * f[1], 0) / w;
    sum += n * avg * CAPTURE_RATE;
  }
  return sum * COMBO_MULT;
}

// ── 许可证：由「上一张图的满深度收入」定标 ──
for (let i = 0; i < MAPS.length; i++) {
  MAPS[i].license = i === 0 ? 0
    : Math.round(incomePerCast(MAPS[i - 1], MAPS[i - 1].maxDepth) * LIC_MUL);
}

// ═══════════════════════════════════════════════════════════
// 模拟：逐竿推进
//   策略：lineFirst（可买项里有鱼线就优先买，否则买最便宜的）
//         两阶段（未接近许可证 → 自由升级；接近后 → 停止消费转储蓄）
//   换图：潜到过本图上限深度 + 攒够下一张图的许可证
// ═══════════════════════════════════════════════════════════
function simulate() {
  const lv = Object.fromEntries(UPGRADES.map((u) => [u.key, 0]));
  let coins = 0;
  let casts = 0;
  const log = [];
  const lvTimeline = [];   // { cast, totalLv } 用来算"每级竿数"的曲线

  for (let mi = 0; mi < MAPS.length; mi++) {
    const map = MAPS[mi];
    const cap = SEG.slice(0, mi + 1).reduce((a, b) => a + b, 0);   // 本图等级上限
    const castStart = casts;
    let spentOnUpgrades = 0;
    let reachedMax = false;
    let guard = 0;

    while (guard++ < 500000) {
      const depth = Math.min(maxDepthAtLevel(lv.line), map.maxDepth);
      if (depth >= map.maxDepth) reachedMax = true;

      coins += incomePerCast(map, depth);
      casts += 1;

      const next = MAPS[mi + 1];
      const lic = next ? next.license : 0;
      const saving = lic > 0 && coins >= lic * SAVE_AT;

      if (!saving) {
        // 反复买：可买项里若有鱼线就优先买，否则买最便宜的
        let bought = true;
        while (bought) {
          bought = false;
          const aff = [];
          for (const u of UPGRADES) {
            if (lv[u.key] >= cap) continue;
            const c = cost(u, lv[u.key]);
            if (c <= coins) aff.push({ u, c });
          }
          if (aff.length) {
            aff.sort((a, b) => (a.u.key === 'line' ? -1 : b.u.key === 'line' ? 1 : a.c - b.c));
            coins -= aff[0].c;
            spentOnUpgrades += aff[0].c;
            lv[aff[0].u.key] += 1;
            bought = true;
          }
        }
      }

      lvTimeline.push({ cast: casts, totalLv: UPGRADES.reduce((s, u) => s + lv[u.key], 0) });

      if (reachedMax && next && coins >= lic) { coins -= lic; break; }
      if (!next && UPGRADES.every((u) => lv[u.key] >= cap)) break;
    }

    log.push({
      map: map.name,
      casts: casts - castStart,
      license: mi + 1 < MAPS.length ? MAPS[mi + 1].license : 0,
      spent: spentOnUpgrades,
      incomeStart: Math.round(incomePerCast(map, Math.min(maxDepthAtLevel(0), map.maxDepth))),
      incomeEnd: Math.round(incomePerCast(map, Math.min(maxDepthAtLevel(lv.line), map.maxDepth))),
      lineLv: lv.line,
      cap,
    });
  }
  return { log, casts, lv, lvTimeline };
}

// ═══════════════════════════════════════════════════════════
// 输出
// ═══════════════════════════════════════════════════════════
const { log, casts, lv, lvTimeline } = simulate();
const pad = (s, n, right) => (right ? String(s).padStart(n) : String(s).padEnd(n));
const num = (n) => n.toLocaleString();

console.log('══════ 扩充方案 · 经济模型验算 ══════\n');
console.log(`GROWTH = ${GROWTH} · BASE_MUL = ${BASE_MUL} · 许可证 = ${LIC_MUL}×本图满深度收入`);
console.log(`等级段 SEG = [${SEG}] · 每项 ${MAX_LV} 级 · ${UPGRADES.length} 项升级 · 合计 ${MAX_LV * UPGRADES.length} 级\n`);

console.log(pad('地图', 12) + pad('竿数', 6, 1) + pad('许可证', 12, 1) +
  pad('本图升级支出', 14, 1) + pad('进图一竿', 11, 1) + pad('毕业一竿', 11, 1) + pad('鱼线', 7, 1));
console.log('─'.repeat(74));
let totalLicense = 0, totalSpent = 0;
for (const r of log) {
  totalLicense += r.license;
  totalSpent += r.spent;
  console.log(pad(r.map, 12) + pad(r.casts, 6, 1) + pad(num(r.license), 12, 1) +
    pad(num(r.spent), 14, 1) + pad(num(r.incomeStart), 11, 1) +
    pad(num(r.incomeEnd), 11, 1) + pad('Lv' + r.lineLv, 7, 1));
}
console.log('─'.repeat(74));
console.log(pad('合计', 12) + pad(casts, 6, 1) + pad(num(totalLicense), 12, 1) + pad(num(totalSpent), 14, 1));

// ── 核心健康度指标：每 10 级升级要几竿 ──
console.log('\n══ 健康度核心指标：每升 10 级需要几竿（应单调缓升，不能递减）══\n');
console.log(pad('升级等级区间', 16) + pad('竿数', 8, 1) + pad('平均每级竿数', 14, 1) + '  曲线');
console.log('─'.repeat(78));
const totalLvMax = MAX_LV * UPGRADES.length;   // 220
const buckets = [];
for (let b = 0; b < totalLvMax; b += 10) {
  const lo = b, hi = Math.min(b + 10, totalLvMax);
  const a = lvTimeline.find((x) => x.totalLv >= lo);
  const z = lvTimeline.find((x) => x.totalLv >= hi);
  if (!a) continue;
  const castsFor = (z ? z.cast : casts) - a.cast;
  const perLv = castsFor / (hi - lo);
  buckets.push({ lo, hi, castsFor, perLv });
  console.log(pad(`Lv${lo} → Lv${hi}`, 16) + pad(castsFor, 8, 1) +
    pad(perLv.toFixed(2), 14, 1) + '  ' + '█'.repeat(Math.min(46, Math.round(perLv * 4))));
}

// ── 趋势判定：排除教学段（第一个桶）后，前后各取 5 桶比均值 ──
// 教学段（Lv0→10）天然最慢（只能潜 80m、一竿 58 金币），把它算进"首段"会得出假的递减结论。
const body = buckets.slice(1);
const headAvg = body.slice(0, 5).reduce((s, b) => s + b.perLv, 0) / 5;
const tailAvg = body.slice(-5).reduce((s, b) => s + b.perLv, 0) / 5;
console.log(`\n教学段 ${buckets[0].perLv.toFixed(2)} 竿/级（天然最慢，应该的）`);
console.log(`正片前段 ${headAvg.toFixed(2)} → 正片末段 ${tailAvg.toFixed(2)} 竿/级  ` +
  `（${tailAvg > headAvg ? '✅ 递增' : '❌ 递减'}，倍率 ${(tailAvg / headAvg).toFixed(2)}×）`);

// ── 每图竿/级：直接看"这张图整体比上一张图更肝吗" ──
// 注意分母是**总等级**（每项升级都算），不是鱼线等级。
console.log('\n── 每张地图的竿/级（应逐图抬高，锯齿是设计，包络要向上）──');
console.log(pad('地图', 12) + pad('竿数', 6, 1) + pad('开放', 8, 1) + pad('总等级', 8, 1) + pad('竿/级', 8, 1));
let prevCap = 0, prevPerLv = 0;
for (let i = 0; i < log.length; i++) {
  const r = log[i];
  const lvGain = (r.cap - prevCap) * UPGRADES.length;
  const perLv = r.casts / lvGain;
  const mark = i === 0 ? '' : (perLv >= prevPerLv ? ' ↑' : ' ↓');
  console.log(pad(r.map, 12) + pad(r.casts, 6, 1) + pad(`Lv${r.cap}`, 8, 1) +
    pad(lvGain, 8, 1) + pad(perLv.toFixed(2), 8, 1) + mark);
  prevCap = r.cap; prevPerLv = perLv;
}
console.log(`\n主线总时长 ≈ ${casts} 竿 ≈ ${(casts * CAST_SECONDS / 3600).toFixed(1)} 小时（按一竿 ${CAST_SECONDS}s）`);

// ── 金币出口结构 ──
const totalCoin = totalLicense + totalSpent;
console.log(`\n金币出口：许可证 ${num(totalLicense)}（${(totalLicense / totalCoin * 100).toFixed(0)}%）` +
  ` + 升级 ${num(totalSpent)}（${(totalSpent / totalCoin * 100).toFixed(0)}%）` +
  ` = ${num(totalCoin)}`);

// ── 最终等级分布 ──
console.log('\n══ 通关时的升级等级 ══\n');
for (const u of UPGRADES) {
  console.log(`  ${pad(u.key, 11)} ${pad(u.tier, 5)} Lv${pad(lv[u.key], 3, 1)}  ` + '█'.repeat(lv[u.key]));
}
