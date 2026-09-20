/**
 * _probe-rowh.mjs — 一次性探针：商店每一行的**实际行高**（B7 挂了，要定位是哪一行）
 *
 * 用法：node .dev/archive/_probe-rowh.mjs [url]
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9371;
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = path.resolve('.dev/profile-rowh-' + Date.now());

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--no-proxy-server', '--proxy-bypass-list=*',
  '--disable-extensions', '--mute-audio',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=430,932', '--hide-scrollbars', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

async function getTarget(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await r.json();
      const p = list.find((t) => t.type === 'page');
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch (_) { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('CDP 未就绪');
}

try {
  const ws = new WebSocket(await getTarget(PORT));
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3200);
  await ev(`(async()=>{ window.__cfg = await import('./src/config.js'); return 'ok'; })()`);
  await ev('document.getElementById("startBtn").click()');
  await sleep(400);

  // 首图 + 全解锁 + 全买满：把所有形态的行都逼出来
  const out = await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.save.levels = Object.fromEntries(cfg.UPGRADE_ORDER.map(k=>[k,0]));
    g.save.charts = {}; g.save.boats = { owned: [], current: null };
    g.save.coins = 9999999;
    g.openPhone(); g.ui.openApp('shop');
    const rows = [...document.querySelectorAll('#pApp .item')];
    return rows.map((r)=>({
      k: (r.querySelector('button')||{}).dataset ? r.querySelector('button').dataset.k : '?',
      h: r.offsetHeight,
      cls: r.className,
      nm: r.querySelector('.nm').textContent.trim(),
      ds: r.querySelector('.ds').textContent.trim(),
      hasPips: !!r.querySelector('.pips'),
      hasLock: !!r.querySelector('.lock-hint'),
      lockText: (r.querySelector('.lock-hint')||{}).textContent || '',
    }));})())`);
  for (const r of JSON.parse(out)) {
    console.log(`h=${String(r.h).padStart(3)}  ${r.k.padEnd(7)} ${r.nm.padEnd(14)} pips=${r.hasPips?1:0} lock=${r.hasLock?1:0}  ds「${r.ds}」 ${r.lockText ? 'lock「' + r.lockText + '」' : ''}`);
  }
} finally {
  try { chrome.kill(); } catch (_) { /* ignore */ }
}
