import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import fs from 'node:fs';
import path from 'node:path';
import { skipStory, castOff } from './lib.mjs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML = path.resolve('dist/index.html');
const SHOTS = path.resolve('.smoke/shots');
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 430, height: 900, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('PAGEERROR:', e.message); });
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.log('ERR:', m.text()); } });

const url = 'file:///' + HTML.replace(/\\/g, '/') + '#debug';
await page.goto(url, { waitUntil: 'load' });
await sleep(900);

// 给点钱，方便测购买
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('absurd-fishing-3d-save-v2'));
  s.money = 5000;
  localStorage.setItem('absurd-fishing-3d-save-v2', JSON.stringify(s));
});
await page.reload({ waitUntil: 'load' });
await sleep(900);

const clickText = async (txt) => page.evaluate((t) => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes(t));
  if (b) { b.click(); return true; }
  return false;
}, txt);

// 1) 画质切换（标题页）
for (const q of ['流畅', '均衡', '精美']) {
  const ok = await clickText(q);
  await sleep(700);
  console.log('quality', q, ok, 'phase=', await page.evaluate(() => document.querySelector('[data-phase]')?.dataset.phase ?? 'none'));
}
const qNow = await page.evaluate(() => JSON.parse(localStorage.getItem('absurd-fishing-3d-save-v2')).quality);
console.log('saved quality:', qNow);
await page.screenshot({ path: path.join(SHOTS, '20-quality.png') });

// 2) 出海 → 暂停 → 回到岸边
await page.click('.btn.start');
await sleep(600);
await skipStory(page, 10);
await castOff(page);
await sleep(900);
await page.keyboard.press('Escape');
await sleep(500);
await page.screenshot({ path: path.join(SHOTS, '21-pause.png') });
const paused = await page.evaluate(() => document.querySelector('.sheet-mask')?.innerText.replace(/\n/g, ' | '));
console.log('pause sheet:', paused);
console.log('back to shore:', await clickText('回到岸边'));
await sleep(800);
console.log('phase after shore:', await page.evaluate(() => document.querySelector('[data-phase]')?.dataset.phase));

// 3) 标题页手机入口 → 装备升级
console.log('open phone(from title):', await page.evaluate(() => {
  const b = document.querySelector('.phone-fab') ?? [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('手机'));
  if (b) { b.click(); return true; }
  return false;
}));
await sleep(800);
console.log('apps:', await page.evaluate(() => [...document.querySelectorAll('.app-icon')].map((x) => x.textContent).join('/')));
console.log('tackle:', await clickText('渔具'));
await sleep(700);
await page.screenshot({ path: path.join(SHOTS, '22-tackle.png') });
const before = await page.evaluate(() => JSON.parse(localStorage.getItem('absurd-fishing-3d-save-v2')));
const upBtns = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /强化|升级|购买/.test(b.textContent)).map((b) => b.textContent));
console.log('upgrade buttons:', upBtns.length, upBtns.slice(0, 3));
const bought = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /强化|升级|购买/.test(x.textContent) && !x.disabled);
  if (b) { b.click(); return b.textContent; }
  return null;
});
await sleep(700);
const after = await page.evaluate(() => JSON.parse(localStorage.getItem('absurd-fishing-3d-save-v2')));
console.log('bought:', bought, 'money', before.money, '->', after.money, 'up', JSON.stringify(before.up), '->', JSON.stringify(after.up));
await page.screenshot({ path: path.join(SHOTS, '23-tackle-bought.png') });

// 4) 设置：音效/震动/导出
console.log('back:', await clickText('返回'));
await sleep(400);
console.log('settings:', await clickText('设置'));
await sleep(700);
await page.screenshot({ path: path.join(SHOTS, '24-settings.png') });
const setTxt = await page.evaluate(() => document.querySelector('.phone')?.innerText.replace(/\n/g, ' | ').slice(0, 400));
console.log('settings text:', setTxt);

// 5) 关闭手机，再出一次海，确认船/水面正常
await page.evaluate(() => {
  const b = document.querySelector('.phone-fold');
  b && b.click();
});
await sleep(500);
await page.screenshot({ path: path.join(SHOTS, '25-home.png') });
console.log('errors:', errors.length);
await browser.close();
