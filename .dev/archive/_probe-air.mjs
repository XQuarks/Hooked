/**
 * _probe-air.mjs — 空中相机探针
 *
 * 验证「镜头锁定最低的非扣钱鱼 + 推近」在真实流程里的表现：
 * 每帧打印各条鱼的 y、相机位置与 scale、当前锁定的目标是谁。
 * 顺便出几张图人工复核（推近之后鱼够不够大、目标是不是在画面中间）。
 *
 * 用法：node .dev/_probe-air.mjs [url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9376;
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-air');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const profile = path.resolve('.dev/profile-air-' + Date.now());

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
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (r.result?.data) fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
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

// 造一竿空中鱼：挑 5 条非扣钱鱼，身价拉开 → 飞行高度拉开
const made = await ev(`(()=>{const g=window.__game; const cfg=window.__cfg;
  g.enterDescend();
  const defs = cfg.SPECIES.filter(s=>!s.hazard && s.value>=20).slice(0,5);
  for (const d of defs) {
    const f = g.fish.acquire(d);
    f.reset(0, -30);
    f.hook();
    g.caught.push(f);
  }
  g.enterAir();
  return JSON.stringify(defs.map(d=>d.id+':'+d.value));})()`);
console.log('空中鱼：' + made);

const snap = `JSON.stringify((()=>{const g=window.__game;
  const c = g._airCamera();
  const fish = g.airFish.filter(f=>f.state==='air')
    .map(f=>({id:f.def.id, hz:!!f.def.hazard, x:Math.round(f.mesh.position.x), y:Math.round(f.mesh.position.y)}))
    .sort((a,b)=>a.y-b.y);
  // 相机返回的是「目标」，但真正落到 world 上的是平滑后的 camY
  return { cam:[Math.round(c.x),Math.round(c.y)], scale:c.scale,
    smooth:[Math.round(g.world.camX),Math.round(g.world.camY),+g.world.viewScale.toFixed(2)],
    view:[Math.round(g.world.viewRange().bottom),Math.round(g.world.viewRange().top)],
    fish };})())`;

for (let i = 0; i < 10; i++) {
  await ev('window.step(24)');            // 每次 0.4 秒
  const s = JSON.parse(await ev(snap));
  const lowest = s.fish.find((f) => !f.hz);
  console.log(`\n[${((i + 1) * 0.4).toFixed(1)}s] 目标→相机 ${JSON.stringify(s.cam)} scale=${s.scale} | 平滑后 ${JSON.stringify(s.smooth)} 视野 ${JSON.stringify(s.view)}`);
  console.log(`   最低非扣钱鱼 ${lowest ? `${lowest.id} @ y=${lowest.y}` : '（无）'}`);
  console.log('   ' + s.fish.map((f) => `${f.id}${f.hz ? '(扣钱)' : ''} y=${f.y}`).join(' · '));
  await shot('A' + (i + 1) + '-air');
}

// 击落最低的那条 → 相机应该自动切给剩下的最低那条
const killed = await ev(`JSON.stringify((()=>{const g=window.__game;
  const air = g.airFish.filter(f=>f.state==='air' && !f.def.hazard)
    .sort((a,b)=>a.mesh.position.y-b.mesh.position.y);
  const before = air[0] ? { id: air[0].def.id, y: Math.round(air[0].mesh.position.y) } : null;
  if (air[0]) { g._hitFish(air[0]); }
  const after = air.slice(1).filter(f=>f.state==='air')
    .sort((a,b)=>a.mesh.position.y-b.mesh.position.y)[0];
  return { before, after: after ? { id: after.def.id, y: Math.round(after.mesh.position.y) } : null,
    cam: Math.round(g._airCamera().y) };})())`);
console.log('\n【击落最低鱼】' + killed);
await ev('window.step(30)');
await shot('B-after-kill');

console.log('\n出图目录：' + OUT);
ws.close(); chrome.kill();
fs.rmSync(profile, { recursive: true, force: true });
