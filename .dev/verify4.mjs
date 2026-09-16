/**
 * verify4.mjs — 第 5 轮改造的回归验证
 *
 * 覆盖：
 *   · 主界面大标题（海域名称 + 前往的最低深度），随鱼线等级推进
 *   · 船随小波浪缓缓摇晃，且竿梢跟着船走
 *   · 抛竿 = 空中抛物线，滞空期间可左右移动鱼钩、决定落点
 *   · 水下明显显示「鱼线能到的最深」与「本竿已达最深」两条线
 *
 * 用法：node .dev/verify4.mjs [url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9334;
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-v4');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  · ' + detail : ''}`);
}

async function getTarget(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const p = list.find((t) => t.type === 'page');
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch (_) { /* 还没起来 */ }
    await sleep(300);
  }
  throw new Error('Chrome CDP 未就绪');
}

const profile = path.resolve('.dev/profile-v4-' + Date.now());
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=430,932', '--hide-scrollbars',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

let ws;
try {
  ws = new WebSocket(await getTarget(PORT));
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let msgId = 0;
  const pending = new Map();
  const errors = [];

  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push('EXCEPTION: ' + (d.exception?.description || d.text));
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
      return { __err: (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text || '').split('\n')[0] };
    }
    return r.result?.result?.value;
  };
  const J = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
  };

  const PE = (type, nx, ny) => `(()=>{
    const c = document.getElementById('game');
    const r = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent('${type}', {
      clientX: r.left + r.width * ${nx}, clientY: r.top + r.height * ${ny},
      pointerId: 1, bubbles: true, cancelable: true,
    }));
    return 'ok';
  })()`;

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3500);

  // ── 冻结 rAF，改手动定步长 ──
  const froze = await ev(`(()=>{const g=window.__game; if(!g) return 'no game'; g._loop = () => {};
    window.step = (n) => { const dt0 = 1/60;
      for (let i=0;i<n;i++){
        if (g.slowmoT > 0) { g.slowmoT -= dt0; if (g.slowmoT <= 0) g.timeScale = 1; }
        const dt = dt0 * g.timeScale; g.time += dt; g._update(dt);
      }
      g.world.render();
      return 'ok';
    };
    return 'ok';})()`);
  if (froze !== 'ok') { console.error('冻结 rAF 失败:', froze); }
  await sleep(300);

  // ═══════════════════════════════════════════════════════
  // V1~V4 主界面大标题（迭代 6 改版）：
  //   大标题 = **地图名**，固定「宁静海湾」，不随鱼线等级 / 深度变化
  //   副标题 = 这张地图的探索进度（已探索至 −Xm / 可下潜至 −430m）
  // ═══════════════════════════════════════════════════════
  // ⚠ 批 2 之后「探索进度」读的是**本图**的最深记录 `save.mapBest[mapId]`，
  //   不再是全局 `bestDepth`（换图之后全局纪录会被别的海污染）。
  //   这两个字段是两个语义，夹具里都得给：bestDepth 是全局最深（结算面板用），
  //   mapBest 是"这张图潜到过哪"（大标题 / 航线 App 用）。
  await ev(`(()=>{ const g=window.__game;
    g.save.levels.line = 0; g.save.bestDepth = 0; g.save.mapBest = {};
    g.applyUpgrades(); g.showIdle(); return 'ok'; })()`);
  await ev('window.step(30)');

  const t0 = J(await ev(`JSON.stringify({
    on: document.getElementById('seaTitle').classList.contains('on'),
    name: document.getElementById('seaName').textContent,
    goal: document.getElementById('seaGoal').textContent,
    line: window.__game.save.levels.line,
    maxDepth: window.__game.maxDepth,
  })`));
  check('V1 待机界面显示海域大标题', t0.on && !!t0.name,
    `on=${t0.on} name=${t0.name} goal=${t0.goal}`);
  check('V2 没下潜过时副标题是「可下潜至 −860m」', t0.goal === '可下潜至 −860m',
    `${t0.goal}（鱼线 Lv${t0.line} 上限 ${t0.maxDepth}m）`);
  check('V2b 标题固定是地图名「宁静海湾」（不再是随等级变化的海域名）',
    t0.name === '宁静海湾', `${t0.name} / ${t0.goal}`);
  await shot('V1-idle-title');

  // 玩家在这片海域潜过 → 副标题换成「已探索至 −XXm」（需求⑦）
  await ev(`(()=>{ const g=window.__game;
    g.save.bestDepth = 90; g.save.mapBest = { 'calm-bay': 90 };
    g.showIdle(); return 'ok'; })()`);
  await ev('window.step(20)');
  const t0b = J(await ev(`JSON.stringify({
    name: document.getElementById('seaName').textContent,
    goal: document.getElementById('seaGoal').textContent,
  })`));
  check('V2c 潜过之后副标题显示「已探索至 −XXm」',
    t0b.name === '宁静海湾' && t0b.goal === '已探索至 −90m', `${t0b.name} / ${t0b.goal}`);

  // 鱼线升满 → 海域名推进到海沟
  await ev(`(()=>{ const g=window.__game; g.save.levels.line = 4;
    g.save.bestDepth = 300; g.save.mapBest = { 'calm-bay': 300 };
    g.applyUpgrades(); g.showIdle(); return 'ok'; })()`);
  await ev('window.step(30)');
  const t1 = J(await ev(`JSON.stringify({
    name: document.getElementById('seaName').textContent,
    goal: document.getElementById('seaGoal').textContent,
  })`));
  check('V3 鱼线满级（420m）后标题仍是地图名 · 已探索至 −300m',
    t1.name === '宁静海湾' && t1.goal === '已探索至 −300m', `${t1.name} / ${t1.goal}`);
  await shot('V2-idle-title-maxline');

  // 到过的深度按**地图上限**钳（430m），不再按当前海域的底钳
  await ev(`(()=>{ const g=window.__game; g.save.levels.line = 1;
    g.save.bestDepth = 260; g.save.mapBest = { 'calm-bay': 260 };
    g.applyUpgrades(); g.showIdle(); return 'ok'; })()`);
  await ev('window.step(20)');
  const t2 = J(await ev(`JSON.stringify({
    name: document.getElementById('seaName').textContent,
    goal: document.getElementById('seaGoal').textContent,
  })`));
  check('V4 Lv1 时标题仍是地图名，深度按地图上限钳位（260m 原样显示）',
    t2.name === '宁静海湾' && t2.goal === '已探索至 −260m', `${t2.name} / ${t2.goal}`);

  // 标题在抛竿后要收起（下潜阶段由深度尺负责显示目标）
  await ev(`(()=>{ window.__game.enterDescend(); return 'ok'; })()`);
  await ev('window.step(4)');
  const t3 = J(await ev(`JSON.stringify({
    on: document.getElementById('seaTitle').classList.contains('on'),
    castAir: window.__game.castAir,
  })`));
  check('V5 抛竿后大标题收起', !t3.on && t3.castAir === true,
    `on=${t3.on} castAir=${t3.castAir}`);

  // ═══════════════════════════════════════════════════════
  // V6~V7 船随波浪摇晃 + 竿梢跟随
  // ═══════════════════════════════════════════════════════
  await ev(`(()=>{ window.__game.showIdle(); return 'ok'; })()`);
  const samples = [];
  for (let i = 0; i < 12; i++) {
    // 摇晃的慢波周期约 11.6s，采样窗必须够长才测得到幅度（0.5s × 12 = 6s）
    await ev('window.step(30)');
    samples.push(J(await ev(`JSON.stringify({
      t: +window.__game.world.time.toFixed(3),
      rot: +window.__game.world.boat.rotation.z.toFixed(5),
      y: +window.__game.world.boat.position.y.toFixed(3),
      tipY: +window.__game.world.rodTip.y.toFixed(3),
      tipX: +window.__game.world.rodTip.x.toFixed(3),
    })`)));
  }
  const rotSpan = Math.max(...samples.map((s) => s.rot)) - Math.min(...samples.map((s) => s.rot));
  const ySpan = Math.max(...samples.map((s) => s.y)) - Math.min(...samples.map((s) => s.y));
  const tipSpan = Math.max(...samples.map((s) => s.tipY)) - Math.min(...samples.map((s) => s.tipY));
  const tipXSpan = Math.max(...samples.map((s) => s.tipX)) - Math.min(...samples.map((s) => s.tipX));
  check('V6 船在左右摇晃（roll 变化幅度够看得见）', rotSpan > 0.05,
    `roll 摆幅 ${rotSpan.toFixed(4)} rad ≈ ${(rotSpan * 57.3).toFixed(2)}°`);
  check('V7 船在随浪起伏（y 随时间变化）', ySpan > 1.2,
    `起伏幅度 ${ySpan.toFixed(3)} 世界单位`);
  check('V8 竿梢跟着船动（否则鱼线会脱开竿梢）', tipSpan > 1.0 && tipXSpan > 0.5,
    `竿梢 Δy=${tipSpan.toFixed(3)} Δx=${tipXSpan.toFixed(3)}`);

  // ═══════════════════════════════════════════════════════
  // V9~V13 抛竿：空中抛物线 + 滞空可操控
  // ═══════════════════════════════════════════════════════
  // 注：每帧把 targetX 钉住，模拟"玩家一直往某边拖"
  await ev(`(()=>{ const g = window.__game;
    window.castWith = (tx) => {
      g.showIdle();
      g.enterDescend();
      const tip = { x: g.world.rodTip.x, y: g.world.rodTip.y };
      let maxY = -1e9, guard = 0, airborneFrames = 0;
      while (g.castAir && guard++ < 600) {
        g.targetX = tx;
        g._update(1/60);
        maxY = Math.max(maxY, g.hook.y);
        airborneFrames++;
      }
      return { startX: tip.x, startY: tip.y, maxY, landX: g.hook.x, landY: g.hook.y,
               castAir: g.castAir, frames: airborneFrames };
    };
    return 'ok'; })()`);

  const straight = J(await ev('JSON.stringify(window.castWith(window.__game.world.rodTip.x))'));
  check('V9 抛竿时鱼钩飞到空中（高于水面 40m 以上）', straight.maxY > 40,
    `起抛 y=${straight.startY.toFixed(1)} → 最高 ${straight.maxY.toFixed(1)}m，滞空 ${straight.frames} 帧`);
  check('V10 滞空时长合理（0.8~1.6s）',
    straight.frames / 60 >= 0.8 && straight.frames / 60 <= 1.6,
    `${(straight.frames / 60).toFixed(2)}s`);
  check('V11 落水后交回下潜（castAir=false，钩在水面附近）',
    straight.castAir === false && straight.landY <= 0 && straight.landY > -20,
    `castAir=${straight.castAir} 落点 y=${straight.landY.toFixed(1)}`);

  // 抛竿全程鱼钩必须在画面内 —— 否则"从空中抛下"玩家根本看不到
  const vis = J(await ev(`(()=>{ const g=window.__game;
    g.showIdle(); g.enterDescend();
    const rows = [];
    for (let i=0;i<200;i++){
      g.targetX = g.world.rodTip.x;
      g._update(1/60);
      if (!g.castAir) break;
      const w = g.world;
      rows.push({ y: +g.hook.y.toFixed(1),
                  ny: +(0.5 - (g.hook.y - w.camY) / w.viewH).toFixed(3) });
    }
    const nys = rows.map(r=>r.ny);
    return JSON.stringify({ minNy: Math.min(...nys), maxNy: Math.max(...nys),
      apex: Math.max(...rows.map(r=>r.y)),
      tipY: +g.world.rodTip.y.toFixed(1), n: rows.length }); })()`));
  check('V11b 抛竿全程鱼钩都在画面内（可见）',
    vis.minNy > 0.02 && vis.maxNy < 0.72,
    `鱼钩 ny ∈ [${vis.minNy}, ${vis.maxNy}]（0=顶部 1=底部），最高 ${vis.apex}m vs 竿梢 ${vis.tipY}m，${vis.n} 帧`);

  // 空中往右拖 → 落点明显右移
  const right = J(await ev('JSON.stringify(window.castWith(56))'));
  const left = J(await ev('JSON.stringify(window.castWith(-56))'));
  check('V12 空中左右移动能改变落点（往右拖落点右移）',
    right.landX > straight.landX + 12,
    `直抛 x=${straight.landX.toFixed(1)} → 右拖 x=${right.landX.toFixed(1)}`);
  check('V13 空中左右移动能改变落点（往左拖落点左移）',
    left.landX < straight.landX - 12,
    `直抛 x=${straight.landX.toFixed(1)} → 左拖 x=${left.landX.toFixed(1)}`);

  // 走真实输入链路（指针事件）再验一次，确保不是只有直接改 targetX 才有效
  const dragSteer = J(await ev(`(()=>{ const g=window.__game;
    g.showIdle(); g.enterDescend();
    const c = document.getElementById('game');
    const r = c.getBoundingClientRect();
    const PE = (type, nx, ny) => c.dispatchEvent(new PointerEvent(type, {
      clientX: r.left + r.width * nx, clientY: r.top + r.height * ny,
      pointerId: 1, bubbles: true, cancelable: true }));
    for (let i=0;i<10;i++) g._update(1/60);
    const x0 = g.targetX;
    PE('pointerdown', 0.5, 0.5);
    for (let i=0;i<12;i++){ PE('pointermove', 0.96, 0.5); g._update(1/60); }
    const x1 = g.targetX;
    let guard=0; while (g.castAir && guard++ < 600) g._update(1/60);
    return JSON.stringify({ x0:+x0.toFixed(1), x1:+x1.toFixed(1), landX:+g.hook.x.toFixed(1) }); })()`));
  check('V13b 走真实指针拖动也能在空中改变落点',
    dragSteer.x1 > dragSteer.x0 + 20 && dragSteer.landX > 15,
    `targetX ${dragSteer.x0} → ${dragSteer.x1}，落点 x=${dragSteer.landX}`);

  // 空中截图（停在最高点附近）
  await ev(`(()=>{ const g=window.__game; g.showIdle(); g.enterDescend();
    for (let i=0;i<26;i++){ g._update(1/60); } return 'ok'; })()`);
  await shot('V3-cast-air');

  // 抛竿滞空期间不能收线
  const reelGuard = J(await ev(`(()=>{ const g=window.__game;
    g.showIdle(); g.enterDescend();
    for (let i=0;i<6;i++) g._update(1/60);
    const before = g.state; g._reel();
    const after = g.state;
    return JSON.stringify({ before, after, castAir: g.castAir }); })()`));
  check('V14 滞空期间收线无效（钩子还在天上）',
    reelGuard.before === 'descend' && reelGuard.after === 'descend',
    `${reelGuard.before} → ${reelGuard.after}`);

  // ═══════════════════════════════════════════════════════
  // V15~V18 水下：鱼线极限 + 已潜深度
  // ═══════════════════════════════════════════════════════
  await ev(`(()=>{ const g=window.__game;
    g.save.levels.line = 2; g.applyUpgrades();      // 上限 240m
    g.showIdle(); g.enterDescend();
    // 走完抛竿，再往下潜一段
    let guard = 0;
    while (g.castAir && guard++ < 600) g._update(1/60);
    for (let i=0;i<240;i++) { if (g.state !== 'descend') break; g._update(1/60); }
    return 'ok'; })()`);
  await ev('window.step(2)');

  const under = J(await ev(`JSON.stringify({
    state: window.__game.state,
    maxDepth: window.__game.maxDepth,
    reached: Math.round(window.__game.maxDepthReached),
    rulerOn: document.getElementById('ruler').classList.contains('on'),
    limitTop: window.__game.ui._limit.style.top,
    limitText: window.__game.ui._limitTag.textContent,
    limitShown: window.__game.ui._limit.style.display !== 'none',
    markerTop: window.__game.ui._marker.style.top,
    markerText: window.__game.ui._markerTag.textContent,
    chipDepth: document.getElementById('depthVal').textContent,
    chipLine: document.getElementById('lineVal').textContent,
  })`));

  check('V15 水下显示深度尺', under.rulerOn && under.state !== 'idle',
    `state=${under.state} rulerOn=${under.rulerOn}`);
  check('V16 显示「当前鱼线能到达的最低深度」', under.limitShown && under.limitText === `鱼线 −${under.maxDepth}m`,
    `标签「${under.limitText}」@ ${under.limitTop}`);
  check('V17 显示「本竿已经达到的最低深度」', /^已潜 −\d+m$/.test(under.markerText || ''),
    `标签「${under.markerText}」@ ${under.markerTop}`);
  check('V18 顶部 chip 同时给出「已潜 / 上限」',
    Number(under.chipDepth) === under.reached && Number(under.chipLine) === under.maxDepth,
    `${under.chipDepth} / ${under.chipLine}m（已达 ${under.reached}m）`);
  await shot('V4-underwater-depth');

  // 两条线位置应当随数值走：鱼线 240m 在 51%，已潜深度在它上方
  const limitPct = parseFloat(under.limitTop);
  const markerPct = parseFloat(under.markerTop);
  check('V19 已潜游标不超过鱼线极限线', markerPct <= limitPct + 0.01,
    `已潜 ${markerPct.toFixed(1)}% ≤ 鱼线 ${limitPct.toFixed(1)}%`);

  // 满级鱼线 420m：迭代 6 之后尺子总量 = 地图深度上限 430m，
  // 所以极限线落在 420/430 ≈ 97.7% 处（仍不到底），应当照常显示。
  await ev(`(()=>{ const g=window.__game; g.save.levels.line = 4; g.applyUpgrades(); return 'ok'; })()`);
  const maxed = J(await ev(`JSON.stringify({
    shown: window.__game.ui._limit.style.display !== 'none',
    text: window.__game.ui._limitTag.textContent,
    pct: parseFloat(window.__game.ui._limit.style.top),
  })`));
  check('V20 鱼线 Lv4（840m）时极限线落在尺子 97.7% 处且照常显示',
    maxed.shown === true && maxed.text === '鱼线 −840m' && Math.abs(maxed.pct - 97.67) < 0.6,
    `shown=${maxed.shown} 「${maxed.text}」 @ ${maxed.pct}%`);

  // ═══════════════════════════════════════════════════════
  // V21 控制台无报错
  // ═══════════════════════════════════════════════════════
  check('V21 控制台无报错', errors.length === 0, `${errors.length} 条`);
  if (errors.length) for (const e of errors.slice(0, 8)) console.log('   ', e);

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n═══ ${pass}/${results.length} 断言通过 ═══`);
  fs.writeFileSync('.dev/verify4.json',
    JSON.stringify({ pass, total: results.length, results, errors }, null, 2));
} finally {
  try { ws?.close(); } catch (_) { /* ignore */ }
  chrome.kill();
}
