/** 出水水幕 + 局内变天 */
import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { castOff, skipStory, sleep } from './lib.mjs';

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
  if (m.type() === 'error') errs.push(m.text().slice(0, 160));
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
await sleep(700);
await skipStory(page);
await castOff(page);
await sleep(1800);

// ── 1. 局内变天：把 weatherAt 一直压在深度下面，逼它每帧都掷骰子 ──
const wm = await page.evaluate(() => new Promise((resolve) => {
  const e = window.__af;
  const before = e.scene.weather;
  let n = 0;
  const tick = () => {
    e.weatherAt = Math.max(0, -e.lure.y) - 60;
    n += 1;
    if (e.scene.weather !== before || n > 90) {
      resolve({ before, after: e.scene.weather, frames: n, banner: document.querySelector('.banner')?.innerText?.replace(/\n/g, ' | ') ?? null });
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}));
console.log('局内变天:', JSON.stringify(wm));
await sleep(400);
await page.screenshot({ path: path.join(SHOTS, '33-weather-mid.png') });

// ── 2. 出水水幕：进 shoot 后手动触发一次 ──
await page.evaluate(() => {
  const e = window.__af;
  const pool = e.fishes.filter((f) => !f.caught && !f.dead && f.mesh).slice(0, 4);
  for (const f of pool) e.hook(f, e.cfg);
  e.beginAscent('manual');
});
for (let i = 0; i < 200; i++) {
  const ph = await page.evaluate(() => window.__af?.phase);
  if (ph === 'shoot') break;
  await sleep(100);
}
// 立刻重放一次破水（launch 时已经触发过一次，这里保证截在最强的一帧）
await page.evaluate(() => window.__af?.stage.burstSplash());
await sleep(110);
await page.screenshot({ path: path.join(SHOTS, '34-burst-splash.png') });
await sleep(700);
await page.screenshot({ path: path.join(SHOTS, '35-burst-after.png') });

console.log('水幕:', JSON.stringify(await page.evaluate(() => ({ phase: window.__af.phase, burst: window.__af.stage.burst }))));
console.log('errors:', errs.length, errs.slice(0, 3));
await browser.close();
