/**
 * shots3.mjs — 只出图不判定：看深海地形 / 黑暗 / 灯具 / 待机的实际画面
 * 用法：node .dev/shots3.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9334;
const URL = 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-v3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

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

const profile = path.resolve('.dev/profile-shots-' + Date.now());
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=430,932', '--hide-scrollbars', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

let ws;
try {
  ws = new WebSocket(await getTarget(PORT));
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0; const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;
  const shot = async (n) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) fs.writeFileSync(path.join(OUT, n + '.png'), Buffer.from(r.result.data, 'base64'));
  };

  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3500);

  await ev(`(()=>{const g=window.__game; g._loop = () => {};
    window.step = (n) => { for (let i=0;i<n;i++){ const dt=1/60; g.time+=dt; g._update(dt);} g.world.render(); };
    return 'ok';})()`);
  await sleep(250);

  // 进待机
  await ev('document.getElementById("startBtn").click(); window.step(40);');
  await shot('01-idle');

  // 下潜各深度：直接驱动 world，绕开状态机（否则相机跟着鱼钩跑，出图不可控）
  const depths = [[70, 0], [70, 4], [180, 2], [300, 3], [365, 4]];
  for (const [d, lamp] of depths) {
    await ev(`(()=>{const g=window.__game, w=g.world;
      w.setLamp(${lamp});
      w.viewScale = 1; w._applyView();
      g.ui.showHud(true); g.ui.showShopBtn(true);
      g.ui.setCatchVisible(false); g.ui.setRulerVisible(true); g.ui.showReel(true);
      g.ui.setHint('左右拖动躲开鱼 · 碰到就收线');
      g.ui.setDepth(${d}); g.ui.setZone(g._zoneAt(-${d}));
      g.hook.setVisible(true); g.hook.setPosition(0, -${d} + 40);
      // 把鱼摆到相机附近，顺便看深海里的辨识度
      const lo = -${d} - 110, hi = -${d} + 110;
      const list = g.fish.active;
      list.forEach((f,i)=>{ f.speed = 0; f.bobAmp = 0;
        f.x = (i % 5 - 2) * 22; f.y = lo + ((i * 37) % 220);
        f.mesh.position.set(f.x, f.y, 0); f.mesh.visible = true; });
      w.camX = 0; w.camY = -${d};
      w.update(1/60, {x:0, y:-${d}, rate:999, scale:1, hookY:-${d}+40});
      w.render();
      return 'ok';})()`);
    await shot(`D${d}-lamp${lamp}`);
  }

  // 待机时的商店
  await ev('window.__game.showShop(); window.step(2);');
  await shot('02-shop');

  ws.close();
} catch (e) {
  console.error('出图脚本异常：', e);
} finally {
  try { chrome.kill(); } catch (_) { /* ignore */ }
  setTimeout(() => process.exit(0), 500);
}
