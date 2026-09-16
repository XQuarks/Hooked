/**
 * smoke.mjs — 改完代码先跑这个：起页面、进待机、开手机、开三个 App，报所有控制台异常。
 * 用法：node .dev/smoke.mjs [url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9351;
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

const profile = path.resolve('.dev/profile-smoke-' + Date.now());
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
      return { __err: (r.result.exceptionDetails.exception?.description || '').split('\n').slice(0, 3).join(' | ') };
    }
    return r.result?.result?.value;
  };

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3500);

  console.log('boot:', await ev('JSON.stringify({game: !!window.__game, state: window.__game && window.__game.state})'));
  console.log('start:', await ev('document.getElementById("startBtn").click(), "ok"'));
  await sleep(600);
  console.log('idle:', await ev('JSON.stringify({state: window.__game.state, phoneBtn: document.getElementById("phoneBtn").classList.contains("on"), sea: document.getElementById("seaName").textContent})'));
  console.log('coinSvg:', await ev('document.querySelector(".chip.coin .ico svg") ? "svg ok" : "MISSING"'));
  console.log('openPhone:', await ev('document.getElementById("phoneBtn").click(), JSON.stringify({open: !document.getElementById("phoneLayer").classList.contains("hidden")})'));
  await sleep(500);
  console.log('phoneBox:', await ev('JSON.stringify((()=>{const r=document.getElementById("phoneBody").getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height),vh:window.innerHeight,apps:document.querySelectorAll(".p-app-item").length};})())'));
  for (const app of ['shop', 'codex', 'settings']) {
    console.log(app + ':', await ev(`document.querySelector('[data-app="${app}"]').click(), JSON.stringify({app: document.querySelector('#pApp .p-app-h b').textContent, body: document.querySelector('#pApp .p-app-body').children.length})`));
    await sleep(320);
  }
  await sleep(400);
  console.log('errors:', errors.length ? errors : 'none');
} finally {
  try { ws && ws.close(); } catch (_) { /* ignore */ }
  chrome.kill();
}
