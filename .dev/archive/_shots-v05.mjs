/**
 * _shots-v05.mjs — v0.5「删 6 项 + 铅坠直达深度 + 绞盘快速回收」的观感复核图（一次性探针）
 *
 * 为什么必须出图：这两个新东西**断言测不到"看起来对不对"** ——
 *   ① 快速回收按钮和收线按钮会不会被认成同一个东西；
 *   ② 直达深度跳下去那一下画面有没有"断层感"；
 *   ③ 商店里铅坠那一行下面挂的控件像不像"这一行的附属品"。
 *
 * 用法：node .dev/archive/_shots-v05.mjs
 * 出图：.dev/shots-v05/
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9388;
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-v05');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(OUT, { recursive: true });

async function getTarget(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const p = list.find((t) => t.type === 'page');
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch (_) { /* 等 */ }
    await sleep(300);
  }
  throw new Error('CDP 未就绪');
}

const profile = path.resolve('.dev/profile-v05-' + Date.now());
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=430,932', '--hide-scrollbars', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

try {
  const ws = new WebSocket(await getTarget(PORT));
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0; const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expr) => (await send('Runtime.evaluate',
    { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) { fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64')); console.log('  shot', name); }
  };

  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL }); await sleep(3400);
  await ev('document.getElementById("startBtn").click()'); await sleep(400);
  await ev(`(async()=>{ window.__cfg = await import('./src/config.js'); return 'ok'; })()`);

  // 冻结 rAF，手动定步长（不然"某一帧"根本不可控）
  await ev(`(()=>{const g=window.__game; g._loop = () => {};
    window.step = (n) => { const dt0 = 1/60;
      for (let i=0;i<n;i++){ g.time += dt0; g._update(dt0); }
      g.world.render(); return 'ok'; }; return 'ok';})()`);

  // ① 上升阶段：买了绞盘 → 快速回收按钮应该和收线按钮一起出现在画面右下
  // ⚠ 必须把 `ascendRampT` 清零：不清的话 _updateAscend 走"起步缓动"分支，
  //   每一帧都把钩子按曲线插值回 `ascendFrom`（水面），手动设的深度会被抹掉，
  //   出图就变成"钩子贴在水面"的假象（第一次出图就踩了这个）。
  await ev(`(()=>{const g=window.__game; const cfg=window.__cfg;
    g.save.levels.winch = 1; g.save.levels.line = 4; g.save.levels.hook = 3;
    g.applyUpgrades(); g.showIdle(); g.enterDescend();
    let guard=0; while (g.castAir && guard++<400) window.step(1);
    g.state = 'descend'; g.reelPre = 0; g._beginAscend();
    g.ascendRampT = 0;
    g.hook.setPosition(0, -300); g.hook.y = -300;
    g.maxDepthReached = 300;
    window.step(1); return 'ok';})()`);
  await sleep(200); await shot('01-ascend-fast-reel');

  // ② 按下之后：按钮变灰 + 飘字"快速回收 ▲▲"
  await ev(`(()=>{const g=window.__game; g.fastReelNow(); window.step(1); return 'ok';})()`);
  await sleep(120); await shot('02-fast-reel-used');

  // ③ 直达深度：开竿直接落到 −500m，看落点有没有断层感
  await ev(`(()=>{const g=window.__game;
    g.save.drop = { on: true, depth: 500 };
    g.showIdle(); g.enterDescend();
    let guard=0; while (g.castAir && guard++<400) window.step(1);
    window.step(3); return 'ok';})()`);
  await sleep(200); await shot('03-drop-to-500');

  // ④ 商店：铅坠那一行 + 它下面的直达控件（开着的状态）
  // ⚠ openPhone() 只在 IDLE 下生效（手机里没有抛竿入口，所以它是"船上才能开"的界面）——
  //   上一竿结束时停在 descend/ascend，直接 openPhone() 会被静默忽略。
  await ev(`(()=>{const g=window.__game; g.showIdle();
    g.save.coins = 99999999;
    g.save.levels.sinker = 9; g.save.drop = { on: true, depth: 400 };
    g.applyUpgrades();
    g.openPhone(); g.ui.openApp('shop'); return 'ok';})()`);
  await sleep(500);
  await ev(`(()=>{const b=document.querySelector('#pApp .p-app-body'); if(b) b.scrollTop=140; return 'ok';})()`);
  await sleep(180); await shot('04-shop-drop-on');
} finally {
  chrome.kill();
}
