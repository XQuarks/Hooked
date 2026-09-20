/**
 * _probe-b4.mjs — 一次性探针：批 4 的三处疑点（热泉加速 / 滞空 / 榴弹引信）
 * 用法：node .dev/archive/_probe-b4.mjs [url]
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9372;
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = path.resolve('.dev/profile-b4-' + Date.now());

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--no-proxy-server', '--proxy-bypass-list=*',
  '--disable-extensions', '--mute-audio',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=430,932', '--hide-scrollbars', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

async function getTarget(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await r.json();
      const p = list.find((t) => t.type === 'page');
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch (_) { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('CDP 未就绪');
}

try {
  const ws = new WebSocket(await getTarget(PORT));
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3200);
  await ev(`(async()=>{ window.__cfg = await import('./src/config.js'); return 'ok'; })()`);
  await ev('document.getElementById("startBtn").click()');
  await sleep(400);
  await ev(`(()=>{const g=window.__game; g._loop = () => {};
    window.__cfg.TUNING.airSettleGrace = 999;
    window.step = (n) => { const dt0 = 1/60; for (let i=0;i<n;i++){ g.time += dt0; g._update(dt0); } g.world.render(); };
    return 'ok';})()`);

  console.log('--- C2 热泉（这次把 targetX 一起搬）---');
  console.log(await ev(`(()=>{try{const g=window.__game;
    g.save.charts={polar:true,lava:true}; g.save.boats={owned:['golden'],current:'golden'};
    g.enterMap('lava');
    const vs = g.world.heatVentColliders || [];
    const v = vs[0];
    g.state='ascend'; g.ascendRampT=0; g.fish.releaseAll(); g.airFish=[]; g.fastReel=false;
    const run=(x,y)=>{ g.hook.x=x; g.hook.y=y; g.targetX=x; g.hook.setPosition(x,y);
      const b=g._ventBoost(); const y0=g.hook.y; window.step(1);
      return {boost:b, x0:Math.round(x), xAfter:Math.round(g.hook.x), dy:+(g.hook.y-y0).toFixed(3)}; };
    const mid=(v.y0+v.y1)/2;
    return JSON.stringify({ vents: vs.map(w=>({x:Math.round(w.x),r:Math.round(w.r)})),
      inCol: run(v.x, mid), outX: run(v.x+v.r+12, mid) });
    }catch(e){return 'ERR C2: '+e.message;}})()`));

  console.log('--- D1 滞空 ---');
  console.log(await ev(`(()=>{try{const g=window.__game; const cfg=window.__cfg;
    g.save.charts={polar:true,lava:true}; g.save.boats={owned:['golden'],current:'golden'};
    g.enterMap('lava');
    const mk=()=>{ g.state='air'; g.airFish=[{state:'air', def:{hazard:false}}]; g.airT=30; g.airClearT=0; };
    g.save.levels.tank=0; g.applyUpgrades(); mk(); const t0=g.airTimeout;
    g._updateAir(1/60, g.time); const a=g.state;
    g.save.levels.tank=cfg.MAX_LEVEL; g.applyUpgrades(); mk(); const t1=g.airTimeout;
    g._updateAir(1/60, g.time); const b=g.state;
    return JSON.stringify({ lv0:a, lvMax:b, timeout0:t0, timeoutMax:t1, fsAir:(window.__cfg.FISH_STATE||{}).AIR });
    }catch(e){return 'ERR D1: '+e.message;}})()`));

  console.log('--- D2 榴弹引信 ---');
  console.log(await ev(`(()=>{try{const g=window.__game; const cfg=window.__cfg;
    g.save.charts={polar:true,lava:true}; g.save.boats={owned:['golden'],current:'golden'};
    g.enterMap('lava'); g.closePhone(); g.ui.hideOverlay();
    g.state='air'; g.airFish=[]; g.birds=[]; g.airT=0; g.airClearT=0;
    g.save.guns.current='grenade'; g.save.guns.owned=cfg.GUN_ORDER.slice(); g.save.guns.levels.grenade=0;
    g.applyUpgrades(); g._resetGun(); g.input.nx=0.5; g.input.ny=0.5; g.input.pointerDown=false;
    let blasts=0; const w=g.world; const orig=w.burstExplosion.bind(w);
    w.burstExplosion=(...a)=>{blasts++; return orig(...a);};
    g.gunCd=0; g._tapFire();
    const log=[{n:0, blasts, lobs:g.lobs.length, t:g.lobs[0]?+g.lobs[0].t.toFixed(3):null}];
    for (let i=0;i<40;i++){ window.step(1); if(i%5===4) log.push({n:i+1, blasts, lobs:g.lobs.length, t:g.lobs[0]?+g.lobs[0].t.toFixed(3):null}); }
    w.burstExplosion=orig;
    return JSON.stringify(log);
    }catch(e){return 'ERR D2: '+e.message;}})()`));
} finally {
  try { chrome.kill(); } catch (_) { /* ignore */ }
}
