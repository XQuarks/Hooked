/**
 * verify10.mjs — 批 4（第 3 张地图「熔岩海沟」+ 热泉 + 第 8 项升级 + 第 8 把枪）的回归验证
 *
 * 覆盖：
 *   A 数据表（纯 Node，不开浏览器）
 *     · 3 张地图 / 每图 5 层 / `MAP_LEVEL_CAP` 与地图数一致
 *     · **MAPS ↔ ZONES ↔ SPECIES 三向一致**（无孤儿海域、无跨图鱼种）
 *     · `nick` 不与任何地图名重名（迭代 6 踩过）
 *     · 每层 ≥ 2 种鱼；越深越值钱；深层层内血量极差 ≥ 2.2
 *     · 每图恰好一个 Boss 且 `elite: false`
 *     · ⭐ **等级闸门锚点**：`lvAt('maxDepth', cap) === 本图深度上限`（`pace.mjs` 也守这条）
 *     · 两个梯度：身价 ×2.8/图、深度 ×1.44/图
 *     · 海图表（CHARTS）：id / from 都指向真实地图；最后一张图没有海床
 *     · 第 8 项升级 `tank`：21 项曲线、Lv0 = 26（= 老常量）
 *     · 第 8 把枪 `grenade`：mech = lob、有 fuse
 *   B 换图门槛（浏览器）：熔岩海沟的两条条件 + 极地底部那只箱子
 *   C 热泉（浏览器，冻结主循环）：柱内 ×1.8 / 柱外 ×1；别的图没有热泉
 *   D 第 8 项升级 / 第 8 把枪（浏览器）：滞空时长随等级变、榴弹延迟爆炸
 *   E 冒烟：在熔岩海沟跑完整一竿 + 控制台零报错
 *
 * 用法：node .dev/verify10.mjs [url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as C from '../src/config.js';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.VB_PORT || 9366);   // ⚠ 可用 VB_PORT 覆盖：上一次跑被打断时 Chrome 会占着端口
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-v10');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  · ' + detail : ''}`);
}

const {
  MAPS, ZONES, SPECIES, MAP_LEVEL_CAP, levelCapForMap, zonesOfMap, mapMaxDepth, zoneAtDepth,
  lvAt, LEVELS, MAX_LEVEL, UPGRADES, UPGRADE_ORDER, TUNING, CHARTS, chartFrom, chartById,
  GUNS, GUN_ORDER, gunById, gunStats, HEAT_VENT, ICEBERG,
} = C;

// ═══════════════════════════════════════════════════════════
// A 组 — 第 3 张地图的数据表（纯 Node）
// ═══════════════════════════════════════════════════════════
console.log('\n── A 第 3 张地图的数据表 ──');

const LAVA = MAPS.find((m) => m.id === 'lava');
const ids = MAPS.map((m) => m.id);

// ⚠ MAP_LEVEL_CAP 的**项数**可以 ≥ 地图数（多出来的是给更远期的地图预留的），
//   但前 MAPS.length 项必须存在，且每项都要对上本图深度（A9 守）。
check('地图数 ≥ 3、id 唯一；MAP_LEVEL_CAP 至少覆盖全部地图',
  MAPS.length >= 3 && new Set(ids).size === MAPS.length
  && MAP_LEVEL_CAP.length >= MAPS.length,
  `${ids.join(' / ')} · cap=${JSON.stringify(MAP_LEVEL_CAP)}`);

// ⚠ 第 3 张图是 1560m（不是最初设计的 2200m）—— 见 config 的 MAP_LEVEL_CAP 注释：
//   一段 11 级 × GROWTH 1.62 会把竿/级顶到 32，被 pace.mjs 打回来了。
check('A2 第 3 张图「熔岩海沟」：5 层海域、深度 1560m、等级段 Lv9~13',
  !!LAVA && zonesOfMap('lava').length === 5 && mapMaxDepth(LAVA) === 1560
  && levelCapForMap(2) === 13 && levelCapForMap(1) === 9,
  LAVA ? `${LAVA.name} ${mapMaxDepth(LAVA)}m · 段 Lv${levelCapForMap(1)}~${levelCapForMap(2)}` : '缺 lava');

// MAPS ↔ ZONES 双向一致：地图引用的海域都存在，ZONES 里也没有孤儿
const orphanZones = ZONES.filter((z) => !MAPS.some((m) => m.id === z.map)).map((z) => z.id);
const missingZones = [];
for (const m of MAPS) for (const zid of m.zones) if (!ZONES.some((z) => z.id === zid)) missingZones.push(m.id + '→' + zid);
check('A3 MAPS ↔ ZONES 双向一致（没有孤儿海域、没有悬空引用）',
  orphanZones.length === 0 && missingZones.length === 0,
  orphanZones.concat(missingZones).join(',') || `${ZONES.length} 个海域全部挂在地图上`);

// 每层 ≥ 2 种鱼，且鱼种不跨图
const thin = [], crossMap = [];
for (const m of MAPS) for (const z of zonesOfMap(m.id)) {
  const sp = SPECIES.filter((s) => s.zones[0] === z.id);
  if (sp.length < 2) thin.push(`${z.id}:${sp.length}`);
}
for (const s of SPECIES) {
  const maps = new Set(s.zones.map((z) => (ZONES.find((x) => x.id === z) || {}).map));
  if (maps.size > 1) crossMap.push(s.id);
}
check('A4 每层至少 2 种鱼；没有跨图鱼种',
  thin.length === 0 && crossMap.length === 0,
  (thin.concat(crossMap).join(',') || `${SPECIES.length} 种鱼分层正常`));

// nick 不能和地图名重名（迭代 6：图鉴里出现「宁静海湾 · 宁静海湾」）
const mapNames = new Set(MAPS.map((m) => m.name));
const nickClash = ZONES.filter((z) => mapNames.has(z.nick)).map((z) => z.id);
check('A5 海域雅称（nick）不与任何地图名重名', nickClash.length === 0,
  nickClash.join(',') || `${ZONES.length} 个 nick 都不撞地图名`);

// 越深越值钱：每层的最便宜 > 上一层的最贵
const notDeeper = [];
for (const m of MAPS) {
  const zs = zonesOfMap(m.id);
  for (let i = 1; i < zs.length; i++) {
    const prev = SPECIES.filter((s) => s.zones[0] === zs[i - 1].id);
    const cur = SPECIES.filter((s) => s.zones[0] === zs[i].id);
    if (Math.min(...cur.map((s) => s.value)) <= Math.max(...prev.map((s) => s.value))) notDeeper.push(zs[i].id);
  }
}
check('A6 越深越值钱：每一层最便宜的鱼都比上一层最贵的贵', notDeeper.length === 0,
  notDeeper.join(',') || '3 张图 × 5 层全部单调');

// 层内血量极差 ≥ 2.2（**只算深层** —— 表层是 2~5，绝对差只有 3 点；
// 口径与 verify9 的 A7b 一致：deep = top ≤ −240）
const lowSpread = [];
for (const m of MAPS) {
  for (const z of zonesOfMap(m.id)) {
    if (z.top > -240) continue;
    const hps = SPECIES.filter((s) => s.zones[0] === z.id).map((s) => s.hp);
    const r = Math.max(...hps) / Math.min(...hps);
    if (r < 2.2) lowSpread.push(`${z.id}:${r.toFixed(2)}`);
  }
}
check('A7 每一层的血量极差 ≥ 2.2 倍（"软鱼和硬骨头同框"，否则血量这条轴形同虚设）',
  lowSpread.length === 0, lowSpread.join(',') || '深层全部达标');

// 每图恰好一个 Boss，且不参与稀有度抽签
// ⚠ 首图**也有** Boss（黄金鱼王 hp60）—— 原设计文档写的是除第一张，实际实现每张都有。
const bossBad = [];
for (const m of MAPS) {
  const bosses = SPECIES.filter((s) => s.boss && !s.final && s.zones.some((z) => (ZONES.find((x) => x.id === z) || {}).map === m.id));
  if (bosses.length !== 1) bossBad.push(m.id + ':' + bosses.length + ' 个');
  else if (bosses[0].elite !== false) bossBad.push(m.id + ':Boss 必须 elite:false');
}
check('A8 每张图恰好一个**常规** Boss（终章另算），且不参与稀有度抽签',
  bossBad.length === 0, bossBad.join(',') || MAPS.map((m) => m.name).join(' / ') + ' 各一个');

// ⭐ 等级闸门锚点：买满本图等级 = 刚好潜到本图底
const anchorBad = [];
MAPS.forEach((m, i) => {
  const cap = levelCapForMap(i);
  const d = lvAt('maxDepth', cap);
  if (d !== mapMaxDepth(m)) anchorBad.push(`${m.id}:Lv${cap}=${d}≠${mapMaxDepth(m)}`);
});
check('A9 ⭐ 等级闸门锚点：lvAt(maxDepth, 本图等级上限) === 本图深度上限',
  anchorBad.length === 0, anchorBad.join(',') || MAPS.map((m, i) => `${m.name} Lv${levelCapForMap(i)}=${mapMaxDepth(m)}m`).join(' · '));

// 两个梯度
const valOf = (m) => {
  const sp = SPECIES.filter((s) => s.zones.some((z) => (ZONES.find((x) => x.id === z) || {}).map === m.id));
  return [Math.min(...sp.map((s) => s.value)), Math.max(...sp.map((s) => s.value))];
};
const depthRatios = MAPS.slice(1).map((m, i) => mapMaxDepth(m) / mapMaxDepth(MAPS[i]));
const valRatios = MAPS.slice(1).map((m, i) => valOf(m)[1] / valOf(MAPS[i])[1]);
check('A10 两个梯度：身价 ≈ ×2.8/图、深度 ×1.44 → ×1.26（**深度刻意远缓于身价**）',
  depthRatios.every((r) => r > 1.15 && r < 1.8) && valRatios.every((r) => r > 2.4 && r < 3.2),
  `深度 ${depthRatios.map((r) => r.toFixed(2)).join(' → ')} · 身价 ${valRatios.map((r) => r.toFixed(2)).join(' → ')}`);

// 海图表：id / from 都指向真实地图
const chartBad = [];
for (const c of CHARTS) {
  if (!ids.includes(c.id)) chartBad.push(c.id + ':id 不是地图');
  if (!ids.includes(c.from)) chartBad.push(c.id + ':from 不是地图');
}
check('A11 海图表：每张海图的 id 与 from 都指向真实地图，且 from 排在 id 前面',
  chartBad.length === 0
  && CHARTS.every((c) => ids.indexOf(c.from) < ids.indexOf(c.id)),
  chartBad.join(',') || CHARTS.map((c) => `${c.name}（${c.from} 底部 → 开往 ${c.id}）`).join(' · '));

check('A12 最后一张图没有海床（它没有"下一张图"可以给）',
  chartFrom(MAPS[MAPS.length - 1].id) === null
  && chartFrom('calm-bay')?.id === 'polar' && chartFrom('polar')?.id === 'lava',
  `calm-bay→${chartFrom('calm-bay')?.id} · polar→${chartFrom('polar')?.id} · lava→${chartFrom('lava')}`);

// 第 8 项升级
const tankRow = LEVELS.tank;
check('A13 升级项 8 项；「耐压舱」挂熔岩海沟、21 级单调、Lv0 = 26（= 原来的常量）',
  UPGRADE_ORDER.length === 8 && !!UPGRADES.tank && UPGRADES.tank.unlockMap === 'lava'
  && Array.isArray(tankRow) && tankRow.length === MAX_LEVEL + 1
  && tankRow.every((v, i) => i === 0 || v >= tankRow[i - 1])
  && tankRow[0] === 26 && TUNING.airTimeout(0) === 26,
  `UPGRADE_ORDER=${UPGRADE_ORDER.join('/')} · tank Lv0→Lv20 = ${tankRow[0]}→${tankRow[tankRow.length - 1]}s`);

// 第 8 把枪
const gren = gunById('grenade');
check('A14 枪械 8 把；「榴弹枪」mech = lob、带 fuse、数值单调、解锁挂熔岩海沟',
  GUNS.length === 8 && GUN_ORDER.length === 8 && !!gren
  && gren.mech === 'lob' && gren.fuse > 0 && gren.unlockMap === 'lava'
  && gren.dmg.length === 6 && gren.dmg.every((v, i) => i === 0 || v >= gren.dmg[i - 1])
  && gren.rad.length === 6 && gren.cd.every((v, i) => i === 0 || v <= gren.cd[i - 1]),
  gren ? `${gren.name} fuse=${gren.fuse}s · 伤害 ${gren.dmg[0]}→${gren.dmg[5]} · 半径 ${gren.rad[0]}→${gren.rad[5]}` : '缺 grenade');

check('A15 热泉参数自洽：有柱、有宽高、加速 > 1；浮冰那套参数不受影响',
  HEAT_VENT.count[0] >= 1 && HEAT_VENT.radius[0] > 0 && HEAT_VENT.height[0] > 0
  && HEAT_VENT.boost > 1 && HEAT_VENT.top > 0
  && HEAT_VENT.radius[1] >= HEAT_VENT.radius[0] && HEAT_VENT.height[1] >= HEAT_VENT.height[0]
  && ICEBERG.slowScale < 1,
  `热泉 ×${HEAT_VENT.boost} · 柱宽 ${HEAT_VENT.radius.join('~')} · 柱高 ${HEAT_VENT.height.join('~')}m`);

// `zoneAtDepth` 按图隔离：同一深度在三张图里必须返回各自的海域
const zCalm = zoneAtDepth(-30, 'calm-bay');
const zPolar = zoneAtDepth(-30, 'polar');
const zLava = zoneAtDepth(-30, 'lava');
check('A16 同一深度在三张图里返回**各自**的表层海域（深度分区必须带 map）',
  zCalm.id === 'sunlit' && zPolar.id === 'ice-shelf' && zLava.id === 'lava-shelf',
  `${zCalm.nick} / ${zPolar.nick} / ${zLava.nick}`);

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

const profile = path.resolve('.dev/profile-v10-' + Date.now());
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

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3200);

  await ev(`(async()=>{ window.__cfg = await import('./src/config.js'); return 'ok'; })()`);
  check('A0 测试用的 window.__cfg 已注入（探针拿现值断言的唯一入口）',
    (await ev('typeof window.__cfg?.MAPS?.length')) === 'number',
    'MAPS.length = ' + await ev('window.__cfg.MAPS.length'));
  await ev('document.getElementById("startBtn").click()');
  await sleep(400);

  // 冻结主循环：按帧推进的机制（开火 / 引信 / 热泉加速）必须手动定步长才可复现
  await ev(`(()=>{const g=window.__game; if(!g) return 'no game'; g._loop = () => {};
    window.__cfg.TUNING.airSettleGrace = 999;
    window.step = (n) => { const dt0 = 1/60;
      for (let i=0;i<n;i++){ g.time += dt0; g._update(dt0); }
      g.world.render();
    };
    return 'ok';})()`);
  await sleep(200);

  // ═══════════════════════════════════════════════════════════
  // B 换图门槛：第 3 张图
  // ═══════════════════════════════════════════════════════════
  console.log('\n── B 换图门槛（熔岩海沟）──');

  const b1 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    const lava = cfg.mapById('lava');
    g.save.charts = {}; g.save.boats = { owned: ['golden'], current: 'golden' };
    g.save.currentMap = 'calm-bay'; g.enterMap('calm-bay');
    const p0 = g.mapProgress(lava);
    const ok0 = g.buyMap('lava');
    // ⚠ 必须**当场**把当前地图记下来 —— 下面那次成功的 buyMap 会把它改成 'lava'，
    //   在 return 里现读的话，两条断言读到的是同一个（后来的）值，前半条会假失败。
    const cur0 = g.save.currentMap;
    // 只补熔岩海图（船已经有了）→ 这次必须放行
    g.save.charts = { polar: true, lava: true };
    const p1 = g.mapProgress(lava);
    const ok1 = g.buyMap('lava');
    return { noChart: { ok: ok0, cur: cur0, conds: p0.conds.map((c)=>c.id+':'+c.ok), text: p0.conds[0].text },
             withChart: { ok: ok1, cur: g.save.currentMap, gateOk: p1.gateOk } };})())`));
  check('B1 没有熔岩海图 → 进不去熔岩海沟；补上海图 + 有船 → 放行',
    b1.noChart.ok === false && b1.noChart.cur === 'calm-bay'
    && b1.withChart.ok === true && b1.withChart.cur === 'lava',
    `未拿海图：ok=${b1.noChart.ok} cur=${b1.noChart.cur} 条件[${b1.noChart.conds.join('/')}] 提示「${b1.noChart.text}」 · 拿到海图：ok=${b1.withChart.ok} cur=${b1.withChart.cur} gateOk=${b1.withChart.gateOk}`);

  // 极地底部那只箱子：装的是熔岩海图（不是极地海图）
  const b2 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.save.charts = { polar: true };                 // 已经拿过极地海图（不然进不去极地）
    g.save.boats = { owned: ['golden'], current: 'golden' };
    g.enterMap('polar');
    const at = g.world.chestAt;
    const before = { seabed: g.world.seabedRoot.visible, chest: g.world.chest.visible,
      depth: at ? Math.round(at.y) : null, x: at ? Math.round(at.x) : null,
      charts: JSON.parse(JSON.stringify(g.save.charts)) };
    const coins0 = g.save.coins;
    g.enterDescend();
    g.hook.setPosition(at.x, at.y); g.hook.x = at.x; g.hook.y = at.y;
    for (let i = 0; i < 4; i++) window.step(1);
    g.hook.setPosition(at.x, at.y); g.hook.x = at.x; g.hook.y = at.y;
    g._checkChest(at.x, at.y);
    const after = { charts: JSON.parse(JSON.stringify(g.save.charts)),
      chest: g.world.chest.visible, coins: g.save.coins - coins0 };
    // 换回首图：那只箱子应该**还在**（本图的海图早拿了）
    g.enterMap('calm-bay');
    const backChest = g.world.chest.visible;
    return { before, after, backChest };})())`));
  check('B2 极地底部的宝箱装的是**熔岩海图**：碰到即得、箱子收起、首图那只不受影响',
    b2.before.seabed === true && b2.before.chest === true
    && b2.before.depth <= -1240
    && b2.after.charts.polar === true && b2.after.charts.lava === true
    && b2.after.chest === false && b2.after.coins > 0
    && b2.backChest === false,
    `箱子在 ${b2.before.x}, ${b2.before.depth}m · 海图 ${JSON.stringify(b2.before.charts)} → ${JSON.stringify(b2.after.charts)} · 开箱+${b2.after.coins} · 回首图箱子=${b2.backChest}`);
  await shot('B2-lava-chart');

  // ═══════════════════════════════════════════════════════════
  // C 热泉
  // ═══════════════════════════════════════════════════════════
  console.log('\n── C 热泉上冲 ──');

  const c1 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.save.charts = { polar: true, lava: true };
    g.save.boats = { owned: ['golden'], current: 'golden' };
    g.enterMap('lava');
    const list = g.world.heatVentColliders || [];
    const calm = (()=>{ g.enterMap('calm-bay'); const r = g.world.heatVentColliders; g.enterMap('lava'); return r ? r.length : 0; })();
    return { n: list.length, calm,
      top: list.map((v)=>Math.round(v.y1)), bottom: list.map((v)=>Math.round(v.y0)),
      xs: list.map((v)=>Math.round(v.x)), rs: list.map((v)=>Math.round(v.r)),
      seabed: g.world.seabedRoot.visible, hook: g.world.heatVentColliders !== null };})())`));
  check('C1 熔岩海沟生成 2~3 条热泉柱（都在海面以下、有宽度）；别的图一条都没有（海床另说）',
    c1.n >= HEAT_VENT.count[0] && c1.n <= HEAT_VENT.count[1]
    && c1.top.every((y) => y < 0) && c1.rs.every((r) => r > 0)
    // ⚠ 批 8 起熔岩海沟**也有海床**了（底部箱子里是沉船海图）—— 所以 seabed 应为 true。
    && c1.calm === 0 && c1.seabed === true,
    `${c1.n} 条 · 顶端 y=${c1.top.join('/')} · 底端 y=${c1.bottom.join('/')} · x=${c1.xs.join('/')} · 半宽=${c1.rs.join('/')}`);

  const c2 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.enterMap('lava');
    const v = (g.world.heatVentColliders || [])[0];
    if (!v) return { err: '没有热泉柱' };
    const mid = (v.y0 + v.y1) / 2;
    const at = (x, y) => { g.hook.x = x; g.hook.y = y; return g._ventBoost(); };
    const inCol = at(v.x, mid);
    const outX = at(v.x + v.r + 12, mid);      // 横向出界
    const outY = at(v.x, v.y1 + 60);           // 纵向出界（柱子上方）
    const outY2 = at(v.x, v.y0 - 60);          // 纵向出界（柱子下方）
    // 真的跑一帧：柱内 vs 柱外，位移之比应当 ≈ boost
    g.state = 'ascend'; g.ascendRampT = 0; g.fish.releaseAll(); g.airFish = [];
    g.fastReel = false;
    // ⚠ 必须把 targetX 一起搬 —— 上升/下潜的操控是 "hook.x 追着 targetX 走"，
    //   只设 hook.x 的话下一帧就被拉回 targetX，跑出来的位移比是假的（第一版就栽在这）。
    const run = (x, y) => { g.hook.x = x; g.hook.y = y; g.targetX = x; g.hook.setPosition(x, y);
      const y0 = g.hook.y; window.step(1); return g.hook.y - y0; };
    const dyIn = run(v.x, mid);
    const dyOut = run(v.x + v.r + 12, mid);
    return { inCol, outX, outY, outY2, dyIn, dyOut, ratio: dyIn / dyOut };})())`));
  check('C2 热泉的判定是**区间**：柱内 ×1.8，横向 / 纵向出界都是 ×1；实跑一帧位移之比对得上',
    c2.inCol === HEAT_VENT.boost && c2.outX === 1 && c2.outY === 1 && c2.outY2 === 1
    && Math.abs(c2.ratio - HEAT_VENT.boost) < 0.05,
    `柱内 ×${c2.inCol} · 横向出界 ×${c2.outX} · 上方 ×${c2.outY} · 下方 ×${c2.outY2} · 实测位移比 ${c2.ratio.toFixed(3)}（${c2.dyIn.toFixed(2)} / ${c2.dyOut.toFixed(2)}）`);

  // ═══════════════════════════════════════════════════════════
  // D 第 8 项升级 + 第 8 把枪
  // ═══════════════════════════════════════════════════════════
  console.log('\n── D 耐压舱 / 榴弹枪 ──');

  const d1 = J(await ev(`JSON.stringify((()=>{try{const g=window.__game; const cfg=window.__cfg;
    const at = (lv) => { g.save.levels.tank = lv; g.applyUpgrades(); return g.airTimeout; };
    const lv0 = at(0), lv1 = at(1), lvMax = at(cfg.MAX_LEVEL);
    // 空中超时真的按这个字段走：airT 刚过 26 但没过 46 时，Lv0 会结算、Lv20 不会
    g.save.levels.tank = 0; g.applyUpgrades();
    // ⚠ 假鱼要够"像鱼"：_updateAir 会 filter 出 state==='air' 的鱼、逐条调 update(dt,t,view)，
    //   还会读 mesh.position.y 判"落回水里"（低于水面就 kill 掉 → 场上清空 → 走另一条分支）。
    //   所以至少要有 state / update / kill / mesh.position / radius / knockT。
    //   高度给 200（在水面之上）—— 这样它这一帧不会落水，能稳定停在"还有鱼"那条分支上。
    const stub = () => [{
      state: 'air', def: { hazard: false, name: '夹具鱼' }, radius: 4, knockT: 0,
      update: () => {}, kill: () => {},
      mesh: { position: { x: 0, y: 200, z: 0 } },
    }];
    g.state = 'air'; g.airFish = stub(); g.airT = 30; g.airClearT = 0;
    const before = g.state; g._updateAir(1/60, g.time); const after0 = g.state;
    g.save.levels.tank = cfg.MAX_LEVEL; g.applyUpgrades();
    g.state = 'air'; g.airT = 30; g.airClearT = 0; g.airFish = stub();
    g._updateAir(1/60, g.time); const afterMax = g.state;
    return { lv0, lv1, lvMax, before, after0, afterMax };}catch(e){return {err:e.message};}})())`));
  check('D1 「耐压舱」买一级就把滞空时长顶上去；空中超时真的读这个字段（Lv0 结算 / Lv20 不结算）',
    d1.lv0 === 26 && d1.lv1 === 27 && d1.lvMax === 46
    && d1.after0 === 'result' && d1.afterMax === 'air',
    d1.err ? '探针抛错：' + d1.err
      : `Lv0=${d1.lv0}s Lv1=${d1.lv1}s Lv20=${d1.lvMax}s · airT=30s 时 Lv0→${d1.after0} / Lv20→${d1.afterMax}`);

  const d2 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.save.charts = { polar: true, lava: true };
    g.save.boats = { owned: ['golden'], current: 'golden' };
    g.enterMap('lava');
    g.closePhone(); g.ui.hideOverlay();
    g.state='air'; g.airFish=[]; g.sky=[]; g.airT=0; g.airClearT=0; g.caught=[];
    g.hook.setVisible(false); g.world.clearParticles();
    g.save.guns.current='grenade';
    g.save.guns.owned = cfg.GUN_ORDER.filter(x=>x!=='pistol');
    g.save.guns.levels.grenade = 0;
    g.applyUpgrades(); g._resetGun();
    g.input.nx=0.5; g.input.ny=0.5; g.input.pointerDown=false;
    let blasts = 0;
    const w = g.world;
    const orig = w.burstExplosion.bind(w);
    w.burstExplosion = (...a) => { blasts++; return orig(...a); };
    g.gunCd = 0; g._tapFire();
    const justFired = { blasts, lobs: g.lobs.length };
    window.step(30);                              // 0.5s —— 引信还没到点
    const at05 = { blasts, lobs: g.lobs.length };
    window.step(6);                               // 再 0.1s —— 越过 0.55s
    const at06 = { blasts, lobs: g.lobs.length };
    w.burstExplosion = orig;
    return { fuse: cfg.gunById('grenade').fuse, rad: g.gunStat.radius, justFired, at05, at06 };})())`));
  check('D2 榴弹枪是**延迟**爆炸：开火当帧不结算，0.55s 之后才炸一次（且只炸一次）',
    d2.justFired.blasts === 0 && d2.justFired.lobs === 1
    && d2.at05.blasts === 0 && d2.at05.lobs === 1
    && d2.at06.blasts === 1 && d2.at06.lobs === 0,
    `引信 ${d2.fuse}s · 开火当帧 炸${d2.justFired.blasts}/待炸${d2.justFired.lobs} · 0.5s 炸${d2.at05.blasts} · 0.6s 炸${d2.at06.blasts}`);
  await shot('D2-grenade');

  // ═══════════════════════════════════════════════════════════
  // E 冒烟：在熔岩海沟跑完整一竿
  // ═══════════════════════════════════════════════════════════
  console.log('\n── E 冒烟 ──');

  // ⚠ 这里只能 stringify **一次**：外面再包一层的话，J() 解出来是个字符串，smoke.seen 直接 undefined。
  const smoke = J(await ev(`(()=>{try{const g=window.__game; const cfg=window.__cfg;
    // ⚠ 前面几组把 airSettleGrace 顶到了 999（否则场上清空就自动结算，按帧推进的机制测不了）。
    //   这一组要的是能走到结算，所以先还原成真实值。
    cfg.TUNING.airSettleGrace = 1.8;
    g.save.charts = { polar: true, lava: true };
    g.save.boats = { owned: ['golden'], current: 'golden' };
    g.save.levels = Object.fromEntries(cfg.UPGRADE_ORDER.map(k=>[k, k==='winch'?0:cfg.MAX_LEVEL]));
    g.save.guns.owned = cfg.GUN_ORDER.slice(); g.save.guns.current = 'grenade';
    g.applyUpgrades();
    g.enterMap('lava');
    g.showIdle();
    for (let i=0;i<10;i++) window.step(1);
    g.enterDescend();
    const seen = new Set();
    for (let i=0;i<60*70;i++) {
      window.step(1); seen.add(g.state);
      if (g.state === 'result') break;
    }
    return JSON.stringify({ seen: [...seen], caught: g.run.caught, shot: g.run.shot,
      depth: Math.round(g.run.depth), map: g.map.id, gun: g.save.guns.current,
      coins: Math.round(g.save.coins) });}catch(e){return JSON.stringify({err:e.message});}})()`));
  check('E1 在熔岩海沟用榴弹枪跑完整一竿（下潜 → 收线 → 上升 → 空中 → 结算）',
    smoke.seen.includes('descend') && smoke.seen.includes('ascend') && smoke.seen.includes('result'),
    `${smoke.seen.join(' → ')} · 最深 ${smoke.depth}m · 串上 ${smoke.caught} 条 / 击落 ${smoke.shot} · 枪 ${smoke.gun}`);
  await shot('E1-full-run-lava');

  const clean = errors.filter((e) => !/favicon|AudioContext/i.test(e));
  check('E2 全程控制台零报错', clean.length === 0, clean.slice(0, 3).join(' | ') || 'clean');

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n================  ${pass}/${results.length} 通过  ================\n`);
  fs.writeFileSync(path.resolve('.dev/verify10.json'),
    JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 2));
  if (pass !== results.length) process.exitCode = 1;
} finally {
  try { chrome.kill(); } catch (_) { /* ignore */ }
}
