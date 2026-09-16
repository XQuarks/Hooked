/**
 * _probe-aurora.mjs — 一次性探针：极光到底有没有"加色变亮"？
 *
 * 背景：01-polar-idle.png 里极光看着像几条**暗色**竖条，而不是发光的帘子。
 *   AdditiveBlending 只加不减，不可能把天空压暗 —— 所以要么混合没生效，
 *   要么被后面渲染的东西盖住了。这里直接读像素来定位。
 *
 * 做法：同一位置采样两次 —— 极光开着 / 极光藏着，比较 RGB。
 * 用法：node .dev/_probe-aurora.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9375;
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = path.resolve('.dev/profile-aurora-' + Date.now());

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
    } catch (_) { /* not up */ }
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

await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: URL }); await sleep(3200);
await ev(`(()=>{const g=window.__game; g._loop = () => {};
  window.step = (n) => { const dt0 = 1/60;
    for (let i=0;i<n;i++){ const dt = dt0 * g.timeScale; g.time += dt; g._update(dt); }
    g.world.render(); return 'ok'; }; return 'ok';})()`);
await ev('document.getElementById("startBtn").click()'); await sleep(400);
await ev(`(async()=>{ window.__cfg = await import('./src/config.js'); return 'ok'; })()`);
await ev(`(()=>{const g=window.__game; const cfg=window.__cfg;
  for (const k of cfg.UPGRADE_ORDER) g.save.levels[k] = 12;
  g.save.levels.lamp = 12; g.applyUpgrades(); return 'ok';})()`);

await ev(`(()=>{const g=window.__game;
  g.save.licenses = ['polar']; g.enterMap('polar'); g.showIdle(); return 'ok';})()`);
await ev('window.step(40)');

// 采样：把每条极光"底边往上 40 单位"处的世界坐标投到屏幕，读该像素
//
// ⚠ render() 必须和 drawImage() 在**同一次 JS 任务**里。
//   WebGL canvas 默认 preserveDrawingBuffer:false —— 一旦跨了 CDP 往返，
//   缓冲区已被清空，drawImage 只能抓到全透明（(0,0,0,0)），
//   看起来就像"极光完全没画上去"，其实是探针自己把帧丢了。
const probe = `(()=>{
  const g = window.__game;
  g.world.render();                      // ← 同步渲染，紧接着就抓
  const src = document.querySelector('canvas');
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const w = g.world;
  const at = (wx, wy) => {
    const nx = (wx - w.camX) / w.viewW + 0.5;
    const ny = 0.5 - (wy - w.camY) / w.viewH;
    const px = Math.round(nx * c.width), py = Math.round(ny * c.height);
    if (px < 0 || py < 0 || px >= c.width || py >= c.height) return null;
    const i = (py * c.width + px) * 4;
    return { px, py, rgb: [d[i], d[i+1], d[i+2]], a: d[i+3] };
  };
  const out = [];
  for (const r of g.world.aurora) {
    const bottom = r.position.y - r.scale.y / 2;
    out.push({ x: Math.round(r.position.x), bottom: Math.round(bottom),
      on: at(r.position.x, bottom + 40) });
  }
  // 天空背景参照点：画面正中央偏上（不受极光影响的位置）
  const ref = at(w.camX, w.camY + w.viewH * 0.35);
  return JSON.stringify({ canvas: [c.width, c.height], view: [Math.round(w.camX), Math.round(w.camY), Math.round(w.viewW), Math.round(w.viewH)],
    aurora: out, ref, auroraVisible: g.world.auroraRoot.visible });
})()`;

const on = JSON.parse(await ev(probe));
console.log('【极光开着】');
console.log('  canvas', on.canvas, ' view(camX,camY,viewW,viewH)', on.view);
console.log('  背景参照', JSON.stringify(on.ref));
for (const a of on.aurora) console.log(`  极光 x=${a.x} 底边=${a.bottom} → 像素`, JSON.stringify(a.on));

await ev('window.__game.world.auroraRoot.visible = false; window.step(1)');
const off = JSON.parse(await ev(probe));
console.log('【极光藏着】');
for (const a of off.aurora) console.log(`  极光 x=${a.x} 底边=${a.bottom} → 像素`, JSON.stringify(a.on));

console.log('\n【差值（开 − 藏）】');
on.aurora.forEach((a, i) => {
  const b = off.aurora[i];
  if (!a.on || !b.on) { console.log(`  #${i} 采样点在画布外`); return; }
  const d = a.on.rgb.map((v, k) => v - b.on.rgb[k]);
  console.log(`  #${i} [${a.on.rgb}] - [${b.on.rgb}] = [${d}]  ${d.every(v => v === 0) ? '← 完全没画上去' : (d.some(v => v < 0) ? '← 变暗了（混合有问题）' : '← 变亮 ✓')}`);
});

ws.close(); chrome.kill();
