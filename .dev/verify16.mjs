/**
 * verify16.mjs — 批 8b（第 5 张地图「深海之声」+ 海妖之歌）的回归验证
 *
 * 覆盖：
 *   A 数据：5 张图 / 93 种鱼 / **Lv20 锚点 = 2200m** / 层内极差 / 越深越值钱 / 身价梯度 /
 *     海图链（4 段）/ SIREN 参数 / ⭐ **终章 Boss 现在在深海之声（不在熔岩海沟）**
 *   B 海妖之歌：按周期开唱 / 歌声期间**所有鱼朝鱼钩游** / 结束就不拉 / 招 Boss 且**不招终章**
 *   C 换图门槛：深海海图在废弃沉船底部
 *   D 冒烟：在深海之声跑完整一竿 + 控制台零报错
 *
 * 用法：node .dev/verify16.mjs [url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as C from '../src/config.js';
import * as S from '../src/story.js';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.VB_PORT || 9373);
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-v16');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  · ' + detail : ''}`);
}

const { MAPS, ZONES, SPECIES, MAP_LEVEL_CAP, levelCapForMap, zonesOfMap, mapMaxDepth,
  lvAt, CHARTS, chartFrom, SIREN, mapOfSpecies } = C;
const { ENDING } = S;

// ═══════════════════════════════════════════════════════════
// A 组 — 数据（纯 Node）
// ═══════════════════════════════════════════════════════════
console.log('\n── A 第 5 张图的数据 ──');

const D = MAPS.find((m) => m.id === 'song');
check('A1 共 5 张地图、93 种鱼；MAP_LEVEL_CAP 有 5 档',
  MAPS.length === 5 && SPECIES.length === 93 && MAP_LEVEL_CAP.length === 5,
  `${MAPS.map((m) => m.name).join('/')} · ${SPECIES.length} 种 · cap=${JSON.stringify(MAP_LEVEL_CAP)}`);

const anchorBad = [];
MAPS.forEach((m, i) => {
  const cap = levelCapForMap(i);
  if (lvAt('maxDepth', cap) !== mapMaxDepth(m)) anchorBad.push(`${m.id}:Lv${cap}=${lvAt('maxDepth', cap)}≠${mapMaxDepth(m)}`);
});
check('A2 ⭐ 等级闸门锚点全部对上：第 5 张图 Lv17~20，`lvAt(maxDepth, 20)` = 2200m（曲线的终点）',
  !!D && anchorBad.length === 0 && mapMaxDepth(D) === 2200 && lvAt('maxDepth', 20) === 2200,
  anchorBad.join(',') || MAPS.map((m, i) => `Lv${levelCapForMap(i)}=${mapMaxDepth(m)}m`).join(' · '));

const zBad = [], spreadBad = [];
for (const z of zonesOfMap('song')) {
  const sp = SPECIES.filter((s) => s.zones[0] === z.id);
  if (sp.length < 2) zBad.push(z.id + ':' + sp.length);
  const hps = sp.map((s) => s.hp);
  const r = Math.max(...hps) / Math.min(...hps);
  if (r < 2.2) spreadBad.push(`${z.id}:${r.toFixed(2)}`);
}
check('A3 深海之声 5 层海域每层 ≥2 种鱼，且**层内血量极差 ≥ 2.2 倍**',
  zBad.length === 0 && spreadBad.length === 0,
  zBad.concat(spreadBad).join(',') || zonesOfMap('song').map((z) => {
    const hps = SPECIES.filter((s) => s.zones[0] === z.id).map((s) => s.hp);
    return `${z.nick} ${Math.min(...hps)}~${Math.max(...hps)}`;
  }).join(' · '));

const notDeeper = [];
const zs = zonesOfMap('song');
for (let i = 1; i < zs.length; i++) {
  const prev = SPECIES.filter((s) => s.zones[0] === zs[i - 1].id);
  const cur = SPECIES.filter((s) => s.zones[0] === zs[i].id);
  if (Math.min(...cur.map((s) => s.value)) <= Math.max(...prev.map((s) => s.value))) notDeeper.push(zs[i].id);
}
check('A4 深海之声**越深越值钱**：每一层最便宜的鱼都比上一层最贵的贵',
  notDeeper.length === 0, notDeeper.join(',') || '5 层全部单调');

const vOf = (m) => {
  const sp = SPECIES.filter((s) => s.zones.some((z) => (ZONES.find((x) => x.id === z) || {}).map === m.id));
  return Math.max(...sp.map((s) => s.value));
};
const ratios = MAPS.slice(1).map((m, i) => vOf(m) / vOf(MAPS[i]));
check('A5 身价梯度 4 段全部 ≈ ×2.8/图',
  ratios.every((r) => r > 2.4 && r < 3.2),
  ratios.map((r) => r.toFixed(2)).join(' → '));

check('A6 海图链 4 段完整：calm→polar→lava→wreck→song，**最后一张图没有海床**',
  CHARTS.length === 4 && chartFrom('lava')?.id === 'wreck'
  && chartFrom('wreck')?.id === 'song' && chartFrom('song') === null,
  CHARTS.map((c) => `${c.from}→${c.id}`).join(' · ') + ` · song→${chartFrom('song')}`);

check('A7 SIREN 参数自洽：周期 > 持续 > 0，概率在 (0,1)，且只有深海之声带 `hook: siren`',
  SIREN.period > SIREN.duration && SIREN.duration > 0
  && SIREN.bossChance > 0 && SIREN.bossChance < 1 && SIREN.speedMul > 1
  && MAPS.filter((m) => m.hook === 'siren').length === 1 && D.hook === 'siren',
  `每 ${SIREN.period}s 唱 ${SIREN.duration}s · 招 Boss ${SIREN.bossChance * 100}% · ` +
  MAPS.map((m) => m.hook || '无').join('/'));

// ⭐ 终章 Boss 搬家了
const fin = SPECIES.find((s) => s.final);
const finMap = fin ? mapOfSpecies(fin) : null;
check('A8 ⭐ 终章 Boss「创世之音」现在在**深海之声**（不在熔岩海沟），且结局文本说的是 2,200m',
  !!fin && finMap && finMap.id === 'song' && fin.zones[0] === 'song-source'
  && /2,200/.test(ENDING[0]) && SPECIES.filter((s) => s.id === 'genesis-voice').length === 1,
  fin ? `${fin.name} 在 ${finMap.name} · 触发 ${JSON.stringify(fin.bossWhen)} · 结局首句「${ENDING[0]}」` : '缺 final');

check('A9 深海之声的**常规** Boss 是「海妖女王」（终章另算）',
  SPECIES.filter((s) => s.boss && !s.final && mapOfSpecies(s).id === 'song').length === 1,
  SPECIES.filter((s) => s.boss && mapOfSpecies(s).id === 'song').map((s) => s.name + (s.final ? '(终章)' : '')).join(' · '));

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

const profile = path.resolve('.dev/profile-v16-' + Date.now());
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
    (await ev('typeof window.__cfg?.SIREN?.period')) === 'number',
    'SIREN.period = ' + await ev('window.__cfg.SIREN.period'));
  await ev('document.getElementById("startBtn").click()');
  await sleep(400);

  await ev(`(()=>{const g=window.__game; if(!g) return 'no game'; g._loop = () => {};
    window.__cfg.TUNING.airSettleGrace = 999;
    window.step = (n) => { const dt0 = 1/60;
      for (let i=0;i<n;i++){ g.time += dt0; g._update(dt0); }
      g.world.render();
    };
    g.save.charts = { polar: true, lava: true, wreck: true, song: true };
    g.save.boats = { owned: ['golden'], current: 'golden' };
    return 'ok';})()`);
  await sleep(200);

  // ═══════════════════════════════════════════════════════════
  // B 海妖之歌
  // ═══════════════════════════════════════════════════════════
  console.log('\n── B 海妖之歌 ──');

  const b1 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.enterMap('song');
    const t0 = g.sirenT, on0 = g.sirenOnT;
    // 把计时推到差一帧
    g.sirenT = 0.001; g._update(1/60);
    const after = { on: +g.sirenOnT.toFixed(2), next: +g.sirenT.toFixed(2) };
    // 别的图不该有这个节拍
    g.enterMap('lava'); g.sirenT = 0.001; g._update(1/60);
    const other = +g.sirenOnT.toFixed(2);
    g.enterMap('song');
    return { t0, on0, after, other, period: cfg.SIREN.period, dur: cfg.SIREN.duration };})())`));
  check('B1 歌声按**周期**开唱（计时归零 → 进入歌声），而且只有深海之声有这个节拍',
    b1.t0 === b1.period && b1.on0 === 0 && b1.after.on > b1.dur - 0.2 && b1.after.next === b1.period
    && b1.other === 0,
    `初始 ${b1.t0}s · 开唱后 on=${b1.after.on}s / next=${b1.after.next}s · 别的图 on=${b1.other}`);

  const b2 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.enterMap('song');
    // 造一条**逃逸**鱼（它本来该远离钩子），歌声里它必须**朝钩子游**
    const mk = () => { g.fish.releaseAll();
      const f = g.fish.acquire(cfg.SPECIES.find(s => s.id === 'narwhal-calf'));
      f.reset(0, -400); f.behavior = 'flee'; f.speed = 60; f.dir = 1; return f; };
    const f1 = mk();
    const quiet = f1._steer(1/60, { x: -600, y: -400, siren: false });
    const f2 = mk();
    const singing = f2._steer(1/60, { x: -600, y: -400, siren: true });
    // 钩子在**右边**时也要朝右
    const f3 = mk();
    const singingRight = f3._steer(1/60, { x: 600, y: -400, siren: true });
    return { quiet: +quiet.toFixed(1), singing: +singing.toFixed(1), right: +singingRight.toFixed(1),
      mul: cfg.SIREN.speedMul };})())`));
  check('B2 ⭐ 歌声期间**所有鱼都朝鱼钩游**（连逃逸鱼也掉头），钩子换边就跟着换向',
    // ⚠ 符号：钩子在左边（x=-600）→ dx<0 → dir=-1 → 速度**为负**。第一版写反了。
    b2.singing < 0 && b2.right > 0 && Math.abs(b2.singing) > Math.abs(b2.quiet),
    `安静时逃逸 ${b2.quiet}（远离）→ 歌声里 ${b2.singing}（朝左的钩子）/ ${b2.right}（朝右的钩子）`);

  const b3 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.enterMap('song');
    const f = g.fish.acquire(cfg.SPECIES.find(s => s.id === 'narwhal-calf'));
    f.reset(0, -400); f.behavior = 'flee'; f.speed = 60; f.dir = 1;
    g.sirenOnT = cfg.SIREN.duration; g.hook.x = 0; g.hook.y = -400;
    const on = g.sirenOnT > 0;
    for (let i=0;i<Math.ceil((cfg.SIREN.duration + 0.5) * 60);i++) g._update(1/60);
    const off = g.sirenOnT > 0;
    return { on, off };})())`));
  check('B3 歌声会**自己结束**（时长到了就不再拉鱼）',
    b3.on === true && b3.off === false, `开唱时 on=${b3.on} → ${b3.dur || 12}s 后 on=${b3.off}`);

  const b4 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.enterMap('song');
    const cands = g.bossDefs.map(d => d.id + (d.final ? '(终章)' : ''));
    // 强制必招：把 Math.random 钉到 0（< bossChance）
    const orig = Math.random; Math.random = () => 0;
    g._resetRun(); g.boss = null; g.sirenT = 0.001; g._update(1/60);
    Math.random = orig;
    const got = g.boss ? g.boss.def.id : null;
    const isFinal = g.boss ? !!g.boss.def.final : null;
    g._endBoss();
    return { cands, got, isFinal };})())`));
  check('B4 歌声有概率**招来 Boss**，但**永远不会招终章 Boss**（终章只能靠潜到最底 + 打赢前面所有 Boss）',
    b4.got === 'siren-queen' && b4.isFinal === false,
    `本图候选 ${b4.cands.join('/')} · 强制招来的 = ${b4.got}（final=${b4.isFinal}）`);
  await shot('B4-siren');

  // ═══════════════════════════════════════════════════════════
  // C 换图门槛
  // ═══════════════════════════════════════════════════════════
  console.log('\n── C 换图门槛（第 5 张图）──');

  const c1 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    const song = cfg.mapById('song');
    g.save.charts = { polar: true, lava: true, wreck: true };
    g.save.boats = { owned: ['golden'], current: 'golden' };
    g.save.currentMap = 'wreck'; g.enterMap('wreck');
    const p0 = g.mapProgress(song);
    const ok0 = g.buyMap('song');
    const cur0 = g.save.currentMap;
    g.save.charts.song = true;
    const ok1 = g.buyMap('song');
    return { noChart: { ok: ok0, cur: cur0, conds: p0.conds.map(c=>c.id+':'+c.ok), text: p0.conds[0].text },
      withChart: { ok: ok1, cur: g.save.currentMap } };})())`));
  check('C1 没有深海海图进不去；补上 + 有船 → 放行；条件文案指的是**废弃沉船**的深度（1800）',
    c1.noChart.ok === false && c1.noChart.cur === 'wreck'
    && c1.withChart.ok === true && c1.withChart.cur === 'song'
    && /1800/.test(c1.noChart.text),
    `条件 ${c1.noChart.conds.join(' / ')} · 提示「${c1.noChart.text}」`);

  const c2 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    g.save.charts = { polar: true, lava: true, wreck: true };
    g.save.boats = { owned: ['golden'], current: 'golden' };
    g.enterMap('wreck');
    const at = g.world.chestAt;
    const before = { seabed: g.world.seabedRoot.visible, chest: g.world.chest.visible,
      depth: at ? Math.round(at.y) : null };
    g.enterDescend();
    g.hook.setPosition(at.x, at.y); g.hook.x = at.x; g.hook.y = at.y;
    for (let i = 0; i < 4; i++) window.step(1);
    g.hook.setPosition(at.x, at.y); g.hook.x = at.x; g.hook.y = at.y;
    g._checkChest(at.x, at.y);
    return { before, charts: Object.keys(g.save.charts).sort(), chest: g.world.chest.visible };})())`));
  check('C2 废弃沉船底部也有海床 + 宝箱（箱里是深海海图），碰到即得',
    c2.before.seabed === true && c2.before.chest === true && c2.before.depth <= -1800
    && c2.charts.includes('song') && c2.chest === false,
    `箱子在 ${c2.before.depth}m · 海图 ${c2.charts.join(',')}`);

  // ═══════════════════════════════════════════════════════════
  // D 冒烟
  // ═══════════════════════════════════════════════════════════
  console.log('\n── D 冒烟 ──');

  const smoke = J(await ev(`(()=>{try{const g=window.__game; const cfg=window.__cfg;
    cfg.TUNING.airSettleGrace = 1.8;
    g.save.charts = { polar: true, lava: true, wreck: true, song: true };
    g.save.boats = { owned: ['golden'], current: 'golden' };
    g.save.levels = Object.fromEntries(cfg.UPGRADE_ORDER.map(k=>[k, k==='winch'?0:cfg.MAX_LEVEL]));
    g.applyUpgrades();
    g.enterMap('song');
    g.showIdle();
    for (let i=0;i<10;i++) window.step(1);
    // ⚠ 一竿通常不到 60s， 按真实周期走的话歌声落不进来 ——
    //   把节拍推近到 1s，验的是"歌声能在真实一竿里触发"，不是"周期恰好 60s"（那是 B1）。
    g.sirenT = 1;
    g.enterDescend();
    const seen = new Set(); let sang = false;
    for (let i=0;i<60*120;i++) { window.step(1); seen.add(g.state); if (g.sirenOnT > 0) sang = true; if (g.state === 'result') break; }
    return JSON.stringify({ seen: [...seen], caught: g.run.caught, depth: Math.round(g.run.depth), map: g.map.id, sang });
    }catch(e){return JSON.stringify({ err: e.message });}})()`));
  check('D1 在深海之声跑完整一竿，**期间歌声至少响过一次**',
    smoke.seen.includes('descend') && smoke.seen.includes('ascend') && smoke.seen.includes('result')
    && smoke.sang === true,
    `${smoke.seen.join(' → ')} · 最深 ${smoke.depth}m · 串上 ${smoke.caught} 条 · 歌声响过=${smoke.sang}`);
  await shot('D1-full-run');

  const clean = errors.filter((e) => !/favicon|AudioContext/i.test(e));
  check('D2 全程控制台零报错', clean.length === 0, clean.slice(0, 3).join(' | ') || 'clean');

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n================  ${pass}/${results.length} 通过  ================\n`);
  fs.writeFileSync(path.resolve('.dev/verify16.json'),
    JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 2));
  if (pass !== results.length) process.exitCode = 1;
} finally {
  try { chrome.kill(); } catch (_) { /* ignore */ }
}
