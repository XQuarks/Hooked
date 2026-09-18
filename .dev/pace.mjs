/**
 * pace.mjs — 玩法节奏验算：把「一竿赚多少 / 升一级要几竿 / 换图要几竿」算出来，
 *            并把结果**写进 `GAMEPLAY.md` 的标记块**（不是手抄）。
 *
 * 为什么要有这个脚本：
 *   `GAMEPLAY.md` 讲的是"数值与平衡性设计思路"，里面必然要出现「每张图多少竿」
 *   这类**派生数据**。这个项目已经因为手抄派生数据翻过车（行数表 13 个数字全过期、
 *   docs/ 里 4 批数值漂移）。所以派生数据一律**由脚本生成 + check 子命令兜底**，
 *   和 `gen-docs.mjs` / `loc.mjs` 是同一套做法。
 *
 * 模型边界（**这是模型，不是测量**）：
 *   - 它**不跑游戏**，只把 `src/config.js` 的表代进一个解析式收入模型，秒级出结果；
 *   - 不含鱼群以外的动态（不模拟玩家的走位失误、不模拟浮冰、不模拟枪法）；
 *   - 鱼群、扣钱鱼封顶、鱼饵加权、稀有度期望都按 `spawnFish()` 的真实抽签逻辑建模；
 *   - 两个主观参数（`CAPTURE_RATE` / `COMBO_MULT`）写在下面，改它们就是改结论的口径。
 *
 * 用法：
 *   node .dev/pace.mjs          # 生成 / 覆盖 GAMEPLAY.md 里 PACE 标记之间的内容
 *   node .dev/pace.mjs check    # 只校验不写盘：不一致则退出码 1
 *
 * 生成前会先跑两组结构性断言（不通过直接抛错，不会写出一张假表）：
 *   ① `assertLevelAnchors()`      —— 等级闸门 ↔ 地图深度上限必须一一对上（B3）
 *   ② `assertGateReachable()`     —— 换图的"一次性支出"（首图 = 买船 10,000）必须**够得着**：
 *                                    既不能低到等于白送，也不能高到要攒太多竿（A10 → v0.7 重做）
 *
 * ⚠ v0.7 第二批起，换图门槛 = **海图（潜到本图最底）+ 任意一艘船**。
 *   旧的「图鉴 90% / 潜到上限 / 许可证」三条整条移除，所以本脚本**不再模拟图鉴抽样** ——
 *   "能潜到底"就等于拿到海图。`CODEX_GATE` 这个常量也随之作废（已删除）。
 *
 * ⚠ 改了 `src/config.js` 的任何数值之后：先 `node .dev/pace.mjs`，再 `node .dev/loc.mjs`
 *   （GAMEPLAY.md 的行数会被本脚本改写，loc.mjs 统计的是文件行数）。
 * ⚠ 标记块里**不要放时间戳**，否则 `check` 每次都失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  MAPS, SPECIES, FISH_DENSITY, HAZARD_SPAWN, RARITY, SCHOOL, BOATS,
  UPGRADES, UPGRADE_ORDER, upgradeCost, MAP_LEVEL_CAP, maxLvOf, lvAt,
  zonesOfMap, mapMaxDepth,
} from '../src/config.js';

const ROOT = process.cwd();
const DOC = path.join(ROOT, 'GAMEPLAY.md');
const CHECK_ONLY = process.argv.includes('check');

const BEGIN = '<!-- PACE:BEGIN — 由 .dev/pace.mjs 生成，不要手改（改了数值跑 `node .dev/pace.mjs`）-->';
const END = '<!-- PACE:END -->';

// ───────────────────────── 模型参数 ─────────────────────────
/** 上升阶段扫过的鱼里被真的串上的比例。玩家会漏，但也有一串一串捞的时候。 */
const CAPTURE_RATE = 0.45;
/** 全程平均连击倍率（1 + floor(combo/3) × 0.25，上限 3.0）。 */
const COMBO_MULT = 1.6;
/** 一竿（含看结算、逛商店）的平均耗时，只用来把竿数换算成时长。 */
const CAST_SECONDS = 70;
/** 一竿最多能潜到本图上限的百分之多少时，才算"这一竿把本图走完了"。 */
const REACH_SLACK = 12;      // 与 spawnFish 的 `deepest = -(maxDepth - 12*MODEL_SCALE)` 同口径

// ───────────────────────── 确定性随机（codex 覆盖率模拟要用） ─────────────────────────
const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ───────────────────────── 抽签模型（照抄 spawnFish 的口径） ─────────────────────────
/** 本层每竿刷出几条鱼（含鱼群）：鱼群出现时是「一群 + 少量散鱼」，否则是基准数量 */
function expectedFishCount(zone) {
  const n = Math.max(1, Math.round(zone.count * FISH_DENSITY));
  const group = Math.round((SCHOOL.count[0] + SCHOOL.count[1]) / 2);
  const extras = Math.max(1, Math.round((SCHOOL.extras[0] + SCHOOL.extras[1]) / 2));
  return (1 - SCHOOL.chance) * n + SCHOOL.chance * (group + extras);
}

/** 本层可钓鱼种的抽签权重（扣钱鱼乘 weightScale、鱼饵按层内相对贵重程度加权） */
function zoneWeights(zone, baitK) {
  const pool = SPECIES.filter((s) => s.zones.includes(zone.id));
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
}

/**
 * 本层「平均一条鱼值多少」。
 *
 * ⚠ 扣钱鱼在抽签里被封顶（每层最多 1 条，超出的名额会**退回安全鱼池重抽**），
 *   所以它的期望身价不能直接按权重算进去 —— 这里按"超出上限的扣钱鱼 = 一条普通鱼"处理。
 */
function expectedValue(zone, baitK) {
  const ws = zoneWeights(zone, baitK);
  const safe = ws.filter((x) => !x.s.hazard);
  const safeW = safe.reduce((a, x) => a + x.w, 0);
  const safeV = safeW ? safe.reduce((a, x) => a + x.w * x.s.value, 0) / safeW : 0;
  const total = ws.reduce((a, x) => a + x.w, 0);
  const rawV = ws.reduce((a, x) => a + x.w * x.s.value, 0) / total;
  // 期望扣钱鱼条数（封顶 1）与它在总鱼数里的占比
  const hazardShare = ws.filter((x) => x.s.hazard).reduce((a, x) => a + x.w, 0) / total;
  const n = expectedFishCount(zone);
  const hazardE = Math.min(HAZARD_SPAWN.maxPerZone, n * hazardShare);
  return (n - hazardE) / n * rawV + hazardE / n * safeV;
}

/** 一竿收入：按能潜到的深度，对每层海域做「到达比例」加权 */
function incomePerCast(map, maxDepth, baitK = 0, rarityMul = 1) {
  let sum = 0;
  for (const z of zonesOfMap(map.id)) {
    const span = z.top - z.bottom;
    const reach = Math.max(0, Math.min(maxDepth, -z.bottom) - -z.top);
    if (reach <= 0) continue;
    const ratio = Math.min(1, reach / span);
    sum += expectedFishCount(z) * ratio * expectedValue(z, baitK) * rarityMul * CAPTURE_RATE;
  }
  return sum * COMBO_MULT;
}

/** 本图满深度（潜到底）时的一竿收入 —— 换图那笔一次性支出与毕业节奏都用它当基准 */
const fullDepthIncome = (map, baitK = 0, rarityMul = 1) =>
  incomePerCast(map, mapMaxDepth(map) - REACH_SLACK, baitK, rarityMul);

const RARITY_MUL = RARITY.reduce((a, r) => a + r.p * r.mul, 0);

// ───────────────────────── 逐竿推进模拟 ─────────────────────────
/**
 * 为什么这里还在做**逐竿推进**、而不是解析式估算：
 *
 * 换图门槛是「海图（潜到本图最底）+ 一次性支出（首图 = 买船 10,000）」，
 * 两条都挂在钱与等级上 —— **但收入本身不是解析式**：玩家不是一开始就潜到底的，
 * 深度上限跟着鱼线等级走，而鱼线又跟着收入走，是一条正反馈链。
 *
 * ⚠ v0.7 第二批：换图门槛已换成 **海图 + 买船** —— 旧的「每层都有收获 + 图鉴 ≥ 90%」
 *   整条删掉了，所以这里**不再模拟图鉴抽样**：能潜到底就等于拿到海图（宝箱就在最底下）。
 *
 * 所以逐竿推进：收入随等级涨、等级随收入涨，各条件分别记时，
 * 最后看**哪一个最后达成** —— 那才是真正的进度墙。
 *
 * 玩家策略（模拟里写死的，改它就是改结论）：
 *   - **先把本图的等级段买满**：可买项里有鱼线就优先买鱼线，否则买最便宜的；
 *   - 买满之后**不再消费**，把金币攒成换图那笔一次性支出（首图 = 买船）。
 *
 *   为什么不是"攒到一半就停手"（`.dev/balance-v2.mjs` 的做法）：
 *   那样会**死锁** —— 停手之后金币只涨不花，而换图又要求本图已经买满，
 *   两个条件互相等。把买满放在攒钱前面既不会死锁，也是更自然的通关玩法。
 */
function simulateMap(mi, state, rand) {
  const map = MAPS[mi];
  const cap = MAP_LEVEL_CAP[Math.min(mi, MAP_LEVEL_CAP.length - 1)];
  const mapD = mapMaxDepth(map);
  // ⚠ v0.7：换图门槛已经从"图鉴收集"换成 **海图（潜到本图最底）+ 买船**。
  //   所以这里**不再模拟图鉴抽样**："能潜到底"就等于拿到了海图，
  //   而那一步本身不额外花竿数（宝箱就在最底下，路过即得）。
  const zones = zonesOfMap(map.id);
  // ⚠⚠ 「买满本图等级段」必须按**每一项自己的上限**算，不能只看地图闸门：
  //   ① 一次性工具（绞盘）的上限是 1，而地图闸门是 5 —— 只看闸门的话它永远"没买满"，
  //      循环永远退不出去（实测直接把 guard 跑满 20 万竿，输出一张 7777 小时的假表）。
  //      正确口径：某项做完了 = lv >= min(地图闸门, 该项自己的上限)。
  //   ② **本图买不到的项不算**（v0.6 分段解锁）：`UPGRADES[*].unlockMap` 指向的那张图
  //      **还没到过**时，那一项在本图**根本不在货架上**（`ui.js` 显示「未解锁」）。
  //      不计这一条的话，绞盘会以 9,000 的价格算进首图的等级段支出 ——
  //      而玩家在首图压根买不到它（实测首图支出 45,207 vs 36,207，差的就是这一项）。
  //   ⚠ `entered` 要**含本图**：能站在这张图上，就说明 `unlockMap` 指向它时已经算"到过"了
  //     （`game.js` 的 `mapProgress().owned` 就是这个口径）。少算自己的话，
  //     冰封极地会被判成"买不到绞盘"—— 而绞盘正是在这张图才解锁的。
  const entered = MAPS.slice(0, mi + 1).map((m) => m.id);
  const buyable = (k) => {
    const um = UPGRADES[k].unlockMap;
    return !um || entered.includes(um);
  };
  const itemCap = (k) => (buyable(k) ? Math.min(cap, maxLvOf(k)) : 0);
  const bandDone = () => UPGRADE_ORDER.every((k) => state.lv[k] >= itemCap(k));

  const next = MAPS[mi + 1];
  // 进下一张图的**一次性**支出（v0.7：不再是许可证，而是买船 10,000）。
  // ⚠ 按"下一张图"收：最后一张图没有下一张，就不收（否则末图会被算得格外便宜）。
  const oneOff = next ? (next.license > 0 ? next.license : BOATS[0].price) : 0;
  const oneOffWhat = next ? (next.license > 0 ? '许可证' : '买船') : '';

  let casts = 0, spent = 0, levelsBought = 0, incSum = 0;
  let depthAt = null, bandAt = null, coinAt = null;
  let guard = 0;

  while (guard++ < 200000) {
    const lineMax = lvAt('maxDepth', state.lv.line);
    const depth = Math.min(lineMax, mapD - REACH_SLACK);
    const reachedMax = lineMax >= mapD;

    // ① 这一竿赚多少
    const inc = incomePerCast(map, depth, state.lv.bait / 100, RARITY_MUL);
    state.coins += inc;
    casts += 1; incSum += inc;

    // ② 两个门槛各自记时
    if (depthAt === null && reachedMax) depthAt = casts;          // 潜到本图最底 = 拿到海图
    if (bandAt === null && bandDone()) bandAt = casts;
    if (coinAt === null && oneOff > 0 && state.coins >= oneOff) coinAt = casts;

    // ③ 本图玩完（买满 + 潜到底 + 攒够"买船"那笔）→ 换图
    if (bandAt !== null && reachedMax && state.coins >= oneOff) {
      if (oneOff > 0) state.coins -= oneOff;
      break;
    }

    // ⑤ 买升级：**只在还没买满时消费**
    if (!bandDone()) {
      let bought = true;
      while (bought) {
        bought = false;
        const aff = [];
        for (const key of UPGRADE_ORDER) {
          if (state.lv[key] >= itemCap(key)) continue;
          const c = upgradeCost(key, state.lv[key]);
          if (c <= state.coins) aff.push({ key, c });
        }
        if (!aff.length) break;
        aff.sort((a, b) => (a.key === 'line' ? -1 : b.key === 'line' ? 1 : a.c - b.c));
        state.coins -= aff[0].c;
        state.lv[aff[0].key] += 1;
        spent += aff[0].c; levelsBought += 1;
        bought = true;
      }
    }
  }

  return {
    map, cap, prevCap: mi === 0 ? 0 : MAP_LEVEL_CAP[mi - 1],
    casts, spent, levelsBought, avgInc: incSum / casts,
    depthAt, bandAt, coinAt,
    /** 本图买不到的项（`unlockMap` 指向的那张图还没到过）—— 只用于输出说明 */
    lockedItems: UPGRADE_ORDER.filter((k) => !buyable(k)).map((k) => UPGRADES[k].name),
    oneOff, oneOffWhat,
    fullInc: fullDepthIncome(map, 0, RARITY_MUL),
    oneOffCasts: oneOff > 0 ? oneOff / fullDepthIncome(map, 0, RARITY_MUL) : 0,
  };
}

function simulate() {
  const rand = mulberry32(20260917);
  const state = { coins: 0, lv: Object.fromEntries(UPGRADE_ORDER.map((k) => [k, 0])) };
  const out = [];
  for (let mi = 0; mi < MAPS.length; mi++) out.push(simulateMap(mi, state, rand));
  return out;
}

// ───────────────────────── 结构性断言（生成前先跑，不通过就直接抛） ─────────────────────────
/**
 * 「等级闸门 ↔ 地图深度上限」必须一一对上。
 *
 * `MAP_LEVEL_CAP` 的每个节点都要求 `LEVELS.maxDepth` **正好等于**该图的深度上限
 * （Lv5=860 / Lv9=1240 / Lv13=1560 / Lv17=1800 / Lv20=2200）。
 * 这样"买满本图等级" = "刚好能潜到本图底"，玩家才会自然想换一片更深的海。
 *
 * ⚠ 这条关系原本**只写在 config.js 的注释里**，靠 `verify7` 的 A8 单点覆盖。
 *   第 3~5 张图的锚点在 `MAPS` 里还没有对应条目，一旦有人先动 `LEVELS` 就会静默错位
 *   （症状：玩家买满了却潜不到底，或者还没买满就到底了）。所以在这里钉成硬断言。
 */
function assertLevelAnchors() {
  for (let i = 0; i < MAPS.length; i++) {
    const cap = MAP_LEVEL_CAP[Math.min(i, MAP_LEVEL_CAP.length - 1)];
    const want = mapMaxDepth(MAPS[i]);
    const got = lvAt('maxDepth', cap);
    if (got !== want) {
      throw new Error(
        `等级闸门锚点错位：MAPS[${i}]「${MAPS[i].name}」上限 ${want}m，`
        + `但 LEVELS.maxDepth[Lv${cap}] = ${got}m。`
        + '（改 LEVELS.maxDepth 时必须同步核对 MAP_LEVEL_CAP —— 见 config.js 的注释）',
      );
    }
  }
}

// ───────────────────────── 输出 ─────────────────────────
const fmt = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/** 首图"买船"那笔钱的可及性上限（竿）：超过它就是"攒钱太苦"，见 assertGateReachable */
const BOAT_REACH_MAX_CASTS = 5;

function assertGateReachable(rows) {
  // 首图是"买船"发生的那张图：那 10,000 必须**够得着** ——
  // 太贵（要刷十几竿）会让"换图"变成苦工，太便宜（不到 1 竿）则三艘船等于白送。
  const p = rows[0];
  const casts = p.oneOff / p.fullInc;
  if (!(casts >= 1)) {
    throw new Error(`首图满深度一竿收入 ${fmt(p.fullInc)}，而买船只要 ${fmt(p.oneOff)} ——`
      + ` 不到一竿就买得起（${casts.toFixed(2)} 竿），三艘船等于白送。调高 BOATS[].price。`);
  }
  if (casts > BOAT_REACH_MAX_CASTS) {
    throw new Error(`买船要攒 ${casts.toFixed(1)} 竿（上限 ${BOAT_REACH_MAX_CASTS} 竿）——`
      + ' 太苦了：换图会变成"为了 10,000 反复刷同一片海"。调低 BOATS[].price 或提高首图收入。');
  }
}

assertLevelAnchors();
const paces = simulate();
assertGateReachable(paces);

// 健康度提醒：竿/级必须单调递增（越往后内容越厚）。不递增是"成本梯度不够"的信号。
for (let i = 1; i < paces.length; i++) {
  const a = paces[i - 1].bandAt / paces[i - 1].levelsBought;
  const b = paces[i].bandAt / paces[i].levelsBought;
  if (b < a) console.warn(`  ⚠ 竿/级 未单调递增：${paces[i - 1].map.name} ${a.toFixed(2)} → ${paces[i].map.name} ${b.toFixed(2)}`);
}

const totalCasts = paces.reduce((a, p) => a + p.casts, 0);
const totalHours = totalCasts * CAST_SECONDS / 3600;

const lines = [];
lines.push('### 逐竿推进模拟：升一级要几竿', '');
lines.push(`> 模型口径：捕获率 **${CAPTURE_RATE}**、平均连击 **×${COMBO_MULT}**、一竿 **${CAST_SECONDS}s**、`);
lines.push(`> 稀有度期望 **×${RARITY_MUL.toFixed(3)}**（${RARITY.map((r) => `${r.p * 100}%×${r.mul}`).join(' + ')}）。`);
lines.push(`> 收入按 \`spawnFish()\` 的真实抽签逻辑建模（含鱼群、扣钱鱼每层封顶 ${HAZARD_SPAWN.maxPerZone} 条、鱼饵按层内相对贵重程度加权），`);
lines.push('> 玩家策略 = **先把本图等级段买满，再攒换图那笔一次性支出（首图 = 买船）**。');
lines.push('> **不含**玩家失误、浮冰、枪法 —— 下限估计，不是实测。', '');

lines.push('| 地图 | 等级段 | 本图升级支出 | 本图平均一竿收入 | 买到等级数 | 竿/级 | 本图总竿数 |', '|---|---|---:|---:|---:|---:|---:|');
for (const p of paces) {
  const cpl = p.bandAt ? (p.bandAt / p.levelsBought).toFixed(2) : '—';
  lines.push(`| ${p.map.name} | Lv${p.prevCap}~${p.cap} | ${fmt(p.spent)} | ${fmt(p.avgInc)} | ${p.levelsBought} | ${cpl} | ${fmt(p.casts)} |`);
}
lines.push(`| **合计** | Lv0~${paces[paces.length - 1].cap} | ${fmt(paces.reduce((a, p) => a + p.spent, 0))} | — | ${paces.reduce((a, p) => a + p.levelsBought, 0)} | — | **${fmt(totalCasts)}** ≈ **${totalHours.toFixed(1)} h** |`);
lines.push('');
lines.push('> **「竿/级」= 买满本图等级段所花的竿数 ÷ 等级数**（**不含**换图那笔一次性支出 —— 它是"门票"不是"成长"，混进去会把最后一张图的节奏算歪）。');
lines.push('> 它必须**单调递增**（越往后内容越厚）。当前落地 2 张图：');
lines.push(`> ${paces.map((p) => `${p.map.name} ${p.bandAt ? (p.bandAt / p.levelsBought).toFixed(2) : '—'}`).join(' → ')}。`);
const lockedRows = paces.filter((p) => p.lockedItems.length);
if (lockedRows.length) {
  lines.push('>');
  lines.push('> **等级段只算"本图买得到"的项**（v0.6 分段解锁，`UPGRADES[*].unlockMap`）：');
  for (const p of lockedRows) {
    lines.push(`> ${p.map.name} 买不到 ${p.lockedItems.join(' / ')} —— 它们不在本图的货架上，`
      + `所以本图支出 ${fmt(p.spent)} 里没有它们（放进来的话会算成另一张图的压力）。`);
  }
}
lines.push('');

lines.push('### 换图条件：哪个才是真正的墙', '');
lines.push('| 地图 | 海图（潜到本图最底）于第几竿 | 本图等级段买满于第几竿 | 本图总竿数 | **最慢的那一项** |', '|---|---:|---:|---:|---|');
for (const p of paces) {
  const gates = [
    ['海图（潜到底）', p.depthAt], ['买满本图等级段', p.bandAt],
  ].filter(([, v]) => v !== null);
  const last = gates.reduce((a, b) => (b[1] > a[1] ? b : a), gates[0]);
  lines.push(`| ${p.map.name} | ${p.depthAt ?? '—'} | ${p.bandAt ?? '—'} | ${fmt(p.casts)} | **${last[0]}** |`);
}
lines.push('');
lines.push('| 地图 | 换图的一次性支出 | 满深度一竿收入 | 攒够要几竿（估算） |', '|---|---:|---:|---|');
for (const p of paces) {
  lines.push(`| ${p.map.name} | ${p.oneOff ? `${p.oneOffWhat} ${fmt(p.oneOff)}` : '免费'} | ${fmt(p.fullInc)} | ${p.oneOff ? fmt(p.oneOffCasts) : '—'} |`);
}
lines.push('');
lines.push('> 「第几竿」都从**进入本图**那一刻起算（不是从开局起算）。', '');

const block = [BEGIN, ...lines, END].join('\n');

const src = fs.readFileSync(DOC, 'utf8');
const re = /^<!-- PACE:BEGIN[\s\S]*?^<!-- PACE:END -->/m;
if (!re.test(src)) {
  console.error('✗ GAMEPLAY.md 里找不到 PACE 标记（<!-- PACE:BEGIN ... --> / <!-- PACE:END -->）');
  process.exit(1);
}
const next = src.replace(re, block);
if (next === src) {
  console.log(`✓ 节奏验算表已是最新（合计 ${fmt(totalCasts)} 竿 ≈ ${totalHours.toFixed(1)} h）`);
  process.exit(0);
}
if (CHECK_ONLY) {
  console.error('✗ GAMEPLAY.md 的节奏验算表与 config.js 不一致 —— 跑 node .dev/pace.mjs 重新生成');
  process.exit(1);
}
fs.writeFileSync(DOC, next);
console.log(`✓ 节奏验算表已更新（合计 ${fmt(totalCasts)} 竿 ≈ ${totalHours.toFixed(1)} h）`);
console.log('  ⚠ 接着跑一次 `node .dev/loc.mjs`（GAMEPLAY.md 行数变了）');
