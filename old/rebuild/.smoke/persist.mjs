import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML = path.resolve('dist/index.html');
const SHOTS = path.resolve('.smoke/shots');
const URL = 'file:///' + HTML.replace(/\\/g, '/') + '#debug';
const KEY = 'absurd-fishing-3d-save-v2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 430, height: 900, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text().slice(0, 160));
});

const state = () =>
  page.evaluate(() => ({
    island: document.querySelector('.island')?.className ?? null,
    text: document.querySelector('.island')?.innerText?.replace(/\n/g, ' | ') ?? null,
    veil: !!document.querySelector('.force-veil'),
    hud: !!document.querySelector('.hud-layer'),
    call: !!document.querySelector('.call'),
    sheet: !!document.querySelector('.sheet'),
    phase: window.__af?.debugState?.().phase ?? null,
  }));

// 1) 触发 d120 强制来电
await page.goto(URL, { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await sleep(1300);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('开始'));
  b?.click();
});
await sleep(600);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('跳过'));
  b?.click();
});
await sleep(700);
await page.evaluate((k) => {
  const s = JSON.parse(localStorage.getItem(k));
  s.trips = 2;
  s.maxDepth.bay = 130;
  s.fired = ['intro', 'introAfterFirst'];
  localStorage.setItem(k, JSON.stringify(s));
}, KEY);
await page.reload({ waitUntil: 'load' });
await sleep(1200);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('继续'));
  b?.click();
});
await sleep(1500);
console.log('来电:', JSON.stringify(await state()));

// 2) 切后台：不应弹出暂停面板把来电盖掉
await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await sleep(400);
console.log('切后台后:', JSON.stringify(await state()));
await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await sleep(300);

// 3) 接听后立刻刷新（模拟中途关游戏）
await page.evaluate(() => document.querySelector('.is-btn.yes')?.click());
await sleep(900);
console.log('通话中:', JSON.stringify(await state()));
await page.reload({ waitUntil: 'load' });
await sleep(1300);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('继续'));
  b?.click();
});
await sleep(1500);
const afterReload = await state();
console.log('刷新回来:', JSON.stringify(afterReload));
await page.screenshot({ path: path.join(SHOTS, '94-forced-persist.png') });

// 4) 接完，确认队列清空、记录已接
await page.evaluate(() => document.querySelector('.is-btn.yes')?.click());
await sleep(700);
for (let i = 0; i < 20; i++) {
  const alive = await page.evaluate(() => !!document.querySelector('.call'));
  if (!alive) break;
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const end = btns.find((b) => (b.textContent || '').includes('挂断'));
    if (end) {
      end.click();
      return;
    }
    document.querySelector('.lines')?.click();
  });
  await sleep(300);
}
await sleep(800);
const save = await page.evaluate((k) => {
  const s = JSON.parse(localStorage.getItem(k) || '{}');
  return { queue: (s.queue || []).map((q) => q.kind), calls: s.calls };
}, KEY);
console.log('结束:', JSON.stringify(await state()));
console.log('存档:', JSON.stringify(save));

console.log('errors:', errs.length, errs.slice(0, 3));
await browser.close();
