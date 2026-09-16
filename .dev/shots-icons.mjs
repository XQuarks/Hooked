/**
 * shots-icons.mjs — 把 icons.js 里的图标铺成一张总览图，用来人工复核观感。
 *
 * 为什么需要它：
 *   图标是内联 SVG，**没有任何断言能判断"好不好看"** ——
 *   尺寸是否协调、笔画在 19px 下会不会糊、图形会不会被误读成别的意思，
 *   只能靠把整套图标放大并排看一遍。改完 icons.js 跑一下这个脚本。
 *
 * 用法：node .dev/shots-icons.mjs [url]
 * 输出：.dev/shots-v6/ICONS-gallery.png
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9357;
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-v6');
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

fs.mkdirSync(OUT, { recursive: true });
const profile = path.resolve('.dev/profile-icons-' + Date.now());
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--no-proxy-server', '--proxy-bypass-list=*',
  '--disable-extensions', '--mute-audio',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=900,1000', '--hide-scrollbars', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

let ws;
try {
  ws = new WebSocket(await getTarget(PORT));
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
    if (r.result?.exceptionDetails) {
      throw new Error((r.result.exceptionDetails.exception?.description || '').split('\n').slice(0, 4).join(' | '));
    }
    return r.result?.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',
    { width: 900, height: 1000, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: URL });
  await sleep(3000);

  // 用游戏自己的模块铺一张总览：每个图标画 64px（看形状）+ 19px（看真实尺寸下的可读性）
  const built = await ev(`(async () => {
    const mod = await import('/src/icons.js');
    const names = Object.keys(mod.GLYPH);
    document.head.insertAdjacentHTML('beforeend', '<style>' +
      '*{margin:0;padding:0;box-sizing:border-box}' +
      'body{background:#0b1a2b;color:#cfe6f7;font:13px/1.5 system-ui,sans-serif;padding:22px}' +
      'h1{font-size:15px;letter-spacing:.08em;color:#7fd4ff;margin-bottom:14px}' +
      '.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:12px}' +
      '.cell{background:#13293f;border:1px solid #23496e;border-radius:12px;padding:12px 6px;' +
        'display:flex;flex-direction:column;align-items:center;gap:8px}' +
      '.big{color:#8fe6ff;height:64px;display:flex;align-items:center}' +
      '.small{color:#8fe6ff;height:19px;display:flex;align-items:center}' +
      '.nm{font-size:10px;color:#7ea8c8;letter-spacing:.04em}' +
      '</style>');
    document.body.innerHTML = '<h1>icons.js · GLYPH 总览（上 64px / 下 19px 真实尺寸）</h1>'
      + '<div class="grid">' + names.map((n) =>
        '<div class="cell"><div class="big">' + mod.glyph(n, 64) + '</div>'
        + '<div class="small">' + mod.glyph(n, 19) + '</div>'
        + '<div class="nm">' + n + '</div></div>').join('') + '</div>'
      + '<h1 style="margin-top:22px">coinIcon（多层纯色，非单色）</h1>'
      + '<div class="grid"><div class="cell"><div class="big">' + mod.coinIcon(64)
      + '</div><div class="small">' + mod.coinIcon(14) + '</div><div class="nm">coin</div></div>'
      + '<div class="cell"><div class="big">' + mod.heartRow(3, 28) + '</div>'
      + '<div class="small">' + mod.heartRow(3, 12) + '</div><div class="nm">heartRow(3)</div></div></div>';
    return names.length;
  })()`);
  console.log('glyphs:', built);
  await sleep(600);

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(path.join(OUT, 'ICONS-gallery.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('shot ICONS-gallery');
} finally {
  try { ws && ws.close(); } catch (_) { /* ignore */ }
  chrome.kill();
}
