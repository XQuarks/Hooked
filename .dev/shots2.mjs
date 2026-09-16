/**
 * shots2.mjs — 按高度取景，确认"天空逐渐变成太空"真的看得见
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = './shots-v2';
const PORT = 9371;

fs.mkdirSync(OUT, { recursive: true });
const profile = path.join(process.cwd(), '.chrome-profile-sh2');
fs.rmSync(profile, { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--mute-audio', '--hide-scrollbars',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=430,932', 'about:blank'], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 60 && !wsUrl; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  } catch (_) {}
  if (!wsUrl) await sleep(300);
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => { ws.onopen = r; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr, awaitPromise = false) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
  if (r.result?.exceptionDetails) return { __err: (r.result.exceptionDetails.exception?.description || '').split('\n')[0] };
  return r.result?.result?.value;
};
const J = async (e, a = false) => { const v = await ev(e, a); return typeof v === 'string' ? JSON.parse(v) : v; };
const shot = async (n) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (r.result?.data) fs.writeFileSync(path.join(OUT, n + '.png'), Buffer.from(r.result.data, 'base64'));
};

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: URL });
await sleep(3200);
await ev(`(()=>{const g=window.__game; g._loop=()=>{};})()`);
await sleep(250);

await shot('T1-title');
await ev('document.getElementById("startBtn").click()');
await sleep(250);
await ev('window.__game.save.coins=60000; window.__game.showShop();');
await sleep(200);
await shot('T2-shop');

// 摆出 5 个价位的鱼并起飞，逐段截图
await J(`(async()=>{
  const C = await import('./src/config.js');
  const g = window.__game;
  g.ui.hideOverlay();
  g.ui.showHud(true);
  g.state='air'; g.birds=[]; g.airT=0; g.maxAltReached=0; g.fireCd=1e9;
  const ids=['sardine','tuna','sword','manta','goldking'];
  const list = ids.map(id=>{ const f=g.fish.acquire(C.SPECIES.find(s=>s.id===id)); f.reset(0,4); return f; });
  g.airFish = list;
  const T=C.TUNING, grav=Math.abs(T.airGravity), n=list.length;
  list.forEach((f,i)=>{
    const spread = n>1 ? (i/(n-1)-0.5) : 0;
    f.value=f.def.value;
    const v0=T.launchBase+Math.sqrt(f.value)*T.launchPerSqrtValue;
    const flight=2*v0/grav;
    const drift=T.launchDriftBase+Math.sqrt(f.value)*T.launchDriftPerSqrt;
    f.launch(spread*2*drift/flight, v0);
  });
  window.__step=(n)=>{ for(let i=0;i<n;i++) g._update(1/60); g.world.render(); };
  return JSON.stringify({ ok:true, n:list.length });})()`, true);

const marks = [[45,'H1-sea-level'],[210,'H2-high-sky'],[330,'H3-stratosphere'],[450,'H4-mesosphere'],[570,'H5-low-orbit'],[780,'H6-deep-space']];
let done = 0;
for (const [frame, name] of marks) {
  await ev(`window.__step(${frame - done})`);
  done = frame;
  await sleep(120);
  await shot(name);
}
const info = await J(`(()=>{const g=window.__game,w=g.world;
  return JSON.stringify({ camY:Math.round(w.camY), scale:+w.viewScale.toFixed(2),
    stars:+w.starMat.opacity.toFixed(2), clouds:+w.cloudMat.opacity.toFixed(2),
    band:document.getElementById('zoneName').textContent });})()`);

console.log(JSON.stringify(info));
ws.close(); chrome.kill();
await sleep(150);
process.exit(0);
