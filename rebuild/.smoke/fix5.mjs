/** 五项修复验证：结算文字 / 短信已读 / 去掉画质 / 鱼鉴详情 / 手机浮层 */
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
  s.trips = 6;
  s.money = 8420;
  s.maxDepth = { bay: 128 };
  s.caught = { sardine: 12, yellow: 7 };
  s.seen = {};
  s.messages = [
    { id: 'm1', thread: 'mom', text: '约不到鱼别回来吃饭。', trip: 5 },
    { id: 'm2', thread: 'mom', text: '记得穿外套。', trip: 5 },
    { id: 'm3', thread: 'dapao', text: '来我店里看看，霰弹枪打鱼，一枪一盘刺身！', trip: 2 },
  ];
  s.fired = ['prologue','kevin','north','ending','intro','introAfterFirst','firstTrip','d60','money400','trip3','jelly1','d120','bottle1','species7','d200','goldfish','iceHint','unlockReady','iceUnlocked','iceTrip1','ice300','legend','allSpecies'];
  s.queue = [];
  s.unread = { sms: 3 };
  s.unreadKey = { sms: 3 };
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

// ── 5. 手机浮层：高度、背景可见、HUD 让位
await page.evaluate(() => document.querySelector('.phone-fab')?.click());
await sleep(160);
await page.screenshot({ path: path.join(SHOTS, 'B0-phone-in.png') });
await sleep(500);
const wrap = await page.evaluate(() => {
  const p = document.querySelector('.phone');
  const w = document.querySelector('.phone-wrap');
  const h = document.querySelector('.hud-shell');
  const b = p?.getBoundingClientRect();
  const cs = w ? getComputedStyle(w) : null;
  return {
    phoneH: b ? Math.round(b.height) : null,
    phoneTop: b ? Math.round(b.top) : null,
    screenH: innerHeight,
    ratio: b ? +(b.height / innerHeight).toFixed(2) : null,
    wrapBg: cs?.backgroundImage?.slice(0, 40),
    hudGone: !!h?.classList.contains('gone'),
    hudOpacity: h ? getComputedStyle(h).opacity : null,
  };
});
console.log('手机浮层:', JSON.stringify(wrap));
await page.screenshot({ path: path.join(SHOTS, 'B1-phone-sheet.png') });

// ── 2. 短信已读
await page.evaluate(() => {
  const i = [...document.querySelectorAll('.app-icon')].find((x) => (x.textContent || '').includes('短信'));
  i?.click();
});
await sleep(650);
const before = await page.evaluate(() => ({
  head: document.querySelector('.appbar .tag')?.textContent ?? null,
  rows: [...document.querySelectorAll('.thread')].map((t) => ({
    name: t.querySelector('b')?.textContent,
    n: t.querySelector('.n')?.textContent ?? null,
  })),
}));
console.log('进短信（未读）:', JSON.stringify(before));
// 点第一条会话
await page.evaluate(() => document.querySelectorAll('.thread')[0]?.click());
await sleep(500);
await page.screenshot({ path: path.join(SHOTS, 'B2-sms-open.png') });
await page.evaluate(() => document.querySelector('.appbar .back')?.click());
await sleep(500);
const after = await page.evaluate(() => ({
  head: document.querySelector('.appbar .tag')?.textContent ?? null,
  readTag: !!document.querySelector('.appbar .tag.read'),
  rows: [...document.querySelectorAll('.thread')].map((t) => ({
    name: t.querySelector('b')?.textContent,
    n: t.querySelector('.n')?.textContent ?? null,
  })),
}));
console.log('第一条读完后:', JSON.stringify(after));
await page.screenshot({ path: path.join(SHOTS, 'B3-sms-read.png') });
// 再把剩下那条也点开，顶部角标应彻底变成「已读」
await page.evaluate(() => document.querySelectorAll('.thread')[1]?.click());
await sleep(420);
await page.evaluate(() => document.querySelector('.appbar .back')?.click());
await sleep(500);
const allRead = await page.evaluate(() => ({
  head: document.querySelector('.appbar .tag')?.textContent ?? null,
  readTag: !!document.querySelector('.appbar .tag.read'),
  badges: [...document.querySelectorAll('.thread .n')].map((n) => n.textContent),
}));
console.log('全部读完后:', JSON.stringify(allRead));
await page.screenshot({ path: path.join(SHOTS, 'B3b-sms-allread.png') });

// ── 4. 鱼鉴详情
await page.evaluate(() => document.querySelector('.appbar .back')?.click());
await sleep(400);
await page.evaluate(() => {
  const i = [...document.querySelectorAll('.app-icon')].find((x) => (x.textContent || '').includes('鱼鉴'));
  i?.click();
});
await sleep(600);
await page.evaluate(() => document.querySelectorAll('.dex-cell')[0]?.click());
await sleep(700);
const dex = await page.evaluate(() => {
  const hero = document.querySelector('.dex-hero');
  const desc = document.querySelector('.dex-desc');
  const b = hero?.getBoundingClientRect();
  return {
    heroH: b ? Math.round(b.height) : null,
    descColor: desc ? getComputedStyle(desc).color : null,
    descBg: desc ? getComputedStyle(desc).backgroundColor : null,
  };
});
console.log('鱼鉴详情:', JSON.stringify(dex));
await page.screenshot({ path: path.join(SHOTS, 'B4-dex-detail.png') });
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('关闭'));
  b?.click();
});
await sleep(400);
await page.evaluate(() => document.querySelector('.appbar .back')?.click());
await sleep(400);
await page.evaluate(() => document.querySelector('.phone-bar .home')?.click());
await sleep(400);

// ── 3. 暂停面板（无画质）
await page.keyboard.press('Escape');
await sleep(600);
const pause = await page.evaluate(() => {
  const body = document.querySelector('.sheet-body');
  return {
    opened: !!body,
    text: body?.innerText.replace(/\n/g, ' | '),
    hasQuality: (body?.innerText || '').includes('画质'),
  };
});
console.log('暂停面板:', JSON.stringify(pause));
await page.screenshot({ path: path.join(SHOTS, 'B5-pause.png') });
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('继续钓鱼'));
  b?.click();
});
await sleep(500);

// ── 1. 结算
await page.evaluate(() => window.__af?.finish());
await sleep(900);
const result = await page.evaluate(() => {
  const row = document.querySelector('.result-msgs .rm-row span');
  const cap = document.querySelector('.result-total .cap');
  return {
    msgColor: row ? getComputedStyle(row).color : null,
    capColor: cap ? getComputedStyle(cap).color : null,
  };
});
console.log('结算文字:', JSON.stringify(result));
await page.screenshot({ path: path.join(SHOTS, 'B6-result.png') });

console.log('errors:', errs.length, errs.slice(0, 3));
await browser.close();
