import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { skipStory } from './lib.mjs';

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

// 1) 造一份「已经推进很多」的存档
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
  s.trips = 12;
  s.money = 9000;
  s.unlocked = ['bay', 'ice'];
  s.maxDepth = { bay: 320, ice: 120 };
  s.caught = { sardine: 9, mackerel: 4, goldfish: 1, cod: 2 };
  s.fired = ['intro', 'introAfterFirst', 'firstTrip'];
  localStorage.setItem(k, JSON.stringify(s));
}, KEY);
await page.reload({ waitUntil: 'load' });
await sleep(1200);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('继续'));
  b?.click();
});
await sleep(900);
await skipStory(page);
await sleep(900);

const islandNow = await page.evaluate(() => {
  const el = document.querySelector('.island');
  return {
    cls: el?.className ?? null,
    text: el?.innerText?.replace(/\n/g, ' | ') ?? null,
    phase: window.__af?.debugState?.().phase ?? null,
  };
});
console.log('岛:', JSON.stringify(islandNow));

// 2) 点岛上的公告 → 应进手机通知栏，且不能开始钓鱼
if (islandNow.cls && islandNow.cls.includes('k-notice')) {
  await page.evaluate(() => document.querySelector('.island')?.click());
  await sleep(2200);
  const opened = await page.evaluate(() => ({
    phone: !!document.querySelector('.phone'),
    title: document.querySelector('.appbar .tt')?.textContent ?? null,
    phase: window.__af?.debugState?.().phase ?? null,
    rows: document.querySelectorAll('.ntf').length,
  }));
  console.log('点公告后:', JSON.stringify(opened));
  console.log('styles:', JSON.stringify(await page.evaluate(() => {
    const ph = document.querySelector('.phone');
    const body = document.querySelector('.phone-body');
    const ntf = document.querySelector('.ntf');
    const cs = (el) => el ? getComputedStyle(el) : null;
    return {
      bg: cs(ph)?.backgroundColor, op: cs(ph)?.opacity, tr: cs(ph)?.transform, an: cs(ph)?.animationName,
      bodyH: body?.clientHeight, scrollH: body?.scrollHeight,
      ntfFont: cs(ntf)?.fontSize, ntfH: ntf?.getBoundingClientRect().height,
    };
  })));
  await page.screenshot({ path: path.join(SHOTS, '96-notify.png') });
  await page.evaluate(() => { const w = document.querySelector('.phone-wrap'); if (w) w.style.backdropFilter = 'none'; });
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, '96b-notify-noblur.png') });

  // 3) 展开一条公告
  await page.evaluate(() => document.querySelector('.ntf.kind-notice')?.click());
  await sleep(400);
  const expanded = await page.evaluate(() => document.querySelector('.ntf.kind-notice .ntf-b')?.className ?? null);
  console.log('公告展开:', expanded);

  // 4) 点一条短信通知 → 应进短信会话
  const jumped = await page.evaluate(() => {
    const row = document.querySelector('.ntf.kind-sms');
    if (!row) return false;
    row.click();
    return true;
  });
  await sleep(700);
  const smsView = await page.evaluate(() => ({
    bar: document.querySelector('.appbar, .bar, .app-bar')?.innerText ?? null,
    thread: !!document.querySelector('.msg'),
  }));
  console.log('点短信通知:', jumped, JSON.stringify(smsView));
  await page.screenshot({ path: path.join(SHOTS, '97-notify-jump.png') });
} else {
  console.log('没有公告可点，直接开手机验通知栏');
  await page.evaluate(() => {
    const b = (document.querySelector('.phone-fab') ?? [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('手机')));
    b?.click();
  });
  await sleep(700);
  await page.evaluate(() => document.querySelector('.phone-bell')?.click());
  await sleep(600);
  const rows = await page.evaluate(() => document.querySelectorAll('.ntf').length);
  console.log('通知栏条数:', rows);
  await page.screenshot({ path: path.join(SHOTS, '96-notify.png') });
}

// 5) 关手机后仍应是 idle，不能偷偷开始钓鱼
await page.evaluate(() => {
  const b = document.querySelector('.phone-fold');
  b?.click();
});
await sleep(500);
console.log(
  '关手机后:',
  JSON.stringify(
    await page.evaluate(() => ({
      phase: window.__af?.debugState?.().phase ?? null,
      result: !!document.querySelector('.result-total'),
    })),
  ),
);

console.log('errors:', errs.length, errs.slice(0, 3));
await browser.close();
