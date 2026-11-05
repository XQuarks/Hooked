/** UI 改版对照：岸边 HUD / 手机主屏 / 渔具 / 图鉴 */
import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { sleep } from './lib.mjs';

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
  s.weather = 'clear';
  s.trips = 2;
  s.money = 8420;
  s.fired = ['intro', 'introAfterFirst', 'iceUnlocked'];
  s.queue = [];
  s.up = { line: 7, saw: 3, hook: 5, lamp: 4, fin: 3, scope: 2, slowmo: 1 };
  s.unread = { sms: 2, comic: 1 };
  s.unreadKey = { sms: 2, comic: 1 };
  localStorage.setItem(k, JSON.stringify(s));
}, KEY);
await page.reload({ waitUntil: 'load' });
await sleep(1000);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /开始|继续/.test(x.textContent || ''));
  b?.click();
});
await sleep(700);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('跳过'));
  b?.click();
});
// 有公告就先上滑收掉，否则它会挡住整个 HUD
const island = await page.$('.island');
if (island) {
  const b = await island.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 70, { steps: 8 });
  await page.mouse.up();
  await sleep(700);
}
await page.screenshot({ path: path.join(SHOTS, '50-shore-hud.png') });

// 手机主屏
await page.evaluate(() => document.querySelector('.phone-fab')?.click());
await sleep(700);
await page.screenshot({ path: path.join(SHOTS, '51-phone-home.png') });

const openApp = async (name) => {
  await page.evaluate((n) => {
    const i = [...document.querySelectorAll('.app-icon')].find((x) => (x.textContent || '').includes(n));
    i?.click();
  }, name);
  await sleep(700);
};

await openApp('渔具');
await page.screenshot({ path: path.join(SHOTS, '52-tackle.png') });
await page.evaluate(() => document.querySelector('.appbar .back')?.click());
await sleep(500);
await openApp('鱼鉴');
await page.screenshot({ path: path.join(SHOTS, '53-dex.png') });

console.log('errors:', errs.length, errs.slice(0, 3));
await browser.close();
