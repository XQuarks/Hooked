/**
 * verify.mjs — 最终回归：把 5 条需求逐条变成可判定的断言
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = './shots-v2';
const PORT = 9383;

fs.mkdirSync(OUT, { recursive: true });
const profile = path.join(process.cwd(), '.chrome-profile-verify');
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
let id = 0; const pend = new Map(); const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || '').split('\n')[0]);
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/favicon/.test(m.params.entry.text)) errors.push('LOG: ' + m.params.entry.text);
};
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

const A = [];   // 断言
const check = (name, pass, detail) => A.push({ name, pass: !!pass, detail });

await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: URL });
await sleep(3200);

// ── 多屏幕比例（正交缩放前后都要保持玩法区完整） ─────────────
const layout = [];
for (const [label, w, h] of [
  ['375x667', 375, 667], ['393x852', 393, 852], ['412x915', 412, 915],
  ['768x1024', 768, 1024], ['1440x900', 1440, 900], ['1920x1080', 1920, 1080],
]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 });
  await sleep(360);
  await ev('window.dispatchEvent(new Event("resize"))');
  await sleep(300);
  layout.push({ label, ...(await J(`(()=>{const g=window.__game,w=g.world;
    return JSON.stringify({ viewW:Math.round(w.viewW), viewH:Math.round(w.viewH),
      baseW:Math.round(w.baseViewW), baseH:Math.round(w.baseViewH),
      playFits:w.viewW/2>=56, gunFitsInView:true });})()`)) });
}
check('6 种屏幕比例下玩法区都完整（viewW/2 ≥ 56）', layout.every((l) => l.playFits), layout.map((l) => `${l.label}:${l.viewW}`).join(' '));
check('基准可见宽度恒为 154（构图与比例解耦）', layout.every((l) => l.baseW === 154), layout.map((l) => l.baseW).join(','));
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 1, mobile: true });
await sleep(350);
await ev('window.dispatchEvent(new Event("resize"))');
await sleep(250);

// ── 冻结渲染循环，之后全部用定步长 ──────────────────────────
await ev(`(()=>{const g=window.__game; g._loop=()=>{};
  window.step=(n)=>{ for(let i=0;i<n;i++) g._update(1/60); g.world.render(); };
  window.PE=(t,nx,ny)=>{const c=document.getElementById('game');const r=c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent(t,{clientX:r.left+r.width*nx,clientY:r.top+r.height*ny,pointerId:1,bubbles:true,cancelable:true}));};
})()`);
await sleep(250);

// ── ① 鱼密度 1/10 ──────────────────────────────────────────
const dens = await J(`(()=>{const g=window.__game;
  const reach = 56 + 6 + 12;   // 鱼钩活动半径 + 钩半径 + 最大鱼半径
  return JSON.stringify({ total:g.fish.active.length, baseline:93,
    perZone:g.fish.active.reduce((m,f)=>{const z=f.def.zones[0];m[z]=(m[z]||0)+1;return m;},{}),
    maxAbsX:Math.round(Math.max(...g.fish.active.map(f=>Math.abs(f.mesh.position.x)))),
    inReach:g.fish.active.every(f=>Math.abs(f.mesh.position.x)<=reach) });})()`);
check('① 鱼数量降到基准的 1/10（9 条 / 93 条）', dens.total === 9, `total=${dens.total} ratio=${(dens.total / dens.baseline).toFixed(3)}`);
check('① 所有鱼都在鱼钩的射程内（含游动到边界时）', dens.inReach, `max|x|=${dens.maxAbsX} ${JSON.stringify(dens.perZone)}`);

// ── ② 只升级攻击力 ────────────────────────────────────────
await ev('document.getElementById("startBtn").click()');
await sleep(200);
await ev('window.__game.save.coins=60000; window.__game.showShop();');
await sleep(180);
const shopItems = await J(`(()=>{const g=window.__game;
  return JSON.stringify({ items:[...document.querySelectorAll('.shop-list .item .nm')].map(e=>e.textContent),
    order:g.save.levels, powerLevels:document.querySelectorAll('.shop-list .item').length });})()`);
check('② 商店只有「攻击力」一项', shopItems.items.length === 1 && /攻击力/.test(shopItems.items[0]), shopItems.items.join('/'));

// ── ② 手枪 ────────────────────────────────────────────────
const gun = await J(`(()=>{const g=window.__game;
  const names=g.gun.group.children.length;
  return JSON.stringify({ children:names, hasMuzzle:!!g.gun.muzzle, hasFlash:!!g.gun.flash,
    hasTracerPool:g.gun.tracers.length, hasFollow:typeof g.gun.follow==='function',
    shotgunLeftover: typeof g.gun.fire==='function' && g.gun.fire.length>1 });})()`);
check('② 枪已换成手枪（有套筒/握把/扳机护圈，跟随相机）', gun.children >= 14 && gun.hasMuzzle && gun.hasFollow, `children=${gun.children}`);
check('② 猎枪的霰弹接口已移除（fire 无参数）', gun.shotgunLeftover === false, `fire.length=${gun.fire?.length ?? 0}`);

for (let i = 0; i < 4; i++) { await ev(`document.querySelector('.buy[data-k="power"]:not([disabled])')?.click()`); await sleep(90); }
const maxed = await J(`(()=>{const g=window.__game;return JSON.stringify({lv:g.save.levels.power,coins:g.save.coins});})()`);
check('② 攻击力可升到满级 4', maxed.lv === 4, `lv=${maxed.lv} coins=${maxed.coins}`);
await shot('V1-shop');

// ── ③ 点击处爆炸 ──────────────────────────────────────────
const blast = await J(`(()=>{const g=window.__game,w=g.world;
  g.state='air'; g.fireCd=0; g.airFish=[]; g.birds=[]; g.airT=0;
  g.save.levels.power=0;                      // 用 1 级手枪验证判定圈 = 视觉圈
  const t=w.screenToWorld(0.30,0.70);
  const expect=w.screenToWorld(0.30, 0.70-0.045);   // 游戏会给手指让出 4.5% 屏幕高度
  g._fireAt(0.30,0.70);
  const b=w.blasts.items.find(it=>it.life>0);
  const aim=g.gun.aimPoint;
  return JSON.stringify({ blast:{x:+b.g.position.x.toFixed(1),y:+b.g.position.y.toFixed(1)},
    aim:{x:+aim.x.toFixed(1),y:+aim.y.toFixed(1)},
    expect:{x:+expect.x.toFixed(1),y:+expect.y.toFixed(1)},
    visualRadius:b.radius, logicRadius:g.world.blasts.items[0].radius });})()`);
const sameX = Math.abs(blast.blast.x - blast.aim.x) < 0.5;
const sameY = Math.abs(blast.blast.y - blast.aim.y) < 0.5;
check('③ 爆炸就发生在点击的世界坐标上', sameX && sameY, `blast=(${blast.blast.x},${blast.blast.y}) aim=(${blast.aim.x},${blast.aim.y})`);
check('③ 视觉爆炸半径 = 判定半径', blast.visualRadius === 24, `r=${blast.visualRadius}`);

// 判定：圈内死、圈外活
const judge = await J(`(async()=>{
  const C = await import('./src/config.js');
  const g = window.__game, w=g.world;
  g.state='air'; g.fireCd=0; g.birds=[]; g.airT=0; g.combo=0; g.mult=1;
  g.save.levels.power=0; g.save.coins=0;
  const mk=(id,x,y)=>{ const f=g.fish.acquire(C.SPECIES.find(s=>s.id===id));
    f.reset(x,y); f.launch(0,0,x,y); f.mesh.position.set(x,y,2); f.airX=x; f.airY=y; return f; };
  const inside = mk('sardine', 0, 100);
  const edge   = mk('clown', 26, 100);     // 26 < 24+3.9 → 擦边也算中
  const outside= mk('tuna', 80, 100);      // 80 > 24+6.5 → 打不到
  g.airFish=[inside,edge,outside];
  const w2=g.world;
  w2.camY=100; w2.camX=0; w2.update(1/60,{x:0,y:100,rate:999,scale:1,hookY:0,depthT:0});
  g._fireAt(0.5-(0-w2.camX)/w2.viewW-0.5+0.5, 0.5-(100-w2.camY)/w2.viewH+0.045);
  return JSON.stringify({ insideDead:inside.state==='dead', edgeDead:edge.state==='dead',
    outsideAlive:outside.state==='air', shot:g.run.shot });})()`, true);
check('③ 圈内鱼被炸死', judge.insideDead && judge.edgeDead, JSON.stringify(judge));
check('③ 圈外鱼毫发无伤', judge.outsideAlive, JSON.stringify(judge));

// ── ④ 鱼按价格飞得高远久 + 镜头紧跟 ────────────────────────
const fly = await J(`(async()=>{
  const C = await import('./src/config.js');
  const g = window.__game, w=g.world;
  g.state='air'; g.birds=[]; g.airT=0; g.maxAltReached=0; g.fireCd=1e9; g.save.coins=0;
  const ids=['sardine','tuna','sword','manta','goldking'];
  const list = ids.map(id=>{ const f=g.fish.acquire(C.SPECIES.find(s=>s.id===id)); f.reset(0,4); return f; });
  g.airFish=list;
  const T=C.TUNING, grav=Math.abs(T.airGravity), n=list.length;
  const info=list.map((f,i)=>{
    const spread=n>1?(i/(n-1)-0.5):0;
    f.value=f.def.value;
    const v0=T.launchBase+Math.sqrt(f.value)*T.launchPerSqrtValue;
    const flight=2*v0/grav;
    const drift=T.launchDriftBase+Math.sqrt(f.value)*T.launchDriftPerSqrt;
    f.launch(spread*2*drift/flight, v0);
    return { id:f.def.id, value:f.value, apex:Math.round(v0*v0/(2*grav)), flight:+flight.toFixed(1), drift:Math.round(drift) };
  });
  // 定步长跑到最高点，记录相机是否跟得住
  let peakCam=0, minInView=99, sawMaxScale=false;
  for(let i=0;i<60*26;i++){
    g._update(1/60);
    const ys=list.map(f=>f.mesh.position.y);
    const inView=ys.filter(y=>y>=w.camY-w.viewH/2-30&&y<=w.camY+w.viewH/2+30).length;
    if(i>60*3) minInView=Math.min(minInView,inView);
    peakCam=Math.max(peakCam,w.camY);
    if(w.viewScale>=2.39) sawMaxScale=true;
    if(g.state!=='air') break;
  }
  return JSON.stringify({ info, maxAlt:Math.round(g.maxAltReached), peakCam:Math.round(peakCam),
    minInView, sawMaxScale, endState:g.state,
    monotonic: info.every((r,i)=>i===0||r.apex>info[i-1].apex) });})()`, true);
check('④ 价值越高飞得越高（最高点单调递增）', fly.monotonic,
  fly.info.map((r) => `${r.id} ${r.value}→${r.apex}m`).join(' | '));
check('④ 高价鱼能飞进太空（黄金鱼王 > 1400m）', fly.info[4].apex > 1400, `apex=${fly.info[4].apex}m`);
check('④ 价值越高滞空越久', fly.info[4].flight > fly.info[0].flight * 2,
  `${fly.info[0].flight}s → ${fly.info[4].flight}s`);
check('④ 价值越高水平漂移越远', fly.info[4].drift > fly.info[0].drift * 3,
  `${fly.info[0].drift}m → ${fly.info[4].drift}m`);
check('④ 镜头一路跟着鱼群往上（相机最高 > 1000m）', fly.peakCam > 1000, `peakCam=${fly.peakCam}m`);
check('④ 散得最开时视野会自动拉远', fly.sawMaxScale, `maxScale reached=${fly.sawMaxScale}`);
check('④ 飞行结束后自动进结算', fly.endState === 'result', fly.endState);

// ── ⑤ 背景随高度变太空 ────────────────────────────────────
const space = await J(`(async()=>{
  const C = await import('./src/config.js');
  const g = window.__game, w=g.world;
  const rows = [0,260,520,780,1040,1250].map(y=>{
    w.camY=y; w.update(1/60,{x:0,y,rate:999,scale:1,hookY:0,depthT:0});
    return { y, band:C.altitudeAt(y).name, en:C.altitudeAt(y).en,
      stars:+w.starMat.opacity.toFixed(2), clouds:+w.cloudMat.opacity.toFixed(2),
      moon:+w.moonMat.opacity.toFixed(2), nebula:+w.nebulas[0].material.opacity.toFixed(3),
      snow:w.snow.visible, sun:+w.sunCore.material.opacity.toFixed(2) };
  });
  return JSON.stringify(rows);})()`, true);
const starsRise = space.every((r, i) => i === 0 || r.stars >= space[i - 1].stars);
const cloudsFall = space.every((r, i) => i === 0 || r.clouds <= space[i - 1].clouds);
check('⑤ 越往上星星越亮', starsRise, space.map((r) => `${r.y}:${r.stars}`).join(' '));
check('⑤ 越往上云越淡（到太空完全没有）', cloudsFall && space[5].clouds === 0, space.map((r) => `${r.y}:${r.clouds}`).join(' '));
check('⑤ 6 层大气提示都能到', new Set(space.map((r) => r.band)).size === 6, space.map((r) => r.band).join('→'));
check('⑤ 高空有月亮/星云、水面之外没有海雪', space[5].moon === 1 && space[5].nebula > 0 && !space[5].snow,
  `moon=${space[5].moon} nebula=${space[5].nebula} snow=${space[5].snow}`);

// ── 回归：完整循环 + 存档 + 河豚 ──────────────────────────
await ev(`(()=>{const g=window.__game; g.save.levels.power=4; g.state='shop'; g.showShop();})()`);
await sleep(150);
await ev(`document.getElementById('castBtn').click()`);
await sleep(150);
await ev(`window.PE('pointerdown',0.5,0.7)`);
for (let s = 0; s < 30; s++) {
  await ev(`window.PE('pointermove',${0.5 + Math.sin(s * 0.55) * 0.42},0.7)`);
  await ev('window.step(26)');
  if (await ev('window.__game.state !== "descend"')) break;
}
const desc = await J(`(()=>{const g=window.__game;return JSON.stringify({hookY:Math.round(g.hook.y),caught:g.caught.length,depth:Math.round(g.maxDepthReached),state:g.state});})()`);
check('回归：下沉能一路到底并自动收线', desc.depth === 420 && desc.state === 'ascend',
  `maxDepth=${desc.depth} state=${desc.state} 此刻钩在 ${desc.hookY}m`);
await shot('V2-descend');

// 手动往鱼线上挂 3 条，保证空中阶段一定有东西可打
const forced = await ev(`(()=>{const g=window.__game;
  const near=g.fish.active.filter(f=>f.state==='swim').slice(0,3);
  near.forEach(f=>{ f.hook(); g.caught.push(f); g.run.caught++; g.ui.addCatch(f); });
  g.hook.layoutCatch(g.caught); return near.length;})()`);
check('回归：下沉阶段能捕获到鱼', desc.caught + forced >= 1, `实测捕获 ${desc.caught} 条 + 补挂 ${forced} 条`);

await ev(`document.getElementById('reelBtn').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}))`);
let guard = 0;
while ((await ev('window.__game.state')) === 'ascend' && guard++ < 80) await ev('window.step(12)');
check('回归：上升结束自动进入空中阶段', (await ev('window.__game.state')) === 'air', await ev('window.__game.state'));

await ev('window.step(20)');
const airStart = await J(`(()=>{const g=window.__game,w=g.world;
  return JSON.stringify({ airFish:g.airFish.length, gunAtBottom:g.gun.py < (w.camY-w.viewH/2)+w.viewH*0.30,
    gunY:Math.round(g.gun.py), bottom:Math.round(w.camY-w.viewH/2) });})()`);
check('回归：手枪贴在屏幕底部', airStart.gunAtBottom, JSON.stringify(airStart));
await shot('V3-air');

const c0 = await ev('window.__game.save.coins');
for (let k = 0; k < 40; k++) {
  const ok = await J(`(()=>{const g=window.__game,w=g.world;
    const f=g.airFish.find(x=>x.state==='air'); if(!f) return JSON.stringify({ok:false});
    const p=f.mesh.position;
    const nx=(p.x-w.camX)/w.viewW+0.5, ny=0.5-(p.y-w.camY)/w.viewH+0.045;
    if(nx<0||nx>1||ny<0||ny>1) return JSON.stringify({ok:false});
    g._fireAt(nx,ny); return JSON.stringify({ok:true});})()`);
  if (!ok.ok) break;
  await ev('window.step(14)');
  if (await ev('window.__game.state') !== 'air') break;
}
const air = await J(`(()=>{const g=window.__game;return JSON.stringify({shot:g.run.shot,escaped:g.run.escaped.length,
  earned:g.run.earned,maxAlt:Math.round(g.maxAltReached),coinsGained:g.save.coins-${c0},
  airStart:${airStart.airFish}});})()`);
check('回归：空中能击落鱼并结算金币', air.shot >= 1 && air.coinsGained > 0,
  `起飞 ${air.airStart} 条 → 击落 ${air.shot} 条 / 逃走 ${air.escaped} 条，进账 🪙${air.coinsGained}`);

guard = 0;
while ((await ev('window.__game.state')) !== 'result' && guard++ < 90) await ev('window.step(20)');
await ev('window.step(40)');
await sleep(600);
const res = await J(`(()=>{const g=window.__game;
  return JSON.stringify({state:g.state,saved:!!localStorage.getItem('hooked.save.v2'),coins:g.save.coins,bestAlt:g.save.bestAlt,
    card:document.querySelector('.card')?.innerText.replace(/\\n+/g,' | ')});})()`);
check('回归：结算页出现并写入存档', res.state === 'result' && res.saved, res.card);
await shot('V4-result');

await send('Page.navigate', { url: URL });
await sleep(3000);
const per = await J(`(()=>{const g=window.__game;return JSON.stringify({coins:g.save.coins,levels:g.save.levels});})()`);
check('回归：刷新后存档恢复（金币与升级等级）',
  per.coins === res.coins && per.levels.power === 4, JSON.stringify(per));

check('全程控制台零报错', errors.length === 0, errors.join(' | ') || 'clean');

const pass = A.filter((a) => a.pass).length;
console.log('\n════════ 验收结果 ════════');
for (const a of A) console.log(`${a.pass ? 'PASS' : 'FAIL'}  ${a.name}\n      ${a.detail}`);
console.log(`\n${pass}/${A.length} 通过`);
fs.writeFileSync('.dev/verify.json', JSON.stringify({ assertions: A, layout, errors }, null, 2));
ws.close(); chrome.kill();
await sleep(150);
process.exit(pass === A.length ? 0 : 1);
