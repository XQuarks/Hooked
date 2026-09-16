/** _probe-roww2.mjs — 量商店每一行「文字实际宽度 vs 可用宽度」，找出被截断的行 */
import { spawn } from 'node:child_process';
import path from 'node:path';
const CHROME = 'C://Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9391;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = path.resolve('.dev/profile-roww-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-proxy-server', '--proxy-bypass-list=*', '--mute-audio',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=430,932', '--hide-scrollbars', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
try {
  let ws;
  for (let i = 0; i < 60; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = l.find((t) => t.type === 'page'); if (p?.webSocketDebuggerUrl) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch (_) {}
    await sleep(300);
  }
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8899/index.html' });
  await sleep(3600);
  await ev(`document.getElementById('startBtn').click()`);
  await sleep(400);
  await ev(`(()=>{ const g=window.__game; g.save.coins=99999999; g.openPhone(); g.ui.openApp('shop'); return 'ok'; })()`);

  for (const lv of [0, 9, 15, 19, 20]) {
    await ev(`(()=>{ const g=window.__game;
      for (const k of Object.keys(g.save.levels)) g.save.levels[k]=${lv};
      g.applyUpgrades(); g.ui.openApp('shop'); return 'ok'; })()`);
    await sleep(260);
    const out = await ev(`JSON.stringify((()=>{
      const rows = [...document.querySelectorAll('#pApp .item')];
      return rows.map((it) => {
        const ds = it.querySelector('.ds');
        if (!ds) return null;
        const r = document.createRange(); r.selectNodeContents(ds);
        const need = +r.getBoundingClientRect().width.toFixed(1);
        const avail = +ds.getBoundingClientRect().width.toFixed(1);
        return { nm: it.querySelector('.nm').textContent.trim().split(' ')[0],
                 txt: ds.textContent.trim(), need, avail, over: +(need - avail).toFixed(1),
                 h: Math.round(it.getBoundingClientRect().height) };
      }).filter(Boolean);
    })())`);
    const rows = JSON.parse(out);
    console.log(`\n── Lv${lv} ──`);
    for (const r of rows) {
      const flag = r.over > 0.5 ? '✗ 截断' : (r.over > -6 ? '⚠ 紧' : '  ok');
      console.log(`${flag} ${r.nm.padEnd(4)} need=${String(r.need).padStart(6)} avail=${String(r.avail).padStart(6)} 余=${String(-r.over).padStart(6)} h=${r.h}  ${r.txt}`);
    }
  }
} finally { try { chrome.kill(); } catch (_) {} }
