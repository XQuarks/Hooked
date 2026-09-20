/**
 * boom.mjs — 爆炸视觉专项：几条鱼聚在近处，连点几发看冲击波 / 火球 / 拾取
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = './shots-v2';
const PORT = 9377;

fs.mkdirSync(OUT, { recursive: true });
const profile = path.join(process.cwd(), '.chrome-profile-boom');
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

// 摆场景：低空 5 条鱼聚在一起，相机不跟随太远
const setup = await J(`(async()=>{
  const C = await import('./src/config.js');
  const g = window.__game;
  g.ui.hideOverlay(); g.ui.showHud(true);
  g.state='air'; g.sky=[]; g.airT=0; g.fireCd=0; g.combo=0; g.mult=1;
  g.save.coins=0; g.ui.setCoins(0);
  g.save.levels.power = 0;   // 1 级爆炸范围 24，最能看出判定圈
  const ids=['sardine','clown','mackerel','snapper','tuna'];
  const list = ids.map(id=>{ const f=g.fish.acquire(C.SPECIES.find(s=>s.id===id)); f.reset(0,4); return f; });
  g.airFish = list; window.__list=list;
  // 手动摆成一个紧凑的扇面，并给一个刚好够看的高度
  list.forEach((f,i)=>{
    f.value = f.def.value;
    f.launch((i-2)*10, 60);
    f.airX = (i-2)*16; f.airY = 60 + i*7;
    f.mesh.position.set(f.airX, f.airY, 2);
  });
  window.__step=(n)=>{ for(let i=0;i<n;i++) g._update(1/60); g.world.render(); };
  window.__step(1);
  return JSON.stringify({ n:list.length, camY:Math.round(g.world.camY), viewH:Math.round(g.world.viewH),
    radius:C.TUNING.blastRadius(0), damage:C.TUNING.damage(0),
    hp:list.map(f=>f.maxHp), values:list.map(f=>f.value) });})()`, true);

await sleep(120);
await shot('E1-before');

// 对着鱼群正中引爆（低等级：伤害 1，大鱼需要补一炮）
const r1 = await J(`(()=>{const g=window.__game,w=g.world;
  const nx=(0-w.camX)/w.viewW+0.5, ny=0.5-(80-w.camY)/w.viewH+0.045;
  g._fireAt(nx,ny);
  return JSON.stringify({ combo:g.combo, coins:g.save.coins, alive:g.airFish.filter(f=>f.state==='air').length,
    hps:g.airFish.map(f=>+f.hp.toFixed(2)) });})()`);
await ev('window.__step(7)');   // 冲击波扩到一半
await sleep(120);
await shot('E2-blast');

// 再补一炮清场（第二次射击）
await ev(`(()=>{const g=window.__game,w=g.world;
  const nx=(0-w.camX)/w.viewW+0.5, ny=0.5-(80-w.camY)/w.viewH+0.045;
  g._fireAt(nx,ny); return 'ok';})()`);
await ev('window.__step(5)');
await sleep(120);
await shot('E3-second-shot');

const r2 = await J(`(()=>{const g=window.__game;
  return JSON.stringify({ combo:g.combo, mult:+g.mult.toFixed(2), coins:g.save.coins,
    shot:g.run.shot, earned:g.run.earned, bestCombo:g.run.bestCombo });})()`);

console.log(JSON.stringify({ setup, r1, r2 }, null, 2));
ws.close(); chrome.kill();
await sleep(150);
process.exit(0);
