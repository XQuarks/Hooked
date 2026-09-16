/**
 * probe-coinfit.mjs — 7 位数的金币在 HUD / 钱包里会不会撑破容器
 *
 * 商店按钮被 1,057,128 撑到 93px 是已确认的问题；顺手查一下 HUD 那枚金币药丸
 * 和手机钱包是不是也顶不住 —— 同一个根因（成本/余额长到 7 位数），
 * 如果也顶不住就一起修，不要留一个"商店用了万、HUD 还在挤"的半成品。
 *
 * 用法：node .dev/probe-coinfit.mjs [url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9371;
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = path.resolve('.dev/profile-coinfit-' + Date.now());

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  '--no-proxy-server', '--proxy-bypass-list=*',
  '--disable-extensions', '--mute-audio',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=430,932', '--hide-scrollbars', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

async function getTarget(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const p = list.find((t) => t.type === 'page');
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch (_) {}
    await sleep(300);
  }
  throw new Error('Chrome CDP 未就绪');
}

const ws = new WebSocket(await getTarget(PORT));
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description?.split('\n')[0] };
  return r.result?.result?.value;
};
const J = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (_) { return { __bad: v }; } };

await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: URL }); await sleep(3200);
await ev('document.getElementById("startBtn").click()'); await sleep(500);

const res = J(await ev(`JSON.stringify((()=>{const g=window.__game;
  // 量一个元素：容器实际多宽 vs 内容需要多宽（临时 nowrap 读 scrollWidth）
  const fit = (el, label) => {
    if (!el) return { label: label, missing: true };
    const old = el.style.whiteSpace;
    el.style.whiteSpace = 'nowrap';
    const need = el.scrollWidth, avail = el.clientWidth;
    el.style.whiteSpace = old;
    const r = el.getBoundingClientRect();
    return { label: label, avail: avail, need: need, over: need - avail,
      boxW: Math.round(r.width), text: el.textContent.trim().slice(0, 24) };
  };
  const out = {};
  // 分几档金币，看什么时候开始顶破
  for (const amt of [999, 99999, 1057128, 98765432]) {
    g.save.coins = amt;
    if (g.ui.setCoins) g.ui.setCoins(amt);
    g.ui.refreshHud && g.ui.refreshHud();
    out['hud@' + amt] = fit(document.querySelector('.coin, #coin, .hud .coin'), 'HUD 金币药丸');
  }
  g.save.coins = 1057128; g.ui.setCoins(1057128);
  out.hudHTML = (document.querySelector('.coin, #coin') || {}).outerHTML || 'n/a';
  g.openPhone(); g.ui.openApp('shop'); 
  out.wallet = fit(document.querySelector('#pApp .wallet .amt'), '手机商店钱包');
  out.shopHead = fit(document.querySelector('#pApp .p-app-h i'), '商店标题右侧');
  out.buy0 = fit(document.querySelector('#pApp .buy[data-k="rig"]'), '商店按钮 rig Lv0');
  return out;})())`));

console.log(JSON.stringify(res, null, 2));
ws.close(); chrome.kill();
fs.rmSync(profile, { recursive: true, force: true });
