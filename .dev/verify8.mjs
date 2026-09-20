/**
 * verify8.mjs — 批 2（第 2 张地图「冰封极地」+ 浮冰 + 鱼群 + 稀有度）的回归验证
 *
 * 覆盖：
 *   A 数值表（纯 Node，不开浏览器）
 *     · MAPS / ZONES 双向一致、每张图 5 层
 *     · 海域雅称不与地图名重名（踩过的坑）
 *     · 分区按地图隔离（两张图的表层都在 0~70m）
 *     · 稀有度概率和 = 1、倍率递增、rollRarity 分布对得上
 *     · MAP_LEVEL_CAP 的每个节点刚好等于该图的深度上限
 *     · 每张图鱼种数 / 每层鱼种数 / 不跨图 / 恰好一个 Boss
 *   B 换图（浏览器）
 *     · 没证不能进、条件不满不能买、条件满了扣钱换图
 *     · 换图后尺子量程 / 水体渐变 / 极光 / 冰柱 / 浮冰 / 刷鱼 全部跟着换
 *     · 换回第一张图时主题全部收起
 *   C 浮冰：只出现在浅层、撞上弹开+减速但不收线、减速倍率实测
 *   D 鱼群：固定种子下真的排出等距斜线，且领头不是扣钱鱼
 *   E 稀有度：固定种子下的分布、倍率、光晕只给那一条
 *   F UI：航线 App / 桌面 4 个 App / 本图最深记录
 *   G 冒烟：在冰封极地跑完整一竿 + 控制台零报错
 *
 * 用法：node .dev/verify8.mjs [url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as C from '../src/config.js';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.VB_PORT || 9364);   // ⚠ 可用 VB_PORT 覆盖：上一次跑被打断时 Chrome 会占着端口，新一轮会"连到旧现场"
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-v8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  · ' + detail : ''}`);
}

// ═══════════════════════════════════════════════════════════
// A 组 — 数据表（纯 Node）
// ═══════════════════════════════════════════════════════════
console.log('\n── A 地图 / 分区 / 稀有度 数据表 ──');

const { MAPS, ZONES, SPECIES, RARITY, SCHOOL, ICEBERG, MAP_LEVEL_CAP, LEVELS,
  mapById, mapMaxDepth, zonesOfMap, zoneAtDepth, mapOfSpecies, rollRarity, valueOf,
  levelCapForMap, DEFAULT_MAP } = C;

const zoneById = new Map(ZONES.map((z) => [z.id, z]));
const mapIds = new Set(MAPS.map((m) => m.id));

check('A1 MAPS 至少 2 张、字段齐全、每张图 5 层海域',
  MAPS.length >= 2 && MAPS.every((m) => m.id && m.name && m.en && m.desc
    && Array.isArray(m.zones) && m.zones.length === 5
    && m.zones.every((z) => zoneById.has(z))),
  MAPS.map((m) => `${m.name}(${m.zones.length}层)`).join(' · '));

check('A2 海域雅称 nick 不与任何地图名重名（踩过的坑：图鉴会显示"宁静海湾 · 宁静海湾"）',
  ZONES.every((z) => z.nick && !MAPS.some((m) => m.name === z.nick)),
  ZONES.filter((z) => MAPS.some((m) => m.name === z.nick)).map((z) => z.id).join(',') || '无重名');

check('A3 MAPS.zones ↔ ZONES.map 双向一致（改一边漏一边 = 有海域永远刷不到鱼）',
  MAPS.every((m) => m.zones.every((z) => zoneById.get(z).map === m.id))
  && ZONES.every((z) => mapIds.has(z.map) && mapById(z.map).zones.includes(z.id)),
  `${ZONES.length} 个海域 · ${MAPS.length} 张图`);

// 两张图的表层都是 0~70m 附近，不按地图隔离的话在极地 -30m 会返回「阳光浅滩」
check('A4 zoneAtDepth 按地图隔离（同一深度在两张图返回不同海域）',
  zoneAtDepth(-30, 'calm-bay').id === 'sunlit' && zoneAtDepth(-30, 'polar').id === 'ice-shelf'
  // ⚠ v0.2 挖深之后两张图的海沟不再重叠，取 −700m：宁静海湾是海沟、极地是深渊
  && zoneAtDepth(-700, 'polar').id === 'ice-abyss' && zoneAtDepth(-700, 'calm-bay').id === 'trench',
  `−30m：${zoneAtDepth(-30, 'calm-bay').nick} / ${zoneAtDepth(-30, 'polar').nick}`);

// B4：`mapId` 没有默认值 —— 忘传 / 传脏 id 必须**立刻抛错**，
// 而不是静默退回第一张图（那会变成"极地的 30m 查到阳光浅滩"，不报错、不闪退）。
// ⚠ 这条断言在旧实现（`mapId = DEFAULT_MAP.id`）下必挂 —— 它就是这个 bug 的验收。
const throwOf = (fn) => { try { fn(); return null; } catch (e) { return String((e && e.message) || e); } };
const eNoMap = throwOf(() => zoneAtDepth(-30));
const eBadMap = throwOf(() => zoneAtDepth(-30, 'no-such-map'));
check('A4b zoneAtDepth 的 mapId 是必传的：不传 / 传脏 id 都显式抛错（B4）',
  !!eNoMap && !!eBadMap && /zoneAtDepth/.test(eNoMap) && /zoneAtDepth/.test(eBadMap),
  `不传 → ${eNoMap ? '抛错' : '⚠ 静默返回了 ' + zoneAtDepth(-30).nick} · 脏 id → ${eBadMap ? '抛错' : '⚠ 静默返回了'}`);

const rSum = RARITY.reduce((a, r) => a + r.p, 0);
check('A5 稀有度概率和 = 1、倍率严格递增、非普通档都有描边色',
  Math.abs(rSum - 1) < 1e-9
  && RARITY.every((r, i) => i === 0 || r.mul > RARITY[i - 1].mul)
  && RARITY[0].rim === null && RARITY.slice(1).every((r) => r.rim != null),
  `Σp=${rSum} · ${RARITY.map((r) => `${r.name}×${r.mul}`).join(' ')}`);

// 固定种子 —— 真随机采样会让同一条断言跑出不同结果（"测试在掷骰子"）
let seed = 20260918;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const N = 200000;
const hit = Object.fromEntries(RARITY.map((r) => [r.id, 0]));
for (let i = 0; i < N; i++) hit[rollRarity(rnd).id]++;
const worst = Math.max(...RARITY.map((r) => Math.abs(hit[r.id] / N - r.p)));
check('A6 rollRarity 的实测分布对得上 p（固定种子 20 万次，最大偏差 < 1.2%）',
  worst < 0.012,
  RARITY.map((r) => `${r.name} ${(hit[r.id] / N * 100).toFixed(2)}%/${(r.p * 100).toFixed(1)}%`).join(' · '));

check('A7 valueOf = 基础身价 × 稀有度倍率（不要再在别处乘一遍）',
  valueOf({ value: 100 }, RARITY[0]) === 100
  && valueOf({ value: 100 }, RARITY.find((r) => r.id === 'gold')) === 600
  && valueOf({ value: 7 }, undefined) === 7,
  `100 普通→${valueOf({ value: 100 }, RARITY[0])} 金色→${valueOf({ value: 100 }, RARITY.find((r) => r.id === 'gold'))}`);

// 闸门节点必须"刚好够到本图上限"：不够 → 买满也潜不到底；太多 → 换图没有信号
const capBad = MAPS.filter((m, i) => {
  const cap = levelCapForMap(i);
  const at = LEVELS.maxDepth[cap];
  const prev = cap > 0 ? LEVELS.maxDepth[cap - 1] : 0;
  const maxD = mapMaxDepth(m);
  return !(at >= maxD && prev < maxD);
});
// ⚠ MAP_LEVEL_CAP 是**预留给 5 张图**的表，长度 ≥ MAPS.length 就行 ——
//   写成 === 会在"还没做完第 3 张图"时误报。
check('A8 每张图的等级闸门刚好够到本图上限（cap 处 maxDepth ≥ 上限，cap−1 处 < 上限）',
  capBad.length === 0 && MAP_LEVEL_CAP.length >= MAPS.length,
  MAPS.map((m, i) => `${m.name} Lv${levelCapForMap(i)}→${LEVELS.maxDepth[levelCapForMap(i)]}m/${mapMaxDepth(m)}m`).join(' · '));

check('A9 地图深度上限 = 它最深那个海域的底（860 / 1240）',
  mapMaxDepth(mapById('calm-bay')) === 860 && mapMaxDepth(mapById('polar')) === 1240,
  `宁静海湾 ${mapMaxDepth(mapById('calm-bay'))}m · 冰封极地 ${mapMaxDepth(mapById('polar'))}m`);

const zoneCount = (z) => SPECIES.filter((s) => s.zones.includes(z.id)).length;
const thinZones = ZONES.filter((z) => zoneCount(z) < 2);
check('A10 每个海域至少 2 种鱼、每张图至少 18 种（否则那一层会出现"只有一种鱼"）',
  thinZones.length === 0
  && MAPS.every((m) => SPECIES.filter((s) => s.zones.some((z) => m.zones.includes(z))).length >= 18),
  `每层最少 ${Math.min(...ZONES.map(zoneCount))} 种 · ` +
  MAPS.map((m) => `${m.name} ${SPECIES.filter((s) => s.zones.some((z) => m.zones.includes(z))).length} 种`).join(' · '));

const crossMap = SPECIES.filter((s) => new Set(s.zones.map((z) => zoneById.get(z).map)).size > 1);
check('A11 没有跨地图的鱼种（zones 必须全在同一张图里）',
  crossMap.length === 0, crossMap.map((s) => s.id).join(',') || '全部单图');

const bossBad = MAPS.filter((m) => {
  const mine = SPECIES.filter((s) => s.zones.some((z) => m.zones.includes(z)));
  // ⚠ 终章 Boss（`final: true`）**单独算** —— 它和本图的常规 Boss 共存是设计，
  //   两者靠**触发深度**分层（终章更深），不会在同一竿里同时出现。
  const bosses = mine.filter((s) => s.boss && !s.final);
  const finals = mine.filter((s) => s.boss && s.final);
  // Boss 必须 elite:false —— 它本身已经是"稀有"，再叠金色描边会让"金色"这个信号贬值
  return bosses.length !== 1 || bosses[0].elite !== false || finals.length > 1;
});
check('A12 每张图恰好一个**常规** Boss（终章另算），且 Boss 不参与稀有度抽签（elite === false）',
  bossBad.length === 0,
  MAPS.map((m) => {
    const b = SPECIES.filter((s) => s.zones.some((z) => m.zones.includes(z)) && s.boss && !s.final)[0];
    const fin = SPECIES.filter((s) => s.zones.some((z) => m.zones.includes(z)) && s.final)[0];
    return `${m.name}:${b ? b.name : '无'}${fin ? ' + 终章' + fin.name : ''}`;
  }).join(' · '));

// 越深越值钱：每层的最高身价必须高于上一层，否则"往下走"没有回报
const depthBad = [];
for (const m of MAPS) {
  const zs = zonesOfMap(m.id);
  let prevMax = 0;
  for (const z of zs) {
    const pool = SPECIES.filter((s) => s.zones.includes(z.id) && !s.hazard);
    if (!pool.length) { depthBad.push(`${m.id}/${z.id}:空`); continue; }
    const mx = Math.max(...pool.map((s) => s.value));
    if (mx <= prevMax) depthBad.push(`${m.id}/${z.id}:${mx}≤${prevMax}`);
    prevMax = Math.max(prevMax, mx);
  }
}
check('A13 每张图"越深越值钱"（每层最贵的身价严格高于上一层）',
  depthBad.length === 0, depthBad.join(',') || `${MAPS.map((m) => zonesOfMap(m.id).map((z) => Math.max(...SPECIES.filter((s) => s.zones.includes(z.id) && !s.hazard).map((s) => s.value))).join('<')).join(' | ')}`);

const pairOk = (p) => Array.isArray(p) && p.length === 2 && p[0] < p[1];
check('A14 鱼群 / 浮冰的参数自洽（区间下界 < 上界、减速在 (0,1)、概率在 (0,1)）',
  pairOk(SCHOOL.count) && pairOk(SCHOOL.gap) && pairOk(SCHOOL.extras)
  && pairOk(ICEBERG.count) && pairOk(ICEBERG.radius) && pairOk(ICEBERG.drift)
  && SCHOOL.chance > 0 && SCHOOL.chance < 1
  && ICEBERG.slowScale > 0 && ICEBERG.slowScale < 1 && ICEBERG.depth > 0,
  `SCHOOL ${SCHOOL.count} ×${SCHOOL.chance} · 浮冰 ${ICEBERG.count} 深度 ${ICEBERG.depth}m 减速 ×${ICEBERG.slowScale}`);

// ═══════════════════════════════════════════════════════════
// 浏览器部分
// ═══════════════════════════════════════════════════════════
async function getTarget(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const p = list.find((t) => t.type === 'page');
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch (_) { /* 还没起来 */ }
    await sleep(300);
  }
  throw new Error('Chrome CDP 未就绪（静态服务器没开？先跑 python -m http.server 8899）');
}

const profile = path.resolve('.dev/profile-v8-' + Date.now());
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  '--no-proxy-server', '--proxy-bypass-list=*',
  '--disable-extensions', '--mute-audio',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=430,932', '--hide-scrollbars',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

try {
  const ws = new WebSocket(await getTarget(PORT));
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let msgId = 0;
  const pending = new Map();
  const errors = [];

  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push('EXCEPTION: ' + (d.exception?.description || d.text).split('\n')[0]);
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      const t = m.params.entry.text || '';
      if (!/favicon|AudioContext|autoplay/i.test(t)) errors.push('LOG ERROR: ' + t);
    }
  };

  const send = (method, params = {}) => new Promise((res) => {
    const id = ++msgId; pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) {
      return { __err: (r.result.exceptionDetails.exception?.description || '').split('\n').slice(0, 2).join(' | ') };
    }
    return r.result?.result?.value;
  };
  const J = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (_) { return { __bad: v }; } };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
  };
  const rafWait = (ms) => ev(`new Promise((res)=>{const t0=performance.now();
    const tick=()=>{ if(performance.now()-t0>=${ms}) res('ok'); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);})`);

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3400);

  const boot = J(await ev('JSON.stringify({game: !!window.__game, state: window.__game && window.__game.state})'));
  if (!boot.game) throw new Error('游戏没起来：' + JSON.stringify(boot));

  await ev(`(()=>{const g=window.__game; g._loop = () => {};
    window.step = (n) => { const dt0 = 1/60;
      for (let i=0;i<n;i++){
        if (g.slowmoT > 0) { g.slowmoT -= dt0; if (g.slowmoT <= 0) g.timeScale = 1; }
        const dt = dt0 * g.timeScale; g.time += dt; g._update(dt);
      }
      g.world.render(); return 'ok';
    };
    // 固定种子 LCG —— 分布类断言必须可复现，见 A6 的注释
    window.__seed = 20260918;
    window.__seedRand = () => { window.__seed = (window.__seed * 1103515245 + 12345) & 0x7fffffff;
      return window.__seed / 0x7fffffff; };
    window.__realRandom = Math.random;
    return 'ok';})()`);
  await ev('document.getElementById("startBtn").click()');
  await ev('window.step(10)');
  await ev(`(async()=>{ window.__cfg = await import('./src/config.js'); return 'ok'; })()`);

  // ═════════════════════════════════════════════════════════
  console.log('\n── B 换图 ──');
  // ═════════════════════════════════════════════════════════
  const b0 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    return { cur: g.save.currentMap, worldMap: g.world.map && g.world.map.id,
      uiTotal: g.ui._rulerTotal, bands: document.querySelectorAll('#ruler .band').length,
      aurora: g.world.auroraRoot.visible, ice: g.world.iceRoot.visible,
      berg: g.world.icebergRoot.visible };})())`));
  check('B1 开局在宁静海湾：存档 / 世界 / 尺子三处一致，极地主题全部关闭',
    b0.cur === 'calm-bay' && b0.worldMap === 'calm-bay' && b0.uiTotal === 860 && b0.bands === 5
    && b0.aurora === false && b0.ice === false && b0.berg === false,
    `尺子 ${b0.uiTotal}m/${b0.bands} 层 · 极光${b0.aurora} 冰柱${b0.ice} 浮冰${b0.berg}`);

  const b2 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    g.save.licenses = []; g.save.coins = 999999;
    const ok = g.enterMap('polar');
    return { ok, cur: g.save.currentMap, coins: g.save.coins };})())`));
  check('B2 门槛没过时连 enterMap 都进不去（返回 false 且存档不变）',
    b2.ok === false && b2.cur === 'calm-bay', `ok=${b2.ok} cur=${b2.cur}`);

  const b3 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    g.save.licenses = []; g.save.codex = {}; g.save.mapBest = {}; g.save.coins = 999999;
    // v0.7：门槛 = 海图 + 船。这里两条都没有 → 必须进不去。
    g.save.charts = {}; g.save.boats = { owned: [], current: null };
    const ok = g.buyMap('polar');
    const p = g.mapProgress(window.__cfg.mapById('polar'));
    return { ok, cur: g.save.currentMap, coins: g.save.coins, lic: g.save.licenses.length,
      gateOk: p.gateOk, canBuy: p.canBuy, hasChart: p.hasChart, hasBoat: p.hasBoat,
      conds: p.conds.map((c) => c.id + ':' + c.ok) };})())`));
  check('B3 海图 / 船 都没有时进不去（两条条件都红着），金币一分没扣',
    b3.ok === false && b3.cur === 'calm-bay' && b3.coins === 999999 && b3.lic === 0
    && b3.gateOk === false && b3.canBuy === false
    && b3.hasChart === false && b3.hasBoat === false,
    `${b3.conds.join(' / ')} · 金币 ${b3.coins}`);

  const b4 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    const polar = cfg.mapById('polar');
    g.save.codex = {};
    // v0.7：门槛 = **海图 + 一艘船**（两条都给上 → 必须能进）
    g.save.charts = { polar: true };
    g.save.boats = { owned: ['golden'], current: 'golden' };
    g.save.mapBest = { polar: cfg.mapMaxDepth(polar) };
    g.save.coins = 40000;
    const before = g.save.coins;
    const p = g.mapProgress(polar);
    const ok = g.buyMap('polar');
    const after = g.save.coins;
    return { ok, before, after, price: polar.license, cur: g.save.currentMap,
      gateOk: p.gateOk, conds: p.conds.map((c) => c.id + ':' + c.ok) };})())`));
  check('B4 海图 + 一艘船 = 可以进极地（换图**不再收费**：许可证已改 0）',
    b4.ok === true && b4.cur === 'polar' && b4.price === 0 && b4.before === b4.after
    && b4.gateOk === true,
    `${b4.conds.join(' / ')} · ${b4.before}→${b4.after}（价 ${b4.price}）`);

  // ── 新口径的**空间维度**那一半（everyZone）必须有人守 ──
  // （历史）旧门槛靠"每层都有收获 + 覆盖 90%"，v0.7 已整条移除，换成"海图 + 船"：
  // 口径退回成"纯收集比例"，全套回归依然是绿的。
  //
  // ⚠ 为什么要把 covRatio 临时压到 0.5 才测：在**当前两张图**里，
  //   "漏掉任何一层"都会让覆盖率掉到 90% 以下（每层 2~6 种鱼，丢掉一层就丢 11%~33%），
  //   也就是说 `everyZone` 现在被 covRatio 顺带保证了 —— 想验这一条分支真的在起作用，
  //   必须先把比例门槛调松，让"漏一层但数量够"这种局面**可能**出现。
  //   （这个"冗余"本身也值得记：它是自带保险，不是多余代码 —— 一旦有人把 covRatio 调低，
  //     everyZone 就是唯一还挡着"只刷浅层"的东西。）
  const b4b = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    const polar = cfg.mapById('polar');
    const snap = { coins: g.save.coins, lic: g.save.licenses.slice(), cur: g.save.currentMap,
      charts: g.save.charts, boats: g.save.boats };
    // **只有海图、没有船** → 依然进不去（两条必须同时满足）
    g.save.licenses = []; g.save.currentMap = 'calm-bay';
    g.save.charts = { polar: true }; g.save.boats = { owned: [], current: null };
    g.save.mapBest = { polar: cfg.mapMaxDepth(polar) };
    g.save.coins = 40000;
    const p = g.mapProgress(polar);
    const ok = g.buyMap('polar');
    const out = { ok, hasChart: p.hasChart, hasBoat: p.hasBoat, gateOk: p.gateOk,
      canBuy: p.canBuy, coins: g.save.coins, cur: g.save.currentMap,
      conds: p.conds.map((c) => c.id + ':' + c.ok) };
    // 还原现场（后面所有 B 组断言都要求"人在极地"）
    // ⚠ chart / boats 也要还回去 —— 它们现在是门槛本身，不还的话 enterMap 会被拦下，
    //   后面五条 B 组断言全部跑到"宁静海湾"上去了。
    g.save.charts = snap.charts; g.save.boats = snap.boats;
    g.save.coins = snap.coins; g.save.licenses = snap.lic; g.enterMap(snap.cur);
    out.restored = { cur: g.save.currentMap, coins: g.save.coins };
    return out;})())`));
  check('B4b 只有海图、没船 → 依然进不去（两条条件必须同时满足）',
    b4b.hasChart === true && b4b.hasBoat === false && b4b.gateOk === false
    && b4b.canBuy === false && b4b.ok === false && b4b.coins === 40000
    && b4b.cur === 'calm-bay' && b4b.restored.cur === 'polar',
    `${b4b.conds.join(' / ')} · 金币 ${b4b.coins} · 还原后 ${b4b.restored.cur}`);

  // ── B13 宝箱 → 海图 → 船厂解锁（v0.7 第二批）────────────────
  // 这一段是"换图门槛"的前半条：海沟底部的宝箱**碰到即得**海图，
  // 并且如果船厂还没被介绍过，**直接解锁**（需求原话："若是玩家没有解锁船厂 App
  // 则直接给玩家解锁，并去掉船厂 NPC 引导"）。
  const chartGot = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    g.save.charts = {}; g.save.boatApp = false;
    g.save.boats = { owned: [], current: null };
    g.save.licenses = []; g.enterMap('calm-bay');
    const at = g.world.chestAt;
    const before = { seabed: g.world.seabedRoot.visible, chest: g.world.chest.visible,
      chart: !!g.save.charts.polar, boatApp: g.save.boatApp,
      depth: at ? Math.round(at.y) : null, x: at ? Math.round(at.x) : null };
    const coins0 = g.save.coins;
    // 出图：把镜头挪到海底看宝箱（不然截图里只有水面）
    g.enterDescend();
    g.hook.setPosition(at.x, at.y); g.hook.x = at.x; g.hook.y = at.y;
    for (let i = 0; i < 6; i++) window.step(1);
    // 把钩子放到宝箱上，走一次碰撞检查
    g.hook.setPosition(at.x, at.y); g.hook.x = at.x; g.hook.y = at.y;
    g._checkChest(at.x, at.y);
    // 换到极地看看海床：⚠ v0.8（批 4）起极地**也有**海床了 ——
    //   它底下那只箱子装的是**熔岩海图**（第 3 张图的门槛），不再是"极地没有海床"。
    // ⚠ 必须先给一艘船：enterMap 也要过门槛，不然这一步会被拦下，
    //   后面的判定就变成了假通过（其实人还在首图）。
    g.save.boats = { owned: ['golden'], current: 'golden' };
    g.enterMap('polar');
    const inIce = g.world.seabedRoot.visible;
    const inIceChest = g.world.chest.visible;
    const inIceDepth = g.world.chestAt ? Math.round(g.world.chestAt.y) : null;
    g.enterMap('calm-bay');
    // ⚠ 出图时把镜头开到了海底，这里必须**带回水面** —— 后面 B5+ 全部要看"待机视野"
    //   （不还原的话 B7b 的极光断言会以海底视野去判断，报"0 条相交"）。
    g.showIdle();
    for (let i = 0; i < 90; i++) window.step(1);
    return { before, inIce, inIceChest, inIceDepth, backSeabed: g.world.seabedRoot.visible,
      chart: !!g.save.charts.polar, boatApp: g.save.boatApp, chest: g.world.chest.visible,
      coins: g.save.coins - coins0 };})())`));
  await shot('B13-chart-call');   // 拍的是「钓到海图后老陈来电」的现场（相机已回水面）
  check('B13 首图海床上的宝箱：碰到即得海图 + 直接解锁船厂 + 宝箱收起；极地那只箱子还在（熔岩海图）',
    chartGot.before.seabed === true && chartGot.before.chest === true
    && chartGot.before.chart === false && chartGot.before.boatApp === false
    && chartGot.before.depth <= -860
    && chartGot.chart === true && chartGot.boatApp === true && chartGot.chest === false
    && chartGot.coins > 0
    && chartGot.inIce === true && chartGot.inIceChest === true && chartGot.inIceDepth <= -1240
    && chartGot.backSeabed === true,
    `宝箱在 ${chartGot.before.x}, ${chartGot.before.depth}m · 海图${chartGot.before.chart}→${chartGot.chart}`
    + ` · 船厂${chartGot.before.boatApp}→${chartGot.boatApp} · 开箱+${chartGot.coins}`
    + ` · 海床：首图${chartGot.before.seabed}／极地${chartGot.inIce}(箱${chartGot.inIceChest}@${chartGot.inIceDepth}m)／回来${chartGot.backSeabed}`);

  // ── B14 船厂：三条船同价、效果各一、买船才进得了极地（v0.7）──
  const boatRes = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    const prices = cfg.BOATS.map(b=>b.price);
    const kinds = cfg.BOATS.map(b=>b.effect.kind);
    g.save.boats = { owned: [], current: null };
    g.save.charts = { polar: true }; g.save.coins = 100000;
    // ① 没船 → 进不去
    g.save.currentMap = 'calm-bay';
    const noBoat = g.buyMap('polar');
    // ② 买一艘仓储号（鱼护 +12）
    const creelBefore = g.creelLimit;
    const bought = g.buyBoat('cargo');
    const creelAfter = g.creelLimit;
    const COINS_START = 100000;
    // ③ 再买装甲号（护钩 1 次）→ 鱼护回到基础值（不叠加！）
    const raw = g.buyBoat('armor');
    const guard = g.hookGuardMax;
    const creelArmor = g.creelLimit;
    // ④ 再买黄金号（金币 ×1.25）—— 换船本身免费，但新船要买
    const swapBack = g.setBoat('cargo');     // 免费换回已拥有的船
    g.buyBoat('golden');
    const goldMul = g.boatGoldMul;
    // ⑤ 有船之后能进极地
    const okNow = g.buyMap('polar');
    const cur = g.save.currentMap;      // ⚠ 后面的 B5+ 都要求"人在极地"，所以不再切回海湾
    return { prices, kinds, noBoat, bought, raw, creelBefore, creelAfter, creelArmor,
      guard, goldMul, okNow, cur, swapBack, spend: COINS_START - g.save.coins,
      owned: g.save.boats.owned.slice(), boatApp: g.save.boatApp };})())`));
  check('B14 船厂：三条船同价 10,000、各带一种效果；没船进不了极地、买了任意一艘就能进',
    boatRes.prices.join(',') === '10000,10000,10000'
    && boatRes.kinds.join(',') === 'gold,creel,guard'
    && boatRes.noBoat === false && boatRes.bought === true && boatRes.raw === true
    && boatRes.swapBack === true && boatRes.spend === 30000
    && boatRes.creelAfter === boatRes.creelBefore + 12
    && boatRes.creelArmor === boatRes.creelBefore
    && boatRes.guard === 1 && boatRes.goldMul === 1.25
    && boatRes.okNow === true && boatRes.cur === 'polar' && boatRes.boatApp === true,
    `船价 ${boatRes.prices.join('/')} · 效果 ${boatRes.kinds.join('/')} · 无船进极地=${boatRes.noBoat}`
    + ` · 花 ${boatRes.spend} · 鱼护 ${boatRes.creelBefore}→${boatRes.creelAfter}（换船后 ${boatRes.creelArmor}）`
    + ` · 护钩 ${boatRes.guard} · 金币倍率 ${boatRes.goldMul} · 有船后进极地=${boatRes.okNow}`);

  // 出图：船厂 App（三条船 + 已拥有一艘）—— 这是"三条船长什么样"的唯一人工复核入口
  await ev(`(()=>{const g=window.__game; g.showIdle(); g.openPhone(); g.ui.openApp('boat'); return 'ok';})()`);
  await rafWait(400);
  await shot('B14-boat-shop');
  await ev(`(()=>{const g=window.__game; g.closePhone(); g.enterMap('polar'); return 'ok';})()`);
  await rafWait(200);

  await rafWait(400);
  const b5 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    const bands = [...document.querySelectorAll('#ruler .band span')].map(e=>e.textContent);
    return { uiTotal: g.ui._rulerTotal, uiMap: g.ui._map.id, bands: bands.length,
      bandTxt: bands, markerTop: document.querySelector('#ruler .marker').style.top };})())`));
  check('B5 换图后深度尺换成极地量程（1240m / 5 层，色带全是极地的）',
    b5.uiTotal === 1240 && b5.uiMap === 'polar' && b5.bands === 5
    // 尺子上的分区标签是「分区名 + 该层顶部深度（正数）」，如「中层 140m」
    && b5.bandTxt.join(',') === '表层0m,中层140m,深层340m,深渊600m,海沟920m',
    `${b5.uiTotal}m · ${b5.bandTxt.join(' / ')}`);

  const b6 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    const tex = g.world.bg.material.map;
    return { hasMap: !!tex, imgW: tex && tex.image && tex.image.width,
      canvas: tex && tex.image && tex.image.getContext ? 1 : 0,
      // 采样贴图底部（海沟）和顶部（天空）的实际像素，确认真的换了配色
      px: (()=>{ if(!tex||!tex.image||!tex.image.getContext) return null;
        const c = tex.image.getContext('2d');
        const g2 = (y)=>{ const d=c.getImageData(4, y, 1, 1).data; return [d[0],d[1],d[2]].join(','); };
        return { bottom: g2(1020), top: g2(4) }; })() };})())`));
  check('B6 换图后水体渐变贴图被重画（极地的冰蓝 → 墨蓝）',
    b6.hasMap && b6.canvas === 1 && b6.px && b6.px.top !== b6.px.bottom,
    `顶部 rgb(${b6.px && b6.px.top}) 底部 rgb(${b6.px && b6.px.bottom})`);

  const b7 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    return { aurora: g.world.auroraRoot.visible, ribbons: g.world.aurora.length,
      ice: g.world.iceRoot.visible, ceiling: g.world.iceCeiling.visible,
      iceSide: g.world.iceSide.length,
      berg: g.world.icebergRoot.visible, bergs: g.world.icebergs.length,
      snowBoost: g.world.snowBoost };})())`));
  check('B7 极地主题全开：极光光帘 + 冰柱 + 头顶冰凌 + 浮冰 + 海雪加成',
    b7.aurora === true && b7.ribbons >= 3 && b7.ice === true && b7.ceiling === true
    && b7.iceSide >= 10 && b7.berg === true && b7.bergs >= ICEBERG.count[0]
    && b7.snowBoost > 1,
    `极光 ${b7.ribbons} 条 · 冰柱 ${b7.iceSide} 根 · 浮冰 ${b7.bergs} 块 · 海雪 ×${b7.snowBoost}`);

  // ⚠ 只断言 auroraRoot.visible === true 是**假验收**：
  //   光帘建出来了、visible 也是 true，但整条挂在画面上方
  //   （原来 y=[300,740]，而待机视野只有 [−40,120]），玩家抬头看到的还是一片黑天。
  //   这里量的是"光帘有没有落进待机视野"，也就是"抬头能不能看见"。
  //   判据用"与视野**矩形**相交"而不是"中心点在视野内" —— 光帘高 120~230，
  //   用中心点量的话底边贴水面的那条也会被判成不可见，尺子本身是错的。
  //   横向同理：待机 viewW 只有 ~95（可见 ±47.5），撒到 ±122 会有整条在画面外。
  const b7b = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    g.showIdle(); window.step(3);
    const vr = g.world.viewRange();
    const rows = g.world.aurora.map(r=>({ b: r.position.y - r.scale.y/2, t: r.position.y + r.scale.y/2,
      l: r.position.x - r.scale.x/2, r: r.position.x + r.scale.x/2 }));
    return { top: Math.round(vr.top), bottom: Math.round(vr.bottom),
      left: Math.round(vr.left), right: Math.round(vr.right), n: rows.length,
      inView: rows.filter(o=> o.b < vr.top && o.t > vr.bottom && o.l < vr.right && o.r > vr.left).length,
      lowBottom: Math.round(Math.min(...rows.map(o=>o.b))) };})())`));
  check('B7b 极光光帘真的落进待机视野，且底边在水面之上（不是挂在天上或从水里长出来）',
    b7b.inView >= 3 && b7b.lowBottom < b7b.top && b7b.lowBottom >= 0,
    `${b7b.inView}/${b7b.n} 条与视野矩形相交 · 底边最低 ${b7b.lowBottom}，`
    + `视野 y[${b7b.bottom}, ${b7b.top}] x[${b7b.left}, ${b7b.right}]`);

  const b8 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.showIdle();
    const polarZones = cfg.mapById('polar').zones;
    const active = g.fish.active.filter(f=>f.state==='swim');
    const alien = active.filter(f=>!f.def.zones.some(z=>polarZones.includes(z)));
    const deepest = Math.min(...active.map(f=>f.y));
    return { n: active.length, alien: alien.map(f=>f.def.name).slice(0,4),
      minY: Math.round(deepest), maxY: Math.round(Math.max(...active.map(f=>f.y))),
      title: document.getElementById('seaName').textContent };})())`));
  check('B8 换图后刷出来的鱼全部属于极地（一条海湾鱼都不能混进来）',
    b8.n > 0 && b8.alien.length === 0,
    `${b8.n} 条 · 外来 ${JSON.stringify(b8.alien)} · 深度 ${b8.maxY}~${b8.minY}m`);
  check('B9 主界面大标题换成「冰封极地」', b8.title === '冰封极地', b8.title);
  await shot('B1-polar-idle');

  const b10 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    g.enterMap('calm-bay');
    return { cur: g.save.currentMap, uiTotal: g.ui._rulerTotal,
      aurora: g.world.auroraRoot.visible, ice: g.world.iceRoot.visible,
      berg: g.world.icebergRoot.visible, bergs: g.world.icebergs.length,
      title: document.getElementById('seaName').textContent };})())`));
  check('B10 换回宁静海湾：主题整组收起、尺子量程回 860m、浮冰清空',
    b10.cur === 'calm-bay' && b10.uiTotal === 860 && b10.aurora === false
    && b10.ice === false && b10.berg === false && b10.bergs === 0 && b10.title === '宁静海湾',
    `${b10.uiTotal}m · 极光${b10.aurora} 冰柱${b10.ice} 浮冰${b10.berg}(${b10.bergs})`);

  // ⚠ 商店的等级闸门（levelCapForMap）只挡"在这张图能升到几级"，
  //   挡不住"带着在别处升的长线跨图过来"。
  //   在极地升到 Lv9（620m）再回宁静海湾（只有 430m 深），不封顶就能潜到 620m ——
  //   海底早过了、画面里只剩虚空，而且 HUD 的数字和尺子的量程对不上
  //   （出图时实测撞见过「≈93 / 740m」配 620m 的尺子）。
  const b11 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    const raw = cfg.TUNING.maxDepth(20);                       // 未封顶的线长（Lv20）
    g.save.levels.line = 20; g.applyUpgrades();
    const bay = { max: g.maxDepth, cap: cfg.mapMaxDepth(cfg.mapById('calm-bay')), ruler: g.ui._rulerTotal };
    g.enterMap('polar');
    const polar = { max: g.maxDepth, cap: cfg.mapMaxDepth(cfg.mapById('polar')), ruler: g.ui._rulerTotal };
    g.enterMap('calm-bay'); g.applyUpgrades();
    return { raw, bay, polar, back: g.maxDepth, cur: g.save.currentMap };})())`));
  check('B11 线长按当前地图的深度封顶（带着满级线跨图也潜不过海底）',
    b11.raw > b11.bay.cap && b11.bay.max === b11.bay.cap && b11.polar.max === b11.polar.cap
    && b11.bay.ruler === b11.bay.cap && b11.polar.ruler === b11.polar.cap && b11.back === b11.bay.cap,
    `Lv20 线长 ${b11.raw}m → 海湾 ${b11.bay.max}/${b11.bay.cap}m · 极地 ${b11.polar.max}/${b11.polar.cap}m`);

  // ═════════════════════════════════════════════════════════
  console.log('\n── C 浮冰 ──');
  // ═════════════════════════════════════════════════════════
  await ev(`(()=>{const g=window.__game; g.enterMap('polar');
    g.save.levels.line = 9; g.applyUpgrades(); return 'ok';})()`);

  const c1 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    const ys = g.world.icebergs.map(b=>-b.mesh.position.y);
    return { n: ys.length, min: Math.round(Math.min(...ys)), max: Math.round(Math.max(...ys)),
      depth: window.__cfg.ICEBERG.depth,
      rs: g.world.icebergs.map(b=>Math.round(b.r)) };})())`));
  check('C1 浮冰只出现在浅层（0 ~ ICEBERG.depth），不会跟着潜到深海',
    c1.n >= ICEBERG.count[0] && c1.min >= 0 && c1.max <= c1.depth + 1,
    `${c1.n} 块 · 深度 ${c1.min}~${c1.max}m（上限 ${c1.depth}m）· 半径 ${Math.min(...c1.rs)}~${Math.max(...c1.rs)}`);

  const c2 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    g.showIdle(); g.enterDescend();
    g.castAir = false; g.castT = 0;
    const b = g.world.icebergs[0]; b.hitT = 0;
    g.hook.x = b.mesh.position.x; g.targetX = g.hook.x;
    g.hook.y = b.mesh.position.y; g.hook.setPosition(g.hook.x, g.hook.y);
    g.iceSlowT = 0;
    const x0 = g.hook.x, y0 = g.hook.y;
    window.step(1);
    const out = { x0, y0, x1: g.hook.x, y1: g.hook.y, slow: g.iceSlowT,
      state: g.state, target: g.targetX, hitT: b.hitT, cap: g.world.icebergs.length };
    g.showIdle();
    return out;})())`));
  check('C2 撞上浮冰：横向弹开 + 往上顶 + 开始减速，但**不收线**（这一竿继续）',
    c2.slow > 0 && c2.state === 'descend' && Math.abs(c2.x1 - c2.x0) > 5
    && c2.y1 > c2.y0 && Math.abs(c2.target - c2.x1) < 0.01 && c2.hitT > 0,
    `x ${c2.x0.toFixed(1)}→${c2.x1.toFixed(1)} · y ${c2.y0.toFixed(1)}→${c2.y1.toFixed(1)} · 减速 ${c2.slow.toFixed(2)}s · state=${c2.state}`);

  const c3 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    g.showIdle(); g.enterDescend();
    g.castAir = false; g.castT = 0;
    const keep = g.world.icebergs;
    const keepFish = g.fish.active.slice();
    // ⚠ 场上的鱼必须清掉：把鱼钩瞬移到 (0,-300) 时很可能正好压在一条鱼身上，
    //   撞鱼 → _reel('bump') → 上拉预备 → 转 ascend，量出来的"下潜位移"是负的。
    //   （第一次跑就是这么挂的：比值 ×-0.901。）
    g.fish.active.length = 0;
    g.world.icebergs = [];                       // 挪走冰块，量"不被撞"的基准速度
    const run = (slow) => {
      g.iceSlowT = slow; g.targetX = 0; g.hook.x = 0;
      g.hook.y = -300; g.hook.setPosition(0, -300);
      window.step(60);
      return -300 - g.hook.y;
    };
    const d0 = run(0);
    const d1 = run(99);
    g.world.icebergs = keep;
    g.fish.active.push(...keepFish);
    g.showIdle();
    return { d0, d1, ratio: d1 / d0, want: window.__cfg.ICEBERG.slowScale };})())`));
  check('C3 减速期间的下潜速度 = 正常 × slowScale（实测比值）',
    c3.d0 > 0 && Math.abs(c3.ratio - c3.want) < 0.02,
    `正常 ${c3.d0.toFixed(1)} / 减速 ${c3.d1.toFixed(1)} = ×${c3.ratio.toFixed(3)}（期望 ×${c3.want}）`);

  const c4 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    g.showIdle();
    const x0 = g.world.icebergs[0].mesh.position.x;
    window.step(60);
    return { dx: Math.abs(g.world.icebergs[0].mesh.position.x - x0) };})())`));
  check('C4 浮冰会自己横向漂（不是钉在原地的装饰）', c4.dx > 1, `1 秒漂了 ${c4.dx.toFixed(1)} 单位`);

  // ═════════════════════════════════════════════════════════
  console.log('\n── D 鱼群 ──');
  // ═════════════════════════════════════════════════════════
  const d1 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    const keepChance = cfg.SCHOOL.chance;
    cfg.SCHOOL.chance = 1;                       // 必然成组，去掉概率带来的抖动
    Math.random = window.__seedRand; window.__seed = 20260918;
    g.spawnFish();
    Math.random = window.__realRandom;
    cfg.SCHOOL.chance = keepChance;

    const by = new Map();
    for (const f of g.fish.active) {
      if (f.state !== 'swim') continue;
      const k = f.def.id;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push({ x: f.x, y: f.y, hazard: !!f.def.hazard, spd: f.speed, dir: f.dir });
    }
    // 找一条"等距斜线"作为鱼群的证据：这是"排成一条线"的定义，比"条数多"严格得多。
    // ⚠ 认群只能按**位置**（等距链），不能按"所有同 id 的鱼" ——
    //   鱼群旁边还会刷 1~2 条散鱼（SCHOOL.extras），它们与鱼群同 id 但速度各自随机。
    //   把散鱼一起算进"同一群"再断言"同向同速"，测的是一个错误的集合，必然 false。
    let hit = null;
    for (const [id, list] of by) {
      if (list.length < 3) continue;
      const s = list.slice().sort((a, b) => a.x - b.x);
      for (let i = 0; i + 2 < s.length; i++) {
        const dx1 = s[i+1].x - s[i].x, dx2 = s[i+2].x - s[i+1].x;
        const dy1 = s[i+1].y - s[i].y, dy2 = s[i+2].y - s[i+1].y;
        if (Math.abs(dx1) > 3 && Math.abs(dx1 - dx2) < 0.02 && Math.abs(dy1 - dy2) < 0.02) {
          // 从 i 向后扩展整段等距链：鱼群的 n 条会整段连上，散鱼不会（间距不等）
          let end = i + 2;
          while (end + 1 < s.length) {
            const dxA = s[end].x - s[end-1].x, dyA = s[end].y - s[end-1].y;
            const dxB = s[end+1].x - s[end].x, dyB = s[end+1].y - s[end].y;
            if (Math.abs(dxA - dxB) < 0.02 && Math.abs(dyA - dyB) < 0.02) end++; else break;
          }
          const seg = s.slice(i, end + 1);
          hit = { id, n: list.length, segN: seg.length, dx: dx1, slope: dy1 / dx1,
            spdSame: seg.every(x => x.spd === seg[0].spd && x.dir === seg[0].dir),
            hazard: seg[0].hazard,
            inRange: list.every(x => Math.abs(x.x) <= cfg.WORLD.playHalfWidth + 0.01) };
          break;
        }
      }
      if (hit) break;
    }
    return { hit, groups: [...by].filter(([, l]) => l.length >= 3).map(([k, l]) => k + ':' + l.length) };})())`));
  check('D1 鱼群真的排成等距斜线（三连间距一致、斜率 0.34、全部落在可钓范围内）',
    !!d1.hit && Math.abs(Math.abs(d1.hit.slope) - 0.34) < 0.02 && d1.hit.inRange,
    d1.hit ? `${d1.hit.id} ×${d1.hit.n} 等距段 ${d1.hit.segN} 条 间距 ${d1.hit.dx.toFixed(1)} 斜率 ${d1.hit.slope.toFixed(3)} 在界内=${d1.hit.inRange}`
      : '没找到成群的三连 · 组 ' + JSON.stringify(d1.groups));

  check('D2 鱼群那几条共享朝向和速度（不共享的话两秒内就散开），且领头不是扣钱鱼',
    !!d1.hit && d1.hit.segN >= 3 && d1.hit.spdSame === true && d1.hit.hazard === false,
    d1.hit ? `等距段 ${d1.hit.segN}/${d1.hit.n} 条 · 同向同速=${d1.hit.spdSame} 扣钱鱼=${d1.hit.hazard}` : 'n/a');

  // ⚠ 下潜撞鱼 = **强制收线**。如果鱼能刷在贴着水面的位置，鱼钩一入水就撞上，
  //   一竿还没开始就被迫上拉 —— 玩家看到的是"刚抛竿就提示碰到鱼，可收上来什么都没有"。
  //   所以刷鱼上界必须离水面留出 SPAWN_TOP_MARGIN。
  const d3 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.enterMap('calm-bay'); g.showIdle();
    const m = cfg.SPAWN_TOP_MARGIN;
    let worst = -Infinity, n = 0;
    for (let i = 0; i < 12; i++) {              // 多刷几轮，盖住随机性
      g.spawnFish();
      for (const f of g.fish.active) {
        if (f.state !== 'swim') continue;
        n++;
        if (f.mesh.position.y > worst) worst = f.mesh.position.y;
      }
    }
    return { margin: m, worst: +worst.toFixed(2), n };})())`));
  check('D3 没有鱼刷在贴着水面的位置（否则鱼钩一入水就被迫收线）',
    d3.worst <= -d3.margin + 0.01 && d3.n > 20,
    `${d3.n} 条鱼里最浅的一条在 ${d3.worst}m（要求 ≤ −${d3.margin}m）`);

  // 相机盯住**最低的那条非扣钱鱼**（最快落回水里、最该优先打掉的），
  // 而不是把整个鱼群框进画面 —— 鱼一散开，包围盒就会让镜头一路拉远，
  // 玩家看到的是一堆小点，反而不知道该打谁。
  const d4 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    const fake = (x,y,hazard)=>({state:'air', def:{hazard, name:'t'}, mesh:{position:{x,y}}});
    const keep = g.airFish;
    g.airFish = [fake(0, 900, false), fake(0, 300, false), fake(0, 600, true)];
    const c = g._airCamera();                 // 目标 = y300 那条（河豚 600 不参与）
    g.airFish = [fake(140, 900, false), fake(-80, 420, false)];
    const c2 = g._airCamera();                // 最低的换成 y420 那条（x = −80）
    g.airFish = keep;
    return { y1: Math.round(c.y), x1: Math.round(c.x), scale: c.scale,
      y2: Math.round(c2.y), x2: Math.round(c2.x) };})())`));
  // ⚠ v0.3.2：改成瞄准**鱼群质心**（原来瞄最低那条= 鱼群最底部，
  //   等于把其余鱼全推到画面顶部 —— 玩家反馈「鱼总在屏幕顶部」）。
  //   最低那条只做钳制：最多偏离中心 0.9·viewH。
  check('D4 空中相机锁定最低的非扣钱鱼（击落后自动换下一条）',
    d4.scale < 1 && d4.x1 === 0 && Math.abs(d4.y1 - 300) < 60
    && d4.x2 === -80 && Math.abs(d4.y2 - 420) < 60,
    `第 1 组锁定 (0, 300) → 相机 (${d4.x1}, ${d4.y1}) ×${d4.scale} · `
    + `第 2 组锁定 (−80, 420) → 相机 (${d4.x2}, ${d4.y2})`);

  // ═════════════════════════════════════════════════════════
  console.log('\n── E 稀有度 ──');
  // ═════════════════════════════════════════════════════════
  const e1 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    Math.random = window.__seedRand; window.__seed = 777;
    const f = g.fish.acquire(cfg.SPECIES[0]);
    const hit = {}; const N = 3000;
    for (let i = 0; i < N; i++) { f.reset(0, -40); hit[f.rarity.id] = (hit[f.rarity.id]||0) + 1; }
    Math.random = window.__realRandom;
    g.fish.releaseAll();
    const worst = Math.max(...cfg.RARITY.map(r => Math.abs((hit[r.id]||0)/N - r.p)));
    return { hit, N, worst };})())`));
  check('E1 逐条抽签的实测分布对得上 RARITY.p（固定种子 3000 条，最大偏差 < 2%）',
    e1.worst < 0.02,
    RARITY.map((r) => `${r.name} ${((e1.hit[r.id] || 0) / e1.N * 100).toFixed(1)}%`).join(' · '));

  const e2 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    Math.random = window.__seedRand; window.__seed = 4242;
    const def = cfg.SPECIES.find(s=>s.value>=20);
    const f = g.fish.acquire(def);
    const seen = {};
    let sample = null;
    for (let i = 0; i < 4000 && !sample; i++) {
      f.reset(0, -40);
      const r = f.rarity;
      seen[r.id] = (seen[r.id]||0)+1;
      if (r.id === 'gold') sample = { value: f.value, mul: r.mul, base: def.value, id: def.id };
    }
    Math.random = window.__realRandom;
    g.fish.releaseAll();
    return { sample, seen };})())`));
  check('E2 稀有度倍率真的作用在身价上（金色 = 基础 × 6，带 ±15% 个体浮动）',
    !!e2.sample && e2.sample.value >= e2.sample.base * 6 * 0.85 - 1
    && e2.sample.value <= e2.sample.base * 6 * 1.15 + 1,
    e2.sample ? `${e2.sample.id} 基础 ${e2.sample.base} ×${e2.sample.mul} → ${e2.sample.value}` : '没抽到金色');

  // ⚠ 不要"分别抓一条普通鱼和一条金色鱼再比大小"。
  //   那是在比较**两个不同时刻的状态** —— 光晕的 opacity/scale 只在抽到稀有档时被写，
  //   抽回普通档只把 visible 关掉，旧值会留在材质上。于是"普通鱼"身上挂着的
  //   可能是上一轮银色的残留数值，比大小变成在比"哪次先抽到"。
  //   正确做法：**逐次 reset 校验不变式** —— 每一档都必须写出与它自己相符的
  //   opacity / scale / 颜色，普通档必须 visible=false。
  const e3 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    Math.random = window.__seedRand; window.__seed = 909;
    const def = cfg.SPECIES.find(s=>s.value>=20);
    const f = g.fish.acquire(def);
    const N = 3000;
    let normalN = 0, normalShown = 0, bad = 0, fancyN = 0, gold = null;
    const badIds = [];
    for (let i = 0; i < N; i++) {
      f.reset(0, -40);
      const r = f.rarity; const h = f.rarityHalo;
      if (r.rim == null) { normalN++; if (h.visible) normalShown++; continue; }
      fancyN++;
      const wantOp = 0.30 + 0.40 * r.glow;
      // ⚠ 1.3 / 0.7 = v0.1 的 2.6 / 1.4 折半：f.radius 已经 ×2，
      //   而 rarityHalo 是 mesh 的子对象、还会被 mesh.scale（也 ×2）再放大一次。
      const wantSc = f.radius * (1.3 + r.glow * 0.7);
      const ok = h.visible === true
        && Math.abs(h.material.opacity - wantOp) < 1e-9
        && Math.abs(h.scale.x - wantSc) < 1e-9
        && h.material.color.getHex() === r.rim;
      if (!ok) { bad++; if (badIds.length < 3) badIds.push(r.id); }
      if (r.id === 'gold' && !gold) {
        gold = { id: r.id, color: h.material.color.getHex(), opacity: +h.material.opacity.toFixed(3),
          scale: +h.scale.x.toFixed(2), radius: f.radius, glow: r.glow };
      }
    }
    // 同种鱼里只有稀有那条带光晕 —— 光晕材质必须逐条新建，不能进 matCache
    const sharedMat = (()=>{ const a = f.rarityHalo.material;
      const f2 = g.fish.acquire(def); return a === f2.rarityHalo.material; })();
    Math.random = window.__realRandom;
    g.fish.releaseAll();
    return { normalN, normalShown, fancyN, bad, badIds, gold, sharedMat };})())`));
  check('E3 普通档不画光晕；稀有档的光晕颜色/不透明度/大小逐条都符合 RARITY 的公式',
    e3.normalN > 0 && e3.fancyN > 0 && e3.normalShown === 0 && e3.bad === 0,
    `${e3.normalN} 普通（误显示 ${e3.normalShown}）· ${e3.fancyN} 稀有（不符 ${e3.bad} ${e3.badIds.join(',')}）` +
    (e3.gold ? ` · 金色 #${e3.gold.color.toString(16)} op=${e3.gold.opacity} scale=${e3.gold.scale}（r=${e3.gold.radius}）` : ''));

  check('E4 光晕材质逐条独立（共用的话一条金色会把整群同种鱼都染成金的）',
    e3.sharedMat === false, `两条同种鱼共用材质=${e3.sharedMat}`);

  // ═════════════════════════════════════════════════════════
  console.log('\n── F UI ──');
  // ═════════════════════════════════════════════════════════
  // 先看**两张图都还没解锁**的状态：宁静海湾（license 0 = 天生拥有）是当前图，
  // 冰封极地还没买 —— 这才是航线 App 最主要的用途。
  // ⚠ 不能直接沿用 B 组留下的状态：那里刚买下极地，licenses 里已经有它了，
  //   于是"没去过的那张图"根本不存在，F3 会在一个空集合上判定。
  const readRoute = () => ev(`JSON.stringify((()=>{
    const cards = [...document.querySelectorAll('#pApp .rt-item')];
    const cur = document.querySelector('#pApp .rt-item.cur');
    const locked = cards.filter(c=>c.querySelector('.buy.lock'));
    const conds = locked.length ? [...locked[0].querySelectorAll('.rt-c')].map(e=>e.textContent) : [];
    return { n: cards.length,
      names: cards.map(c=>c.querySelector('.rt-t b').textContent),
      curName: cur && cur.querySelector('.rt-t b').textContent,
      curBtn: cur && cur.querySelector('button').textContent.trim(),
      curDisabled: cur && cur.querySelector('button').disabled,
      lockedName: locked.length ? locked[0].querySelector('.rt-t b').textContent : '',
      lockedN: locked.length, conds,
      // 当前那张卡上还有几行条件（已买下 / 当前所在时应该一行都没有）
      curCondRows: cur ? cur.querySelectorAll('.rt-conds').length : -1,
      lockedBtn: locked.length ? locked[0].querySelector('button').textContent.trim() : '',
      emoji: /[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{FE0F}]/u.test(document.getElementById('pApp').innerText) };})())`);

  // ⚠ 三个条件要**一起**退回未满：只清 licenses 的话，B 组留下的
  //   图鉴（≥90%）+ mapBest 620 还在，按钮会变成「购买许可证」而不是「条件未满」，
  //   于是 .buy.lock 一张都查不到 —— F3 会在空集合上判定。
  await ev(`(()=>{const g=window.__game; const cfg=window.__cfg;
    g.save.licenses = []; g.save.currentMap = 'calm-bay';
    g.ui.setMap(cfg.mapById('calm-bay'));
    g.save.codex = {}; g.save.mapBest = {};
    // ⚠ v0.7：门槛是"海图 + 船"，所以退条件要**连这两样一起清掉** ——
    //   只清 licenses 的话 B 组留下的海图 / 船会让极地那张卡变成"已解锁"，F3 会空过。
    g.save.charts = {}; g.save.boats = { owned: [], current: null };
    g.save.coins = 500; g.showIdle(); g.openPhone(); g.ui.openApp('route'); return 'ok';})()`);
  await rafWait(400);
  const f1 = J(await readRoute());

  check('F1 航线 App 列出全部地图，每张一张卡',
    f1.n === MAPS.length && f1.names.join(',') === MAPS.map((m) => m.name).join(','),
    `${f1.n} 张 · ${f1.names.join(' / ')}`);
  check('F2 当前所在的那张图标成「当前所在」且按钮不可点',
    f1.curName === '宁静海湾' && f1.curBtn === '当前所在' && f1.curDisabled === true,
    `${f1.curName} · 「${f1.curBtn}」disabled=${f1.curDisabled}`);
  check('F3 还没解锁的每一张图各列出两个条件（海图 / 船），按钮是灰的',
    f1.lockedN === MAPS.length - 1 && f1.lockedName === '冰封极地' && f1.conds.length === 2
    && f1.lockedBtn === '条件未满'
    && f1.conds.some((c) => /海图|宝箱/.test(c)) && f1.conds.some((c) => /船/.test(c)),
    `${f1.lockedName} · ${JSON.stringify(f1.conds)} · 按钮「${f1.lockedBtn}」`);
  check('F4 航线 App 里一个 emoji 都没有（界面一律内联 SVG）', f1.emoji === false);
  await shot('F1-route-app');

  // 再看"已经买下并在其中"的状态：那张图应该没有条件行，只留「当前所在」
  await ev(`(()=>{const g=window.__game; const cfg=window.__cfg;
    g.save.licenses = ['polar']; g.save.currentMap = 'polar';
    g.save.charts = { polar: true }; g.save.boats = { owned: ['golden'], current: 'golden' };
    g.ui.setMap(cfg.mapById('polar')); g.ui.refreshApp(); return 'ok';})()`);
  await rafWait(300);
  const f1b = J(await readRoute());
  check('F5 当前那张图不再显示条件行（条件已经没意义了）—— 只有更后面的图还是灰的',
    f1b.curName === '冰封极地' && f1b.lockedN === MAPS.length - 2 && f1b.curCondRows === 0,
    `当前 ${f1b.curName} · 未解锁卡 ${f1b.lockedN} 张 · 当前卡条件行 ${f1b.curCondRows}`);

  await ev(`(()=>{ window.__game.ui.showPhoneHome(); return 'ok';})()`);
  await rafWait(300);
  const f5 = J(await ev(`JSON.stringify((()=>{
    const apps = [...document.querySelectorAll('#pHome .p-app-item')];
    const gridEl = document.querySelector('#pHome .p-grid');
    const grid = getComputedStyle(gridEl).gridTemplateColumns.split(' ').length;
    const widest = Math.max(...apps.map(a=>Math.round(a.getBoundingClientRect().width)));
    // v0.4 加了第 5 个 App（枪店）之后，这一行会不会把手机面板顶宽？
    // 只数"有几个"是量不出这个的 —— 必须量**最右边界和网格右边界之差**。
    const right = Math.max(...apps.map(a=>Math.round(a.getBoundingClientRect().right)));
    const gridRight = Math.round(gridEl.getBoundingClientRect().right);
    const w = document.querySelector('#pHome .p-widget .p-w-depth');
    const sub = [...document.querySelectorAll('#pHome .p-w2-sub span')].map(e=>e.textContent);
    return { n: apps.length, ids: apps.map(a=>a.dataset.app), grid, widest, overflow: right - gridRight,
      boatApp: window.__game.save.boatApp,
      depth: w && w.textContent, sub, title: document.querySelector('#pHome .p-w-name').textContent };})())`));
  // ⚠ 批 5 加了两个**常驻** App（短信 / 电台），所以基数是 8 而不是 6 ——
  //   它们不靠剧情解锁，一开始就在桌面上。
  check('F6 桌面 App 数 = 常驻 8 个 + 已解锁的船厂（本图跑完时已解锁 → 9 个），地图小部件显示的是当前这张图',
    f5.n === (f5.boatApp ? 9 : 8) && f5.ids.length === f5.n && f5.grid === 4
    && f5.overflow <= 0
    && f5.title === '冰封极地' && /本图最深/.test(f5.depth || '')
    && f5.sub.some((s) => /1240m/.test(s)),
    `${f5.n} 个 App / ${f5.grid} 列 · 最宽 ${f5.widest}px · 横向溢出 ${f5.overflow}px · ${f5.title} · ${f5.depth} · ${f5.sub.join(' ')}`);

  await ev(`(()=>{ const g=window.__game; g.closePhone(); g.showIdle(); return 'ok';})()`);

  // ═════════════════════════════════════════════════════════
  console.log('\n── G 冒烟 ──');
  // ═════════════════════════════════════════════════════════
  const smoke = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.save.levels = Object.fromEntries(cfg.UPGRADE_ORDER.map(k=>[k, 6]));
    g.applyUpgrades(); g.showIdle(); g.enterDescend();
    const seen = [];
    let bergHits = 0, lastSlow = 0;
    for (let i = 0; i < 6000; i++) {
      window.step(1);
      if (g.iceSlowT > 0 && lastSlow <= 0) bergHits++;
      lastSlow = g.iceSlowT;
      if (seen[seen.length-1] !== g.state) seen.push(g.state);
      if (g.state === 'result' || (g.state === 'idle' && seen.length > 3)) break;
    }
    return { seen, caught: g.run.caught, shot: g.run.shot, earned: Math.round(g.run.earned),
      depth: Math.round(g.run.depth), bergHits,
      mapBest: g.save.mapBest && g.save.mapBest.polar };})())`));
  check('G1 在冰封极地跑完整一竿（下潜 → 收线 → 上升 → 空中 → 结算）',
    smoke.seen.includes('descend') && smoke.seen.includes('ascend')
    && (smoke.seen.includes('air') || smoke.seen.includes('result')),
    smoke.seen.join(' → ') + ` · 串上 ${smoke.caught} 条 / 击落 ${smoke.shot} / 收入 ${smoke.earned}`);
  check('G2 这一竿的最深记录写进了本图（换图条件②读的就是它）',
    smoke.mapBest > 0, `mapBest.polar = ${smoke.mapBest}m`);
  await shot('G1-polar-cast');

  const clean = errors.filter((e) => !/favicon|AudioContext/i.test(e));
  check('G3 全程控制台零报错', clean.length === 0, clean.slice(0, 3).join(' | ') || 'clean');

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n================  ${pass}/${results.length} 通过  ================\n`);
  fs.writeFileSync(path.resolve('.dev/verify8.json'),
    JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 2));
  if (pass !== results.length) process.exitCode = 1;
} finally {
  try { chrome.kill(); } catch (_) { /* ignore */ }
}
