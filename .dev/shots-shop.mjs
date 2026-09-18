/**
 * shots-shop.mjs — 出商店在 Lv0 / Lv9 / Lv19 三档的截图
 *
 * 为什么需要它：折行、余量、对比度这类**观感问题断言测不到**（B6 只能告诉你
 * "宽度够不够"，看不出"挤成什么样"）。改完商店行的文案或尺寸，出图人工看一眼。
 *
 * 用法：node .dev/shots-shop.mjs [url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9373;
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-shop');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const profile = path.resolve('.dev/profile-shop-' + Date.now());

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
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (r.result?.data) fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
};

await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: URL }); await sleep(3200);
await ev('document.getElementById("startBtn").click()'); await sleep(500);
await ev(`(async()=>{ window.__cfg = await import('./src/config.js'); return 'ok'; })()`);
await ev(`(()=>{const g=window.__game; g.save.coins = 99999999;
  g.openPhone(); g.ui.openApp('shop'); return 'ok';})()`);
await sleep(600);

for (const lv of [0, 9, 19]) {
  const info = await ev(`(()=>{const g=window.__game; const cfg=window.__cfg;
    // ⚠ 一次性工具（绞盘）只到 Lv1：直接写 19 会让 upgradeCost 返回 Infinity，
    //   fmtCost(Infinity) 把按钮写成 NaN，出图就废了。按各项自己的上限钳一次。
    for (const k of cfg.UPGRADE_ORDER) g.save.levels[k] = Math.min(${lv}, cfg.maxLvOf(k));
    g.applyUpgrades(); g.ui.refreshApp();
    const items = [...document.querySelectorAll('#pApp .item')];
    const curve = items.filter(r => !r.querySelector('.lv').textContent.includes('拥有'));
    const hs = [...new Set(curve.map(r => Math.round(r.getBoundingClientRect().height)))];
    const texts = items.map(e => e.querySelector('.ds').textContent.trim());
    return JSON.stringify({ heights: hs, texts: texts,
      oneshot: items.filter(r => r.querySelector('.lv').textContent.includes('拥有'))
        .map(r => r.querySelector('.ds').textContent.trim()) });})()`);
  const d = JSON.parse(info);
  console.log(`Lv${lv}: 曲线行行高 ${JSON.stringify(d.heights)}（一次性工具行不参与，它没有进度条）`);
  console.log(`      例：${d.texts[0]} / ${d.texts[3]} / ${d.texts[4]}`);
  console.log(`      一次性工具：${d.oneshot.join(' | ') || '（未拥有）'}`);
  // 截商店那一屏（滚到列表顶部）
  await ev(`(()=>{const b=document.querySelector('#pApp .p-app-body'); if(b) b.scrollTop=0; return 'ok';})()`);
  await sleep(180);
  await shot(`shop-Lv${lv}`);
}

ws.close(); chrome.kill();
fs.rmSync(profile, { recursive: true, force: true });
console.log('\n出图目录：' + OUT);
