/** 击杀的鱼应当当场消失：状态 lost、从渲染列表移除、网格回收 */
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
await sleep(2200);
// 手动钩几条鱼，保证进射击阶段时确实有东西可打
console.log('手动上钩:', JSON.stringify(await page.evaluate(() => {
  const e = window.__af;
  const pool = e.fishes.filter((f) => !f.caught && !f.dead && f.mesh).slice(0, 6);
  for (const f of pool) e.hook(f, e.cfg);
  return { picked: pool.length, hooked: e.hooked.length };
})));
await page.evaluate(() => window.__af?.beginAscent('manual'));

for (let i = 0; i < 220; i++) {
  const ph = await page.evaluate(() => window.__af?.debugState?.().phase);
  if (ph === 'shoot') break;
  await sleep(150);
}
await sleep(500);

const r = await page.evaluate(() => {
  const e = window.__af;
  const before = e.stage.fishes.length;
  const a = (e.air || []).find((x) => x.state === 'fly');
  if (!a) return { err: 'no fly fish', air: e.air.length };
  const mesh = a.mesh;
  const inList = e.stage.fishes.includes(mesh);
  a.hp = 1;
  a.hits = 0;
  e.damage(a, 99, e.cfg);
  return {
    before,
    after: e.stage.fishes.length,
    inListBefore: inList,
    inListAfter: e.stage.fishes.includes(mesh),
    state: a.state,
    air: e.air.map((x) => x.state),
    gross: e.debugState().gross,
    flyLeft: e.air.filter((x) => x.state === 'fly').length,
  };
});
console.log('击杀后:', JSON.stringify(r));
await page.screenshot({ path: path.join(SHOTS, '15-kill-gone.png') });
// 换一条再打一次，抓爆开的瞬间
await page.evaluate(() => {
  const e = window.__af;
  const a = (e.air || []).find((x) => x.state === 'fly' && x.delay <= 0);
  if (a) {
    a.hp = 1;
    e.damage(a, 99, e.cfg);
  }
});
await sleep(90);
await page.screenshot({ path: path.join(SHOTS, '15b-kill-burst.png') });

// 再等 1 秒，确认没有残留的缩小动画重新长出来
await sleep(900);
const later = await page.evaluate(() => {
  const e = window.__af;
  return {
    stageFish: e.stage.fishes.length,
    air: e.air.map((x) => `${x.sp.id}:${x.state}`),
    phase: e.phase,
  };
});
console.log('1 秒后:', JSON.stringify(later));
await page.screenshot({ path: path.join(SHOTS, '16-kill-later.png') });
console.log('errors:', errs.length, errs.slice(0, 3));
await browser.close();
