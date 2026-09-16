/**
 * shots-phone.mjs — 手机界面的出图复核（桌面 / 五个 App / 空态）
 *
 * 为什么需要它：手机里的改动（增删按钮、调间距、换图标）全是**观感问题** ——
 * 断言只能验"某个元素在不在"，看不出"少了一个按钮之后底部是不是空得发慌"、
 * "桌面 App 从 4 个变 5 个之后换行好不好看"。改完手机界面出图看一眼。
 *
 * 用法：node .dev/shots-phone.mjs [url]
 * 输出：.dev/shots-phone/*.png
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9379;
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-phone');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const profile = path.resolve('.dev/profile-phone-' + Date.now());

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
    } catch (_) { /* 还没起来 */ }
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
await ev('document.getElementById("startBtn").click()'); await sleep(400);
await ev(`(async()=>{ window.__cfg = await import('./src/config.js'); return 'ok'; })()`);

// 给点钱，让所有 App 都有东西可看
await ev(`(()=>{const g=window.__game; g.save.coins = 88888;
  g.save.guns.owned = ['shotgun','uzi']; g.save.guns.levels.shotgun = 2;
  g.openPhone(); return 'ok';})()`);
await sleep(500);
await shot('00-home');

for (const id of ['shop', 'gunshop', 'codex', 'route', 'settings']) {
  await ev(`(()=>{const g=window.__game; g.ui.openApp('${id}'); return 'ok';})()`);
  await sleep(420);
  await shot('01-app-' + id);
}

// 空态：一分钱没有、什么都没买（新玩家第一眼看到的枪店）
await ev(`(()=>{const g=window.__game;
  g.save.coins = 0; g.save.guns.owned = []; g.save.guns.current = 'pistol';
  for (const k of window.__cfg.GUN_ORDER) g.save.guns.levels[k] = 0;
  g.ui.showPhoneHome(); g.ui.openApp('gunshop'); g.ui.refreshApp(); return 'ok';})()`);
await sleep(420);
await shot('02-gunshop-broke');

ws.close(); chrome.kill();
fs.rmSync(profile, { recursive: true, force: true });
console.log('出图目录：' + OUT);
