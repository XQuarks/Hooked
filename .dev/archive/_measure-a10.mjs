/**
 * _measure-a10.mjs — A10「图鉴门槛」的候选口径横评（一次性探针）
 *
 * 背景：GAMEPLAY §6 A10 的推荐方案是「改成每层海域都要有收获」。
 *      但实测它只要 3 竿 —— **比现状（75%，5 竿）还松**。
 *      所以把候选口径都跑一遍，用数据挑一个真的能当门槛的。
 *
 * 做法：每个候选口径跑一次**完整的两图推进**（换图条件换成该口径），
 *      输出每张图的总竿数和"门槛卡在第几竿"，直接和现状对比。
 *
 * 用法：node .dev/archive/_measure-a10.mjs
 */
import {
  MAPS, SPECIES, FISH_DENSITY, HAZARD_SPAWN, SCHOOL, RARITY, GROWTH, UPGRADES, UPGRADE_ORDER,
  MAP_LEVEL_CAP, maxLvOf, lvAt, zonesOfMap, mapMaxDepth,
} from '../../src/config.js';

const REACH_SLACK = 12;
const CAPTURE_RATE = 0.45;
const COMBO_MULT = 1.6;
const RARITY_MUL = RARITY.reduce((a, r) => a + r.p * r.mul, 0);

const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const expectedFishCount = (z) => {
  const n = Math.max(1, Math.round(z.count * FISH_DENSITY));
  const group = Math.round((SCHOOL.count[0] + SCHOOL.count[1]) / 2);
  const extras = Math.max(1, Math.round((SCHOOL.extras[0] + SCHOOL.extras[1]) / 2));
  return (1 - SCHOOL.chance) * n + SCHOOL.chance * (group + extras);
};
const zoneWeights = (z, baitK = 0) => {
  const pool = SPECIES.filter((s) => s.zones.includes(z.id));
  const safe = pool.filter((s) => !s.hazard);
  const vals = safe.map((s) => s.value);
  const minV = vals.length ? Math.min(...vals) : 0;
  const maxV = vals.length ? Math.max(...vals) : 0;
  const span = maxV - minV;
  return pool.map((s) => {
    let w = s.weight * (s.hazard ? HAZARD_SPAWN.weightScale : 1);
    if (baitK > 0 && !s.hazard && span > 0) w *= 1 + baitK * ((s.value - minV) / span);
    return { s, w };
  });
};
const expectedValue = (z, baitK) => {
  const ws = zoneWeights(z, baitK);
  const safe = ws.filter((x) => !x.s.hazard);
  const safeW = safe.reduce((a, x) => a + x.w, 0);
  const safeV = safeW ? safe.reduce((a, x) => a + x.w * x.s.value, 0) / safeW : 0;
  const total = ws.reduce((a, x) => a + x.w, 0);
  const rawV = ws.reduce((a, x) => a + x.w * x.s.value, 0) / total;
  const hz = ws.filter((x) => x.s.hazard).reduce((a, x) => a + x.w, 0) / total;
  const n = expectedFishCount(z);
  const hzE = Math.min(HAZARD_SPAWN.maxPerZone, n * hz);
  return (n - hzE) / n * rawV + hzE / n * safeV;
};
const incomePerCast = (map, maxDepth, baitK = 0) => {
  let sum = 0;
  for (const z of zonesOfMap(map.id)) {
    const span = z.top - z.bottom;
    const reach = Math.max(0, Math.min(maxDepth, -z.bottom) - -z.top);
    if (reach <= 0) continue;
    sum += expectedFishCount(z) * Math.min(1, reach / span) * expectedValue(z, baitK) * RARITY_MUL * CAPTURE_RATE;
  }
  return sum * COMBO_MULT;
};

// ── 候选口径 ──
// 每个 = { 名字, 判定(state) → 是否满足 }
const CANDS = [
  { id: 'cur75', label: '现状：总覆盖 ≥ 75%', ok: (s) => s.seen.size >= Math.ceil(s.total * 0.75) },
  { id: 'cov90', label: '总覆盖 ≥ 90%', ok: (s) => s.seen.size >= Math.ceil(s.total * 0.90) },
  { id: 'cov100', label: '总覆盖 100%（集齐本图）', ok: (s) => s.seen.size >= s.total },
  { id: 'zone1', label: '每层 ≥ 1 种', ok: (s) => s.zones.every((z) => s.zoneSeen.get(z.id).size >= 1) },
  { id: 'zone2', label: '每层 ≥ 2 种', ok: (s) => s.zones.every((z) => s.zoneSeen.get(z.id).size >= 2) },
  { id: 'boss', label: '钓到本图 Boss', ok: (s) => s.boss },
  { id: 'zone1+cov90', label: '每层 ≥ 1 种 + 总覆盖 ≥ 90%', ok: (s) => s.zones.every((z) => s.zoneSeen.get(z.id).size >= 1) && s.seen.size >= Math.ceil(s.total * 0.9) },
  { id: 'boss+cov90', label: 'Boss + 总覆盖 ≥ 90%', ok: (s) => s.boss && s.seen.size >= Math.ceil(s.total * 0.9) },
  { id: 'rare', label: '钓到过银色及以上（≥1 条稀有）', ok: (s) => s.rare },
];

function runAll(cond) {
  const rand = mulberry32(20260917);
  const state = { coins: 0, lv: Object.fromEntries(UPGRADE_ORDER.map((k) => [k, 0])) };
  const out = [];
  for (let mi = 0; mi < MAPS.length; mi++) {
    const map = MAPS[mi];
    const cap = MAP_LEVEL_CAP[Math.min(mi, MAP_LEVEL_CAP.length - 1)];
    const mapD = mapMaxDepth(map);
    const zones = zonesOfMap(map.id);
    const mine = SPECIES.filter((s) => s.zones.some((z) => map.zones.includes(z)));
    const itemCap = (k) => Math.min(cap, maxLvOf(k));
    const bandDone = () => UPGRADE_ORDER.every((k) => state.lv[k] >= itemCap(k));
    const tables = zones.map((z) => {
      const ws = zoneWeights(z, state.lv.bait / 100);
      const total = ws.reduce((a, x) => a + x.w, 0);
      return ws.map((x) => ({ s: x.s, p: x.w / total }));
    });
    const S = { seen: new Set(), zoneSeen: new Map(zones.map((z) => [z.id, new Set()])),
      zones, total: mine.length, boss: false, rare: false };

    const next = MAPS[mi + 1];
    const lic = next ? next.license : 0;
    let casts = 0, spent = 0, levelsBought = 0, incSum = 0, gateAt = null, bandAt = null;
    let guard = 0;

    while (guard++ < 200000) {
      const lineMax = lvAt('maxDepth', state.lv.line);
      const depth = Math.min(lineMax, mapD - REACH_SLACK);
      const reachedMax = lineMax >= mapD;
      const inc = incomePerCast(map, depth, state.lv.bait / 100);
      state.coins += inc; casts += 1; incSum += inc;

      for (let zi = 0; zi < zones.length; zi++) {
        const z = zones[zi];
        const span = z.top - z.bottom;
        const reach = Math.max(0, Math.min(depth, -z.bottom) - -z.top);
        if (reach <= 0) continue;
        const lam = expectedFishCount(z) * Math.min(1, reach / span) * CAPTURE_RATE;
        let L = Math.exp(-lam), k = 0, p = 1;
        do { k += 1; p *= rand(); } while (p > L);
        k -= 1;
        for (let i = 0; i < k; i++) {
          // 稀有度也要抽（"钓到过稀有鱼"这个候选口径要用）
          let rr = rand(), rar = RARITY[0];
          for (const t of RARITY) { rr -= t.p; if (rr < 0) { rar = t; break; } }
          if (rar.mul > 1) S.rare = true;
          let r = rand();
          for (const e of tables[zi]) {
            r -= e.p;
            if (r <= 0) {
              S.seen.add(e.s.id);
              S.zoneSeen.get(z.id).add(e.s.id);
              if (e.s.boss) S.boss = true;
              break;
            }
          }
        }
      }

      if (gateAt === null && cond.ok(S)) gateAt = casts;
      if (bandAt === null && bandDone()) bandAt = casts;
      if (bandAt !== null && cond.ok(S) && reachedMax && state.coins >= lic) break;

      if (!bandDone()) {
        let bought = true;
        while (bought) {
          bought = false;
          const aff = [];
          for (const k2 of UPGRADE_ORDER) {
            if (state.lv[k2] >= itemCap(k2)) continue;
            const c = Math.round(UPGRADES[k2].base * Math.pow(GROWTH, state.lv[k2]));
            if (c <= state.coins) aff.push({ k: k2, c });
          }
          if (!aff.length) break;
          aff.sort((a, b) => (a.k === 'line' ? -1 : b.k === 'line' ? 1 : a.c - b.c));
          state.coins -= aff[0].c;
          state.lv[aff[0].k] += 1;
          spent += aff[0].c; levelsBought += 1;
          bought = true;
        }
      }
    }
    out.push({ map, casts, gateAt, bandAt, total: mine.length });
  }
  return out;
}

console.log('══ A10 候选口径横评（完整两图推进，换图条件换成该口径）══\n');
console.log('口径                              宁静海湾(竿)  门槛卡在第几竿   冰封极地(竿)  门槛卡在第几竿   合计');
console.log('─'.repeat(104));
for (const c of CANDS) {
  const r = runAll(c);
  const total = r.reduce((a, x) => a + x.casts, 0);
  const f = (v) => (v == null ? '未达成' : String(v)).padStart(6);
  console.log(`${c.label.padEnd(32)} ${String(r[0].casts).padStart(9)} ${f(r[0].gateAt)}   ${String(r[1].casts).padStart(10)} ${f(r[1].gateAt)}   ${String(total).padStart(5)}`);
}
console.log('─'.repeat(104));
console.log('\n说明：「门槛卡在第几竿」= 该口径第一次满足是在本图的第几竿。');
console.log('      「未达成」= 整个推进过程里都没满足（说明这个口径会让玩家卡死，不能用）。');
console.log('      对照：本图的"买满等级段"在第 15 / 21 竿 —— 它才是现状真正的墙。');
