/**
 * _shot-p3.mjs —— v0.7 第三批出图：新货推送卡 + 手机红点 + 枪店黑卡
 * 用法：node .dev/_shot-p3.mjs   （需要 8899 静态服务 + 可用 VB_PORT）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.VB_PORT || 9655);
const URL = 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-v9');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

async function getTarget(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const p = list.find((t) => t.type === 'page');
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch (_) {}
    await sleep(300);
  }
  throw new Error('Chrome CDP 未就绪');
}

const profile = path.resolve('.dev/profile-shot-' + Date.now());
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--no-proxy-server', '--proxy-bypass-list=*',
  '--disable-extensions', '--mute-audio',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=430,932', '--hide-scrollbars', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

try {
  const ws = new WebSocket(await getTarget(PORT));
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
    console.log('📸 ' + name);
  };

  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3400);

  // 场景：刚到过极地、什么都不拥有 → 散弹枪作为"新货"触发播报
  const setup = await ev(`(()=>{const g=window.__game;
    if (!g) return { err: 'no __game' };
    try {
      g.save.chart = true; g.save.boats = { owned: ['golden'], current: 'golden' };
      g.save.mapBest = { polar: 0 };
      g.save.guns = { owned: [], current: 'pistol', levels: Object.fromEntries(Object.keys(g.save.guns.levels).map(k=>[k,0])) };
      g.save.gunNews = []; g.save.gunAnnounced = [];
      g.save.calls = g.save.calls && g.save.calls.length ? g.save.calls : ['shop-intro','shop-drop','gun-intro','gun-power','shop-winch','shop-newsea','boat-intro','chart-need-boat','chart-ready'];
      g.ringingCall = null;
      g.showIdle();
      return { state: g.state, news: g.save.gunNews.slice(),
        banner: document.getElementById('newsBanner').classList.contains('on') };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`);
  console.log('[setup] ' + JSON.stringify(setup));
  await sleep(900);
  await shot('p3-1-push-banner');          // 推送卡 + 左下角手机红点

  const s2 = await ev(`(()=>{const g=window.__game;
    g.save.mapBest = { polar: 140 }; g._syncGunNews();
    g.openPhone(); return { state: g.state, open: g.phoneOpen };})()`);
  console.log('[s2] ' + JSON.stringify(s2));
  await sleep(600);
  await shot('p3-2-phone-badge');          // 手机桌面：枪店 App 红点

  await ev(`(()=>{const g=window.__game;
    g.save.gunNews = []; g.syncBadges();   // 点开枪店 = 已读（红点灭），黑卡保留
    g.ui.openApp('gunshop'); g.ui.refreshApp(); return 'ok';})()`);
  await sleep(500);
  await shot('p3-3-gunshop-locked');       // 枪店：手枪可买 + NEW 角标

  // 滚到底：加特林 / 鱼叉 / 激光 / 巴雷特 = 黑卡（看不到数值与价格）
  const scroll = await ev(`(()=>{const a=document.getElementById('pApp'); const b=document.querySelector('#pApp .p-app-body');
    if(a) a.scrollTop=99999; if(b) b.scrollTop=99999; return 'ok';})()`);
  console.log('[scroll] ' + JSON.stringify(scroll));
  await sleep(400);
  await shot('p3-4-gunshop-black');
  console.log('完成');
} finally {
  chrome.kill();
}
