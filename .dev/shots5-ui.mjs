/**
 * shots5-ui.mjs — 第 5 轮 UI 出图：图鉴面板 / 主界面标题 / 提示呼吸
 * 用法：node .dev/shots5-ui.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9342;
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-v5');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const profile = path.resolve('.dev/profile-ui5-' + Date.now());
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
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
    return r.result?.result?.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
  };

  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3500);

  // 冻结 rAF，手动步进
  await ev(`(()=>{const g=window.__game; g._loop=()=>{};
    window.step=(n)=>{for(let i=0;i<n;i++){const dt=1/60; g.time+=dt; g._update(dt);} g.world.render(); return 'ok';};
    return 'ok';})()`);
  // CSS 过渡要靠帧推进，自己撑一会儿
  const rafWait = (ms) => ev(`new Promise((res)=>{ const t0=performance.now();
    const tick=()=>{ if(performance.now()-t0>=${ms}) res('ok'); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick); })`);
  await sleep(150);

  // ── 图鉴：只解锁一部分鱼，验证"已知彩色 / 未知黑色剪影" ──
  await ev(`(()=>{ const g=window.__game;
    // ⚠ 等级夹具从**当前存档的键集**推出来（升级项增删时自动跟上），不要手写键名
    const LV = (o={}) => Object.fromEntries(Object.keys(g.save.levels).map(k=>[k, o[k]??0]));
    g.save = { coins: 1240, bestDepth: 210, bestAlt: 640, casts: 18, totalEarned: 5200,
      levels: LV({line:2,hook:1,sinker:1,lamp:1}), codex:{
        sardine:{n:9,best:7}, clown:{n:4,best:12}, mackerel:{n:3,best:17}, puffer:{n:2,best:9},
        blobfish:{n:1,best:33}, snapper:{n:2,best:26}, tuna:{n:1,best:44}, eel:{n:1,best:57},
        lantern:{n:1,best:68},
      }};
    g.applyUpgrades(); g.showIdle(); return 'ok'; })()`);
  await ev('window.step(40)');
  await shot('U1-idle');

  await ev(`(()=>{ const g=window.__game; g.showCodex(); return 'ok'; })()`);
  await ev('window.step(3)');
  await shot('U2-codex-top');
  await ev(`(()=>{ const l=document.querySelector('.codex-list'); l.scrollTop=l.scrollHeight; return l.scrollHeight; })()`);
  await shot('U3-codex-bottom');

  await ev(`(()=>{ const g=window.__game; g.showIdle(); return 'ok'; })()`);
  await ev('window.step(30)');
  await rafWait(1400);
  await shot('U4-title');

  // ── 开始游戏：两侧 UI 滑入 + 深度 chip 出现 ──
  await ev(`(()=>{ const g=window.__game; g.enterDescend(); return 'ok'; })()`);
  await ev('window.step(70)');
  await rafWait(1600);
  await ev('window.step(2)');
  await shot('U5-ingame-ui');
} finally {
  try { ws?.close(); } catch (_) { /* ignore */ }
  chrome.kill();
}
