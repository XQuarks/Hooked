/**
 * verify13.mjs — 批 6（特效清单）的回归验证
 *
 * 覆盖：
 *   A 参数（纯 Node）：命中定格的两个常量 / 粒子上限
 *   B 命中定格：时长按血量给、取 max 不覆盖、真的把世界放慢
 *   C 粒子：全局上限 400（超了丢弃）/ 金币喷泉 + 落地弹跳 / 冲击波环 / 水花分级
 *   D 覆盖层：vignette 随深度 / 连击色差阈值 / Boss 色偏 / 三个都**不拦点击**
 *   E 冒烟：完整一竿 + 控制台零报错
 *
 * 用法：node .dev/verify13.mjs [url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as C from '../src/config.js';
// ⚠ 不要 import world.js —— 它引了 `three`，Node 里解析不了。
//   所以粒子上限放在 `config.js`（两边都能读），C1 直接读 `C.MAX_PARTICLES`；
//   在浏览器里验的是**行为**（真的不超过上限），数字本身来自源码而不是字面量。

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.VB_PORT || 9370);
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-v13');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  · ' + detail : ''}`);
}

const { TUNING } = C;

// ═══════════════════════════════════════════════════════════
// A 组 — 参数（纯 Node）
// ═══════════════════════════════════════════════════════════
console.log('\n── A 特效参数 ──');

check('A1 命中定格：倍率在 (0,1)、时长区间合法且 min < max',
  TUNING.hitStopScale > 0 && TUNING.hitStopScale < 1
  && TUNING.hitStopMin > 0 && TUNING.hitStopMin < TUNING.hitStopMax,
  `×${TUNING.hitStopScale} · ${TUNING.hitStopMin}~${TUNING.hitStopMax}s`);

// 粒子上限的**实际生效**在 C1 里验（需要浏览器）；这里只验参数区的三个常量都在。
check('A2 特效参数齐全（命中定格 3 个 + 慢镜头 2 个）',
  ['hitStopScale', 'hitStopMin', 'hitStopMax', 'slowmoScale', 'slowmoTime'].every((k) => typeof TUNING[k] === 'number'),
  'hitStopScale/hitStopMin/hitStopMax/slowmoScale/slowmoTime 全部存在');

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

const profile = path.resolve('.dev/profile-v13-' + Date.now());
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
    (await ev('typeof window.__cfg?.TUNING?.hitStopScale')) === 'number',
    'hitStopScale = ' + await ev('window.__cfg.TUNING.hitStopScale'));
  await ev('document.getElementById("startBtn").click()');
  await sleep(400);

  // 冻结主循环
  await ev(`(()=>{const g=window.__game; if(!g) return 'no game'; g._loop = () => {};
    window.__cfg.TUNING.airSettleGrace = 999;
    window.step = (n) => { const dt0 = 1/60;
      for (let i=0;i<n;i++){ g.time += dt0; g._update(dt0); }
      g.world.render();
    };
    return 'ok';})()`);
  await sleep(200);

  // ═══════════════════════════════════════════════════════════
  // B 命中定格
  // ═══════════════════════════════════════════════════════════
  console.log('\n── B 命中定格（特效 #1）──');

  const b1 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const T=window.__cfg.TUNING;
    const at = (hp) => { g.hitStopT = 0; g._hitStop(hp); return g.hitStopT; };
    return { small: at(2), mid: at(100), big: at(999), min: T.hitStopMin, max: T.hitStopMax };})())`));
  check('B1 命中定格：时长按**血量**给，且永远落在 [min, max] 区间内（鱼越大停得越久）',
    // ⚠ 用容差比：0.04 + 0.08×(2/200) = 0.0408，和 0.04 差在浮点上
    Math.abs(b1.small - b1.min) < 0.002 && b1.big === b1.max && b1.mid > b1.small && b1.mid < b1.big,
    `hp2 → ${b1.small.toFixed(3)}s · hp100 → ${b1.mid.toFixed(3)}s · hp999 → ${b1.big.toFixed(3)}s（区间 ${b1.min}~${b1.max}）`);

  const b2 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    g.hitStopT = 0;
    g._hitStop(999);            // 长的那次
    const long = g.hitStopT;
    g._hitStop(2);              // 短的那次**不该**把它缩短
    const afterShort = g.hitStopT;
    return { long, afterShort };})())`));
  check('B2 连续命中取 **max** 不覆盖 —— 射速越高越有打击感，而不是反过来',
    b2.afterShort === b2.long,
    `长的 ${b2.long.toFixed(3)}s · 再补一枪短的之后仍是 ${b2.afterShort.toFixed(3)}s`);

  const b3 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.fish.releaseAll(); g.state='idle'; g.dropGraceT = 999;
    // 一条匀速鱼：同样跑 30 帧，带定格的那次应该只走了 ~5%
    const mk = () => { const f = g.fish.acquire(cfg.SPECIES[0]); f.reset(0, -200); f.behavior='cruise'; f.speed=100; f.dir=1; return f; };
    g.hitStopT = 0; const f1 = mk(); const x0 = f1.x;
    for (let i=0;i<30;i++) window.step(1);
    const free = f1.x - x0;
    g.fish.releaseAll();
    g.hitStopT = 999; const f2 = mk(); const x1 = f2.x;
    for (let i=0;i<30;i++) window.step(1);
    const stopped = f2.x - x1;
    g.hitStopT = 0;
    return { free: +free.toFixed(2), stopped: +stopped.toFixed(2), ratio: +(stopped / free).toFixed(3),
      scale: cfg.TUNING.hitStopScale };})())`));
  check('B3 定格**真的把世界放慢**（同样 30 帧，位移只剩 5% 左右）',
    b3.free > 20 && Math.abs(b3.ratio - b3.scale) < 0.05,
    `正常 ${b3.free} → 定格 ${b3.stopped}（比值 ${b3.ratio}，期望 ${b3.scale}）`);

  // ═══════════════════════════════════════════════════════════
  // C 粒子
  // ═══════════════════════════════════════════════════════════
  console.log('\n── C 粒子（特效 #2 / #5 / #8）──');

  const c1 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const w=g.world;
    w.clearParticles();
    // 猛喷 60 次 × 14 个 = 840 个请求，远超上限
    for (let i=0;i<60;i++) w.burstSparks(0, -100, 14, 1);
    let live = 0;
    for (const pool of [w.coins, w.bubbles, w.sparks, w.chunks]) {
      for (const p of pool.items) if (p.active) live++;
    }
    return { live };})())`));
  check(`C1 全局粒子**上限 ${C.MAX_PARTICLES}**：一次性请求 840 个，实际存活不超过上限（超了直接丢弃）`,
    c1.live > 0 && c1.live <= C.MAX_PARTICLES,
    `请求 840 个 → 实际存活 ${c1.live}（上限 ${C.MAX_PARTICLES}，取自 config.js）`);

  const c2 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const w=g.world;
    w.clearParticles();
    w.burstCoins(0, -100, 6);
    const ps = w.coins.items.filter(p=>p.active);
    const ups = ps.filter(p=>p.vy > 0).length;          // 喷泉：初速向上
    const bounce = ps.filter(p=>p.bounce === 1 && p.bounceY === -100).length;
    // 跑够久：应该有人落回来弹过（bounce 自减到 0）
    // ⚠ 用 window.step 而不是 world.update(dt) —— 后者还要一个相机参数，
    //   直接调会抛错（那样整个探针返回 undefined，看起来像"金币没有初速"）。
    for (let i=0;i<70;i++) window.step(1);
    const bounced = ps.filter(p=>p.bounce === 0 && p.active).length;
    return { n: ps.length, ups, bounce, bounced, vx: ps.length ? Math.round(Math.abs(ps[0].vx)) : 0, vy: ps.length ? Math.round(ps[0].vy) : 0 };})())`));
  check('C2 金币是**喷泉**（初速向上 + 落在起点弹一次），不是全向炸开',
    c2.n === 6 && c2.ups === 6 && c2.bounce === 6 && c2.bounced > 0,
    `${c2.n} 个金币全部朝上（vy=${c2.vy}，vx=${c2.vx} 明显更小）· 带弹跳标记 ${c2.bounce} · 跑 1.2s 后已弹过 ${c2.bounced}`);

  const c3 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const w=g.world;
    w.clearParticles();
    const before = w.rings ? w.rings.filter(r=>r.active).length : -1;
    w.burstExplosion(0, -100, 40);
    const after = w.rings ? w.rings.filter(r=>r.active).length : -1;
    // 环是**共用几何体**：所有环的 geometry 必须是同一个对象
    const geos = w.rings ? new Set(w.rings.map(r=>r.mesh.geometry.uuid)).size : -1;
    return { before, after, ringCount: w.rings ? w.rings.length : -1, geos, target: w.rings ? Math.round(w.rings.find(r=>r.active).target) : 0 };})())`));
  check('C3 爆炸自动带一圈**冲击波环**，而且所有环**共用同一个 geometry**（不每个效果建一份）',
    c3.after === c3.before + 1 && c3.geos === 1 && c3.target === 60,
    `爆炸前 ${c3.before} 个活跃环 → 之后 ${c3.after} 个 · 环池 ${c3.ringCount} 个但只有 ${c3.geos} 份 geometry · 目标直径 ${c3.target}`);

  const c4 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const w=g.world;
    // 水花分级：身价越高 n 越大。这里直接按 game.js 的公式复算一遍，验证单调。
    const nOf = (v) => Math.round(6 + Math.min(28, v / 190 * 28));
    const cheap = nOf(6), mid = nOf(680), rich = nOf(5320);
    // ⚠ burstSplash 里参数化的部分是 **sparks**（n 个），bubbles 是固定 16 个 ——
    //   数 bubbles 的话两次都是 16，看起来像"分级没生效"，其实是数错了池子。
    w.clearParticles();
    w.burstSplash(0, 0, cheap); const a = w.sparks.items.filter(p=>p.active).length;
    w.clearParticles();
    w.burstSplash(0, 0, rich); const b = w.sparks.items.filter(p=>p.active).length;
    return { cheap, mid, rich, a, b };})())`));
  check('C4 入水水花**按身价分级**（6 ~ 34），且真的传到了粒子数上',
    c4.cheap >= 6 && c4.cheap <= 10 && c4.rich === 34 && c4.mid > c4.cheap && c4.b > c4.a,
    `身价 6 → ${c4.cheap} 个 · 680 → ${c4.mid} 个 · 5320 → ${c4.rich} 个（实测粒子 ${c4.a} vs ${c4.b}）`);

  // ═══════════════════════════════════════════════════════════
  // D 覆盖层
  // ═══════════════════════════════════════════════════════════
  console.log('\n── D 覆盖层（特效 #4 / #10 / #11）──');

  const d1 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    const maxD = cfg.mapMaxDepth(g.map);
    g.hook.y = 0; g._vig01 = 0; g._update(1/60);
    const shallow = parseFloat(document.getElementById('vignette').style.opacity) || 0;
    g.hook.y = -maxD; g._vig01 = 0; g._update(1/60);
    const deep = parseFloat(document.getElementById('vignette').style.opacity) || 0;
    return { shallow, deep, maxD };})())`));
  check('D1 深度 vignette：海面几乎不显示，潜到本图最底最重',
    d1.shallow < 0.02 && d1.deep > 0.5,
    `0m → ${d1.shallow} · −${d1.maxD}m → ${d1.deep}`);

  const d2 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    const op = () => parseFloat(document.getElementById('comboFx').style.opacity) || 0;
    g.ui.setCombo(3, 1); const low = op();
    g.ui.setCombo(10, 1.5); const at10 = op();
    g.ui.setCombo(30, 3); const high = op();
    g.ui.setCombo(0, 1); const off = op();
    return { low, at10, high, off };})())`));
  check('D2 连击色差：**阈值 10** —— 低于它完全不显示，之后随连击增强，断连归零',
    d2.low === 0 && d2.at10 > 0 && d2.high > d2.at10 && d2.off === 0,
    `连击 3 → ${d2.low} · 10 → ${d2.at10} · 30 → ${d2.high} · 断连 → ${d2.off}`);

  const d3 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.save.charts = { polar: true, lava: true };
    g.save.boats = { owned: ['golden'], current: 'golden' };
    g.enterMap('lava');
    const op = () => parseFloat(document.getElementById('bossShift').style.opacity) || 0;
    const before = op();
    g._resetRun(); g.state = 'descend'; g.hook.y = -1400; g.run.caught = 5;
    g._checkBossTrigger();
    const during = op();
    g._endBoss();
    const after = op();
    return { before, during, after, spawned: true };})())`));
  check('D3 Boss 色偏：出场亮起、离场熄灭',
    d3.before === 0 && d3.during === 1 && d3.after === 0,
    `出场前 ${d3.before} → 在场 ${d3.during} → 离场后 ${d3.after}`);
  await shot('D3-boss-shift');

  const d4 = J(await ev(`JSON.stringify((()=>{
    const ids = ['vignette', 'comboFx', 'bossShift', 'screenFlash'];
    const pe = ids.map(id => { const el = document.getElementById(id); return el ? getComputedStyle(el).pointerEvents : 'missing'; });
    const z = ids.map(id => { const el = document.getElementById(id); return el ? +getComputedStyle(el).zIndex : -1; });
    return { ids, pe, z };})())`));
  check('D4 四个全屏覆盖层**都不拦点击**（`pointer-events: none`）—— 它们盖住整个画面',
    d4.pe.every((p) => p === 'none'),
    d4.ids.map((id, i) => `${id}:${d4.pe[i]}`).join(' '));

  // ═══════════════════════════════════════════════════════════
  // E 冒烟
  // ═══════════════════════════════════════════════════════════
  console.log('\n── E 冒烟 ──');

  const smoke = J(await ev(`(()=>{try{const g=window.__game; const cfg=window.__cfg;
    cfg.TUNING.airSettleGrace = 1.8;
    g.hitStopT = 0;
    g.save.levels = Object.fromEntries(cfg.UPGRADE_ORDER.map(k=>[k, k==='winch'?0:cfg.MAX_LEVEL]));
    g.applyUpgrades();
    g.showIdle();
    for (let i=0;i<10;i++) window.step(1);
    g.enterDescend();
    const seen = new Set();
    for (let i=0;i<60*90;i++) { window.step(1); seen.add(g.state); if (g.state === 'result') break; }
    return JSON.stringify({ seen: [...seen], caught: g.run.caught, shot: g.run.shot });
    }catch(e){return JSON.stringify({ err: e.message });}})()`));
  check('E1 带全套特效跑完整一竿（下潜 → 收线 → 上升 → 空中 → 结算）',
    smoke.seen.includes('descend') && smoke.seen.includes('ascend') && smoke.seen.includes('result'),
    `${smoke.seen.join(' → ')} · 串上 ${smoke.caught} 条 / 击落 ${smoke.shot}`);
  await shot('E1-full-run');

  const clean = errors.filter((e) => !/favicon|AudioContext/i.test(e));
  check('E2 全程控制台零报错', clean.length === 0, clean.slice(0, 3).join(' | ') || 'clean');

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n================  ${pass}/${results.length} 通过  ================\n`);
  fs.writeFileSync(path.resolve('.dev/verify13.json'),
    JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 2));
  if (pass !== results.length) process.exitCode = 1;
} finally {
  try { chrome.kill(); } catch (_) { /* ignore */ }
}
