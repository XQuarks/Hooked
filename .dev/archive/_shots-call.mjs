/**
 * _shots-call.mjs — 「来电引导」的观感复核图（一次性探针）
 *
 * 为什么必须出图：
 *   ① 手机按钮的"震动 + 光环"够不够显眼（不够就等于没响）；
 *   ② 顶部来电横幅会不会挡住 HUD / 压住标题；
 *   ③ 来电界面像不像"在打电话"（不像的话那几句引导文案就白写了）；
 *   ④ 桌面上 6 个 App 换行之后排得好不好看、红点徽标会不会压到图标。
 *
 * 用法：node .dev/archive/_shots-call.mjs
 * 出图：.dev/shots-call/
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9389;
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-call');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(OUT, { recursive: true });

async function getTarget(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const p = list.find((t) => t.type === 'page');
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch (_) { /* 等 */ }
    await sleep(300);
  }
  throw new Error('CDP 未就绪');
}

const profile = path.resolve('.dev/profile-call-' + Date.now());
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=430,932', '--hide-scrollbars', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

try {
  const ws = new WebSocket(await getTarget(PORT));
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0; const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expr) => (await send('Runtime.evaluate',
    { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) { fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64')); console.log('  shot', name); }
  };

  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL }); await sleep(3400);
  await ev('document.getElementById("startBtn").click()'); await sleep(400);
  await ev(`(async()=>{ window.__cfg = await import('./src/config.js'); return 'ok'; })()`);

  // ① 待机 + 来电：手机按钮震动 + 顶部横幅
  await ev(`(()=>{const g=window.__game; const cfg=window.__cfg;
    g.save.calls = []; g.save.lastCallCast = -999; g.save.casts = 3;
    g.save.codex = {}; g.save.mapBest = {};
    g.save.levels = Object.fromEntries(cfg.UPGRADE_ORDER.map(k=>[k,0]));
    g.applyUpgrades(); g.showIdle(); return 'ok';})()`);
  await sleep(700); await shot('01-idle-ringing');

  // ② 来电界面（第一句）
  await ev(`document.getElementById('callBanner').click()`);
  await sleep(500); await shot('02-call-first-line');

  // ③ 推进到最后一句 → 出现「挂断 / 去 渔具店」
  await ev(`(()=>{ for (let i=0;i<8;i++){ const b=document.querySelector('#callNext'); if(!b) break; b.click(); } return 'ok';})()`);
  await sleep(400); await shot('03-call-actions');

  // ④ 听完 → 直接落在渔具店
  await ev(`document.querySelector('#callGo').click()`);
  await sleep(500); await shot('04-jump-to-shop');

  // ⑤ 通话记录（先多听几通，让列表有内容）
  await ev(`(()=>{const g=window.__game;
    g.save.calls = ['shop-intro','shop-drop','gun-intro'];
    g.ui.openApp('call'); return 'ok';})()`);
  await sleep(400); await shot('05-call-log');

  // ⑥ 桌面：6 个 App + 未接来电红点
  // ⚠ 要让红点真的出现，得先让"有一通电话确实待接"：
  //   光设 calls 不够 —— 上一通发生在第 2 竿时，`CALL_GAP` 会把第 3 竿挡住（节流是对的）。
  //   所以这里把 lastCallCast 推远，并把第二通的条件（鱼线 Lv2）满足。
  await ev(`(()=>{const g=window.__game;
    g.save.calls = ['shop-intro']; g.save.lastCallCast = -999; g.save.casts = 9;
    g.save.levels.line = 2; g.applyUpgrades();
    g.ringingCall = g.pendingCall();
    g.ui.ringPhone(!!g.ringingCall, g.ringingCall);
    g.ui.showPhoneHome(); return 'ok';})()`);
  await sleep(400); await shot('06-home-badge');
} finally {
  chrome.kill();
}
