/**
 * _measure-first-batch.mjs — 「第一批」两个需要先量再定的参数的测算（一次性探针）
 *
 * 为什么先量：
 *   A10 要重做「图鉴门槛」，但"门槛该定多少"不能拍脑袋 ——
 *   定松了等于没有（现状：75% 只要 3~5 竿），定紧了会变成"卡在最后一条鱼上刷 30 竿"。
 *   所以把几个候选口径都跑一遍，看它们各自把换图卡在第几竿。
 *
 * 用法：node .dev/archive/_measure-first-batch.mjs
 */
import {
  MAPS, SPECIES, FISH_DENSITY, HAZARD_SPAWN, SCHOOL, GROWTH, UPGRADES, UPGRADE_ORDER,
  MAP_LEVEL_CAP, maxLvOf, lvAt, zonesOfMap, mapMaxDepth,
} from '../../src/config.js';

const REACH_SLACK = 12;
const CAPTURE_RATE = 0.45;
const COMBO_MULT = 1.6;
const RARITY_MUL = 1.375;

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

// ═══════════════════════════════════════════════════════════
// 逐竿推进：记录「覆盖率门槛」和「每层覆盖门槛」各自在第几竿达成
// ═══════════════════════════════════════════════════════════
function simulate(mi, state, rand) {
  const map = MAPS[mi];
  const cap = MAP_LEVEL_CAP[Math.min(mi, MAP_LEVEL_CAP.length - 1)];
  const mapD = mapMaxDepth(map);
  const zones = zonesOfMap(map.id);
  const mine = SPECIES.filter((s) => s.zones.some((z) => map.zones.includes(z)));
  const need = Math.ceil(mine.length * 0.75);
  const itemCap = (k) => Math.min(cap, maxLvOf(k));
  const bandDone = () => UPGRADE_ORDER.every((k) => state.lv[k] >= itemCap(k));

  const seen = new Set();
  const zoneSeen = new Map(zones.map((z) => [z.id, new Set()]));
  const tables = zones.map((z) => {
    const ws = zoneWeights(z, state.lv.bait / 100);
    const total = ws.reduce((a, x) => a + x.w, 0);
    return ws.map((x) => ({ s: x.s, p: x.w / total }));
  });

  let casts = 0, spent = 0, levelsBought = 0, incSum = 0;
  let codex75 = null, codex90 = null, codex100 = null;
  const zoneAt = {};
  let bandAt = null;
  const next = MAPS[mi + 1];
  const lic = next ? next.license : 0;
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
        let r = rand();
        for (const e of tables[zi]) {
          r -= e.p;
          if (r <= 0) { seen.add(e.s.id); zoneSeen.get(z.id).add(e.s.id); break; }
        }
      }
    }

    const cov = seen.size / mine.length;
    if (codex75 === null && seen.size >= Math.ceil(mine.length * 0.75)) codex75 = casts;
    if (codex90 === null && cov >= 0.9) codex90 = casts;
    if (codex100 === null && seen.size >= mine.length) codex100 = casts;
    // 每层至少 N 种：记录 N=1/2/3 各自达成的竿数
    for (const N of [1, 2, 3]) {
      const key = `z${N}`;
      if (zoneAt[key] == null && zones.every((z) => zoneSeen.get(z.id).size >= N)) zoneAt[key] = casts;
    }
    if (bandAt === null && bandDone()) bandAt = casts;

    if (bandAt !== null && seen.size >= need && reachedMax && state.coins >= lic) break;

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
  return { map, casts, spent, levelsBought, codex75, codex90, codex100, zoneAt,
    total: mine.length, zones: zones.length,
    perZone: zones.map((z) => `${z.nick}(${zones.length ? '' : ''}${SPECIES.filter((s) => s.zones.includes(z.id)).length})`).join(' ') };
}

console.log('══ A10 图鉴门槛候选口径：各自卡在第几竿 ══\n');
console.log('地图        本图总竿  75%（现状）  90%      100%     每层≥1种  每层≥2种  每层≥3种');
console.log('─'.repeat(96));
const rand = mulberry32(20260917);
const state = { coins: 0, lv: Object.fromEntries(UPGRADE_ORDER.map((k) => [k, 0])) };
let totalCasts = 0;
for (let mi = 0; mi < MAPS.length; mi++) {
  const r = simulate(mi, state, rand);
  totalCasts += r.casts;
  const f = (v) => (v == null ? '—' : String(v)).padStart(6);
  console.log(`${r.map.name.padEnd(10)} ${String(r.casts).padStart(7)}  ${f(r.codex75)}    ${f(r.codex90)}  ${f(r.codex100)}   ${f(r.zoneAt.z1)}   ${f(r.zoneAt.z2)}   ${f(r.zoneAt.z3)}`);
}
console.log('─'.repeat(96));
console.log(`合计主线 ${totalCasts} 竿`);

console.log('\n各图每层鱼种数（"每层≥N种"的分母）:');
for (const m of MAPS) {
  const zs = zonesOfMap(m.id);
  console.log('  ' + m.name + '：' + zs.map((z) => `${z.nick}=${SPECIES.filter((s) => s.zones.includes(z.id)).length}`).join(' · '));
}

console.log('\n══ A1 分段解锁的代价：只留 4 项基础时，首图还能买多少 ══\n');
const S = (g, a, b) => { let s = 0; for (let l = a; l < b; l++) s += Math.pow(g, l); return s; };
const baseKeys = ['line', 'hook', 'sinker', 'lamp'];
const advKeys = ['creel', 'bait'];
const sumOf = (keys, from, to) => keys.reduce((a, k) => a + UPGRADES[k].base * S(GROWTH, from, to), 0);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
console.log(`首图 Lv0~5：4 项基础 = ${fmt(sumOf(baseKeys, 0, 5))} · 6 项 = ${fmt(sumOf([...baseKeys, ...advKeys], 0, 5))} · 加绞盘 = ${fmt(sumOf([...baseKeys, ...advKeys], 0, 5) + UPGRADES.winch.base)}`);
console.log(`第二图 Lv5~9：4 项基础 = ${fmt(sumOf(baseKeys, 5, 9))} · 6 项 = ${fmt(sumOf([...baseKeys, ...advKeys], 5, 9))}`);
console.log(`等级数：首图 4 项×5 = 20 · 6 项×5+绞盘 = 31；第二图 4 项×4 = 16 · 6 项×4 = 24`);
