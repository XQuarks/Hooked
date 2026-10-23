import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML = path.resolve('dist/index.html');
const URL = 'file:///' + HTML.replace(/\\/g, '/');
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

const overlay = () =>
  page.evaluate(() => {
    if (document.querySelector('.comic')) return 'comic';
    if (document.querySelector('.call')) return 'call';
    if (document.querySelector('.notice')) return 'notice';
    if (document.querySelector('.bottle')) return 'bottle';
    return null;
  });

async function drain(max = 10) {
  const seq = [];
  for (let i = 0; i < max; i++) {
    const k = await overlay();
    if (!k) break;
    seq.push(k);
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const pick = ['接听', '挂断', '已阅', '继续', '跳过'].map((t) => btns.find((b) => (b.textContent || '').includes(t))).find(Boolean);
      if (pick) { pick.click(); return; }
      const lines = document.querySelector('.lines');
      if (lines) { lines.click(); return; }
      document.querySelector('.comic')?.click();
    });
    await sleep(340);
  }
  return seq;
}

await page.goto(URL, { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await sleep(1400);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('开始'));
  b?.click();
});
await sleep(600);
console.log('第一段（开场）:', (await drain()).join(' -> '));

// 模拟「已经打完第一局」：直接把 trips 改成 1，runStory 会在下次加载时补播
await page.evaluate((k) => {
  const s = JSON.parse(localStorage.getItem(k));
  s.trips = 1;
  s.money = 60;
  s.totalEarned = 60;
  localStorage.setItem(k, JSON.stringify(s));
}, KEY);
await page.reload({ waitUntil: 'load' });
await sleep(1400);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('继续') || (x.textContent || '').includes('开始'));
  b?.click();
});
await sleep(1200);
const islandTxt = await page.evaluate(() => {
  const el = document.querySelector('.island');
  return el ? el.innerText.replace(/\n/g, ' | ') : null;
});
console.log('第二段（首局后）灵动岛:', islandTxt);

// 目标条应该变成「攒钱升级鱼线」类
await sleep(500);
console.log('目标条:', await page.evaluate(() => document.querySelector('.goal')?.innerText.replace(/\n/g, ' | ') ?? null));
await page.screenshot({ path: path.join('.smoke/shots', '74-goal-2.png') });

console.log('errors:', errs.length, errs.slice(0, 3));
await browser.close();
