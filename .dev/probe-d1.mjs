/**
 * probe-d1.mjs — 单点复现 verify5 的 D1 场景（勾中鱼时弹鱼名 + 写图鉴），
 * 把中间每一步的状态都打出来，用来定位"鱼为什么没被勾上"。
 *
 * 用法：node .dev/probe-d1.mjs [url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9361;
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const profile = path.resolve('.dev/profile-probe-d1-' + Date.now());
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--no-proxy-server', '--proxy-bypass-list=*',
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
      errors.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const id = ++msgId; pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) {
      return { __err: (r.result.exceptionDetails.exception?.description || '').split('\n')[0] };
    }
    return r.result?.result?.value;
  };
  const log = (label, v) => console.log(`\n── ${label} ──\n` + (typeof v === 'string' ? v : JSON.stringify(v, null, 1)));

  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3500);

  // 和 verify5 一样：先等标题页，再进游戏，冻结 rAF
  log('boot', await ev(`(()=>{const g=window.__game; return g? g.state : 'no game';})()`));
  await ev(`(()=>{const g=window.__game;
    if (!g.__frozen){ const raw=g._loop; g._loop=()=>{}; g.__frozen=true; g.__raw=raw; }
    g.showIdle(); return 'ok';})()`);
  await sleep(400);

  // ── 复现 D1 ──
  log('D1 前置', await ev(`(()=>{const g=window.__game;
    g.save.codex = {};
    g.showIdle(); g.enterDescend();
    return JSON.stringify({state:g.state, castAir:g.castAir, hookY:+g.hook.y.toFixed(1),
      maxDepth:g.maxDepth, lineLv:g.save.levels.line, ascendSpeed:g.ascendSpeed,
      creelLimit:g.creelLimit});})()`));

  log('等 castAir 落地', await ev(`(()=>{const g=window.__game;
    let guard=0; while (g.castAir && guard++<400) window.step(1);
    return JSON.stringify({frames:guard, state:g.state, castAir:g.castAir,
      hookY:+g.hook.y.toFixed(1), maxDepthReached:+g.maxDepthReached.toFixed(1)});})()`));

  log('把鱼挪到 -3000 后 step(20)', await ev(`(()=>{const g=window.__game;
    for (const f of g.fish.active) { f.speed=0; f.bobAmp=0; f.x=0; f.y=-3000; f.mesh.position.set(0,-3000,0); }
    window.step(20);
    const st = {};
    for (const f of g.fish.active) st[f.state] = (st[f.state]||0)+1;
    return JSON.stringify({state:g.state, hookY:+g.hook.y.toFixed(1), 鱼状态:st,
      最深的鱼:Math.min(...g.fish.active.map(f=>+f.y.toFixed(0)))});})()`));

  log('_reel()', await ev(`(()=>{const g=window.__game;
    g._reel();
    return JSON.stringify({state:g.state, reelPre:g.reelPre, hint:document.getElementById('hint').textContent});})()`));

  log('等预备走完 → ascend', await ev(`(()=>{const g=window.__game;
    let guard=0; while (g.state==='descend' && guard++<200) window.step(1);
    return JSON.stringify({frames:guard, state:g.state, reelPre:+g.reelPre.toFixed(3),
      hookY:+g.hook.y.toFixed(1)});})()`));

  log('放鱼 + 等 90 帧', await ev(`(()=>{const g=window.__game;
    const f = g.fish.active.find(x=>!x.def.hazard);
    if (!f) return JSON.stringify({err:'没有非扣钱鱼'});
    f.y = g.hook.y + 6; f.x = g.hook.x; f.mesh.position.set(f.x, f.y, 0);
    const before = {name:f.def.name, state:f.state, immuneT:f.immuneT,
      fY:+f.y.toFixed(1), hookY:+g.hook.y.toFixed(1),
      hookR:+g.hook.radius.toFixed(2), fR:+f.radius.toFixed(2),
      need:+(g.hook.radius+f.radius).toFixed(2)};
    let frames=0;
    while (g.run.caught===0 && frames++<90) window.step(1);
    const p = f.mesh.position;
    return JSON.stringify({before, frames, state:g.state, caught:g.run.caught,
      线长:g.caught.length, fStateNow:f.state, fImmuneNow:+f.immuneT.toFixed(2),
      fYNow:+p.y.toFixed(1), hookYNow:+g.hook.y.toFixed(1),
      距离:+Math.hypot(p.x-g.hook.x, p.y-g.hook.y).toFixed(2),
      codex:Object.keys(g.save.codex),
      floats:[...document.querySelectorAll('#floatLayer .float-txt')].map(e=>e.textContent)});})()`));

  if (errors.length) console.log('\n!! 控制台异常:\n' + errors.join('\n'));
} finally {
  try { chrome.kill(); } catch (_) { /* ignore */ }
}
