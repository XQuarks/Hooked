/** 逐个 App 截图，用于对照 ui-refs */
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
  s.unlocked = ['bay'];
  s.weather = 'clear';
  s.trips = 6;
  s.money = 8420;
  s.totalEarned = 12680;
  s.maxDepth = { bay: 128 };
  s.caught = { sardine: 12, yellow: 7, mackerel: 3, jelly: 2, tuna: 1 };
  s.calls = [
    { id: 'call_d120_0', from: 'unknown', topic: '海底的瓶子', trip: 2, missed: true },
    { id: 'call_intro', from: 'cuihua', topic: '渔具店的熟人', trip: 1, missed: false },
    { id: 'call_mayor', from: 'mayor', topic: '钓鱼节报名', trip: 3, missed: true },
  ];
  s.messages = [
    { id: 'm1', thread: 'mom', text: '吃饭了没有？别老吃鱼。', trip: 5 },
    { id: 'm2', thread: 'cuihua', text: '渔具店新到一批线，来看看。', trip: 4 },
    { id: 'm3', thread: 'unknown', text: '海底的瓶子……', trip: 2 },
  ];
  s.feed = [
    { id: 'f1', author: 'kevin', text: '今天又钓到一条大的！直播间见！', likes: 128, trip: 3 },
    { id: 'f2', author: 'cuihua', text: '新到的鱼线，谁不来买我就涨价。', likes: 46, trip: 2 },
  ];
  s.fired = ['prologue','kevin','north','ending','intro','introAfterFirst','firstTrip','d60','money400','trip3','jelly1','d120','bottle1','species7','d200','goldfish','iceHint','unlockReady','iceUnlocked','iceTrip1','ice300','legend','allSpecies'];
  s.queue = [];
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
await sleep(900);
await page.evaluate(() => document.querySelector('.phone-fab')?.click());
await sleep(800);

const shot = async (name, file) => {
  await page.evaluate((n) => {
    const i = [...document.querySelectorAll('.app-icon')].find((x) => (x.textContent || '').includes(n));
    i?.click();
  }, name);
  await sleep(650);
  await page.screenshot({ path: path.join(SHOTS, file) });
  await page.evaluate(() => document.querySelector('.appbar .back')?.click());
  await sleep(450);
};

await shot('短信', 'A1-sms.png');
await shot('电话', 'A2-calls.png');
await shot('鱼博', 'A3-feed.png');
await shot('鱼鉴', 'A4-dex.png');
await shot('渔具', 'A5-tackle.png');
await shot('枪铺', 'A6-guns.png');
await shot('设置', 'A7-settings.png');

console.log('errors:', errs.length, errs.slice(0, 3));
await browser.close();
