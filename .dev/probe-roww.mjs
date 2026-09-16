/**
 * probe-roww.mjs — 量商店一行的实际宽度预算
 *
 * 目的：搞清 `.ds` 那 178px（Lv0）/ 151px（高等级）到底是怎么被瓜分的，
 * 以及成本数字变长后按钮宽了多少。
 *
 * 用法：node .dev/probe-roww.mjs [url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9369;
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = path.resolve('.dev/profile-roww-' + Date.now());

// ⚠ 参数必须和 verify7 对齐：少了 --no-proxy-server / --use-gl=angle 这些，
//   headless 起得来但 CDP 端口迟迟不监听，getTarget 会一直等到超时。
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  '--no-proxy-server', '--proxy-bypass-list=*',
  '--disable-extensions', '--mute-audio',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=430,932', '--hide-scrollbars',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

async function getTarget(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await r.json();
      const p = list.find((t) => t.type === 'page');
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch (_) {}
    await sleep(250);
  }
  throw new Error('找不到 CDP target');
}

const wsUrl = await getTarget(PORT);
const ws = new WebSocket(wsUrl);
let msgId = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((res) => {
  const id = ++msgId; pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description };
  return r.result?.result?.value;
};
const J = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (_) { return { __bad: v }; } };

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: URL });
await sleep(3200);

// 开局 → 打开手机 → 切到商店（和 verify7 完全同一套调用，少一步面板就是 0 宽）
await ev('document.getElementById("startBtn").click()');
await sleep(400);
await ev(`(async()=>{ window.__cfg = await import('./src/config.js'); return 'ok'; })()`);
await ev(`(()=>{const g=window.__game;
  g.save.coins = 99999999;
  g.openPhone(); g.ui.openApp('shop'); return 'ok';})()`);
await sleep(600);

const dump = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
  const box = (el) => { if(!el) return null; const r=el.getBoundingClientRect();
    return { w: Math.round(r.width), x: Math.round(r.x) }; };
  const rows = () => [...document.querySelectorAll('#pApp .item')].map((r,i)=>({
    k: cfg.UPGRADE_ORDER[i],
    item: box(r),
    icon: box(r.querySelector('.icon')),
    info: box(r.querySelector('.info')),
    ds: box(r.querySelector('.ds')),
    dsAvail: r.querySelector('.ds').clientWidth,
    buy: box(r.querySelector('.buy')),
    buyText: r.querySelector('.buy').textContent.trim(),
    cost: cfg.upgradeCost(cfg.UPGRADE_ORDER[i], g.save.levels[cfg.UPGRADE_ORDER[i]]),
    h: Math.round(r.getBoundingClientRect().height),
  }));
  const out = {};
  g.save.coins = 99999999;
  for (const k of cfg.UPGRADE_ORDER) g.save.levels[k] = 0;
  g.applyUpgrades(); g.ui.refreshApp();
  out.lv0 = rows();
  out.pApp = box(document.querySelector('#pApp'));
  out.body = box(document.querySelector('#pApp .p-app-body'));
  out.list = box(document.querySelector('#pApp .shop-list'));
  for (const k of cfg.UPGRADE_ORDER) g.save.levels[k] = 19;
  g.applyUpgrades(); g.ui.refreshApp();
  out.lv19 = rows();
  for (const k of cfg.UPGRADE_ORDER) g.save.levels[k] = 0;
  g.save.coins = 0; g.applyUpgrades(); g.ui.refreshApp();
  return out;})())`));

console.log('pApp  ', JSON.stringify(dump.pApp));
console.log('body  ', JSON.stringify(dump.body));
console.log('list  ', JSON.stringify(dump.list));
console.log('\n%-10s %-14s %-14s %-16s %-14s %-10s', 'key', 'item', 'icon', 'info', 'buy', 'buyText');
for (const r of dump.lv0) {
  console.log('%-10s %-14s %-14s %-16s %-14s %-10s  h=%d ds=%d',
    r.k, JSON.stringify(r.item), JSON.stringify(r.icon), JSON.stringify(r.info),
    JSON.stringify(r.buy), r.buyText, r.h, r.dsAvail);
}
console.log('\n── Lv19 时按钮变宽、文字列变窄 ──');
for (const r of dump.lv19) {
  console.log('%-10s item=%-12s buy=%-14s ds=%-4d  %s',
    r.k, JSON.stringify(r.item), JSON.stringify(r.buy), r.dsAvail, r.buyText);
}

ws.close();
chrome.kill();
fs.rmSync(profile, { recursive: true, force: true });
