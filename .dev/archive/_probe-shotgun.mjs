/**
 * _probe-shotgun.mjs — 散弹枪「一次 6 颗弹丸」到底有没有生效？
 *
 * 起因：读 `game.js::_shoot()` 发现分派用的是 `switch (g.mech)`，
 * 而 `GUNS.shotgun.mech === 'single'` → `case 'shotgun'` 永远进不去，
 * `_shootShotgun()` 疑似死代码。
 *
 * 这个探针**不听代码推理，只看运行时事实**：装散弹枪，开一枪，
 * 数 `world.burstExplosion()` 被调用了几次（6 颗弹丸 = 6 次 + 0，单发爆炸 = 1 次）。
 *
 * 用法：node .dev/archive/_probe-shotgun.mjs [url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9381;
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = path.resolve('.dev/profile-shotgun-' + Date.now());

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
  if (r.result?.exceptionDetails) return { __err: (r.result.exceptionDetails.exception?.description || '').split('\n')[0] };
  return r.result?.result?.value;
};
const J = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (_) { return { __bad: v }; } };

await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: URL }); await sleep(3200);
await ev(`(async()=>{ window.__cfg = await import('./src/config.js'); return 'ok'; })()`);
await ev('document.getElementById("startBtn").click()'); await sleep(400);

const out = J(await ev(`(()=>{const g=window.__game, cfg=window.__cfg;
  g._loop = () => {};
  g.closePhone(); g.ui.hideOverlay();
  g.state='air'; g.airFish=[]; g.birds=[]; g.airT=0; g.airClearT=0;
  g.save.guns.current='shotgun';
  g.save.guns.owned = cfg.GUN_ORDER.filter(x=>x!=='pistol');
  g.save.guns.levels.shotgun = 5;          // 用 Lv5：散布半径 30 最明显
  g.applyUpgrades(); g._resetGun();
  g.input.nx=0.5; g.input.ny=0.5; g.input.pointerDown=false;

  // 数爆炸圈 + 记录 _shootShotgun 有没有被调用
  let blasts = 0;
  const w = g.world;
  const origBurst = w.burstExplosion.bind(w);
  w.burstExplosion = (...a) => { blasts++; return origBurst(...a); };
  let shotgunFn = 0;
  const origFn = g._shootShotgun.bind(g);
  g._shootShotgun = (...a) => { shotgunFn++; return origFn(...a); };

  g._shoot(g.gunStat);

  return JSON.stringify({
    mech: g.gun.mech,
    pellets: g.gunStat.pellets,
    spread: g.gunStat.spread,
    radius: g.gunStat.radius,
    blasts,           // 6 = 弹丸生效；1 = 走了单发爆炸
    shotgunFn,        // 0 = _shootShotgun 是死代码
    dmgPerShot: g.gunStat.damage,
  });})()`));

console.log('散弹枪实测：', JSON.stringify(out, null, 2));
console.log(out.blasts >= 6
  ? '\n→ 弹丸生效（一次开火铺开多颗）'
  : '\n→ ⚠ 一次开火只有 ' + out.blasts + ' 个爆炸圈 —— 6 弹丸没有生效，_shootShotgun 是死代码');

ws.close(); chrome.kill();
process.exit(0);
