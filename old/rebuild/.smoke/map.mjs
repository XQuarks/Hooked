import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import fs from 'node:fs';
import path from 'node:path';
import { skipStory, castOff } from './lib.mjs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML = path.resolve('dist/index.html');
const SHOTS = path.resolve('.smoke/shots');
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = 'absurd-fishing-3d-save-v2';

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

await page.goto('file:///' + HTML.replace(/\\/g, '/') + '#debug', { waitUntil: 'load' });
await sleep(800);
await page.evaluate((k) => {
  const s = JSON.parse(localStorage.getItem(k));
  s.money = 9000;
  s.maxDepth = { bay: 320, ice: 0 };
  s.caught = { sardine: 3, mackerel: 2, puffer: 1, jelly: 1, snapper: 1, eel: 1, ray: 1, grouper: 1, octo: 1, marlin: 1, lantern: 1, goldfish: 1 };
  s.unlocked = ['bay'];
  localStorage.setItem(k, JSON.stringify(s));
}, KEY);
await page.reload({ waitUntil: 'load' });
await sleep(900);

const clickText = async (t) => page.evaluate((x) => {
  const b = [...document.querySelectorAll('button')].find((y) => y.textContent?.includes(x));
  if (b) { b.click(); return true; }
  return false;
}, t);

console.log('phone:', await page.evaluate(() => {
  const b = document.querySelector('.phone-fab') ?? [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('📱'));
  if (b) { b.click(); return true; }
  return false;
}));
await sleep(700);
console.log('route:', await clickText('航线'));
await sleep(800);
await page.screenshot({ path: path.join(SHOTS, '30-route.png') });
console.log('route text:', await page.evaluate(() => document.querySelector('.phone')?.innerText.replace(/\n/g, ' | ').slice(0, 500)));

const buy = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /船票|前往|解锁/.test(x.textContent) && !x.disabled);
  if (b) { b.click(); return b.textContent; }
  return null;
});
await sleep(900);
const s1 = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
console.log('buy clicked:', buy, '=> map:', s1.map, 'unlocked:', s1.unlocked, 'money:', s1.money);
await page.screenshot({ path: path.join(SHOTS, '31-route-unlocked.png') });

// 回岸边，看冰海标题
await page.evaluate(() => {
  const b = document.querySelector('.phone-fold');
  b && b.click();
});
await sleep(700);
await page.screenshot({ path: path.join(SHOTS, '32-title-ice.png') });
console.log('title:', await page.evaluate(() => document.querySelector('.title')?.innerText.replace(/\n/g, ' | ').slice(0, 220)));

// 出海一次，确认冰海渲染 + 洋流
await page.click('.btn.start');
await sleep(600);
await skipStory(page, 10);
await castOff(page);
await sleep(3600);
await page.screenshot({ path: path.join(SHOTS, '33-ice-play.png') });
console.log('ice state:', JSON.stringify(await page.evaluate(() => ({ ...window.__af.debugState(), scene: window.__af.scene?.map, weather: window.__af.scene?.weather }))).slice(0, 220));
console.log('errors:', errors.length);
await browser.close();
