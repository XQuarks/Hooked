/** 一次性探针：打开图鉴 App，把异常和 DOM 结果都打出来 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9371;
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

const profile = path.resolve('.dev/profile-probe-' + Date.now());
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
      errors.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      errors.push('LOG ' + m.params.entry.text);
    }
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

  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3200);
  await ev('document.getElementById("startBtn").click()');
  await sleep(300);

  console.log('--- fixture (同 verify5) ---');
  console.log(await ev(`(()=>{ const g=window.__game;
    g.save = { coins: 900, bestDepth: 200, bestAlt: 0, casts: 5, totalEarned: 900,
      levels:{line:2,hook:1,sinker:1,power:2,lamp:1,winch:1,creel:1,insurance:1,sonar:1,bait:1,rig:1},
      licenses: [],
      codex: { sardine:{n:9,best:7}, clown:{n:4,best:12}, puffer:{n:2,best:9}, tuna:{n:1,best:44} } };
    g.applyUpgrades(); g.showIdle(); return 'ok'; })()`));

  console.log('--- open codex ---');
  console.log(await ev(`(()=>{ const g=window.__game;
    try { g.openPhone(); g.ui.openApp('codex'); }
    catch(e) { return 'THROW ' + e.message + ' | ' + e.stack.split('\\n').slice(0,4).join(' >> '); }
    return 'ok'; })()`));
  await sleep(400);
  console.log('pApp len =', await ev('document.getElementById("pApp").innerHTML.length'));
  console.log('cx-item =', await ev('document.querySelectorAll("#pApp .cx-item").length'));
  console.log('html head =', String(await ev('document.getElementById("pApp").innerHTML.slice(0,400)')));
  console.log('--- open route ---');
  console.log(await ev(`(()=>{ const g=window.__game;
    try { g.ui.openApp('route'); }
    catch(e) { return 'THROW ' + e.message + ' | ' + e.stack.split('\\n').slice(0,4).join(' >> '); }
    return 'ok'; })()`));
  await sleep(300);
  console.log('rt-item =', await ev('document.querySelectorAll("#pApp .rt-item").length'));
  console.log('rt html =', String(await ev('document.getElementById("pApp").innerHTML.slice(0,600)')));
  console.log('--- open shop ---');
  console.log(await ev(`(()=>{ const g=window.__game;
    try { g.ui.openApp('shop'); } catch(e) { return 'THROW ' + e.message; } return 'ok'; })()`));
  await sleep(200);
  console.log('shop items =', await ev('document.querySelectorAll("#pApp .item").length'));
  console.log('--- errors ---');
  console.log(errors.slice(0, 12).join('\n') || '(none)');
} finally {
  try { chrome.kill(); } catch (_) { /* ignore */ }
}
