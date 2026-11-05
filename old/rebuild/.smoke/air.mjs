/** 空中阶段：滞空时长 / 最高点 / 镜头跟随 / 推近 */
import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { castOff, sleep } from './lib.mjs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML = path.resolve('dist/index.html');
const SHOTS = path.resolve('.smoke/shots');
const KEY = 'absurd-fishing-3d-save-v2';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 430, height: 900, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text().slice(0, 140));
});

await page.goto('file:///' + HTML.replace(/\\/g, '/') + '#debug', { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await sleep(1100);
await page.evaluate((k) => {
  const s = JSON.parse(localStorage.getItem(k));
  s.unlocked = ['bay', 'ice'];
  s.map = 'bay';
  s.weather = 'clear';
  s.trips = 2;
  s.fired = ['intro', 'introAfterFirst'];
  s.queue = [];
  s.up = { line: 7, saw: 3, hook: 5, lamp: 4, fin: 3, scope: 2, slowmo: 1 };
  localStorage.setItem(k, JSON.stringify(s));
}, KEY);
await page.reload({ waitUntil: 'load' });
await sleep(1000);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /开始|继续/.test(x.textContent || ''));
  b?.click();
});
await sleep(600);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('跳过'));
  b?.click();
});
await sleep(700);
await castOff(page);
await sleep(2000);

// 手动串 8 条，制造一波扇形
const hooked = await page.evaluate(() => {
  const e = window.__af;
  const pool = e.fishes.filter((f) => !f.caught && !f.dead && f.mesh).slice(0, 8);
  for (const f of pool) e.hook(f, e.cfg);
  return pool.length;
});

await page.evaluate(() => window.__af?.beginAscent('manual'));
// 等进 shoot，然后整段采样
for (let i = 0; i < 240; i++) {
  const ph = await page.evaluate(() => window.__af?.phase);
  if (ph === 'shoot') break;
  await sleep(100);
}

await sleep(2400);
await page.screenshot({ path: path.join(SHOTS, '21-air-rise.png') });
await sleep(2200);
await page.screenshot({ path: path.join(SHOTS, '22-air-apex.png') });

const trace = await page.evaluate(() => new Promise((resolve) => {
  const e = window.__af;
  const out = [];
  const t0 = performance.now();
  const tick = () => {
    const fly = e.air.filter((a) => a.state === 'fly');
    let low = Infinity;
    let high = -Infinity;
    for (const a of fly) {
      low = Math.min(low, a.y);
      high = Math.max(high, a.y);
    }
    out.push({
      t: Math.round(performance.now() - t0),
      ph: e.phase,
      n: fly.length,
      low: Number.isFinite(low) ? +low.toFixed(1) : null,
      high: Number.isFinite(high) ? +high.toFixed(1) : null,
      camY: +e.stage.camera.position.y.toFixed(2),
      camX: +e.stage.cam.cx.toFixed(2),
      scale: +e.stage.cam.scale.toFixed(1),
      airT: +e.airT.toFixed(2),
    });
    if (performance.now() - t0 < 16000) requestAnimationFrame(tick);
    else resolve(out);
  };
  requestAnimationFrame(tick);
}));

const shootRows = trace.filter((r) => r.ph === 'shoot');
const apex = shootRows.reduce((a, b) => (b.high > a.high ? b : a), shootRows[0] ?? { high: 0 });
console.log('上钩:', hooked, '条');
console.log('空中首帧:', JSON.stringify(shootRows[0]));
console.log('最高点:', JSON.stringify(apex));
console.log('空中时长:', shootRows.length ? ((shootRows[shootRows.length - 1].t - shootRows[0].t) / 1000).toFixed(1) + 's' : '0');
console.log('采样(每 20 帧):', JSON.stringify(shootRows.filter((_, i) => i % 20 === 0).map((r) => `t=${(r.t / 1000).toFixed(1)} n=${r.n} lo=${r.low} hi=${r.high} cam=${r.camY} scale=${r.scale}`)));

await page.screenshot({ path: path.join(SHOTS, '20-air-zoom.png') });
console.log('结束:', JSON.stringify(await page.evaluate(() => ({ phase: window.__af.phase }))));
console.log('errors:', errs.length, errs.slice(0, 3));
await browser.close();
