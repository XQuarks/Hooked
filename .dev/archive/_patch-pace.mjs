/**
 * 一次性补丁：把 `.dev/pace.mjs` 的门槛模型从「图鉴收集」换成「海图 + 买船」（v0.7 第二批）。
 * 跑完即删（或者留着当记录）。用法：node .dev/_patch-pace.mjs
 */
import fs from 'node:fs';

const FILE = '.dev/pace.mjs';
let t = fs.readFileSync(FILE, 'utf8');
const log = [];
const rep = (from, to, label) => {
  if (!t.includes(from)) { log.push(`✗ 未找到：${label}`); return; }
  t = t.replace(from, to);
  log.push(`✓ ${label}`);
};

rep(
  '  MAPS, SPECIES, FISH_DENSITY, HAZARD_SPAWN, RARITY, SCHOOL, CODEX_GATE,',
  '  MAPS, SPECIES, FISH_DENSITY, HAZARD_SPAWN, RARITY, SCHOOL, BOATS,',
  'P1 import 换成 BOATS',
);

rep(
  `  const zones = zonesOfMap(map.id);
  const mine = SPECIES.filter((s) => s.zones.some((z) => map.zones.includes(z)));
  const need = Math.ceil(mine.length * CODEX_GATE.covRatio);
  const seen = new Set();
  /** 每层各钓到过几种（换图条件①的"空间维度"那一半） */
  const zoneSeen = new Map(zones.map((z) => [z.id, new Set()]));
  /** 换图条件①：两层都满足才算过 */
  const gateOk = () => (!CODEX_GATE.everyZone || zones.every((z) => zoneSeen.get(z.id).size > 0))
    && seen.size >= need;`,
  `  // ⚠ v0.7：换图门槛已经从"图鉴收集"换成 **海图（潜到本图最底）+ 买船**。
  //   所以这里**不再模拟图鉴抽样**："能潜到底"就等于拿到了海图，
  //   而那一步本身不额外花竿数（宝箱就在最底下，路过即得）。
  const zones = zonesOfMap(map.id);`,
  'P2 删掉图鉴门槛的建模',
);

rep(
  `  // 每层的抽签表（鱼饵会按等级改权重，所以每竿重算一次 —— 层数很少，开销可忽略）
  const tablesOf = () => zones.map((z) => {
    const ws = zoneWeights(z, state.lv.bait / 100);
    const total = ws.reduce((a, x) => a + x.w, 0);
    return ws.map((x) => ({ id: x.s.id, p: x.w / total }));
  });

  const next = MAPS[mi + 1];
  const lic = next ? next.license : 0;`,
  `  const next = MAPS[mi + 1];
  // 进下一张图的**一次性**支出（v0.7：不再是许可证，而是买船 10,000）。
  // ⚠ 按"下一张图"收：最后一张图没有下一张，就不收（否则末图会被算得格外便宜）。
  const oneOff = next ? (next.license > 0 ? next.license : BOATS[0].price) : 0;
  const oneOffWhat = next ? (next.license > 0 ? '许可证' : '买船') : '';`,
  'P3 lic → oneOff（买船）',
);

rep(
  '  let codexAt = null, depthAt = null, bandAt = null, coinAt = null;',
  '  let depthAt = null, bandAt = null, coinAt = null;',
  'P4 去掉 codexAt',
);

rep(
  `    // ② 这一竿串上来的鱼 → 图鉴
    const tables = tablesOf();
    for (let zi = 0; zi < zones.length; zi++) {
      const z = zones[zi];
      const span = z.top - z.bottom;
      const reach = Math.max(0, Math.min(depth, -z.bottom) - -z.top);
      if (reach <= 0) continue;
      const lam = expectedFishCount(z) * Math.min(1, reach / span) * CAPTURE_RATE;
      // Poisson(λ)：这一竿从该层串上来几条
      let L = Math.exp(-lam), k = 0, p = 1;
      do { k += 1; p *= rand(); } while (p > L);
      k -= 1;
      for (let i = 0; i < k; i++) {
        let r = rand();
        for (const e of tables[zi]) {
          r -= e.p;
          if (r <= 0) { seen.add(e.id); zoneSeen.get(z.id).add(e.id); break; }
        }
      }
    }

    // ③ 三个条件各自记时
    if (codexAt === null && gateOk()) codexAt = casts;
    if (depthAt === null && reachedMax) depthAt = casts;
    if (bandAt === null && bandDone()) bandAt = casts;
    if (coinAt === null && lic > 0 && state.coins >= lic) coinAt = casts;

    // ④ 本图彻底玩完（买满 + 三个门槛全过）→ 换图
    if (bandAt !== null && gateOk() && reachedMax && state.coins >= lic) {
      if (lic > 0) state.coins -= lic;
      break;
    }`,
  `    // ② 两个门槛各自记时
    if (depthAt === null && reachedMax) depthAt = casts;          // 潜到本图最底 = 拿到海图
    if (bandAt === null && bandDone()) bandAt = casts;
    if (coinAt === null && oneOff > 0 && state.coins >= oneOff) coinAt = casts;

    // ③ 本图玩完（买满 + 潜到底 + 攒够"买船"那笔）→ 换图
    if (bandAt !== null && reachedMax && state.coins >= oneOff) {
      if (oneOff > 0) state.coins -= oneOff;
      break;
    }`,
  'P5/P6 记时与退出条件',
);

rep(
  `    casts, spent, levelsBought, avgInc: incSum / casts,
    codexAt, depthAt, bandAt, coinAt,
    codexTotal: mine.length, codexNeed: need,
    /** 本图买不到的项（\`unlockMap\` 指向的许可证还没拿到）—— 只用于输出说明 */
    lockedItems: UPGRADE_ORDER.filter((k) => !buyable(k)).map((k) => UPGRADES[k].name),
    license: lic,
    fullInc: fullDepthIncome(map, 0, RARITY_MUL),
    licenseCasts: lic > 0 ? lic / fullDepthIncome(map, 0, RARITY_MUL) : 0,`,
  `    casts, spent, levelsBought, avgInc: incSum / casts,
    depthAt, bandAt, coinAt,
    /** 本图买不到的项（\`unlockMap\` 指向的许可证还没拿到）—— 只用于输出说明 */
    lockedItems: UPGRADE_ORDER.filter((k) => !buyable(k)).map((k) => UPGRADES[k].name),
    oneOff, oneOffWhat,
    fullInc: fullDepthIncome(map, 0, RARITY_MUL),
    oneOffCasts: oneOff > 0 ? oneOff / fullDepthIncome(map, 0, RARITY_MUL) : 0,`,
  'P7 return 字段',
);

rep(
  `/** 换图条件① 的人话描述（表格与断言共用，避免两处口径不一样） */
const GATE_TEXT = \`\${CODEX_GATE.everyZone ? '每层都有收获 + ' : ''}图鉴 \${CODEX_GATE.covRatio * 100}%\`;`,
  `/** 首图"买船"那笔钱的可及性上限（竿）：超过它就是"攒钱太苦"，见 assertGateReachable */
const BOAT_REACH_MAX_CASTS = 5;

function assertGateReachable(rows) {
  // 首图是"买船"发生的那张图：那 10,000 必须**够得着** ——
  // 太贵（要刷十几竿）会让"换图"变成苦工，太便宜（不到 1 竿）则三艘船等于白送。
  const p = rows[0];
  const casts = p.oneOff / p.fullInc;
  if (!(casts >= 1)) {
    throw new Error(\`首图满深度一竿收入 \${fmt(p.fullInc)}，而买船只要 \${fmt(p.oneOff)} ——\`
      + \` 不到一竿就买得起（\${casts.toFixed(2)} 竿），三艘船等于白送。调高 BOATS[].price。\`);
  }
  if (casts > BOAT_REACH_MAX_CASTS) {
    throw new Error(\`买船要攒 \${casts.toFixed(1)} 竿（上限 \${BOAT_REACH_MAX_CASTS} 竿）——\`
      + ' 太苦了：换图会变成"为了 10,000 反复刷同一片海"。调低 BOATS[].price 或提高首图收入。');
  }
}`,
  'P8 GATE_TEXT → assertGateReachable',
);

// P9：把旧的 assertCodexGateBalance 整段（含 GATE_WALL_SLACK 常量）切掉
const from = t.indexOf('/**\n * 首图（新手图）的内容门槛');
const to = t.indexOf('assertLevelAnchors();');
if (from >= 0 && to > from) {
  t = t.slice(0, from) + t.slice(to);
  log.push('✓ P9 删掉 assertCodexGateBalance 整段');
} else {
  log.push('✗ P9 没找到 assertCodexGateBalance 段');
}

rep('assertCodexGateBalance(paces);', 'assertGateReachable(paces);', 'P10 调用点改名');

rep(
  `lines.push(\`| 地图 | 内容门槛（\${GATE_TEXT}）达成于第几竿 | 潜到本图上限于第几竿 | 本图等级段买满于第几竿 | 本图总竿数 | **最慢的那一项** |\`, '|---|---:|---:|---:|---:|---|');`,
  `lines.push('| 地图 | 海图（潜到本图最底）于第几竿 | 本图等级段买满于第几竿 | 本图总竿数 | **最慢的那一项** |', '|---|---:|---:|---:|---|');`,
  'P11 换表头',
);

rep(
  `    ['内容门槛', p.codexAt], ['潜到本图上限', p.depthAt], ['买满本图等级段', p.bandAt],`,
  `    ['海图（潜到底）', p.depthAt], ['买满本图等级段', p.bandAt],`,
  'P12 门槛列',
);

rep(
  `  lines.push(\`| \${p.map.name} | \${p.codexAt ?? '—'} | \${p.depthAt ?? '—'} | \${p.bandAt ?? '—'} | \${fmt(p.casts)} | **\${last[0]}** |\`);`,
  `  lines.push(\`| \${p.map.name} | \${p.depthAt ?? '—'} | \${p.bandAt ?? '—'} | \${fmt(p.casts)} | **\${last[0]}** |\`);`,
  'P13 门槛行',
);

rep(
  `lines.push('| 地图 | 许可证 | 满深度一竿收入 | 攒够许可证要几竿（估算） | 内容门槛 |', '|---|---:|---:|---:|---|');
for (const p of paces) {
  lines.push(\`| \${p.map.name} | \${p.license ? fmt(p.license) : '免费'} | \${fmt(p.fullInc)} | \${p.license ? fmt(p.licenseCasts) : '—'} | \${CODEX_GATE.everyZone ? '每层都有收获 + ' : ''}本图 \${p.codexTotal} 种里钓到 \${p.codexNeed} 种 |\`);
}`,
  `lines.push('| 地图 | 换图的一次性支出 | 满深度一竿收入 | 攒够要几竿（估算） |', '|---|---:|---:|---|');
for (const p of paces) {
  lines.push(\`| \${p.map.name} | \${p.oneOff ? \`\${p.oneOffWhat} \${fmt(p.oneOff)}\` : '免费'} | \${fmt(p.fullInc)} | \${p.oneOff ? fmt(p.oneOffCasts) : '—'} |\`);
}`,
  'P14 许可证表 → 一次性支出表',
);

fs.writeFileSync(FILE, t);
console.log(log.join('\n'));
console.log(`\n剩余 CODEX_GATE 引用：${(t.match(/CODEX_GATE/g) || []).length}`);
