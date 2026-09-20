/**
 * verify15.mjs — 批 8（第 4 张地图「废弃沉船」+ 沉船格子）的回归验证
 *
 * 覆盖：
 *   A 数据（纯 Node）：4 张图 / 76 种鱼 / 等级闸门锚点 / 层内极差 / 越深越值钱 / 身价梯度 /
 *     海图链 / WRECK_CELL 参数
 *   B 沉船格子（浏览器）：生成数量 / **格子里免疫下潜撞鱼** / 判定是区间
 *   C 换图门槛（浏览器）：沉船海图在熔岩海沟底部 / 没海图进不去
 *   D 冒烟：在废弃沉船跑完整一竿 + 控制台零报错
 *
 * 用法：node .dev/verify15.mjs [url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as C from '../src/config.js';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.VB_PORT || 9372);
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-v15');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  · ' + detail : ''}`);
}

const { MAPS, ZONES, SPECIES, MAP_LEVEL_CAP, levelCapForMap, zonesOfMap, mapMaxDepth,
  lvAt, CHARTS, chartFrom, WRECK_CELL, mapOfSpecies } = C;

// ═══════════════════════════════════════════════════════════
// A 组 — 数据（纯 Node）
// ═══════════════════════════════════════════════════════════
console.log('\n── A 第 4 张图的数据 ──');

const W = MAPS.find((m) => m.id === 'wreck');
check('地图数 ≥ 4、鱼种 ≥ 76；MAP_LEVEL_CAP 至少覆盖全部地图',
  MAPS.length >= 4 && SPECIES.length >= 76 && MAP_LEVEL_CAP.length >= MAPS.length,
  `${MAPS.map((m) => m.name).join('/')} · ${SPECIES.length} 种 · cap=${JSON.stringify(MAP_LEVEL_CAP)}`);

const anchorBad = [];
MAPS.forEach((m, i) => {
  const cap = levelCapForMap(i);
  if (lvAt('maxDepth', cap) !== mapMaxDepth(m)) anchorBad.push(`${m.id}:Lv${cap}=${lvAt('maxDepth', cap)}≠${mapMaxDepth(m)}`);
});
check('A2 ⭐ 等级闸门锚点：第 4 张图 Lv13~17，`lvAt(maxDepth, 17)` 正好 = 1800m',
  !!W && anchorBad.length === 0 && mapMaxDepth(W) === 1800 && lvAt('maxDepth', 17) === 1800,
  anchorBad.join(',') || MAPS.map((m, i) => `${m.name} Lv${levelCapForMap(i)}=${mapMaxDepth(m)}m`).join(' · '));

const zBad = [], spreadBad = [];
for (const z of zonesOfMap('wreck')) {
  const sp = SPECIES.filter((s) => s.zones[0] === z.id);
  if (sp.length < 2) zBad.push(z.id + ':' + sp.length);
  const hps = sp.map((s) => s.hp);
  const r = Math.max(...hps) / Math.min(...hps);
  if (r < 2.2) spreadBad.push(`${z.id}:${r.toFixed(2)}`);
}
check('A3 废弃沉船 5 层海域每层 ≥2 种鱼，且**层内血量极差 ≥ 2.2 倍**',
  zBad.length === 0 && spreadBad.length === 0,
  zBad.concat(spreadBad).join(',') || zonesOfMap('wreck').map((z) => {
    const hps = SPECIES.filter((s) => s.zones[0] === z.id).map((s) => s.hp);
    return `${z.nick} ${Math.min(...hps)}~${Math.max(...hps)}`;
  }).join(' · '));

const notDeeper = [];
const zs = zonesOfMap('wreck');
for (let i = 1; i < zs.length; i++) {
  const prev = SPECIES.filter((s) => s.zones[0] === zs[i - 1].id);
  const cur = SPECIES.filter((s) => s.zones[0] === zs[i].id);
  if (Math.min(...cur.map((s) => s.value)) <= Math.max(...prev.map((s) => s.value))) notDeeper.push(zs[i].id);
}
check('A4 废弃沉船**越深越值钱**：每一层最便宜的鱼都比上一层最贵的贵',
  notDeeper.length === 0,
  notDeeper.join(',') || zs.map((z) => {
    const vs = SPECIES.filter((s) => s.zones[0] === z.id).map((s) => s.value);
    return `${z.nick} ${Math.min(...vs)}~${Math.max(...vs)}`;
  }).join(' · '));

const vOf = (m) => {
  const sp = SPECIES.filter((s) => s.zones.some((z) => (ZONES.find((x) => x.id === z) || {}).map === m.id));
  return Math.max(...sp.map((s) => s.value));
};
const ratios = MAPS.slice(1).map((m, i) => vOf(m) / vOf(MAPS[i]));
check('A5 身价梯度仍然 ≈ ×2.8/图（第 4 张图没有把它拉出区间）',
  ratios.every((r) => r > 2.4 && r < 3.2),
  ratios.map((r) => r.toFixed(2)).join(' → '));

check('A6 海图链从 calm-bay 起首尾相接，**最后一张图没有海床**',
  chartFrom('calm-bay')?.id === 'polar' && chartFrom('polar')?.id === 'lava'
  && chartFrom('lava')?.id === 'wreck' && chartFrom('wreck')?.id === 'song'
  && chartFrom('song') === null,
  CHARTS.map((c) => `${c.from}→${c.id}`).join(' · ') + ` · wreck→${chartFrom('wreck')}`);

check('A7 WRECK_CELL 参数自洽：数量 / 宽高 / 顶端深度 / 横向偏移都在合理区间',
  WRECK_CELL.count[0] >= 2 && WRECK_CELL.count[1] >= WRECK_CELL.count[0]
  && WRECK_CELL.w[1] >= WRECK_CELL.w[0] && WRECK_CELL.w[0] > 0
  && WRECK_CELL.h[1] >= WRECK_CELL.h[0] && WRECK_CELL.h[0] > 0
  && WRECK_CELL.top > 0 && WRECK_CELL.margin > 0 && WRECK_CELL.margin <= 0.5,
  `${WRECK_CELL.count.join('~')} 个 · 宽 ${WRECK_CELL.w.join('~')} · 高 ${WRECK_CELL.h.join('~')}m`);

check('A8 只有废弃沉船带 `hook: wreck`（机制不会漏到别的图）',
  MAPS.filter((m) => m.hook === 'wreck').length === 1 && W.hook === 'wreck',
  MAPS.map((m) => `${m.name}:${m.hook || '无'}`).join(' · '));

// ═══════════════════════════════════════════════════════════
// 浏览器部分
// ═══════════════════════════════════════════════════════════
async function getTarget(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await r.json();
      const t = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (t) return t.webSocketDebuggerUrl;
    } catch (_) { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('Chrome CDP 未就绪（静态服务器没开？先跑 python -m http.server 8899）');
}

const profile = path.resolve('.dev/profile-v15-' + Date.now());
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  '--no-proxy-server', '--proxy-bypass-list=*',
  '--disable-extensions', '--mute-audio',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=430,932', '--hide-scrollbars', 'about:blank',
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

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3200);

  await ev(`(async()=>{ window.__cfg = await import('./src/config.js'); return 'ok'; })()`);
  check('A0 测试用的 window.__cfg 已注入（探针拿现值断言的唯一入口）',
    (await ev('typeof window.__cfg?.WRECK_CELL?.count')) === 'object',
    'WRECK_CELL.count = ' + await ev('JSON.stringify(window.__cfg.WRECK_CELL.count)'));
  await ev('document.getElementById("startBtn").click()');
  await sleep(400);

  await ev(`(()=>{const g=window.__game; if(!g) return 'no game'; g._loop = () => {};
    window.__cfg.TUNING.airSettleGrace = 999;
    window.step = (n) => { const dt0 = 1/60;
      for (let i=0;i<n;i++){ g.time += dt0; g._update(dt0); }
      g.world.render();
    };
    g.save.charts = { polar: true, lava: true, wreck: true };
    g.save.boats = { owned: ['golden'], current: 'golden' };
    return 'ok';})()`);
  await sleep(200);

  // ═══════════════════════════════════════════════════════════
  // B 沉船格子
  // ═══════════════════════════════════════════════════════════
  console.log('\n── B 沉船格子 ──');

  const b1 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.enterMap('wreck');
    const list = g.world.wreckCellColliders || [];
    const other = (()=>{ g.enterMap('lava'); const r = g.world.wreckCellColliders; g.enterMap('wreck'); return r ? r.length : 0; })();
    return { n: list.length, min: cfg.WRECK_CELL.count[0], max: cfg.WRECK_CELL.count[1],
      ws: list.map(c=>Math.round(c.w)), top: list.map(c=>Math.round(c.y1)),
      bottom: list.map(c=>Math.round(c.y0)), other };})())`));
  check('B1 废弃沉船生成 4~6 个格子（都在海面以下）；别的图一个都没有',
    b1.n >= b1.min && b1.n <= b1.max && b1.top.every((y) => y < 0) && b1.ws.every((w) => w > 0)
    && b1.other === 0,
    `${b1.n} 个 · 宽 ${b1.ws.join('/')} · 顶端 ${b1.top.join('/')} · 底端 ${b1.bottom.join('/')} · 别的图 ${b1.other} 个`);

  const b2 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.enterMap('wreck');
    const c = (g.world.wreckCellColliders || [])[0];
    if (!c) return { err: '没有格子' };
    const mid = (c.y0 + c.y1) / 2;
    const at = (x, y) => { g.hook.x = x; g.hook.y = y; return g._inWreckCell(); };
    return { inside: at(c.x, mid), outX: at(c.x + c.w / 2 + 20, mid),
      above: at(c.x, c.y1 + 30), below: at(c.x, c.y0 - 30), w: Math.round(c.w) };})())`));
  check('B2 格子判定是**区间**：里面算在、横向出界 / 上下出界都不算',
    b2.inside === true && b2.outX === false && b2.above === false && b2.below === false,
    `里面=${b2.inside} · 横向出界=${b2.outX} · 上方=${b2.above} · 下方=${b2.below}（半宽 ${b2.w / 2}）`);

  const b3 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.enterMap('wreck');
    const c = (g.world.wreckCellColliders || [])[0];
    if (!c) return { err: '没有格子' };
    // ⚠⚠ 必须先把**鱼线升满**：Lv0 的线只有 320m，钩子会被  钳到 −320，
    //   而格子在最深那片（−732~−570）—— 钩子根本进不去， 恒为 false，
    //   看起来像"格子免疫没生效"。
    g.save.levels.line = cfg.MAX_LEVEL; g.applyUpgrades();
    const mid = (c.y0 + c.y1) / 2;
    // 造一条鱼**正压在钩子路径上**，然后分别在格子内 / 格子外走一帧，看会不会被串走
    const run = (x) => {
      g.fish.releaseAll(); g.caught = []; g.state = 'descend'; g.dropGraceT = 0;
      const f = g.fish.acquire(cfg.SPECIES.find(s => s.id === 'mackerel'));
      f.reset(x, mid); f.behavior = 'cruise'; f.speed = 0;
      // ⚠ 钩子必须**和鱼同一点**：判定是 "钩子这一帧扫过的线段"，
      //   放 40m 外的话线段离鱼很远，撞不到 —— 那样两边都是 0 条，看起来像"免疫没生效"。
      g.hook.x = x; g.hook.y = mid; g.targetX = x;
      const before = g.caught.length;
      const inCell = g._inWreckCell();
      // 把 _inWreckCell 打桩，看 _update 里那一刻它返回什么
      const oi = g._inWreckCell.bind(g); const calls = [];
      g._inWreckCell = () => { const r = oi(); calls.push(r + '@' + Math.round(g.hook.x) + ',' + Math.round(g.hook.y)); return r; };
      g._update(1 / 60);
      g._inWreckCell = oi;
      return { n: g.caught.length - before, inCell, calls, y: Math.round(g.hook.y), y0: Math.round(c.y0), y1: Math.round(c.y1) };
    };
    // 给 _catch 打桩：记下它到底是从哪一行被调的
    const orig = g._catch.bind(g); const marks = [];
    g._catch = (f) => { marks.push((new Error().stack || '').split(String.fromCharCode(10))[2].trim().slice(0, 70)); return orig(f); };
    const r1 = run(c.x); const m1 = marks.slice();
    marks.length = 0;
    const r2 = run(c.x + c.w / 2 + 40); const m2 = marks.slice();
    g._catch = orig;
    return { inCell: r1, outCell: r2, mid: Math.round(mid), w: Math.round(c.w),
      m1, m2, castAir: g.castAir, brakeT: +(g.brakeT || 0).toFixed(3) };})())`));
  check('B3 ⭐ 格子里**免疫下潜撞鱼**：同一条鱼、同样贴着钩子，格子内不会被串走、格子外会',
    b3.outCell.n > 0 && b3.inCell.n === 0,
    `格子内 ${b3.inCell.n} 条（inCell=${b3.inCell.inCell}）[来自 ${JSON.stringify(b3.m1)} 调用 ${JSON.stringify(b3.inCell.calls)} 区间 ${b3.inCell.y0}~${b3.inCell.y1}] · 格子外 ${b3.outCell.n} 条 [来自 ${JSON.stringify(b3.m2)}] · castAir=${b3.castAir} brakeT=${b3.brakeT}`);
  await shot('B3-wreck-cell');

  // ═══════════════════════════════════════════════════════════
  // C 换图门槛
  // ═══════════════════════════════════════════════════════════
  console.log('\n── C 换图门槛（第 4 张图）──');

  const c1 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    const wreck = cfg.mapById('wreck');
    // ① 没有沉船海图 → 进不去
    g.save.charts = { polar: true, lava: true };
    g.save.boats = { owned: ['golden'], current: 'golden' };
    g.save.currentMap = 'lava'; g.enterMap('lava');
    const p0 = g.mapProgress(wreck);
    const ok0 = g.buyMap('wreck');
    const cur0 = g.save.currentMap;
    // ② 补上沉船海图 → 放行
    g.save.charts.wreck = true;
    const ok1 = g.buyMap('wreck');
    return { noChart: { ok: ok0, cur: cur0, conds: p0.conds.map(c=>c.id+':'+c.ok), text: p0.conds[0].text },
      withChart: { ok: ok1, cur: g.save.currentMap } };})())`));
  check('C1 没有沉船海图进不去；补上海图 + 有船 → 放行；条件文案指的是**熔岩海沟**的深度',
    c1.noChart.ok === false && c1.noChart.cur === 'lava'
    && c1.withChart.ok === true && c1.withChart.cur === 'wreck'
    && /1560/.test(c1.noChart.text),
    `条件 ${c1.noChart.conds.join(' / ')} · 提示「${c1.noChart.text}」`);

  const c2 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    // 熔岩海沟底部的箱子：装的是沉船海图
    g.save.charts = { polar: true, lava: true };
    g.save.boats = { owned: ['golden'], current: 'golden' };
    g.enterMap('lava');
    const at = g.world.chestAt;
    const before = { seabed: g.world.seabedRoot.visible, chest: g.world.chest.visible,
      depth: at ? Math.round(at.y) : null, charts: Object.keys(g.save.charts).sort() };
    g.enterDescend();
    g.hook.setPosition(at.x, at.y); g.hook.x = at.x; g.hook.y = at.y;
    for (let i = 0; i < 4; i++) window.step(1);
    g.hook.setPosition(at.x, at.y); g.hook.x = at.x; g.hook.y = at.y;
    g._checkChest(at.x, at.y);
    return { before, after: Object.keys(g.save.charts).sort(), chest: g.world.chest.visible };})())`));
  check('C2 熔岩海沟底部**现在也有海床 + 宝箱**（箱里是沉船海图），碰到即得',
    c2.before.seabed === true && c2.before.chest === true && c2.before.depth <= -1560
    && c2.after.includes('wreck') && c2.chest === false,
    `箱子在 ${c2.before.depth}m · 海图 ${c2.before.charts.join(',')} → ${c2.after.join(',')}`);

  // ═══════════════════════════════════════════════════════════
  // D 冒烟
  // ═══════════════════════════════════════════════════════════
  console.log('\n── D 冒烟 ──');

  const smoke = J(await ev(`(()=>{try{const g=window.__game; const cfg=window.__cfg;
    cfg.TUNING.airSettleGrace = 1.8;
    g.save.charts = { polar: true, lava: true, wreck: true };
    g.save.boats = { owned: ['golden'], current: 'golden' };
    g.save.levels = Object.fromEntries(cfg.UPGRADE_ORDER.map(k=>[k, k==='winch'?0:cfg.MAX_LEVEL]));
    g.applyUpgrades();
    g.enterMap('wreck');
    g.showIdle();
    for (let i=0;i<10;i++) window.step(1);
    g.enterDescend();
    const seen = new Set();
    for (let i=0;i<60*90;i++) { window.step(1); seen.add(g.state); if (g.state === 'result') break; }
    return JSON.stringify({ seen: [...seen], caught: g.run.caught, depth: Math.round(g.run.depth), map: g.map.id });
    }catch(e){return JSON.stringify({ err: e.message });}})()`));
  check('D1 在废弃沉船跑完整一竿（下潜 → 收线 → 上升 → 空中 → 结算）',
    smoke.seen.includes('descend') && smoke.seen.includes('ascend') && smoke.seen.includes('result'),
    `${smoke.seen.join(' → ')} · 最深 ${smoke.depth}m · 串上 ${smoke.caught} 条 · 图 ${smoke.map}`);
  await shot('D1-full-run');

  const clean = errors.filter((e) => !/favicon|AudioContext/i.test(e));
  check('D2 全程控制台零报错', clean.length === 0, clean.slice(0, 3).join(' | ') || 'clean');

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n================  ${pass}/${results.length} 通过  ================\n`);
  fs.writeFileSync(path.resolve('.dev/verify15.json'),
    JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 2));
  if (pass !== results.length) process.exitCode = 1;
} finally {
  try { chrome.kill(); } catch (_) { /* ignore */ }
}
