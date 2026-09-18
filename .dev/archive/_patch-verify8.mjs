/**
 * 一次性补丁：verify8 的 B 组（换图门槛）从「图鉴 90% + 深度 + 许可证」改成
 * 「海图 + 船」（v0.7 第二批），并补一条「船厂 App 上架」的断言。
 * 用法：node .dev/_patch-verify8.mjs
 */
import fs from 'node:fs';

const FILE = '.dev/verify8.mjs';
let t = fs.readFileSync(FILE, 'utf8');
const log = [];
const rep = (from, to, label) => {
  if (!t.includes(from)) { log.push(`✗ 未找到：${label}`); return; }
  t = t.replace(from, to);
  log.push(`✓ ${label}`);
};

// ── B3：什么都还没有 → 进不去 ──
rep(
  `  const b3 = J(await ev(\`JSON.stringify((()=>{const g=window.__game;
    g.save.licenses = []; g.save.codex = {}; g.save.mapBest = {}; g.save.coins = 999999;
    const ok = g.buyMap('polar');
    const p = g.mapProgress(window.__cfg.mapById('polar'));
    return { ok, cur: g.save.currentMap, coins: g.save.coins, lic: g.save.licenses.length,
      codexOk: p.codexOk, depthOk: p.depthOk, canBuy: p.canBuy };})())\`));
  check('B3 三个条件没满时买不了（图鉴 / 深度都红着），金币一分没扣',
    b3.ok === false && b3.cur === 'calm-bay' && b3.coins === 999999 && b3.lic === 0
    && b3.codexOk === false && b3.depthOk === false && b3.canBuy === false,
    \`图鉴\${b3.codexOk} 深度\${b3.depthOk} 可买\${b3.canBuy}\`);`,
  `  const b3 = J(await ev(\`JSON.stringify((()=>{const g=window.__game;
    g.save.licenses = []; g.save.codex = {}; g.save.mapBest = {}; g.save.coins = 999999;
    // v0.7：门槛 = 海图 + 船。这里两条都没有 → 必须进不去。
    g.save.chart = false; g.save.boats = { owned: [], current: null };
    const ok = g.buyMap('polar');
    const p = g.mapProgress(window.__cfg.mapById('polar'));
    return { ok, cur: g.save.currentMap, coins: g.save.coins, lic: g.save.licenses.length,
      gateOk: p.gateOk, canBuy: p.canBuy, hasChart: p.hasChart, hasBoat: p.hasBoat,
      conds: p.conds.map((c) => c.id + ':' + c.ok) };})())\`));
  check('B3 海图 / 船 都没有时进不去（两条条件都红着），金币一分没扣',
    b3.ok === false && b3.cur === 'calm-bay' && b3.coins === 999999 && b3.lic === 0
    && b3.gateOk === false && b3.canBuy === false
    && b3.hasChart === false && b3.hasBoat === false,
    \`\${b3.conds.join(' / ')} · 金币 \${b3.coins}\`);`,
  'B3 改成"海图+船都没有"',
);

// ── B4：两条都有 → 能进，且换图不再收费 ──
rep(
  `  const b4 = J(await ev(\`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    const polar = cfg.mapById('polar');
    const mine = cfg.SPECIES.filter(s=>s.zones.some(z=>polar.zones.includes(z)));
    const gate = cfg.CODEX_GATE;
    const need = Math.ceil(mine.length * gate.covRatio);
    g.save.codex = {};
    // **恰好达标**（v0.6 新口径）：先保证"每层各钓到一种"（空间维度），
    // 再用其他鱼补满到 >= 90%（数量维度）。验的是"阈值本身"，不是"多给几条一定过"。
    const picked = [];
    for (const z of cfg.zonesOfMap('polar')) {
      const s = mine.find(x => x.zones.includes(z.id) && !picked.includes(x));
      if (s) picked.push(s);
    }
    for (const s of mine) { if (picked.length >= need) break; if (!picked.includes(s)) picked.push(s); }
    picked.forEach(s=>{ g.save.codex[s.id] = {n:1,best:s.value}; });
    g.save.mapBest = { polar: cfg.mapMaxDepth(polar) };
    g.save.coins = 40000;
    const before = g.save.coins;
    const p = g.mapProgress(polar);
    const ok = g.buyMap('polar');
    const after = g.save.coins;
    return { ok, before, after, price: polar.license, cur: g.save.currentMap,
      lic: g.save.licenses.slice(), speciesTotal: mine.length, got: Object.keys(g.save.codex).length,
      need, zoneOk: p.zoneOk, covOk: p.covOk, codexOk: p.codexOk };})())\`));
  check('B4 内容门槛恰好在阈值上（每层都有收获 + 总覆盖 ≥ 90%）+ 换图：扣钱、记 licenses、currentMap 变了',
    b4.ok === true && b4.cur === 'polar' && b4.before - b4.after === b4.price
    && b4.lic.join(',') === 'polar' && b4.zoneOk === true && b4.covOk === true,
    \`图鉴 \${b4.got}/\${b4.speciesTotal}（门槛 \${b4.need}）· 每层\${b4.zoneOk} 覆盖\${b4.covOk} · \${b4.before}→\${b4.after}（价 \${b4.price}）\`);`,
  `  const b4 = J(await ev(\`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    const polar = cfg.mapById('polar');
    g.save.codex = {};
    // v0.7：门槛 = **海图 + 一艘船**（两条都给上 → 必须能进）
    g.save.chart = true;
    g.save.boats = { owned: ['golden'], current: 'golden' };
    g.save.mapBest = { polar: cfg.mapMaxDepth(polar) };
    g.save.coins = 40000;
    const before = g.save.coins;
    const p = g.mapProgress(polar);
    const ok = g.buyMap('polar');
    const after = g.save.coins;
    return { ok, before, after, price: polar.license, cur: g.save.currentMap,
      gateOk: p.gateOk, conds: p.conds.map((c) => c.id + ':' + c.ok) };})())\`));
  check('B4 海图 + 一艘船 = 可以进极地（换图**不再收费**：许可证已改 0）',
    b4.ok === true && b4.cur === 'polar' && b4.price === 0 && b4.before === b4.after
    && b4.gateOk === true,
    \`\${b4.conds.join(' / ')} · \${b4.before}→\${b4.after}（价 \${b4.price}）\`);`,
  'B4 改成"海图+船齐了"',
);

// ── B4b：只差一艘船 → 依然进不去（并还原现场）──
rep(
  `  const b4b = J(await ev(\`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    const polar = cfg.mapById('polar');
    const keep = cfg.CODEX_GATE.covRatio;
    const snap = { coins: g.save.coins, lic: g.save.licenses.slice(), cur: g.save.currentMap };
    cfg.CODEX_GATE.covRatio = 0.5;               // 临时调松，只为了逼出"漏一层但数量够"
    const zones = cfg.zonesOfMap('polar');
    const deepest = zones[zones.length-1].id;
    const mine = cfg.SPECIES.filter(s=>s.zones.some(z=>polar.zones.includes(z)));
    const need = Math.ceil(mine.length * cfg.CODEX_GATE.covRatio);
    g.save.licenses = []; g.save.currentMap = 'calm-bay';
    g.save.codex = {};
    const picked = mine.filter(s => !s.zones.includes(deepest)).slice(0, need);
    picked.forEach(s=>{ g.save.codex[s.id] = {n:1,best:s.value}; });
    g.save.mapBest = { polar: cfg.mapMaxDepth(polar) };
    g.save.coins = 40000;
    const p = g.mapProgress(polar);
    const ok = g.buyMap('polar');
    const out = { ok, got: picked.length, need, zoneGot: p.zoneGot, zoneTotal: p.zoneTotal,
      zoneOk: p.zoneOk, covOk: p.covOk, codexOk: p.codexOk, canBuy: p.canBuy,
      coins: g.save.coins, cur: g.save.currentMap };
    cfg.CODEX_GATE.covRatio = keep;             // 立刻还原口径
    // ⚠ 还要把**现场**还原成 B4 之后的样子：这一段把图切回了宁静海湾，
    //   不还原的话后面所有 B 组断言（刷鱼归属 / 标题 / 线长封顶 / 浮冰）全被带偏。
    //   ⚠ 顺序不能反：先还 licenses，enterMap 才有权限把图切回去。
    g.save.coins = snap.coins; g.save.licenses = snap.lic; g.enterMap(snap.cur);
    out.restored = { cur: g.save.currentMap, lic: g.save.licenses.slice(), coins: g.save.coins };
    return out;})())\`));
  check('B4b 只满足"总覆盖达标"但漏掉整层海域 → 依然买不了（每层都要有收获确实在挡人）',
    b4b.got >= b4b.need && b4b.covOk === true && b4b.zoneOk === false
    && b4b.codexOk === false && b4b.canBuy === false && b4b.ok === false
    && b4b.coins === 40000 && b4b.cur === 'calm-bay'
    && b4b.restored.cur === 'polar',
    \`图鉴 \${b4b.got}/\${b4b.need} 达标 · 海域 \${b4b.zoneGot}/\${b4b.zoneTotal} 层 · 每层\${b4b.zoneOk} 覆盖\${b4b.covOk} 可买\${b4b.canBuy}\`
    + \` · 还原后 \${b4b.restored.cur}（证 \${b4b.restored.lic.join(',')} / \${b4b.restored.coins} 金币）\`);`,
  `  const b4b = J(await ev(\`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    const polar = cfg.mapById('polar');
    const snap = { coins: g.save.coins, lic: g.save.licenses.slice(), cur: g.save.currentMap,
      chart: g.save.chart, boats: g.save.boats };
    // **只有海图、没有船** → 依然进不去（两条必须同时满足）
    g.save.licenses = []; g.save.currentMap = 'calm-bay';
    g.save.chart = true; g.save.boats = { owned: [], current: null };
    g.save.mapBest = { polar: cfg.mapMaxDepth(polar) };
    g.save.coins = 40000;
    const p = g.mapProgress(polar);
    const ok = g.buyMap('polar');
    const out = { ok, hasChart: p.hasChart, hasBoat: p.hasBoat, gateOk: p.gateOk,
      canBuy: p.canBuy, coins: g.save.coins, cur: g.save.currentMap,
      conds: p.conds.map((c) => c.id + ':' + c.ok) };
    // 还原现场（后面所有 B 组断言都要求"人在极地"）
    g.save.coins = snap.coins; g.save.licenses = snap.lic; g.enterMap(snap.cur);
    out.restored = { cur: g.save.currentMap, coins: g.save.coins };
    return out;})())\`));
  check('B4b 只有海图、没船 → 依然进不去（两条条件必须同时满足）',
    b4b.hasChart === true && b4b.hasBoat === false && b4b.gateOk === false
    && b4b.canBuy === false && b4b.ok === false && b4b.coins === 40000
    && b4b.cur === 'calm-bay' && b4b.restored.cur === 'polar',
    \`\${b4b.conds.join(' / ')} · 金币 \${b4b.coins} · 还原后 \${b4b.restored.cur}\`);`,
  'B4b 改成"只差一艘船"',
);

fs.writeFileSync(FILE, t);
console.log(log.join('\n'));
console.log(`\n剩余 CODEX_GATE 引用：${(t.match(/CODEX_GATE/g) || []).length}`);
