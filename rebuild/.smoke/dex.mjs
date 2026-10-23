import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML = path.resolve('dist/index.html');
const SHOTS = path.resolve('.smoke/shots');
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

await page.goto('file:///' + HTML.replace(/\\/g, '/'), { waitUntil: 'load' });
await sleep(1600);
await page.screenshot({ path: path.join(SHOTS, '60-title.png') });

await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('开始') || x.textContent?.includes('继续'));
  b?.click();
});
await sleep(800);

// 跳过序章
for (let i = 0; i < 30; i++) {
  const done = await page.evaluate(() => !document.querySelector('.comic, .call, .notice'));
  if (done) break;
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const pick = ['跳过', '接听', '已阅', '继续'].map((t) => btns.find((b) => b.textContent?.includes(t))).find(Boolean);
    if (pick) pick.click();
    else document.querySelector('.comic')?.click();
  });
  await sleep(320);
}
await sleep(400);

// 打开手机 → 鱼鉴
await page.evaluate(() => {
  const b = (document.querySelector('.phone-fab') ?? [...document.querySelectorAll('button, .app-icon')].find((x) => (x.textContent || '').includes('手机')));
  b?.click();
});
await sleep(500);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.app-icon, button')].find((x) => (x.textContent || '').includes('鱼鉴') || (x.textContent || '').includes('图鉴'));
  b?.click();
});
await sleep(700);
await page.screenshot({ path: path.join(SHOTS, '61-dex.png') });

// 点第一条已解锁的鱼看详情
await page.evaluate(() => {
  const card = [...document.querySelectorAll('.dex-card, .card')].find((x) => !(x.textContent || '').includes('???'));
  card?.click();
});
await sleep(900);
await page.screenshot({ path: path.join(SHOTS, '62-dex-detail.png') });

console.log('errors:', errs.length, errs.slice(0, 3));
await browser.close();
