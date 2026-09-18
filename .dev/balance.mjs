/**
 * balance.mjs — 手感抽样：不做任何操作时，一竿能潜多深、上升能抓几条
 * 用法：node .dev/balance.mjs
 *
 * ⚠ 夹具一律用 `levelsOf()` 造**完整**的等级表，不要手写键名 ——
 *   漏键会让 `lvAt` 拿到 undefined 并钳到 0，NaN 顺着物理链静默污染（见 fixtures.mjs）。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { UPGRADE_ORDER } from '../src/config.js';
import { levelsOf } from './fixtures.mjs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9335;
const URL = 'http://127.0.0.1:8899/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 「全 LvN」= 所有走等级曲线的项都设成 N（一次性工具没有曲线，设了也没用） */
const allAt = (n) => levelsOf(Object.fromEntries(UPGRADE_ORDER.map((k) => [k, n])));

async function getTarget(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const p = list.find((t) => t.type === 'page');
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch (_) { /* 等 */ }
    await sleep(300);
  }
  throw new Error('CDP 未就绪');
}

const profile = path.resolve('.dev/profile-bal-' + Date.now());
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=430,932', '--hide-scrollbars', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

let ws;
try {
  ws = new WebSocket(await getTarget(PORT));
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0; const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3500);

  await ev(`(()=>{const g=window.__game; g._loop = () => {};
    const cl = (v,a,b) => v<a?a:v>b?b:v;
    // 一个"还算认真玩"的玩家：下潜时躲开正下方的鱼，上升时朝最近的鱼靠过去
    window.ai = () => {
      if (g.state !== 'descend' && g.state !== 'ascend') return;
      const hx = g.hook.x, hy = g.hook.y;
      const list = g.fish.active.filter(f => f.state === 'swim');
      if (g.state === 'descend') {
        let best = null, bd = 1e9;
        for (const f of list) {
          const p = f.mesh.position;
          const dy = hy - p.y;
          if (dy < -6 || dy > 130) continue;
          const dx = p.x - hx;
          if (Math.abs(dx) > 46) continue;
          const d = Math.abs(dx) + Math.abs(dy) * 0.35;
          if (d < bd) { bd = d; best = f; }
        }
        g.targetX = best
          ? cl(best.mesh.position.x + (best.mesh.position.x >= hx ? -1 : 1) * 34, -56, 56)
          : 0;
      } else {
        let best = null, bd = 1e9;
        for (const f of list) {
          const p = f.mesh.position;
          const dy = p.y - hy;
          if (dy < -6 || dy > 170) continue;
          const d = dy + Math.abs(p.x - hx) * 0.5;
          if (d < bd) { bd = d; best = f; }
        }
        g.targetX = best ? cl(best.mesh.position.x, -56, 56) : hx;
      }
    };
    window.step = (n, useAi) => { for (let i=0;i<n;i++){ const dt=1/60; g.time+=dt;
      if (useAi) window.ai(); g._update(dt);} };
    return 'ok';})()`);
  await sleep(200);

  // 每一项升级分别测「不改等级」和「满级」两种情形
  for (const cfg of [
    { tag: '全 Lv0', levels: allAt(0) },
    { tag: '全 Lv4', levels: allAt(4) },
    { tag: '只升鱼线 Lv4', levels: levelsOf({ line: 4 }) },
  ]) {
    for (const useAi of [false, true]) {
      const out = await ev(`(()=>{const g=window.__game;
        Object.assign(g.save.levels, ${JSON.stringify(cfg.levels)});
        g.applyUpgrades();
        const N = 40;
        const depths = [], catches = [], airs = [];
        for (let i = 0; i < N; i++) {
          g.enterDescend();
          let guard = 0;
          while (g.state === 'descend' && guard++ < 6000) window.step(1, ${useAi});
          depths.push(Math.round(g.maxDepthReached));
          guard = 0;
          while (g.state === 'ascend' && guard++ < 6000) window.step(1, ${useAi});
          catches.push(g.run.caught);
          airs.push(g.airFish.length);
          if (g.state === 'air') g.state = 'result';
        }
        const avg = (a) => +(a.reduce((x,y)=>x+y,0)/a.length).toFixed(1);
        const pct = (a, p) => { const s=[...a].sort((x,y)=>x-y); return s[Math.floor(s.length*p)]; };
        return JSON.stringify({ tag: '${cfg.tag}' + (${useAi} ? ' · 会操作' : ' · 不操作'),
          depthAvg: avg(depths), depthP25: pct(depths,0.25), depthP75: pct(depths,0.75), depthMax: Math.max(...depths),
          catchAvg: avg(catches), catchMax: Math.max(...catches), catchZero: catches.filter(x=>x===0).length });})()`);
      console.log(out);
    }
  }

  ws.close();
} catch (e) {
  console.error('抽样脚本异常：', e);
} finally {
  try { chrome.kill(); } catch (_) { /* ignore */ }
  setTimeout(() => process.exit(0), 500);
}
