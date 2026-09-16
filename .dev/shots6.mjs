/**
 * shots6.mjs — 迭代 6 出图：待机（金币 SVG + 手机入口）/ 手机桌面 / 三个 App / 空中旋转序列
 * 用法：node .dev/shots6.mjs [url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9352;
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-v6');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

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

const profile = path.resolve('.dev/profile-shots6-' + Date.now());
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--no-proxy-server', '--proxy-bypass-list=*',
  '--disable-extensions', '--mute-audio',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=430,932', '--hide-scrollbars', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

let ws;
try {
  ws = new WebSocket(await getTarget(PORT));
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const id = ++msgId; pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return { __err: (r.result.exceptionDetails.exception?.description || '').split('\n')[0] };
    return r.result?.result?.value;
  };
  const shot = async (name, clip) => {
    const params = { format: 'png' };
    if (clip) params.clip = { ...clip, scale: 1 };
    const r = await send('Page.captureScreenshot', params);
    if (r.result?.data) fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
    console.log('  shot', name);
  };
  // 自己撑帧，让 CSS 过渡真的走完（headless 里没有别的帧源时过渡会停住）
  const rafWait = (ms) => ev(`new Promise((res)=>{const t0=performance.now();
    const tick=()=>{ if(performance.now()-t0>=${ms}) res('ok'); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);})`);

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3500);

  // 造点数据：金币、等级、图鉴若干条
  await ev(`(()=>{const g=window.__game;
    g.save.coins=4820; g.save.bestDepth=268; g.save.bestAlt=612; g.save.casts=37;
    g.save.levels.line=2; g.save.levels.hook=1; g.save.levels.power=2;
    g.save.codex={sardine:{n:9,best:8},clown:{n:5,best:13},puffer:{n:2,best:10},
      mackerel:{n:3,best:17},blobfish:{n:2,best:35},snapper:{n:1,best:26},
      butterfly:{n:2,best:30},tuna:{n:1,best:45},lantern:{n:1,best:70},squid:{n:1,best:88}};
    g.ui.setCoins(g.save.coins); g.applyUpgrades(); return 'ok';})()`);
  await ev('document.getElementById("startBtn").click()');
  await rafWait(900);

  await shot('S1-idle');

  // 手机桌面
  await ev('document.getElementById("phoneBtn").click()');
  await rafWait(700);
  await shot('S2-phone-home');

  await ev(`document.querySelector('[data-app="shop"]').click()`);
  await rafWait(450);
  await shot('S3-phone-shop');

  await ev(`document.querySelector('[data-back]').click()`);
  await rafWait(320);
  await ev(`document.querySelector('[data-app="codex"]').click()`);
  await rafWait(450);
  await shot('S4-phone-codex-top');
  await ev(`document.getElementById('pApp').scrollTop = 900`);
  await rafWait(260);
  await shot('S5-phone-codex-mid');
  await ev(`document.getElementById('pApp').scrollTop = 1e6`);
  await rafWait(260);
  await shot('S6-phone-codex-bottom');

  await ev(`document.querySelector('[data-back]').click()`);
  await rafWait(320);
  await ev(`document.querySelector('[data-app="settings"]').click()`);
  await rafWait(450);
  await shot('S7-phone-settings');

  // 空中旋转：冻住 rAF，手动步进，连拍 4 帧
  await ev('document.querySelector("[data-back]").click()');
  await rafWait(260);
  await ev(`(()=>{const g=window.__game;
    g._loop = () => {};
    window.step = (n) => { for (let i=0;i<n;i++) g._update(1/60); g.world.render(); };
    return 'ok';})()`);
  await sleep(240);
  await ev(`(()=>{const g=window.__game;
    g.closePhone(); g.enterDescend();
    // 跳过下潜，直接造一竿空中鱼：手动塞 4 条不同价位的鱼上钩
    const ids=['sardine','tuna','sword','manta'];
    for (const id of ids) {
      const def = g.fish.active.find(f=>f.def.id===id);
      if (def) { def.hook(); g.caught.push(def); g.ui.addCatch(def); }
    }
    g.enterAir();
    return g.caught.length;})()`);
  await ev('window.step(6)');
  for (let i = 0; i < 4; i++) {
    await ev('window.step(18)');
    await shot('S8-spin-' + (i + 1));
  }
  console.log('spin state:', await ev(`JSON.stringify(window.__game.airFish.map(f=>({id:f.def.id, spin:+f.spin.toFixed(1), rz:+(f.mesh.rotation.z%6.283).toFixed(2), rx:+(f.mesh.rotation.x%6.283).toFixed(2), ry:+(f.mesh.rotation.y%6.283).toFixed(2)})))`));
} finally {
  try { ws && ws.close(); } catch (_) { /* ignore */ }
  chrome.kill();
}
