/**
 * shots-guns.mjs — 枪店 / 枪械条 / 空中开火观感的出图复核
 *
 * 为什么需要它：枪店的卡片是**多行结构**（名字 + 机制说明 + 三四个数值 + 等级格 + 两个按钮），
 * 折行、挤压、按钮宽度这类问题没有任何断言测得到 —— 断言只能告诉你"有没有溢出"，
 * 看不出"挤成什么样"。改完枪店文案 / 卡片尺寸 / 枪械条之后，出图人工看一眼。
 *
 * 出三组图：
 *   1. 枪店（未买 → 只买得起手枪 → 全解锁）三档
 *   2. 枪械条：7 把枪各一张（看图标在 20px 下还认不认得出）
 *   3. 空中开火：散弹 / 鱼叉 / 激光 三种机制各一张
 *
 * 用法：node .dev/shots-guns.mjs [url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9378;
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-guns');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const profile = path.resolve('.dev/profile-guns-' + Date.now());

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
await ev('document.getElementById("startBtn").click()'); await sleep(500);
await ev(`(async()=>{ window.__cfg = await import('./src/config.js'); return 'ok'; })()`);

// ⚠ 立刻把 rAF 冻掉、改成手动定步长。不冻的话：
//   ① 后面把 state 设成 'air' 造场景时，主循环会自己跑完 airSettleGrace 弹结算面板；
//   ② 光束（life 0.09s）在截图前就过期了，拍出来什么都看不见。
//   出图脚本要的是"我能控制的这一帧"，不是"某一帧碰巧的样子"。
await ev(`(()=>{const g=window.__game; g._loop = () => {};
  window.step = (n) => { const dt0 = 1/60;
    for (let i=0;i<n;i++){ g.time += dt0; g._update(dt0); }
    g.world.render();
  };
  g._airCamera = () => ({ x: 0, y: 165, scale: 0.75, rate: 9 });
  g.input.nx = 0.5; g.input.ny = 0.5;
  return 'ok';})()`);

// ── 1. 枪店三档 ──────────────────────────────────────────
const STATES = [
  ['poor', `g.save.coins = 300;`],
  ['mid', `g.save.coins = 60000; g.save.guns.owned = ['shotgun','uzi'];`],
  ['rich', `g.save.coins = 9999999; g.save.guns.owned = window.__cfg.GUN_ORDER.slice(1);
            for (const id of window.__cfg.GUN_ORDER) g.save.guns.levels[id] = 3;`],
];
for (const [name, setup] of STATES) {
  const info = await ev(`(()=>{const g=window.__game; const cfg=window.__cfg;
    ${setup}
    g.openPhone(); g.ui.openApp('gunshop'); g.ui.refreshApp();
    const cards = [...document.querySelectorAll('#pApp .gs-item')];
    const hs = [...new Set(cards.map(r => Math.round(r.getBoundingClientRect().height)))];
    const list = document.querySelector('#pApp .gs-list');
    const over = list ? cards
      .map(r => Math.round(r.getBoundingClientRect().right) - Math.round(list.getBoundingClientRect().right))
      .filter(v => v > 0) : [];
    return JSON.stringify({ n: cards.length, heights: hs, overflow: over.length,
      app: (document.querySelector('#pApp') || {}).className,
      html: (document.querySelector('#pApp') || {}).innerHTML ? document.querySelector('#pApp').innerHTML.length : 0 });})()`);
  if (typeof info !== 'string') { console.log(`[枪店 ${name}] 探针异常`, JSON.stringify(info)); continue; }
  const d = JSON.parse(info);
  console.log(`[枪店 ${name}] 卡片 ${d.n} 张 · 高度集合 ${JSON.stringify(d.heights)} · 横向溢出 ${d.overflow} 张 · #pApp.class="${d.app}" html=${d.html}`);
  await ev(`(()=>{const b=document.querySelector('#pApp .p-app-body'); if(b) b.scrollTop=0; return 'ok';})()`);
  await sleep(200);
  await shot(`gunshop-${name}-top`);
  await ev(`(()=>{const b=document.querySelector('#pApp .p-app-body'); if(b) b.scrollTop=99999; return 'ok';})()`);
  await sleep(200);
  await shot(`gunshop-${name}-bottom`);
}

// ── 2. 枪械条：7 把枪各一张 ───────────────────────────────
await ev(`(()=>{const g=window.__game; g.closePhone(); g.showIdle(); return 'ok';})()`);
for (const id of ['pistol', 'shotgun', 'uzi', 'harpoon', 'gatling', 'laser', 'barrett']) {
  await ev(`(()=>{const g=window.__game; const cfg=window.__cfg;
    g.save.guns.current = '${id}'; g.save.guns.owned = cfg.GUN_ORDER.slice(1);
    g.save.guns.levels['${id}'] = 5;
    g.state = 'air'; g.airFish = []; g.airT = 0; g._resetGun();
    g.ui.showGunBar(true); g.ui.setHint(g._gunHint()); return 'ok';})()`);
  await sleep(180);
  await shot(`gunbar-${id}`);
}

// ── 3. 空中开火：三种机制 ─────────────────────────────────
const MECH = [
  ['shotgun', `g._shoot(g.gunStat)`, 'ring'],
  ['harpoon', `g._shoot(g.gunStat)`, 'column'],
  ['laser', `for (let i=0;i<5;i++){ g.gunHeat += 0.15; g.gunCd = 0; g._shoot(g.gunStat); }`, 'ring'],
];
for (const [id, fire, layout] of MECH) {
  const r = await ev(`(()=>{const g=window.__game; const cfg=window.__cfg;
    g.closePhone();
    g.save.guns.current = '${id}'; g.save.guns.owned = cfg.GUN_ORDER.slice(1);
    g.save.guns.levels['${id}'] = 3;
    g.state = 'air'; g.airFish = []; g.birds = []; g.airT = 0; g.airClearT = 0;
    g.caught = []; g.hook.setVisible(false);
    g.ui.hideOverlay();
    g.world.clearParticles();
    const S = cfg.SPECIES.find(s=>s.id==='tuna');
    // 瞄准点 = screenToWorld(0.5, 0.5−0.045)，相机 (0,165) / viewH 120 → 约 (0, 165)
    const spots = '${layout}' === 'column'
      ? [[0,110],[0,135],[0,165],[0,195],[0,225]]
      : [[-52,150],[-26,175],[0,140],[0,180],[26,175],[52,150],[0,210]];
    for (const [x,y] of spots) {
      const f = g.fish.acquire(S); f.reset(0,0); g.airFish.push(f);
      f.launch(0, 0, x, y);
      f.vx = 0; f.vy = 0; f.mesh.position.set(x, y, 2);
    }
    g.gunCd = 0;
    g.ui.showGunBar(true); g.ui.setHint(g._gunHint());
    try { ${fire} } catch(e){ return 'EXC '+e.message; }
    window.step(2);
    return 'ok 鱼=' + g.airFish.length;})()`);
  console.log(`[开火 ${id}] ${typeof r === 'string' ? r : JSON.stringify(r)}`);
  await shot(`fire-${id}`);
}

ws.close(); chrome.kill();
fs.rmSync(profile, { recursive: true, force: true });
console.log('\n出图目录：' + OUT);
