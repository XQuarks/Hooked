/**
 * shots4.mjs — 第 5 轮改动的出图脚本（绕开状态机，直接驱动）
 * 用法：node .dev/shots4.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9336;
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-v4');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const profile = path.resolve('.dev/profile-shots4-' + Date.now());
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=430,932', '--hide-scrollbars', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

let ws;
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
    } catch (_) { /* wait */ }
    if (!target) await sleep(300);
  }
  ws = new WebSocket(target);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let msgId = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
  };

  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3500);

  await ev(`(()=>{const g=window.__game; g._loop=()=>{};
    window.step=(n)=>{for(let i=0;i<n;i++){const dt=1/60; g.time+=dt; g._update(dt);} g.world.render(); return 'ok';};
    return 'ok';})()`);
  await sleep(200);

  // ── 待机（大标题）──
  await ev(`(()=>{ const g=window.__game; g.save.levels.line=0; g.applyUpgrades(); g.showIdle(); return 'ok'; })()`);
  await ev('window.step(40)');
  await shot('S1-idle');

  // ── 抛竿：从竿梢甩到空中再落水 ──
  await ev(`(()=>{ const g=window.__game; g.showIdle(); g.enterDescend(); return 'ok'; })()`);
  for (const [n, tag] of [[6, 'a-6f'], [14, 'b-14f'], [26, 'c-26f-apex'], [40, 'd-40f'], [52, 'e-52f']]) {
    await ev(`window.step(${n === 6 ? 6 : 8})`);
    await shot(`S2-cast-${tag}`);
  }
  await ev('window.step(40)');
  await shot('S3-cast-landed');

  // ── 水下：两条深度线 ──
  await ev(`(()=>{ const g=window.__game;
    g.save.levels.line=3; g.applyUpgrades();       // 上限 330m
    g.showIdle(); g.enterDescend();
    let guard=0; while (g.castAir && guard++ < 600) g._update(1/60);
    for (let i=0;i<900;i++){ if (g.state!=='descend') break; g._update(1/60); }
    return 'ok'; })()`);
  await ev('window.step(2)');
  await shot('S4-underwater-limit');
  console.log('hookY=', await ev('window.__game.hook.y.toFixed(1)'),
              'reached=', await ev('Math.round(window.__game.maxDepthReached)'),
              'limit=', await ev('window.__game.maxDepth'));

  // ── 商店（确认新标题元素不影响商店）──
  await ev(`(()=>{ const g=window.__game; g.save.coins=5000; g.showShop(); return 'ok'; })()`);
  await ev('window.step(20)');
  await shot('S5-shop');
} finally {
  try { ws?.close(); } catch (_) { /* ignore */ }
  chrome.kill();
}
