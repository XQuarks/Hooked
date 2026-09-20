/**
 * shots-polar.mjs — 冰封极地的观感复核出图
 *
 * 为什么需要它：极光够不够亮、冰柱是不是"一堵糊掉的墙"、海带有没有收干净、
 * 水体渐变读不读得出"这是另一片海" —— 这些都是**断言测不到**的东西
 * （verify8 只能告诉你 auroraRoot.visible === true，看不出它其实在画面外）。
 * 改完 world.js 的主题部分，跑这个脚本人工看一眼。
 *
 * 出图：极地待机（船 + 极光）/ 水面以下各深度 / 宁静海湾对照
 * 用法：node .dev/shots-polar.mjs [url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9374;
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-polar');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const profile = path.resolve('.dev/profile-polar-' + Date.now());

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

// 静音 + 满级（看清鱼和地形，不受灯具黑暗干扰）
await ev(`(()=>{const g=window.__game; const cfg=window.__cfg;
  for (const k of cfg.UPGRADE_ORDER) g.save.levels[k] = 12;
  g.save.levels.lamp = 12; g.applyUpgrades(); return 'ok';})()`);

// ⚠⚠ 出图要的是**干净的场景**，不是过场故事卡：`enterMap()` 会在首次进入某张图时
//   盖一层「点击继续」的故事卡（`cutsceneFor()` 读 `save.seenCut`）。
//   不先把它们标成"已看过"的话，截出来的 8 张图**全是过场**。
//   （这个坑一直存在，只是 polar 那几张因为换图失败反而"躲过"了它 ——
//     也就是这个脚本既拍错了海、又被过场盖住。）
await ev(`(()=>{const g=window.__game; const cfg=window.__cfg;
  g.save.seenCut = cfg.MAPS.map((m) => m.id);
  return 'ok';})()`);

// ── 1) 极地待机：船 + 天空 + 极光 ──
// ⚠⚠ 换图钥匙 = **海图 + 船**。这里原先写的是 `g.save.licenses = ['polar']`，而
//   **所有地图的 `license` 恒为 0** → `enterMap` 里那条许可证判定从来没生效过
//   → 一直返回 `false`。也就是说这个脚本**从 v0.7 第二批起拍的就是宁静海湾**，
//   只是文件名还叫 polar（出图脚本没有断言，所以没人发现 —— 又一个静默失效）。
//   2026-09-20 修：按真实门槛给上海图 + 船，并**加两道会抛错的护栏**。
await ev(`(()=>{const g=window.__game; const cfg=window.__cfg;
  // ⚠ 出图要的是**干净场景**：来电卡和「枪店 · 新货上架」横幅正好**盖在要复核的极光 / 冰柱上**
  //   （第一版截出来顶部就是一条横幅）。两步都要做：
  //   ① 把**来源**掐掉（所有电话标记已听 / 所有枪标记已播报）—— 必须赶在 enterMap 之前，
  //      因为换图本身会触发 _syncGunNews()；
  //   ② 清一遍 UI 队列里**已经排上**的（横幅是入队后由 pumpNews() 逐张渲染的，
  //      只清 save 里的 gunNews 拦不住它）。
  //   ⚠ 这段注释在**模板字符串内部** —— 里面一个反引号都不能有，会提前把它闭合。
  g.save.calls = cfg.CALLS.map((c) => c.id);
  g.ringingCall = null;
  g.save.gunAnnounced = cfg.GUN_ORDER.slice();
  g.save.gunNews = [];
  g.save.charts = { polar: true };
  g.save.boats = { owned: [cfg.BOAT_ORDER[0]], current: cfg.BOAT_ORDER[0] };
  if (!g.enterMap('polar')) throw new Error('enterMap(polar) 被换图门槛拦下了 —— 出图会拍到错的海');
  if (g.save.currentMap !== 'polar') throw new Error('换图没生效，当前图 = ' + g.save.currentMap);
  g.ui._newsQueue.length = 0;
  g.ui._newsShowing = false;
  clearTimeout(g.ui._newsT);
  g.ui.el.newsBanner.classList.remove('on');
  g.showIdle(); return 'ok';})()`);
await ev('window.step(40)');
await shot('01-polar-idle');
const auroraInfo = await ev(`JSON.stringify((()=>{const g=window.__game;
  const vr = g.world.viewRange();
  // ⚠ 判据是"光帘与视野**相交**"，不是"中心点在视野内"。
  //   光帘高 230~440，用中心点量的话：底边贴地平线的帘子中心也在 120+，
  //   会被判成"不可见"，而它其实占了大半个天空 —— 尺子本身是错的。
  const rows = g.world.aurora.map(r => ({ y: Math.round(r.position.y), h: Math.round(r.scale.y),
    x: Math.round(r.position.x), w: Math.round(r.scale.x) }));
  const vis = rows.filter(r => r.y - r.h / 2 < vr.top && r.y + r.h / 2 > vr.bottom).length;
  // 横向别用 Math.abs(x) 去比 right —— 负坐标会算错（x=-113 会被当成 +113 判到右侧外）。
  const inX = rows.filter(r => r.x - r.w / 2 < vr.right && r.x + r.w / 2 > vr.left).length;
  return { viewTop: Math.round(vr.top), viewBottom: Math.round(vr.bottom),
    ribbons: g.world.aurora.length, visible: vis, visibleX: inX, rows };})())`);
console.log('极光：' + auroraInfo);

// ── 2) 水面以下各深度 ──
for (const d of [30, 90, 200, 340, 520]) {
  await ev(`(()=>{const g=window.__game;
    g.enterDescend(); g.castAir = false; g.castT = 0;
    g.hook.y = -${d}; g.hook.setPosition(0, -${d}); g.targetX = 0;
    g.world.camY = -${d}; g.world.camX = 0;
    window.step(2); return 'ok';})()`);
  await sleep(120);
  await shot(`02-polar-${d}m`);
}

// ── 3) 宁静海湾同深度对照 ──
// ⚠ 切图前必须把鱼钩和相机**手动归位**：上一步把 hook 停在 −520m 了，
//   只调 showIdle() 的话相机会慢慢爬回水面（step(30) 只推进 0.5s，爬不完），
//   截出来是"水下 + 深度 523/430"的怪画面，看着像封顶失效，其实是脚本没归位。
await ev(`(()=>{const g=window.__game;
  g.enterMap('calm-bay');
  g.hook.y = 0; g.hook.setPosition(0, 0); g.targetX = 0;
  g.world.camY = 0; g.world.camX = 0;
  g.showIdle(); window.step(40); return 'ok';})()`);
// ⚠ step() 是同步 JS 循环，**不推进 CSS 过渡**（performance.now 几乎不变）。
//   深度 chip 从「下潜中」淡回待机要 0.25s 过渡，sleep 太短会截到半透明的中间态，
//   看起来像"待机时还挂着 523/430"的 bug —— 其实是出图自己没等。
await sleep(450);
await shot('03-bay-idle');
await ev(`(()=>{const g=window.__game;
  g.enterDescend(); g.castAir = false; g.castT = 0;
  g.hook.y = -90; g.hook.setPosition(0, -90); g.targetX = 0;
  g.world.camY = -90; g.world.camX = 0; window.step(2); return 'ok';})()`);
await sleep(120);
await shot('04-bay-90m');

ws.close(); chrome.kill();
fs.rmSync(profile, { recursive: true, force: true });
console.log('\n出图目录：' + OUT);
