/**
 * _shots-v02.mjs — v0.2 世界 ×2 之后的观感复核出图。
 * 拍：待机 / 宁静海湾浅中深三档 / 空中阶段 / 冰封极地 / 商店
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C://Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9399;
const OUT = '.dev/shots-v02';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
const profile = path.resolve('.dev/profile-v02-' + Date.now());

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-proxy-server', '--proxy-bypass-list=*', '--mute-audio',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=430,932', '--hide-scrollbars', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });

try {
  let ws;
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = l.find((t) => t.type === 'page');
      if (p?.webSocketDebuggerUrl) { ws = new WebSocket(p.webSocketDebuggerUrl); break; }
    } catch (_) {}
    await sleep(300);
  }
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (x) => {
    const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    return r.result?.exceptionDetails ? { __err: (r.result.exceptionDetails.exception?.description || '').split('\n')[0] } : r.result?.result?.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
    console.log('  拍下 ' + name);
  };

  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8899/index.html' });
  await sleep(3800);

  // 冻结 rAF，改完状态手动 step，出图才稳定
  await ev(`(()=>{ window.__raf = window.requestAnimationFrame;
    window.requestAnimationFrame = () => 0;
    window.step = (n)=>{ for(let i=0;i<n;i++) window.__game._loop(performance.now()+i*16.7); };
    return 'ok'; })()`);
  await sleep(200);

  await ev(`document.getElementById('startBtn').click()`);
  await ev(`window.__game.save.coins = 999999; window.__game.applyUpgrades(); window.__game.showIdle();`);
  await ev(`window.step(60)`);
  await shot('01-idle');

  const dive = async (y, name) => {
    await ev(`(()=>{ const g=window.__game;
      g.save.levels.line = 20; g.applyUpgrades();
      g.showIdle(); g.enterDescend();
      let k=0; while (g.castAir && k++<400) window.step(1);
      g.state='descend'; g.hook.setPosition(0, ${y}); g.hook.y = ${y};
      g.world.camY = ${y} + g.world.viewH * (-0.30); g.world.viewScale = 1; g.world._applyView();
      window.step(6); return 'ok'; })()`);
    await shot(name);
  };
  await dive(-60, '02-calm-60m');
  await dive(-400, '03-calm-400m');
  await dive(-760, '04-calm-760m');

  // 空中阶段：造几条鱼飞起来
  await ev(`(()=>{ const g=window.__game, C=window.__cfg;
    g.showIdle(); g.state='air'; g.airT=0; g.birds=[];
    const ids=['sword','tuna','butterfly','puffer'];
    g.airFish=[];
    for (let i=0;i<4;i++){ const f=g.fish.acquire(C.SPECIES.find(s=>s.id===ids[i]));
      f.reset(i*20-30, -200); f.launch(i%2?40:-40, 500+i*120, i*20-30, 5); g.airFish.push(f); }
    for (let i=0;i<90;i++) g._update(1/60);
    return 'ok'; })()`);
  await ev(`window.step(2)`);
  await shot('05-air');

  // 冰封极地
  await ev(`(()=>{ const g=window.__game;
    g.save.licenses = {polar:true}; g.enterMap('polar');
    g.save.levels.line = 20; g.applyUpgrades();
    g.showIdle(); g.enterDescend();
    let k=0; while (g.castAir && k++<400) window.step(1);
    g.state='descend'; g.hook.setPosition(0,-420); g.hook.y=-420;
    g.world.camY = -420 + g.world.viewH*(-0.30); g.world.viewScale=1; g.world._applyView();
    window.step(6); return 'ok'; })()`);
  await shot('06-polar-420m');
  await ev(`window.step(240)`);
  await shot('07-polar-420m-b');

  // 极地待机（看极光还在不在）
  await ev(`(()=>{ const g=window.__game; g.showIdle(); window.step(90); return 'ok'; })()`);
  await shot('08-polar-idle');

  // 商店
  await ev(`(()=>{ const g=window.__game; g.openPhone(); g.ui.openApp('shop'); return 'ok'; })()`);
  await ev(`window.step(30)`);
  await shot('09-shop');

  // 商店满级（攻击力那一行最长）
  await ev(`(()=>{ const g=window.__game;
    for (const k of Object.keys(g.save.levels)) g.save.levels[k] = 20;
    g.applyUpgrades(); g.ui.openApp('shop'); window.step(30); return 'ok'; })()`);
  await shot('10-shop-max');
} finally { try { chrome.kill(); } catch (_) {} }
