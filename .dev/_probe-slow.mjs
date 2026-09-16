/** 一次性探针：复现 C3（减速实测）为什么比值是负的 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9372;
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const p = list.find((t) => t.type === 'page');
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch (_) { /* not up */ }
    await sleep(300);
  }
  throw new Error('no cdp');
}

const profile = path.resolve('.dev/profile-slow-' + Date.now());
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
    if (r.result?.exceptionDetails) return '__ERR ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
    return r.result?.result?.value;
  };

  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3200);
  await ev(`(()=>{const g=window.__game; g._loop = () => {};
    window.step = (n) => { const dt0 = 1/60;
      for (let i=0;i<n;i++){ const dt = dt0 * g.timeScale; g.time += dt; g._update(dt); }
      g.world.render(); return 'ok'; }; return 'ok';})()`);
  await ev('document.getElementById("startBtn").click()');
  await ev(`(async()=>{ window.__cfg = await import('./src/config.js'); return 'ok'; })()`);

  console.log(await ev(`(()=>{const g=window.__game;
    g.enterMap('polar'); g.save.levels.line = 9; g.save.levels.sinker = 0; g.applyUpgrades();
    g.showIdle(); g.enterDescend();
    g.castAir = false; g.castT = 0;
    const keep = g.world.icebergs;
    g.world.icebergs = [];
    const log = [];
    const run = (slow, tag) => {
      g.iceSlowT = slow; g.targetX = 0; g.hook.x = 0;
      g.hook.y = -300; g.hook.setPosition(0, -300);
      for (let i = 0; i < 60; i++) {
        window.step(1);
        if (i % 10 === 0) log.push(tag + ' f' + i + ' y=' + g.hook.y.toFixed(2)
          + ' slow=' + g.iceSlowT.toFixed(2) + ' st=' + g.state + ' reelPre=' + g.reelPre.toFixed(2));
      }
      log.push(tag + ' END y=' + g.hook.y.toFixed(2) + ' st=' + g.state
        + ' reelPre=' + g.reelPre.toFixed(2) + ' maxDepth=' + g.maxDepth + ' dspd=' + g.descendSpeed);
    };
    run(0, 'A');
    run(99, 'B');
    g.world.icebergs = keep;
    return log.join('\\n');})()`));
} finally {
  try { chrome.kill(); } catch (_) { /* ignore */ }
}
